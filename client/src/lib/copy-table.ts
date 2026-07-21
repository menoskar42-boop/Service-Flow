// نسخ جدول كـ HTML بحدود (RTL) للصقه فى الإيميل (Outlook) مباشرة.
// - RTL مضبوط: dir="rtl" على الجدول + الصفوف + الخلايا (Outlook أحياناً بيتجاهل dir على الجدول وحده).
// - أرقام لاتينية (Western) مش هندية (Indic): الخلايا اللى مفيهاش حروف عربية (أرقام/أكواد/تواريخ)
//   بتتلفّ فى span dir="ltr" — ده بيخلّى Outlook يعرضها بأرقام لاتينية بدل ما يحوّلها هندية فى سياق RTL.
export async function copyHtmlTable(
  columns: string[],
  rows: (string | number | null | undefined)[][],
): Promise<boolean> {
  const cell = (v: any, head = false) => {
    const raw = v == null ? "" : String(v);
    const hasArabic = /[؀-ۿ]/.test(raw);
    const inner = hasArabic ? raw : `<span dir="ltr" style="unicode-bidi:embed">${raw}</span>`;
    const tag = head ? "th" : "td";
    const st = `border:1px solid #000;padding:4px 8px;white-space:nowrap;${head ? "background:#f2f2f2;font-weight:bold;" : ""}`;
    return `<${tag} dir="rtl" align="right" style="${st}">${inner}</${tag}>`;
  };
  const head = `<tr dir="rtl">${columns.map((c) => cell(c, true)).join("")}</tr>`;
  const body = rows.map((r) => `<tr dir="rtl">${r.map((c) => cell(c)).join("")}</tr>`).join("");
  const html = `<table dir="rtl" border="1" style="direction:rtl;border-collapse:collapse;font-family:Arial;font-size:13px">${head}${body}</table>`;
  const text = [columns, ...rows].map((r) => r.map((c) => (c == null ? "" : String(c))).join("\t")).join("\n");
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" }),
    })]);
    return true;
  } catch {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }
}
