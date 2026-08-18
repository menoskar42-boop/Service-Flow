// طباعة محاضر التفتيش كـ HTML مطابق للنماذج الرسمية (RTL) → نافذة طباعة/حفظ PDF.
// ثلاثة محاضر: الفحص الظاهرى / مطابقة البيانات الفنية / خطاب مدير السنترال (خطة الصيانة).

const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function openPrint(html: string) {
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

const WE_HEADER = `
  <div class="wehead">
    <div class="welogo">we</div>
    <div class="wetitle">المصرية للاتصالات</div>
  </div>`;

const BASE_CSS = `
  body{font-family:Arial,'Segoe UI',sans-serif;direction:rtl;margin:0;background:#f1f5f9;color:#111;font-size:12px}
  *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
  .page{background:#fff;padding:26px;margin:12px auto;max-width:1050px;box-shadow:0 1px 4px rgba(0,0,0,.15)}
  .wehead{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-bottom:6px}
  .welogo{background:#5b2d8e;color:#fff;font-weight:bold;border-radius:50%;width:52px;height:52px;display:flex;align-items:center;justify-content:center;font-size:20px}
  .wetitle{color:#5b2d8e;font-size:26px;font-weight:bold}
  h2{text-align:center;font-size:16px;margin:10px 0}
  .intro{line-height:2.3;font-size:13px;margin:8px 0 12px;text-align:justify}
  .blank{display:inline-block;border-bottom:1px dotted #333;min-width:60px;text-align:center;font-weight:bold}
  .note{background:#fff3a3;font-weight:bold;padding:4px 6px;display:inline-block;margin:6px 0}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{border:1px solid #000;padding:5px 4px;text-align:center;font-size:11px;vertical-align:middle}
  th{background:#f7ede3;font-weight:bold}
  .letterhead{line-height:2.4;font-size:14px}
  .letterhead .lbl{font-weight:bold}
  .foot{margin-top:26px;font-size:13px;line-height:2.2}
  .center{text-align:center}
  .toolbar{position:sticky;top:0;background:#fff;border-bottom:1px solid #e2e8f0;padding:10px 14px;display:flex;gap:10px;align-items:center}
  .toolbar button{background:#dc2626;color:#fff;border:0;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer;font-family:inherit}
  @media print{body{background:#fff}.toolbar{display:none}.page{box-shadow:none;margin:0;max-width:none}@page{size:A4 landscape;margin:8mm}}
`;

const B = '<span class="blank"></span>';
const wrap = (title: string, inner: string, landscape = true) =>
  `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(title)}</title>
   <style>${BASE_CSS}${landscape ? "" : "@media print{@page{size:A4 portrait;margin:12mm}}"}</style></head><body>
   <div class="toolbar"><button onclick="try{window.close()}catch(e){};setTimeout(function(){history.length>1?history.back():location.href='/'},150)" style="padding:6px 14px;background:#475569;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px;margin-left:8px">↩ رجوع</button><button onclick="window.print()">🖨️ طباعة / حفظ PDF</button><span>اختر "حفظ بصيغة PDF" كوجهة الطباعة.</span></div>
   <section class="page">${WE_HEADER}${inner}</section></body></html>`;

const sigTable = (headerLine: string, withNum = false) =>
  `<div class="foot">${esc(headerLine)}</div>
   <table><thead><tr>${withNum ? "<th>م</th>" : ""}<th>الاسم</th><th>الوظيفة</th><th>رقم العامل</th><th>التوقيع</th></tr></thead>
   <tbody>${Array.from({ length: 4 }, (_, i) => `<tr>${withNum ? `<td>${i + 1}</td>` : ""}<td style="height:32px"></td><td></td><td></td><td></td></tr>`).join("")}</tbody></table>`;

// ── محضر الفحص الظاهرى ── (رقم الكابينة + رقم البكس فقط، باقى الأعمدة فارغة)
export function printVisualInspection(central: string, boxes: { cabinNumber: string; boxNumber: string }[]) {
  const cols = ["م", "رقم الكابينة", "رقم البكس", "واقى طلعة البكس (موجود/مثبت)", "إرتفاع البكس (مناسب)", "غطاء البكس موجود", "البكس مثبت جيداً", "الترمنال مثبت جيداً", "التوصيلات بالبكس جيدة", "التوصيلات الهوائية منتظمة", "يوجد ترقيم على البكس", "لا يوجد تعدية طريق", "لا يوجد تعارض مع الكهرباء", "ملاحظات"];
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = boxes.map((b, i) => `<tr><td>${i + 1}</td><td>${esc(b.cabinNumber)}</td><td>${esc(b.boxNumber)}</td>${"<td></td>".repeat(11)}</tr>`).join("");
  const inner = `
    <h2>محضر الفحص الظاهرى للمرور على صيانة البكسيات</h2>
    <div class="intro">أنه اليوم ${B} الموافق ${B}/${B}/${B} وبمعرفتنا نحن الموقعين أدناه من قطاع التفتيش وسنترال <span class="blank">${esc(central)}</span> بمنطقة ${B} بقطاع ${B} تم المرور على الطبيعة لأعمال صيانة البكسيات طبقاً للمعايير الموضحة أدناه وقد تبين الآتى:</div>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    ${sigTable("بناءً على ما تم المرور عليه على الطبيعة تم تحرير الملاحظات سالفة الذكر وتم التوقيع :")}`;
  openPrint(wrap("محضر الفحص الظاهرى", inner));
}

// ── محضر مطابقة البيانات الفنية ── (كل الخانات ما عدا «عدد المطابق»)
export function printTechnicalData(
  central: string,
  boxes: { cabinNumber: string; boxNumber: string; msanCode: string; combAbs: string; capacity: number; occupancy: number }[],
) {
  // المحضر ده مفيهوش عمود «رقم البلوك» → رقم المشط مطلق (الخرج 345 → مشط 35).
  const cols = ["م", "رقم الـ MSAN", "رقم النحاسى", "رقم البكس", "رقم المشط", "السعة", "عدد الشغال", "عدد المطابق", "ملاحظات"];
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = boxes.map((b, i) =>
    `<tr><td>${i + 1}</td><td>${esc(b.msanCode)}</td><td>${esc(b.cabinNumber)}</td><td>${esc(b.boxNumber)}</td><td>${esc(b.combAbs)}</td><td>${esc(b.capacity)}</td><td>${esc(b.occupancy)}</td><td></td><td></td></tr>`,
  ).join("");
  const inner = `
    <h2>محضر مطابقة البيانات الفنية لخطوط العملاء بسنترال</h2>
    <div class="intro">أنه اليوم ${B} الموافق ${B}/${B}/${B} وبمعرفتنا نحن الموقعين أدناه من قطاع التفتيش وسنترال <span class="blank">${esc(central)}</span> بمنطقة ${B} بقطاع مناطق ${B} وقد تم مطابقة البيانات الفنية لخطوط العملاء المدرجة بشاشات الـ FCC مع ما هو على الطبيعة وتلاحظ ما يلى:</div>
    <div class="note">مرفق شيت الـ FCC (عدد ...... ورقة) على أن يتم إدراج البكسيات الموجودة بالخطة فقط.</div>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    ${sigTable("وبناءً عليه تم توقيع أعضاء اللجنة :", true)}`;
  openPrint(wrap("محضر مطابقة البيانات الفنية", inner));
}

// ── خطاب مدير السنترال (خطة صيانة بكسيات) ── (كل الخانات؛ «الخالية 0%» تُملأ يدوياً)
export function printCentralManagerLetter(
  central: string,
  cabinets: { cabinNumber: string; msanCode: string; boxCount: number; closedBoxes: number; emptyBoxes: number }[],
) {
  const totalBoxes = cabinets.reduce((s, c) => s + (c.boxCount || 0), 0);
  const cols = ["م", "رقم MSAN", "نحاس رقم", "عدد البكسيات", "عدد البكسيات المغلقة (نسبة الاشغال 100%)", "عدد البكسيات الخالية (نسبة الاشغال 0%)"];
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join("");
  const rows = cabinets.map((c, i) =>
    `<tr><td>${i + 1}</td><td>${esc(c.msanCode)}</td><td>${esc(c.cabinNumber)}</td><td>${esc(c.boxCount)}</td><td>${esc(c.closedBoxes)}</td><td>${esc(c.emptyBoxes)}</td></tr>`,
  ).join("");
  // إكمال الجدول لـ 15 صف (زى النموذج) حتى لو الكباين أقل
  const pad = Array.from({ length: Math.max(0, 15 - cabinets.length) }, (_, k) =>
    `<tr><td>${cabinets.length + k + 1}</td><td></td><td></td><td></td><td></td><td></td></tr>`).join("");
  const inner = `
    <div class="letterhead">
      <div style="text-align:left">التاريخ ${B}/${B}/ 202${B}</div>
      <div><span class="lbl">الموضوع :</span> خطة صيانة بكسيات سنترال خلال شهر ${B}/${B}/ 202${B}</div>
      <div><span class="lbl">السيد الأستاذ / رئيس مجموعة عمل صيانة بكسيات قطاع</span> ${B}</div>
      <div>تحية طيبة وبعد ،،،</div>
      <div>رجاء التفضل بالإحاطة بأن البكسيات المدرجة بخطة صيانة شهر ${B} لسنترال <span class="blank">${esc(central)}</span> لعام 202${B} بمنطقة ${B} بقطاع ${B} بعدد <span class="blank">${esc(totalBoxes)}</span> بكس والمذكورة فيما لم يسبق المرور عليها أو تسليمها لقطاع التفتيش من قبل وهى :-</div>
    </div>
    <table><thead><tr>${head}</tr></thead><tbody>${rows}${pad}</tbody></table>
    <div class="foot center">وتفضلوا بقبول فائق الاحترام والتقدير</div>
    <div class="foot">مدير إدارة سنترال<br>الإسم :- ${B}<br>التوقيع :- ${B}</div>`;
  openPrint(wrap("خطاب مدير السنترال — خطة صيانة بكسيات", inner));
}
