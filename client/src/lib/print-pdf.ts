// Shared printable-PDF helper for every report in the reports section.
// Opens a new window with an RTL A4-landscape printable table; the user then
// chooses "Save as PDF" as the print destination. Mirrors the inline pattern
// originally used by WorkOrdersReport / CurrentFaultsReport so all reports look
// identical when printed. See CLAUDE.md rule #7 (Excel + PDF on every report).

type Cell = string | number | null | undefined;

const esc = (v: Cell) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function printTablePDF(opts: {
  title: string;
  columns: string[];
  rows: Cell[][];
  rowsPerPage?: number;
}): void {
  const { title, columns, rows, rowsPerPage = 12 } = opts;
  const headRow = `<tr>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));

  let pages = "";
  for (let p = 0; p < totalPages; p++) {
    const chunk = rows.slice(p * rowsPerPage, (p + 1) * rowsPerPage);
    const body = chunk
      .map((r) => `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`)
      .join("");
    pages += `
      <section class="page">
        <h2>${esc(title)}</h2>
        <div class="pageno">صفحة ${p + 1} من ${totalPages} — إجمالي: ${rows.length} سجل</div>
        <table><thead>${headRow}</thead><tbody>${body}</tbody></table>
      </section>`;
  }

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
    <title>${esc(title)}</title>
    <style>
      body { font-family: Arial, "Segoe UI", sans-serif; font-size: 11px; direction: rtl; margin: 0; background: #f1f5f9; }
      h2 { text-align: center; font-size: 15px; margin: 0 0 4px; }
      .pageno { text-align: center; font-size: 10px; color: #64748b; margin-bottom: 8px; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      table { width: 100%; border-collapse: collapse; } td, th { word-break: break-word; overflow-wrap: anywhere; }
      th { background: #1e50a0 !important; color: #ffffff !important; padding: 7px 4px;
        border: 1px solid #15407f; font-weight: bold; font-size: 12px; }
      td { border: 1px solid #ccc; padding: 5px 4px; text-align: right; color: #111; }
      tbody tr:nth-child(even) { background: #eef2fb !important; }
      .page { background: #fff; padding: 14px; margin: 12px auto; max-width: 1100px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
      .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e2e8f0;
        padding: 10px 14px; display: flex; gap: 10px; align-items: center; z-index: 10; }
      .toolbar button { background: #dc2626; color: #fff; border: 0; border-radius: 6px;
        padding: 8px 16px; font-size: 13px; cursor: pointer; font-family: inherit; }
      .toolbar span { color: #475569; font-size: 12px; }
      @media print {
        body { background: #fff; }
        .toolbar { display: none; }
        .page { box-shadow: none; margin: 0; padding: 0; max-width: none; page-break-after: always; }
        .page:last-child { page-break-after: auto; }
        @page { size: A4 landscape; margin: 10mm; }
      }
    </style></head><body>
    <div class="toolbar">
      <button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
      <span>في نافذة الطباعة اختر &quot;حفظ بصيغة PDF&quot; (Save as PDF) كوجهة الطباعة.</span>
    </div>
    ${pages}
    </body></html>`;

  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}
