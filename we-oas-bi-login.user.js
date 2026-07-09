// ==UserScript==
// @name         WE OAS BI — تسجيل دخول تلقائى
// @namespace    service-flow.we-oas.login
// @description  يملأ اسم المستخدم وكلمة السر تلقائياً على صفحة we-oas.te.eg BI ثم يضغط Sign In.
// @version      1.0.0
// @match        *://we-oas.te.eg/bi-security-login/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ================== CONFIG ================== */
  const USER = "mena.haleem@te.eg";
  const PASS = "Mon_oskar352";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => { try { return !!el && el.getClientRects().length > 0; } catch (e) { return false; } };

  // ضبط قيمة الحقل بشكل يفهمه أى framework (native setter + events)
  function setValue(input, value) {
    try { input.focus(); } catch (e) {}
    try {
      const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    } catch (e) { input.value = value; }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function findUserField(passField) {
    // أفضّل حقل نصّى/إيميل قبل الباسورد فى نفس الفورم، وإلا أى تخمين بالاسم/الـid
    const all = [...document.querySelectorAll("input")].filter(visible);
    const byName = all.find((i) => /user|login|email|acc/i.test((i.name || "") + (i.id || "")) && !/password|pass/i.test(i.type));
    if (byName) return byName;
    if (passField) {
      const before = all.slice(0, all.indexOf(passField)).reverse().find((i) => !/password/i.test(i.type) && /text|email|^$/i.test(i.type || "text"));
      if (before) return before;
    }
    return all.find((i) => /text|email/i.test(i.type || "text")) || all[0] || null;
  }

  function findSignInBtn() {
    const re = /sign\s*in|log\s*in|login|دخول|تسجيل/i;
    const els = [...document.querySelectorAll("button, input[type='submit'], input[type='button'], a")].filter(visible);
    return els.find((b) => re.test((b.textContent || b.value || "").trim())) || els.find((b) => /submit/i.test(b.type)) || null;
  }

  function clickEl(el) {
    if (!el) return false;
    for (const t of ["mousedown", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    const form = el.closest && el.closest("form");
    if (form && typeof form.requestSubmit === "function") { try { form.requestSubmit(el.type === "submit" ? el : undefined); } catch (e) {} }
    return true;
  }

  let done = false;
  async function autoLogin() {
    if (done) return;
    // استنى ظهور حقل الباسورد
    const end = Date.now() + 20000;
    let pass = null;
    while (Date.now() < end) { pass = document.querySelector("input[type='password']"); if (pass && visible(pass)) break; await sleep(300); }
    if (!pass) return;
    const user = findUserField(pass);
    if (user) setValue(user, USER);
    setValue(pass, PASS);
    await sleep(400);
    const btn = findSignInBtn();
    if (btn) { done = true; clickEl(btn); }
    else { done = true; pass.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true })); }
  }

  autoLogin();
})();
