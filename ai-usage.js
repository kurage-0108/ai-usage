// AI使用量ウィジェット（Scriptable）
// 設定は不要です（データの URL は設定済み。ウィジェットのパラメータも空のままで動きます）。
// 各行をタップすると、そのサービスのアプリまたはサイトが開きます（中・大サイズ。
// 小サイズは iOS の仕様でタップ先を1つしか持てないため、行ごとには開きません）。
// 小サイズは先頭3件、中・大サイズは5件まで表示します。

const JSON_URL = "https://raw.githubusercontent.com/kurage-0108/ai-usage/main/usage.json";

const REFRESH_MINUTES = 15;

// サービス id → タップ先とアイコン（SF Symbols。候補を先頭から試し、存在するものを使う）
const SERVICES = {
  muse: { url: "https://muse.ai", symbols: ["sparkles", "star.fill"] },
  claude: { url: "claude://", symbols: ["asterisk", "staroflife.fill", "sun.max.fill"] },
  chatgpt: { url: "chatgpt://", symbols: ["camera.aperture", "circle.hexagongrid.fill", "hexagon.fill"] },
  gemini: { url: "https://antigravity.google", symbols: ["arrow.up", "chevron.up"] },
  grok: { url: "https://grok.com", symbols: ["bolt.fill", "bolt"] },
};

// ---------- 色（ライト / ダーク） ----------

function dyn(light, dark) {
  const l = new Color(light);
  return typeof Color.dynamic === "function" ? Color.dynamic(l, new Color(dark)) : l;
}

const C = {
  bg: dyn("#FFFFFF", "#1C1C1E"),
  text: dyn("#1D1D1F", "#F5F5F7"),
  muted: dyn("#7C7C80", "#98989D"),
  separator: dyn("#DCDCE0", "#3A3A3C"),
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
    rows: 5, pad: [12, 14, 12, 14], maxSlot: 32, separators: true,
    badge: 20, radius: 5.5, glyph: 11, gap: 8,
    name: 13,
    secW: 54, mainW: 66, colGap: 10, capH: 12, capGap: 3, caption: 9.5, resetIcon: 7.5,
    bar: 4, miniBar: 3,
    heroGap: 6, heroDigits: 19, heroPct: 11, heroW: 52,
    note: 10,
  },
  large: {
    rows: 5, pad: [16, 16, 16, 16], maxSlot: 72, separators: true,
    badge: 26, radius: 7, glyph: 14, gap: 10,
    name: 15, reset: 11, resetIcon: 9, resetW: 88,
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
  try {
    data = await loadData();
  } catch (e) {
    console.log(`usage.json を取得できませんでした: ${e}`);
  }

  const services = data ? data.services.filter(isObject).slice(0, L.rows) : [];
  let widget;
  if (!services.length) {
    widget = messageWidget("データを取得できませんでした", L);
  } else {
    try {
      widget = buildWidget(services, family, L);
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

async function loadData() {
  const req = new Request(JSON_URL);
  req.timeoutInterval = 15;
  const data = await req.loadJSON();
  if (!isObject(data) || !Array.isArray(data.services)) throw new Error("想定外の形式");
  return data;
}

function buildWidget(services, family, L) {
  const size = widgetSize(family);
  const [pt, pl, pb, pr] = L.pad;
  const hair = hairline();
  const n = services.length;
  const separators = L.separators ? n - 1 : 0;
  // 行は高さ固定のスロットで並べる（見積もりが実寸より小さい時は全体が中央に寄るだけ）
  const avail = size.h - pt - pb - separators * hair;
  const ctx = {
    contentW: size.w - pl - pr,
    slot: Math.min(L.maxSlot, Math.floor((avail / n) * 2) / 2),
    glyphs: loadGlyphs(services),
    resetIcon: symbolImage(["arrow.clockwise"], "medium"),
    links: family !== "small",
  };

  const widget = new ListWidget();
  widget.backgroundColor = C.bg;
  widget.setPadding(pt, pl, pb, pr);
  widget.spacing = 0;

  services.forEach((s, i) => {
    if (i > 0 && L.separators) addSeparator(widget, L.badge + L.gap, hair);
    const row = widget.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    row.spacing = 0;
    row.size = new Size(0, ctx.slot);
    const url = ctx.links ? urlFor(s) : null;
    if (url) row.url = url;

    if (family === "small") smallRow(row, s, L, ctx);
    else if (family === "large") largeRow(row, s, L, ctx);
    else mediumRow(row, s, L, ctx);
  });
  return widget;
}

// 中: [アイコン] 名前 …… [5時間 % / ミニバー] [↻ リセット / バー] 残り%
function mediumRow(row, s, L, ctx) {
  const { primary, secondary } = pickWindows(s);
  addBadge(row, s, L, ctx, !primary);
  row.addSpacer(L.gap);
  addName(row, s, L.name, !primary);
  row.addSpacer();
  if (!primary) {
    addNote(row, statusText(s), L.note);
    return;
  }
  if (secondary) {
    statColumn(row, L, L.secW, remainingOf(secondary), L.miniBar,
      (cap) => statCaption(cap, secondary, L.caption));
    row.addSpacer(L.colGap);
  }
  const reset = resetText(primary);
  statColumn(row, L, L.mainW, remainingOf(primary), L.bar,
    reset ? (cap) => resetCaption(cap, reset, L.caption, L.resetIcon, ctx) : null);
  row.addSpacer(L.heroGap);
  addHero(row, remainingOf(primary), L, L.heroW);
}

// 大: 1段目 [アイコン] 名前 …… [5時間 % / ミニバー / ↻] 残り%
//     2段目 名前の位置から始まるバー …… ↻ リセット（残り% の真下、右端にそろえる）
function largeRow(row, s, L, ctx) {
  const { primary, secondary } = pickWindows(s);
  const body = row.addStack();
  body.layoutVertically();
  body.spacing = L.tierGap;

  const top = body.addStack();
  top.layoutHorizontally();
  top.centerAlignContent();
  addBadge(top, s, L, ctx, !primary);
  top.addSpacer(L.gap);
  addName(top, s, L.name, !primary);
  top.addSpacer();
  if (!primary) {
    addNote(top, statusText(s), L.note);
    return;
  }
  if (secondary) {
    const col = top.addStack();
    col.layoutVertically();
    col.spacing = 3;
    col.size = new Size(L.secW, 0);
    statCaption(col.addStack(), secondary, L.caption);
    addBar(col, L.secW, L.miniBar, remainingOf(secondary));
    const secReset = resetText(secondary);
    if (secReset) resetCaption(col.addStack(), secReset, L.secReset, L.secResetIcon, ctx);
    top.addSpacer(L.colGap);
  }
  addHero(top, remainingOf(primary), L, L.heroW);

  // バーは全行同じ長さ。幅の見積もり誤差は、バーとリセット時刻の間の余白が吸収する
  const indent = L.badge + L.gap;
  const bottom = body.addStack();
  bottom.layoutHorizontally();
  bottom.centerAlignContent();
  bottom.setPadding(0, indent, 0, 0);
  addBar(bottom, Math.floor(ctx.contentW - indent - L.resetW), L.bar, remainingOf(primary));
  bottom.addSpacer();
  const reset = resetText(primary);
  if (reset) resetCaption(bottom.addStack(), reset, L.reset, L.resetIcon, ctx);
}

// 小: [アイコン] 名前
//            バー …… 残り%
function smallRow(row, s, L, ctx) {
  const { primary } = pickWindows(s);
  addBadge(row, s, L, ctx, !primary);
  row.addSpacer(L.gap);
  const col = row.addStack();
  col.layoutVertically();
  col.spacing = L.lineGap;
  addName(col, s, L.name, !primary);
  const line = col.addStack();
  line.layoutHorizontally();
  line.centerAlignContent();
  if (!primary) {
    addNote(line, statusText(s), L.note);
    line.addSpacer();
    return;
  }
  const pct = remainingOf(primary);
  const barW = Math.max(24, Math.floor(ctx.contentW - L.badge - L.gap - L.heroMax - 8));
  addBar(line, barW, L.bar, pct);
  line.addSpacer();
  addHero(line, pct, L, 0);
}

// ---------- 部品 ----------

function addBadge(parent, s, L, ctx, muted) {
  const badge = parent.addStack();
  badge.layoutHorizontally();
  badge.centerAlignContent();
  badge.size = new Size(L.badge, L.badge);
  badge.cornerRadius = L.radius;
  badge.backgroundColor = C.badge;
  const url = ctx.links ? urlFor(s) : null;
  if (url) badge.url = url;

  badge.addSpacer();
  const img = ctx.glyphs.images[s.id];
  if (img) {
    // 全アイコンを同じ倍率で縮小し、SF Symbols 本来の大きさの釣り合いを保つ
    const k = L.glyph / ctx.glyphs.maxDim;
    const icon = badge.addImage(img);
    icon.imageSize = new Size(img.size.width * k, img.size.height * k);
    icon.tintColor = muted ? C.muted : C.glyph;
    if (url) icon.url = url;
  } else {
    const t = badge.addText(displayName(s).charAt(0).toUpperCase());
    t.font = roundedFont("bold", L.glyph);
    t.textColor = muted ? C.muted : C.glyph;
    t.lineLimit = 1;
  }
  badge.addSpacer();
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
  cap.size = new Size(0, L.capH);
  if (fillCaption) fillCaption(cap);
  addBar(col, width, L.bar, pct, thickness);
}

// 「5時間 73%」
function statCaption(st, w, size) {
  st.layoutHorizontally();
  st.centerAlignContent();
  const label = st.addText(String(w.label || ""));
  label.font = Font.systemFont(size);
  label.textColor = C.muted;
  label.lineLimit = 1;
  label.minimumScaleFactor = 0.7;
  st.addSpacer(Math.round(size * 0.35));
  const pct = remainingOf(w);
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
  const y = height - t;
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

// ---------- アイコン ----------

function loadGlyphs(services) {
  const images = {};
  let maxDim = 0;
  for (const s of services) {
    const meta = SERVICES[s.id];
    const img = meta ? symbolImage(meta.symbols, "semibold") : null;
    if (img) {
      images[s.id] = img;
      maxDim = Math.max(maxDim, img.size.width, img.size.height);
    }
  }
  return { images, maxDim };
}

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

function urlFor(s) {
  const meta = SERVICES[s.id];
  return meta ? meta.url : null;
}

// 主役は「週間」の窓（なければ最後の窓）、もう1つの窓を補助として小さく出す
function pickWindows(s) {
  const list = Array.isArray(s.windows) ? s.windows.filter(isObject) : [];
  if (!list.length) return { primary: null, secondary: null };
  let i = list.findIndex((w) => w.label === "週間");
  if (i < 0) i = list.length - 1;
  return { primary: list[i], secondary: list.find((_, j) => j !== i) || null };
}

function toNumber(v) {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function remainingOf(w) {
  if (!w) return null;
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

function parseTime(v) {
  if (typeof v !== "string") return null;
  const t = Date.parse(v.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isFinite(t) ? t : null;
}

function statusText(s) {
  return s.status === "unavailable" ? "アプリ内のみ" : "取得できません";
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
