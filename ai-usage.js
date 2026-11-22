// AI使用量ウィジェット (Scriptable)
// 使い方: 下の JSON_URL を、公開した usage.json の URL に書き換えてください。
// ウィジェットをホーム画面に置く時は、このスクリプトのウィジェット設定で
// 「Run Script」ではなく通常表示のままにし、パラメータは空で大丈夫です。

const JSON_URL = "https://raw.githubusercontent.com/kurage-0108/ai-usage/main/usage.json";

function barImage(pct, color) {
  const w = 110, h = 7;
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.setFillColor(new Color("#888888", 0.25));
  const bg = new Path();
  bg.addRoundedRect(new Rect(0, 0, w, h), 3, 3);
  ctx.addPath(bg);
  ctx.fillPath();
  const fgW = Math.max(4, Math.round(w * Math.min(100, Math.max(0, pct)) / 100));
  ctx.setFillColor(color);
  const fg = new Path();
  fg.addRoundedRect(new Rect(0, 0, fgW, h), 3, 3);
  ctx.addPath(fg);
  ctx.fillPath();
  return ctx.getImage();
}

function colorFor(pct) {
  if (pct <= 20) return new Color("#e5484d");
  if (pct <= 45) return new Color("#f5a524");
  return new Color("#30a46c");
}

async function main() {
  const widget = new ListWidget();
  widget.setPadding(10, 12, 10, 12);

  let data = null;
  try {
    data = await new Request(JSON_URL).loadJSON();
  } catch (e) {
    const t = widget.addText("AI使用量: 取得に失敗しました");
    t.font = Font.systemFont(12);
    Script.setWidget(widget);
    Script.complete();
    return;
  }

  const head = widget.addStack();
  const title = head.addText("AI使用量");
  title.font = Font.boldSystemFont(13);
  head.addSpacer();
  const upd = head.addText("更新 " + (data.updated_text || ""));
  upd.font = Font.systemFont(10);
  upd.textColor = Color.gray();
  widget.addSpacer(6);

  for (const s of data.services) {
    const row = widget.addStack();
    row.centerAlignContent();
    const nm = row.addText(s.name);
    nm.font = Font.semiboldSystemFont(12);
    nm.lineLimit = 1;
    row.addSpacer(6);

    if (s.status === "ok" && s.windows) {
      const parts = [];
      for (const w of s.windows) {
        const st = row.addStack();
        st.centerAlignContent();
        const lab = st.addText(w.label + " ");
        lab.font = Font.systemFont(10);
        lab.textColor = Color.gray();
        const img = st.addImage(barImage(w.remaining_pct, colorFor(w.remaining_pct)));
        img.imageSize = new Size(64, 5);
        const pct = st.addText(" " + Math.round(w.remaining_pct) + "%");
        pct.font = Font.systemFont(11);
        const rs = st.addText(" ↻" + (w.reset_text || ""));
        rs.font = Font.systemFont(9);
        rs.textColor = Color.gray();
        row.addSpacer(8);
      }
    } else {
      const note = row.addText(s.note || s.status);
      note.font = Font.systemFont(10);
      note.textColor = Color.gray();
      note.lineLimit = 2;
    }
    widget.addSpacer(4);
  }

  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  Script.setWidget(widget);
  Script.complete();
}

await main();
