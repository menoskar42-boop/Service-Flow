// طبقة «البادئة» (base-path): بتخلّى تطبيق الصيانة — اللى بيفترض إنه على جذر الدومين —
// يشتغل مركّب تحت مسار /maintenance من غير ما نعدّل مئات الروابط المطلقة فى القوالب.
// بتعمل حاجتين تلقائياً لكل ريكوست:
//   (1) res.redirect: أى Location جذرى (/x) يتحوّل لـ /maintenance/x.
//   (2) res.send للـ HTML: روابط href/src/action="/x" و fetch('/x') و url:'/x' تتبِّئ بالبادئة.
// بنتجاهل: البروتوكول-relative (//host)، والـ http(s)، واللى مبدوء بالبادئة أصلاً.
module.exports = function basePath(base) {
  const b = String(base || "").replace(/\/+$/, ""); // مثال: "/maintenance" (بدون سلاش آخر)
  if (!b) return function (_req, _res, next) { next(); };
  const bare = b.replace(/^\//, ""); // "maintenance"
  const hrefRe = new RegExp('\\b(href|src|action)=(["\'])/(?!/|' + bare + '[/"\'])', "gi");
  const jsRe = new RegExp('\\b(fetch|open|assign|replace)\\((\\s*)(["\'])/(?!/|' + bare + '/)', "gi");
  const urlRe = new RegExp('\\b(url|action)(\\s*:\\s*)(["\'])/(?!/|' + bare + '/)', "gi");

  return function (req, res, next) {
    // (1) التحويلات — نبِّئ أى مسار جذرى
    const _redirect = res.redirect.bind(res);
    res.redirect = function (a, c) {
      let status, url;
      if (typeof a === "number") { status = a; url = c; } else { url = a; }
      if (typeof url === "string" && /^\/(?!\/)/.test(url) && url !== b && !url.startsWith(b + "/")) {
        url = b + url;
      }
      return status != null ? _redirect(status, url) : _redirect(url);
    };
    // (2) روابط الـ HTML — نبِّئ المسارات الجذرية داخل الصفحة المرندَرة
    const _send = res.send.bind(res);
    res.send = function (body) {
      try {
        // مهم: res.render بينده res.send بجسم HTML قبل ما Express يظبط Content-Type (بيتظبط جوّه
        // send نفسه بعد ما الـ wrapper ده يشتغل) — فلو اشترطنا text/html بس، الصفحات المرندَرة
        // متتبِّئش روابطها وتطلع 404. فنبِّئ لو الـ ct = html أو **لسه مش متظبط** (جسم نصّى من render).
        // الـ JSON/الملفات بيتظبط لها ct (application/json / image/…) قبل send فمتتأثرش.
        const ct = res.get("Content-Type") || "";
        if (typeof body === "string" && (!ct || /text\/html/i.test(ct))) {
          body = body
            .replace(hrefRe, "$1=$2" + b + "/")
            .replace(jsRe, "$1($2$3" + b + "/")
            .replace(urlRe, "$1$2$3" + b + "/");
        }
      } catch (e) { /* لو حصل أى خطأ فى التبِّئة نبعت الجسم زى ما هو */ }
      return _send(body);
    };
    next();
  };
};
