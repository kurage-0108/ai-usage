// AI使用量ウィジェット（Scriptable）
// 設定は不要です（データの URL は設定済み。ウィジェットのパラメータも空のままで動きます）。
// 行をタップしても何も開きません（タップ動作は付けていません）。アイコンも付けていません。
// 中・大サイズは一番上に列見出し（週間／5時間）を1行だけ表示し、左端にデータの更新時刻を出します。
// 取得に失敗した時は前回成功時のデータを表示し、古いデータの間は更新時刻を警告色にします。
// 小サイズは先頭3件、中・大サイズは5件まで表示します。

const JSON_URL = "https://raw.githubusercontent.com/kurage-0108/ai-usage/main/usage.json";

const REFRESH_MINUTES = 15;

// ---------- 色（ライト / ダーク） ----------

function dyn(light, dark) {
  const l = new Color(light);
  return typeof Color.dynamic === "function" ? Color.dynamic(l, new Color(dark)) : l;
}

const C = {
  bg: dyn("#FFFFFF", "#1C1C1E"),
  text: dyn("#1D1D1F", "#F5F5F7"),
  muted: dyn("#7C7C80", "#98989D"),
  separator: dyn("#E8E8EC", "#2C2C2E"),
  badge: dyn("#F0F0F3", "#2C2C2E"),
  glyph: dyn("#3A3A3C", "#E5E5EA"),
  warn: dyn("#C26A00", "#FFB340"),
  bad: dyn("#D70015", "#FF6B60"),
};

// DrawContext は dynamic color を描けないため、バーは明暗どちらの背景にもなじむ固定色で描く
// （トラックは半透明のグレーなので、下の背景色に合わせて明るさが変わる）
const BAR = {
  track: new Color("#787880", 0.2),
  good: new Color("#34C759"),
  warn: new Color("#FF9F0A"),
  bad: new Color("#FF453A"),
};

// ---------- サイズ別レイアウト ----------

const LAYOUTS = {
  small: {
    rows: 3, pad: [12, 14, 12, 14], maxSlot: 52, separators: false,
    badge: 22, radius: 6, glyph: 12, gap: 9,
    name: 12.5, lineGap: 1,
    bar: 4, heroDigits: 18, heroPct: 10.5, heroMax: 42,
    note: 10,
  },
  medium: {
    rows: 5, pad: [10, 14, 10, 14], maxSlot: 32, separators: true,
    badge: 20, radius: 5.5, glyph: 11, gap: 8,
    name: 13, header: 9.5, headerH: 12, headerGap: 4,
    secW: 68, mainW: 84, colGap: 18, capH: 12, capGap: 2, caption: 9.5, resetIcon: 7.5,
    bar: 4, miniBar: 3,
    heroGap: 4, heroDigits: 19, heroPct: 11, heroW: 46,
    note: 10,
  },
  large: {
    rows: 5, pad: [16, 16, 16, 16], maxSlot: 72, separators: true,
    badge: 26, radius: 7, glyph: 14, gap: 10,
    name: 15, header: 10.5, headerH: 14, headerGap: 6, reset: 11, resetIcon: 9, resetW: 88,
    secW: 66, colGap: 12, caption: 10.5, secReset: 9.5, secResetIcon: 8,
    tierGap: 7, bar: 6, miniBar: 4,
    heroDigits: 26, heroPct: 14, heroW: 66,
    note: 11,
  },
};

// Apple 公開のウィジェット寸法（pt）。画面サイズ → [小, 中・大の幅, 中の高さ, 大の高さ]
const WIDGET_SIZES = {
  "430x932": [170, 364, 170, 382],
  "428x926": [170, 364, 170, 382],
  "414x896": [169, 360, 169, 379],
  "414x736": [159, 348, 157, 357],
  "393x852": [158, 338, 158, 354],
  "390x844": [158, 338, 158, 354],
  "375x812": [155, 329, 155, 345],
  "375x667": [148, 321, 148, 324],
  "360x780": [155, 329, 155, 345],
  "320x568": [141, 292, 141, 311],
};

const SYMBOL_RENDER_SIZE = 40;

// ---------- 本体 ----------

async function main() {
  const family = widgetFamily();
  const L = LAYOUTS[family];

  let data = null;
  let fromCache = false;
  try {
    data = await loadData();
  } catch (e) {
    console.log(`usage.json を取得できませんでした: ${e}`);
    data = loadCache();
    fromCache = !!data;
  }

  const services = data ? data.services.filter(isObject).slice(0, L.rows) : [];
  let widget;
  if (!services.length) {
    widget = messageWidget("データを取得できませんでした", L);
  } else {
    try {
      const updatedAtMs = parseTime(data.updated_at);
      const stale = fromCache || (updatedAtMs != null && Date.now() - updatedAtMs > 2 * 60 * 60 * 1000);
      widget = buildWidget(services, family, L, { updatedText: data.updated_text, updatedAtMs, stale });
    } catch (e) {
      console.error(e);
      widget = messageWidget("表示できませんでした", L);
    }
  }
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);

  if (runsInWidget()) {
    Script.setWidget(widget);
  } else {
    await preview(widget, family);
  }
  Script.complete();
}

const CACHE_FILE = "ai-usage-cache.json";

async function loadData() {
  const req = new Request(JSON_URL);
  req.timeoutInterval = 15;
  const text = await req.loadString();
  const data = JSON.parse(text);
  if (!isObject(data) || !Array.isArray(data.services)) throw new Error("想定外の形式");
  try {
    const fm = FileManager.local();
    fm.writeString(fm.joinPath(fm.cacheDirectory(), CACHE_FILE), text);
  } catch (e) {
    // キャッシュ保存の失敗は表示に影響させない
  }
  return data;
}

// 取得に失敗した時は、前回成功した時のデータを返す
function loadCache() {
  try {
    const fm = FileManager.local();
    const path = fm.joinPath(fm.cacheDirectory(), CACHE_FILE);
    if (!fm.fileExists(path)) return null;
    const data = JSON.parse(fm.readString(path));
    if (!isObject(data) || !Array.isArray(data.services)) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function buildWidget(services, family, L, meta) {
  const size = widgetSize(family);
  const [pt, pl, pb, pr] = L.pad;
  const hair = hairline();
  const n = services.length;
  const separators = L.separators ? n - 1 : 0;
  // 行は高さ固定のスロットで並べる（見積もりが実寸より小さい時は全体が中央に寄るだけ）
  const headerH = family === "small" ? 0 : L.headerH + L.headerGap;
  const avail = size.h - pt - pb - separators * hair - headerH;
  const ctx = {
    contentW: size.w - pl - pr,
    slot: Math.min(L.maxSlot, Math.floor((avail / n) * 2) / 2),
    resetIcon: symbolImage(["arrow.clockwise"], "medium"),
    clockIcon: symbolImage(["clock"], "medium"),
    updatedAtMs: meta.updatedAtMs,
  };

  const widget = new ListWidget();
  widget.backgroundColor = C.bg;
  widget.setPadding(pt, pl, pb, pr);
  widget.spacing = 0;

  if (family !== "small") {
    addHeader(widget, services, L, family, meta, ctx);
    widget.addSpacer(L.headerGap);
  }

  services.forEach((s, i) => {
    if (i > 0 && L.separators) addSeparator(widget, 0, hair);
    const row = widget.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    row.spacing = 0;
    row.size = new Size(0, ctx.slot);

    if (family === "small") smallRow(row, s, L, ctx);
    else if (family === "large") largeRow(row, s, L, ctx);
    else mediumRow(row, s, L, ctx);
  });
  return widget;
}

// 中: 名前 …… [5時間 ↻リセット % / ミニバー] [↻ リセット / バー] 残り%
function mediumRow(row, s, L, ctx) {
  const { primary, secondary } = pickWindows(s);
  const none = !primary && !secondary;
  addName(row, s, L.name, none);
  row.addSpacer();
  if (none) {
    addNote(row, statusText(s), L.note);
    return;
  }
  if (secondary) {
    statColumn(row, L, L.secW, remainingOf(secondary, ctx), L.miniBar,
      (cap) => statCaption(cap, secondary, L.caption, true, ctx));
    row.addSpacer(L.colGap);
  }
  const reset = resetText(primary);
  statColumn(row, L, L.mainW, remainingOf(primary, ctx), L.bar,
    reset ? (cap) => resetCaption(cap, reset, L.caption, L.resetIcon, ctx) : null);
  row.addSpacer(L.heroGap);
  addHero(row, remainingOf(primary, ctx), L, L.heroW);
}

// 大: 1段目 名前 …… [5時間 % / ミニバー / ↻] 残り%
//     2段目 左端から始まるバー …… ↻ リセット（残り% の真下、右端にそろえる）
function largeRow(row, s, L, ctx) {
  const { primary, secondary } = pickWindows(s);
  const body = row.addStack();
  body.layoutVertically();
  body.spacing = L.tierGap;

  const top = body.addStack();
  top.layoutHorizontally();
  top.centerAlignContent();
  const none = !primary && !secondary;
  addName(top, s, L.name, none);
  top.addSpacer();
  if (none) {
    addNote(top, statusText(s), L.note);
    return;
  }
  if (secondary) {
    const col = top.addStack();
    col.layoutVertically();
    col.spacing = 3;
    col.size = new Size(L.secW, 0);
    statCaption(col.addStack(), secondary, L.caption, false, ctx);
    addBar(col, L.secW, L.miniBar, remainingOf(secondary, ctx));
    const secReset = resetText(secondary);
    if (secReset) resetCaption(col.addStack(), secReset, L.secReset, L.secResetIcon, ctx);
    top.addSpacer(L.colGap);
  }
  addHero(top, remainingOf(primary, ctx), L, L.heroW);

  // バーは全行同じ長さ。幅の見積もり誤差は、バーとリセット時刻の間の余白が吸収する
  const indent = 0;
  const bottom = body.addStack();
  bottom.layoutHorizontally();
  bottom.centerAlignContent();
  bottom.setPadding(0, indent, 0, 0);
  addBar(bottom, Math.floor(ctx.contentW - indent - L.resetW), L.bar, remainingOf(primary, ctx));
  bottom.addSpacer();
  const reset = resetText(primary);
  if (reset) resetCaption(bottom.addStack(), reset, L.reset, L.resetIcon, ctx);
}

// 小: 名前
//     バー …… 残り%
function smallRow(row, s, L, ctx) {
  const { primary, secondary } = pickWindows(s);
  const w = primary || secondary;
  const col = row.addStack();
  col.layoutVertically();
  col.spacing = L.lineGap;
  addName(col, s, L.name, !w);
  const line = col.addStack();
  line.layoutHorizontally();
  line.centerAlignContent();
  if (!w) {
    addNote(line, statusText(s), L.note);
    line.addSpacer();
    return;
  }
  const pct = remainingOf(w, ctx);
  const barW = Math.max(24, Math.floor(ctx.contentW - L.heroMax - 8));
  addBar(line, barW, L.bar, pct);
  line.addSpacer();
  addHero(line, pct, L, 0);
}

// ---------- 部品 ----------

// 一番上に1行だけ置く列見出し（5時間／週間）。左端にデータの更新時刻（アイコン＋時刻）。
// 列の並びは各行とまったく同じ幅構成にして、見出しと列の位置をそろえる
function addHeader(widget, services, L, family, meta, ctx) {
  const head = widget.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  head.size = new Size(0, L.headerH);
  const updatedText = meta.updatedText;
  if (typeof updatedText === "string" && updatedText.trim()) {
    // 古いデータ（キャッシュ利用時・更新停止時）は更新時刻を警告色にして区別する
    const color = meta.stale ? C.warn : C.muted;
    // 更新時刻は「過去」の印として時計アイコンにする（各行のリセット時刻の↻と区別する）
    const updIcon = ctx.clockIcon || ctx.resetIcon;
    if (updIcon) {
      const icon = head.addImage(updIcon);
      icon.imageSize = sizeForHeight(updIcon, Math.max(6, L.header - 2));
      icon.tintColor = color;
      head.addSpacer(3);
    }
    const u = head.addText(updatedText.trim());
    u.font = roundedFont("medium", L.header);
    u.textColor = color;
    u.lineLimit = 1;
  }
  head.addSpacer();
  const hasSec = services.some((s) => pickWindows(s).secondary);
  if (hasSec) {
    const c1 = head.addStack();
    c1.layoutHorizontally();
    c1.size = new Size(L.secW, 0);
    const t1 = c1.addText("5時間");
    t1.font = systemFont("semibold", L.header);
    t1.textColor = C.muted;
    t1.lineLimit = 1;
    c1.addSpacer();
    head.addSpacer(L.colGap);
  }
  const c2 = head.addStack();
  c2.layoutHorizontally();
  c2.size = new Size(L.mainW || L.heroW, 0);
  // 中サイズは直下の列の左端にそろえる。大サイズの直下は右寄せの大きな数字なので右に寄せる
  if (family !== "medium") c2.addSpacer();
  const t2 = c2.addText("週間");
  t2.font = systemFont("semibold", L.header);
  t2.textColor = C.muted;
  t2.lineLimit = 1;
  if (family === "medium") c2.addSpacer();
  if (family === "medium") {
    // 中サイズの行は主列の右に残り% の列がある。見出し側にも同じ幅を空けないと列が右にずれる
    head.addSpacer(L.heroGap);
    const tail = head.addStack();
    tail.size = new Size(L.heroW, 0);
  }
}

function addName(parent, s, size, muted) {
  const t = parent.addText(displayName(s));
  t.font = systemFont("semibold", size);
  t.textColor = muted ? C.muted : C.text;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.75;
}

function addNote(parent, text, size) {
  const t = parent.addText(text);
  t.font = Font.systemFont(size);
  t.textColor = C.muted;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.8;
}

// 残り% の大きな数字。「%」は小さく添え、下端をそろえてベースラインを合わせる
function addHero(parent, pct, L, width) {
  const hero = parent.addStack();
  hero.layoutHorizontally();
  hero.bottomAlignContent();
  if (width) {
    hero.size = new Size(width, 0);
    hero.addSpacer();
  }
  if (pct == null) {
    const t = hero.addText("—");
    t.font = roundedFont("semibold", L.heroDigits * 0.8);
    t.textColor = C.muted;
    return;
  }
  const value = Math.round(pct);
  const color = emphasis(value);
  const digits = hero.addText(String(value));
  digits.font = roundedFont("bold", L.heroDigits);
  digits.textColor = color;
  digits.lineLimit = 1;
  digits.minimumScaleFactor = 0.7;

  const unit = hero.addStack();
  unit.setPadding(0, 1, baselineLift(L.heroDigits, L.heroPct), 0);
  const p = unit.addText("%");
  p.font = roundedFont("semibold", L.heroPct);
  p.textColor = color;
  p.textOpacity = 0.6;
  p.lineLimit = 1;
}

// 中サイズの列: 上に小さな見出し（高さ固定）、下にバー。
// バーの描画領域はどの列も同じ高さにし、見出しとバーの位置を行内でそろえる
function statColumn(parent, L, width, pct, thickness, fillCaption) {
  const col = parent.addStack();
  col.layoutVertically();
  col.spacing = L.capGap;
  col.size = new Size(width, 0);
  const cap = col.addStack();
  cap.layoutHorizontally();
  cap.centerAlignContent();
  cap.size = new Size(width, L.capH);
  if (fillCaption) fillCaption(cap);
  addBar(col, width, L.bar, pct, thickness);
}

// 「↻04:40 73%」（列見出しが一番上にあるので、行ごとに窓の名前は書かない）
// 並びは週間に寄せる: リセット（週間と同じアイコン画像＋時刻）→ 残量% の順。
// withReset でない時は残量% だけ
function statCaption(st, w, size, withReset, ctx) {
  st.layoutHorizontally();
  st.centerAlignContent();
  if (withReset) {
    const rt = shortResetText(w);
    if (rt) {
      let label = rt;
      if (ctx.resetIcon) {
        const icon = st.addImage(ctx.resetIcon);
        icon.imageSize = sizeForHeight(ctx.resetIcon, Math.max(6, size - 2));
        icon.tintColor = C.muted;
        st.addSpacer(Math.max(1.5, Math.round(size * 0.5) / 2));
      } else {
        label = `↻${rt}`;
      }
      const r = st.addText(label);
      r.font = roundedFont("medium", size);
      r.textColor = C.muted;
      r.lineLimit = 1;
      r.minimumScaleFactor = 0.7;
      // 残量% は列の右端に寄せ、% の縦列をミニバーの右端とそろえる
      st.addSpacer();
    }
  }
  const pct = remainingOf(w, ctx);
  const value = st.addText(pct == null ? "—" : `${Math.round(pct)}%`);
  value.font = roundedFont("semibold", size);
  value.textColor = pct == null ? C.muted : emphasis(Math.round(pct));
  value.lineLimit = 1;
  value.minimumScaleFactor = 0.7;
}

// 「↻ 11/25 06:00」
function resetCaption(st, text, size, iconH, ctx) {
  st.layoutHorizontally();
  st.centerAlignContent();
  let label = text;
  if (ctx.resetIcon) {
    const icon = st.addImage(ctx.resetIcon);
    icon.imageSize = sizeForHeight(ctx.resetIcon, iconH);
    icon.tintColor = C.muted;
    st.addSpacer(Math.max(1.5, Math.round(size * 0.5) / 2));
  } else {
    label = `↻ ${text}`;
  }
  const t = st.addText(label);
  t.font = roundedFont("medium", size);
  t.textColor = C.muted;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.7;
}

function addSeparator(widget, inset, hair) {
  const wrap = widget.addStack();
  wrap.layoutHorizontally();
  wrap.setPadding(0, inset, 0, 0);
  wrap.size = new Size(0, hair);
  const line = wrap.addStack();
  line.size = new Size(0, hair);
  line.backgroundColor = C.separator;
  line.addSpacer();
}

// thickness を height より細くすると、描画領域の下端にそろえて細いバーを描く
function addBar(parent, width, height, pct, thickness) {
  const w = Math.max(Math.round(width), Math.ceil(height) + 1);
  const bar = parent.addImage(barImage(w, height, pct, thickness || height));
  bar.imageSize = new Size(w, height);
  return bar;
}

// 角丸のトラック＋角丸の塗り。0% はトラックのみ、0% より上は最低でも丸1つ分を塗る
function barImage(width, height, pct, thickness) {
  const t = Math.min(height, thickness);
  // 細いバーは枠の中央に置く（下端寄せだとキャプションとの間隔が列ごとにずれて見える）
  const y = (height - t) / 2;
  const ctx = new DrawContext();
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  ctx.size = new Size(width, height);
  fillRounded(ctx, new Rect(0, y, width, t), BAR.track);
  if (pct != null && pct > 0) {
    const fillW = Math.min(width, Math.max(t, (width * pct) / 100));
    fillRounded(ctx, new Rect(0, y, fillW, t), BAR[level(Math.round(pct))]);
  }
  return ctx.getImage();
}

function fillRounded(ctx, rect, color) {
  const r = Math.max(0, Math.min(rect.width, rect.height) / 2 - 0.01);
  const path = new Path();
  path.addRoundedRect(rect, r, r);
  ctx.addPath(path);
  ctx.setFillColor(color);
  ctx.fillPath();
}

function messageWidget(message, L) {
  const widget = new ListWidget();
  widget.backgroundColor = C.bg;
  const [pt, pl, pb, pr] = L.pad;
  widget.setPadding(pt, pl, pb, pr);
  widget.addSpacer();
  const row = widget.addStack();
  row.layoutHorizontally();
  row.addSpacer();
  const t = row.addText(message);
  t.font = Font.systemFont(L.note + 1);
  t.textColor = C.muted;
  t.centerAlignText();
  t.lineLimit = 2;
  t.minimumScaleFactor = 0.8;
  row.addSpacer();
  widget.addSpacer();
  return widget;
}

// ---------- シンボル ----------

function symbolImage(names, weight) {
  if (typeof SFSymbol === "undefined") return null;
  for (const name of names) {
    try {
      const sym = SFSymbol.named(name);
      if (!sym) continue;
      sym.applyFont(systemFont(weight, SYMBOL_RENDER_SIZE));
      const img = sym.image;
      if (img && img.size && img.size.width > 0 && img.size.height > 0) return img;
    } catch (e) {
      // 次の候補を試す
    }
  }
  return null;
}

function sizeForHeight(img, h) {
  const ratio = img.size.width / img.size.height;
  return new Size(Math.round(h * ratio * 2) / 2, h);
}

// ---------- データの読み取り ----------

function isObject(v) {
  return v !== null && typeof v === "object";
}

function displayName(s) {
  if (typeof s.name === "string" && s.name.trim()) return s.name.trim();
  return s.id != null ? String(s.id) : "—";
}

// 主列は「週間」の窓に固定し、もう1つの窓を補助として小さく出す。
// 週間が欠けている行は主列を空（—）にし、別の期間の数値を週間として見せない
function pickWindows(s) {
  const list = Array.isArray(s.windows) ? s.windows.filter(isObject) : [];
  const primary = list.find((w) => w.label === "週間") || null;
  const secondary = list.find((w) => w !== primary) || null;
  return { primary, secondary };
}

function toNumber(v) {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function remainingOf(w, ctx) {
  if (!w) return null;
  // データ取得後にリセットを過ぎた窓は、古い残量を現在値として出さない。
  // 取得時刻より前にリセット済みの窓は、生成側が反映済みなのでそのまま出す
  const at = parseTime(w.resets_at);
  if (at != null && at <= Date.now() && ctx && ctx.updatedAtMs != null && ctx.updatedAtMs < at) return null;
  let r = toNumber(w.remaining_pct);
  if (r == null) {
    const used = toNumber(w.used_pct);
    if (used != null) r = 100 - used;
  }
  return r == null ? null : Math.min(100, Math.max(0, r));
}

// reset_text がある時だけ表示。すでに過ぎたリセット時刻は出さない
function resetText(w) {
  const text = w && typeof w.reset_text === "string" ? w.reset_text.trim() : "";
  if (!text) return null;
  const at = parseTime(w.resets_at);
  if (at != null && at <= Date.now()) return null;
  return text;
}

// 狭い列向けの短いリセット表記。当日なら「04:40」、別日なら「11/25」
function shortResetText(w) {
  const full = resetText(w);
  if (!full) return null;
  const at = parseTime(w.resets_at);
  if (at == null) return full;
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  // 24時間以内なら時刻、それより先なら日付。当日判定だと日付またぎで肝心の時刻が消える
  if (at - Date.now() < 24 * 60 * 60 * 1000) return `${hh}:${mm}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function parseTime(v) {
  if (typeof v !== "string") return null;
  const t = Date.parse(v.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isFinite(t) ? t : null;
}

function statusText(s) {
  return s.status === "manual" ? "手動確認" : "取得できません";
}

// 残り% → 緑（>45）/ 琥珀（≤45）/ 赤（≤20）
function level(value) {
  if (value <= 20) return "bad";
  if (value <= 45) return "warn";
  return "good";
}

// 数字は普段は本文色、残りが少ない時だけ色を付ける
function emphasis(value) {
  const lv = level(value);
  return lv === "good" ? C.text : C[lv];
}

// ---------- 環境 ----------

function widgetFamily() {
  const f = typeof config !== "undefined" && config ? config.widgetFamily : null;
  if (f === "small" || f === "systemSmall") return "small";
  if (f === "large" || f === "extraLarge" || f === "systemLarge" || f === "systemExtraLarge") return "large";
  return "medium";
}

function runsInWidget() {
  return typeof config !== "undefined" && !!config && !!config.runsInWidget;
}

async function preview(widget, family) {
  if (family === "small") await widget.presentSmall();
  else if (family === "large") await widget.presentLarge();
  else await widget.presentMedium();
}

function widgetSize(family) {
  let s = null;
  try {
    const scr = Device.screenSize();
    const w = Math.round(Math.min(scr.width, scr.height));
    const h = Math.round(Math.max(scr.width, scr.height));
    s = WIDGET_SIZES[`${w}x${h}`] || null;
    if (!s && !Device.isPad()) {
      // 未知の iPhone は実寸より小さめに見積もる（はみ出すより余白が少し増える方が安全）
      s = [Math.floor(w * 0.38), Math.floor(w * 0.83), Math.floor(w * 0.38), Math.floor(w * 0.86)];
    }
  } catch (e) {
    s = null;
  }
  if (!s) s = [141, 292, 141, 292];
  if (family === "small") return { w: s[0], h: s[0] };
  if (family === "large") return { w: s[1], h: s[3] };
  return { w: s[1], h: s[2] };
}

function hairline() {
  try {
    const scale = Device.screenScale();
    if (scale > 0) return 1 / scale;
  } catch (e) {
    // 既定値を使う
  }
  return 0.5;
}

function baselineLift(big, small) {
  return Math.round((big - small) * 0.24 * 2) / 2;
}

function systemFont(weight, size) {
  const fn = Font[`${weight}SystemFont`];
  return typeof fn === "function" ? fn.call(Font, size) : Font.systemFont(size);
}

function roundedFont(weight, size) {
  const fn = Font[`${weight}RoundedSystemFont`];
  return typeof fn === "function" ? fn.call(Font, size) : systemFont(weight, size);
}

await main();
