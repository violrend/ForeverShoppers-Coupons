// Safari/WebExtension compatibility shim
(function () {
  if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
    globalThis.chrome = globalThis.browser;
  }
})();

// ForeverShoppers Coupons - Content Script (Honey-style auto coupon tester)
(function () {
  if (window.__fsInjected) return;
  window.__fsInjected = true;

  const domain = window.location.hostname.replace(/^www\./, "").toLowerCase();
  let isTesting = false;

  const FIELD_WORDS = [
    "coupon", "promo", "promotion", "discount", "voucher", "gift card", "giftcard",
    "offer code", "code", "redeem", "reward", "store credit", "have a code", "apply code"
  ];

  const NEGATIVE_WORDS = [
    "email", "password", "phone", "tel", "zip", "postal", "city", "address", "first", "last",
    "name", "card", "credit", "cvv", "security", "exp", "search", "gift message", "quantity"
  ];

  const COUPON_SELECTORS = [
    'input[name*="coupon" i]', 'input[id*="coupon" i]', 'input[class*="coupon" i]', 'input[placeholder*="coupon" i]', 'input[aria-label*="coupon" i]',
    'input[name*="promo" i]', 'input[id*="promo" i]', 'input[class*="promo" i]', 'input[placeholder*="promo" i]', 'input[aria-label*="promo" i]',
    'input[name*="promotion" i]', 'input[id*="promotion" i]', 'input[placeholder*="promotion" i]',
    'input[name*="discount" i]', 'input[id*="discount" i]', 'input[class*="discount" i]', 'input[placeholder*="discount" i]', 'input[aria-label*="discount" i]',
    'input[name*="voucher" i]', 'input[id*="voucher" i]', 'input[class*="voucher" i]', 'input[placeholder*="voucher" i]', 'input[aria-label*="voucher" i]',
    'input[name*="redeem" i]', 'input[id*="redeem" i]', 'input[placeholder*="code" i]', 'input[aria-label*="code" i]',
    'input[data-testid*="coupon" i]', 'input[data-testid*="promo" i]', 'input[data-test*="coupon" i]', 'input[data-test*="promo" i]',
    'input[data-qa*="coupon" i]', 'input[data-qa*="promo" i]', 'textarea[name*="coupon" i]', 'textarea[id*="coupon" i]', 'textarea[placeholder*="coupon" i]'
  ];

  const APPLY_BUTTON_SELECTORS = [
    'button[id*="coupon" i]', 'button[class*="coupon" i]', 'button[name*="coupon" i]',
    'button[id*="promo" i]', 'button[class*="promo" i]', 'button[name*="promo" i]',
    'button[data-testid*="coupon" i]', 'button[data-testid*="promo" i]', 'button[data-test*="coupon" i]', 'button[data-test*="promo" i]',
    'input[type="submit"][value*="apply" i]', 'button[aria-label*="apply" i]', 'button[aria-label*="coupon" i]', 'button[aria-label*="promo" i]',
    '.apply-coupon', '#apply-coupon', '[data-action*="apply" i]', '[data-action*="coupon" i]'
  ];

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function getStoreDisplayName(coupons) {
    const first = Array.isArray(coupons) && coupons.length ? coupons[0] : null;
    let name = (first && (first.store || first.storeName || first.merchant || first.merchantName || first.brand)) || "";

    if (!name && first && first.title) {
      name = String(first.title).split(" - " )[0] || "";
    }

    if (!name) {
      const host = window.location.hostname.replace(/^www\./, "");
      name = host.split(".")[0] || "store";
    }

    name = String(name)
      .replace(/\b(coupons?|promo codes?|discounts?|deals?)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    return name || "this store";
  }


  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  }

  function textOf(el) {
    if (!el) return "";
    const attrs = ["id", "name", "class", "placeholder", "aria-label", "title", "data-testid", "data-test", "data-qa", "autocomplete"];
    let txt = attrs.map(a => el.getAttribute(a) || "").join(" ");
    const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    if (label) txt += " " + label.innerText;
    const wrapLabel = el.closest("label");
    if (wrapLabel) txt += " " + wrapLabel.innerText;
    const parent = el.closest("form, section, div, li, fieldset");
    if (parent) txt += " " + parent.innerText.slice(0, 500);
    return txt.toLowerCase();
  }



  function hasDangerousActionText(txt) {
    return /\b(checkout|check out|continue|payment|pay|place order|complete order|submit order|review order|shipping|delivery|login|log in|sign in|register|create account|paypal|apple pay|google pay|shop|buy|view|details|remove|delete|quantity|wishlist|heart|search)\b/i.test(txt || "");
  }

  function looksLikeCouponOpener(el) {
    const txt = textOf(el);
    if (!txt) return false;
    if (hasDangerousActionText(txt)) return false;
    const positive = /(coupon|promo|promotion|discount|voucher|offer code|have a code|apply code|add code|enter code|redeem)/i.test(txt);
    if (!positive) return false;

    // Never click normal links while auto-applying. This was causing checkout pages to navigate away.
    if (el.tagName === "A" || el.closest("a")) return false;

    // Prefer actual expanders/toggles or small controls. Avoid random layout div/span clicks.
    const role = (el.getAttribute("role") || "").toLowerCase();
    const ariaExpanded = el.hasAttribute("aria-expanded");
    const tag = el.tagName.toLowerCase();
    const isControl = ["button", "summary"].includes(tag) || role === "button" || ariaExpanded;
    if (!isControl) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width > 520 || rect.height > 100) return false;
    return true;
  }

  function looksLikeApplyCouponButton(btn, input) {
    if (!btn || !isVisible(btn)) return false;
    if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return false;
    const txt = textOf(btn);
    if (hasDangerousActionText(txt)) return false;
    const positive = /(apply|redeem|submit|add)\b/i.test(txt) || /(coupon|promo|promotion|discount|voucher|code)/i.test(txt);
    if (!positive) return false;

    // Prefer buttons near the coupon input. This prevents clicking checkout/continue buttons.
    if (input) {
      const a = input.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      const distance = Math.hypot((a.left + a.width/2) - (b.left + b.width/2), (a.top + a.height/2) - (b.top + b.height/2));
      if (distance > 900) return false;
    }
    return true;
  }

  function scoreInput(el) {
    const txt = textOf(el);
    let score = 0;
    for (const w of FIELD_WORDS) if (txt.includes(w)) score += 5;
    for (const w of NEGATIVE_WORDS) if (txt.includes(w)) score -= 8;
    if (["text", "search", "", "tel"].includes((el.type || "").toLowerCase())) score += 1;
    if (el.disabled || el.readOnly) score -= 30;
    return score;
  }

  async function openCouponSections() {
    // Only click safe promo/coupon expanders. Do NOT click <a>, checkout buttons, or broad div/span areas.
    const clickable = Array.from(document.querySelectorAll('button, summary, [role="button"], [aria-expanded]'));
    for (const el of clickable) {
      if (!isVisible(el)) continue;
      if (!looksLikeCouponOpener(el)) continue;
      try { el.click(); } catch (_) {}
      await sleep(120);
    }
    await sleep(500);
  }

  async function findCouponInput() {
    await openCouponSections();

    for (const selector of COUPON_SELECTORS) {
      const el = Array.from(document.querySelectorAll(selector)).find(x => isVisible(x) && !x.disabled && !x.readOnly);
      if (el) return el;
    }

    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea'))
      .filter(el => isVisible(el) && !el.disabled && !el.readOnly)
      .map(el => ({ el, score: scoreInput(el) }))
      .sort((a, b) => b.score - a.score);

    return inputs.length && inputs[0].score >= 4 ? inputs[0].el : null;
  }

  function findApplyButton(input) {
    if (input) {
      const containers = [
        input.closest("form"), input.closest("section"), input.closest("fieldset"),
        input.closest("div"), input.parentElement, input.parentElement?.parentElement
      ].filter(Boolean);

      for (const parent of containers) {
        const buttons = Array.from(parent.querySelectorAll('button, input[type="submit"], [role="button"]')).filter(btn => looksLikeApplyCouponButton(btn, input));
        const best = buttons.map(btn => ({ btn, txt: textOf(btn), score: 0 })).map(o => {
          if (/\bapply\b/i.test(o.txt)) o.score += 12;
          if (/\bredeem\b/i.test(o.txt)) o.score += 10;
          if (/\bsubmit\b/i.test(o.txt)) o.score += 5;
          if (/\badd\b/i.test(o.txt)) o.score += 4;
          if (FIELD_WORDS.some(w => o.txt.includes(w))) o.score += 4;
          return o;
        }).sort((a, b) => b.score - a.score)[0];
        if (best && best.score > 0) return best.btn;
      }
    }

    for (const selector of APPLY_BUTTON_SELECTORS) {
      const el = Array.from(document.querySelectorAll(selector)).find(btn => looksLikeApplyCouponButton(btn, input));
      if (el) return el;
    }
    return null;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: value.slice(-1) || "A" }));
  }



  function normalizeText(txt) {
    return String(txt || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function moneyNumbersFromText(txt) {
    const values = [];
    const re = /(?:[$€£₺]\s*)?([0-9]{1,4}(?:[,.][0-9]{3})*(?:[,.][0-9]{2})|[0-9]+(?:[,.][0-9]{2}))(?:\s*[$€£₺])?/g;
    let m;
    while ((m = re.exec(txt || "")) !== null) {
      let raw = m[1];
      const lastComma = raw.lastIndexOf(",");
      const lastDot = raw.lastIndexOf(".");
      if (lastComma > lastDot) raw = raw.replace(/\./g, "").replace(",", ".");
      else raw = raw.replace(/,/g, "");
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n > 0) values.push(n);
    }
    return values;
  }

  function getCheckoutText() {
    const candidates = Array.from(document.querySelectorAll('body, main, [class*="cart" i], [id*="cart" i], [class*="bag" i], [id*="bag" i], [class*="checkout" i], [id*="checkout" i], [class*="summary" i], [id*="summary" i], [class*="total" i], [id*="total" i]'));
    return normalizeText(candidates.map(el => el.innerText || "").join(" "));
  }

  function captureCheckoutState() {
    const text = getCheckoutText();
    const nums = moneyNumbersFromText(text);
    return {
      text,
      nums,
      minPrice: nums.length ? Math.min(...nums) : null,
      maxPrice: nums.length ? Math.max(...nums) : null
    };
  }

  function hasErrorText(text) {
    return /(invalid|not valid|valid code|expired|couldn'?t apply|could not apply|cannot apply|can not apply|not eligible|does not meet|requirements not met|already used|not recognized|unable to apply|try again|error applying|was not applied|could not be applied|sorry|no longer valid|not currently active|enter a valid|please enter a valid|promotion code cannot|promo code cannot|coupon code cannot)/i.test(text || "");
  }

  function getChangedText(beforeText, afterText) {
    beforeText = String(beforeText || "");
    afterText = String(afterText || "");
    if (!beforeText) return afterText;
    if (afterText === beforeText) return "";
    let start = 0;
    while (start < beforeText.length && start < afterText.length && beforeText[start] === afterText[start]) start++;
    let bEnd = beforeText.length - 1;
    let aEnd = afterText.length - 1;
    while (bEnd >= start && aEnd >= start && beforeText[bEnd] === afterText[aEnd]) { bEnd--; aEnd--; }
    return afterText.slice(Math.max(0, start - 250), Math.min(afterText.length, aEnd + 251));
  }

  function hasSuccessText(text, code) {
    const safeCode = String(code || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Do NOT treat generic words like "discount" or "coupon" as success.
    // Some checkouts always contain those words, so invalid codes were being marked Success.
    const explicitSuccess = /(coupon applied|promo applied|promotion applied|code applied|coupon code applied|promo code applied|applied successfully|successfully applied|successfully redeemed|you saved\s*[$€£₺]?\s*\d|savings applied|discount applied|offer applied)/i.test(text || "");
    const codeNearApplied = safeCode ? new RegExp(`${safeCode}.{0,120}(applied|redeemed|accepted|remove|savings|you saved)|(?:applied|redeemed|accepted|remove|savings|you saved).{0,120}${safeCode}`, "i").test(text || "") : false;

    return explicitSuccess || codeNearApplied;
  }

  function hasNewDiscountEvidence(beforeText, afterText) {
    // Success evidence must be a real discount/savings row with a negative money amount,
    // and it must not have already existed before trying this code.
    const discountRowRe = /(discount|promo|promotion|coupon|savings|you saved|offer).{0,100}[-−]\s*[$€£₺]?\s*\d+(?:[,.]\d{2})?|[-−]\s*[$€£₺]?\s*\d+(?:[,.]\d{2})?.{0,100}(discount|promo|promotion|coupon|savings|you saved|offer)/i;
    return discountRowRe.test(afterText || "") && !discountRowRe.test(beforeText || "");
  }

  function stateLooksDiscounted(before, after, code) {
    const afterText = after.text || "";
    const beforeText = before.text || "";
    const changedText = getChangedText(beforeText, afterText);

    // Invalid/error messages always win for this attempt.
    if (hasErrorText(changedText)) return false;

    // Only accept clear success text that appeared/changed after this exact attempt.
    if (hasSuccessText(changedText, code)) return true;

    // Or accept a newly-created negative discount/savings line.
    if (hasNewDiscountEvidence(beforeText, afterText) && !hasErrorText(afterText.slice(-2500))) return true;

    // Price changes alone are not enough; they caused false positives on invalid coupons.
    return false;
  }

  async function waitForCouponResult(before, code) {
    let last = captureCheckoutState();
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      last = captureCheckoutState();
      const changedText = getChangedText(before.text, last.text);

      if (hasErrorText(changedText)) return { success: false, state: last };
      if (stateLooksDiscounted(before, last, code)) return { success: true, state: last };
    }

    // No clear success text or new discount row = not successful.
    return { success: false, state: last };
  }

  function showSuccessPopup(code, storeName) {
    document.getElementById("fs-success-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "fs-success-modal";
    modal.innerHTML = `
      <div class="fs-fireworks">
        ${Array.from({length: 22}).map((_,i)=>`<span style="--i:${i};--x:${(Math.random()*100).toFixed(1)}%;--d:${(Math.random()*1.2).toFixed(2)}s"></span>`).join("")}
      </div>
      <div class="fs-success-card">
        <button class="fs-success-close" aria-label="Close">✕</button>
        <div class="fs-success-icon">🎉</div>
        <h2>Success!</h2>
        <p><b>${code}</b> worked at ${storeName || "this store"}.</p>
        <div class="fs-success-sub">Best coupon applied. We stopped testing more codes.</div>
      </div>`;

    const style = document.createElement("style");
    style.id = "fs-success-style";
    style.textContent = `
      #fs-success-modal{position:fixed;inset:0;background:rgba(17,24,39,.42);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;overflow:hidden}
      .fs-success-card{width:min(430px,90vw);background:#fff;border-radius:24px;box-shadow:0 24px 90px rgba(0,0,0,.32);padding:34px 28px 30px;text-align:center;position:relative;animation:fs-pop .35s ease-out}
      @keyframes fs-pop{from{transform:scale(.86);opacity:0}to{transform:scale(1);opacity:1}}
      .fs-success-close{position:absolute;top:14px;right:16px;border:0;background:transparent;font-size:22px;cursor:pointer;color:#777}.fs-success-icon{font-size:58px;margin-bottom:10px}.fs-success-card h2{font-size:34px;margin:0 0 10px;font-weight:900;color:#16a34a}.fs-success-card p{font-size:18px;line-height:1.35;margin:0;color:#111}.fs-success-sub{margin-top:16px;background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;border-radius:14px;padding:11px 14px;font-weight:700;font-size:14px}
      .fs-fireworks span{position:absolute;left:var(--x);bottom:-20px;width:9px;height:9px;border-radius:50%;background:hsl(calc(var(--i)*32),90%,58%);animation:fs-burst 1.8s ease-out var(--d) infinite;box-shadow:0 0 14px currentColor}
      @keyframes fs-burst{0%{transform:translateY(0) scale(.8);opacity:0}15%{opacity:1}70%{transform:translateY(-78vh) translateX(calc((var(--i) - 11)*7px)) scale(1.25);opacity:1}100%{transform:translateY(-90vh) translateX(calc((var(--i) - 11)*12px)) scale(.2);opacity:0}}
    `;
    document.head.appendChild(style);
    document.body.appendChild(modal);
    modal.querySelector(".fs-success-close").addEventListener("click", () => modal.remove());
    setTimeout(() => modal.remove(), 6500);
  }


  async function clearInput(input) {
    input.focus();
    setNativeValue(input, "");
    await sleep(150);
  }

  async function tryApplyCoupon(coupon) {
    const code = coupon.couponCode || coupon.code || "";
    if (!code) return { ok: false, reason: "empty" };

    const input = await findCouponInput();
    if (!input) return { ok: false, success: false, reason: "no_field" };

    const beforeState = captureCheckoutState();

    input.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(250);
    await clearInput(input);
    setNativeValue(input, code);
    await sleep(450);

    const button = findApplyButton(input);
    if (button) {
      button.click();
    } else {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
      input.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, key: "Enter", code: "Enter" }));
      input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter" }));
    }

    const detection = await waitForCouponResult(beforeState, code);
    return { ok: true, success: detection.success, code };
  }

  function isCheckoutPage() {
    const url = window.location.href.toLowerCase();
    const keywords = ["checkout", "cart", "basket", "order", "payment", "bag"];
    return keywords.some(k => url.includes(k));
  }

  function createTesterModal(coupons) {
    const storeName = getStoreDisplayName(coupons);
    document.getElementById("fs-auto-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "fs-auto-modal";
    modal.innerHTML = `
      <div class="fs-auto-card">
        <button class="fs-auto-close" aria-label="Close">✕</button>
        <div class="fs-auto-logo">🛍️</div>
        <h2>Applying Deals...</h2>
        <div class="fs-auto-step done">✓ Activating ${storeName} coupons</div>
        <div class="fs-auto-step active"><span class="fs-spinner"></span> Testing ${coupons.length} coupon code${coupons.length > 1 ? "s" : ""}</div>
        <div class="fs-code-list">
          ${coupons.map((c, i) => `
            <div class="fs-code-row" data-index="${i}">
              <span class="fs-code-status">○</span>
              <span class="fs-code-text">${c.couponCode || c.code || "CODE"}</span>
            </div>
          `).join("")}
        </div>
        <div class="fs-auto-message">Please keep this checkout page open.</div>
        <div class="fs-auto-progress"><div class="fs-auto-progress-bar"></div></div>
      </div>`;

    const style = document.createElement("style");
    style.id = "fs-auto-style";
    style.textContent = `
      #fs-auto-modal{position:fixed;inset:0;background:rgba(0,0,0,.58);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111}
      .fs-auto-card{width:min(620px,92vw);min-height:420px;background:#fff;border-radius:12px;box-shadow:0 22px 80px rgba(0,0,0,.28);position:relative;padding:42px 58px 30px;text-align:center;overflow:hidden}
      .fs-auto-close{position:absolute;top:20px;right:22px;border:0;background:transparent;font-size:24px;cursor:pointer;color:#777}.fs-auto-logo{width:72px;height:72px;border-radius:16px;background:#f5f0ff;margin:10px auto 26px;display:flex;align-items:center;justify-content:center;font-size:34px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
      .fs-auto-card h2{font-size:30px;margin:0 0 34px;font-weight:800}.fs-auto-step{font-size:20px;font-weight:700;text-align:left;max-width:430px;margin:18px auto;display:flex;align-items:center;gap:14px}.fs-auto-step.done{color:#111}.fs-auto-step.active{color:#222}.fs-spinner{width:28px;height:28px;border:3px solid #ddd;border-top-color:#7c3aed;border-radius:50%;display:inline-block;animation:fs-spin .8s linear infinite}@keyframes fs-spin{to{transform:rotate(360deg)}}
      .fs-code-list{max-width:430px;margin:22px auto 8px;text-align:left;max-height:150px;overflow:auto}.fs-code-row{display:flex;align-items:center;gap:12px;border:1px solid #eee;border-radius:8px;padding:10px 14px;margin:8px 0;font-weight:700;background:#fafafa}.fs-code-row.testing{border-color:#c4b5fd;background:#f5f0ff}.fs-code-row.applied{border-color:#86efac;background:#f0fdf4}.fs-code-row.failed{opacity:.55}.fs-code-status{width:24px;text-align:center}.fs-code-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fs-auto-message{font-size:14px;color:#555;margin-top:22px}.fs-auto-progress{position:absolute;left:0;right:0;bottom:0;height:8px;background:#e5e7eb}.fs-auto-progress-bar{height:100%;width:0%;background:#7c3aed;transition:width .35s ease}
      @media(max-width:560px){.fs-auto-card{padding:34px 24px 28px}.fs-auto-card h2{font-size:24px}.fs-auto-step{font-size:17px}}
    `;
    document.head.appendChild(style);
    document.body.appendChild(modal);
    modal.querySelector(".fs-auto-close").addEventListener("click", () => modal.remove());
    return modal;
  }

  async function autoTestCoupons(coupons) {
    if (isTesting) return;
    isTesting = true;

    const modal = createTesterModal(coupons);
    const msg = modal.querySelector(".fs-auto-message");
    const bar = modal.querySelector(".fs-auto-progress-bar");
    const rows = Array.from(modal.querySelectorAll(".fs-code-row"));

    let appliedCount = 0;
    let noField = false;

    for (let i = 0; i < coupons.length; i++) {
      const code = coupons[i].couponCode || coupons[i].code || "";
      rows[i].classList.add("testing");
      rows[i].querySelector(".fs-code-status").textContent = "↻";
      msg.textContent = `Trying ${code}...`;
      bar.style.width = `${Math.round((i / coupons.length) * 100)}%`;

      const result = await tryApplyCoupon(coupons[i]);
      rows[i].classList.remove("testing");

      if (result.ok && result.success) {
        appliedCount++;
        rows[i].classList.add("applied");
        rows[i].querySelector(".fs-code-status").textContent = "✓";
        msg.textContent = `${code} worked! Stopping here.`;
        bar.style.width = `100%`;
        showSuccessPopup(code, getStoreDisplayName(coupons));
        break;
      } else if (result.ok) {
        rows[i].classList.add("failed");
        rows[i].querySelector(".fs-code-status").textContent = "×";
        msg.textContent = `${code} did not work. Trying next code...`;
      } else {
        rows[i].classList.add("failed");
        rows[i].querySelector(".fs-code-status").textContent = "×";
        if (result.reason === "no_field") noField = true;
      }

      bar.style.width = `${Math.round(((i + 1) / coupons.length) * 100)}%`;
      await sleep(500);
      if (noField || appliedCount > 0) break;
    }

    if (noField) {
      msg.textContent = "Couldn't find a coupon field. Open the promo/coupon box manually, then try again.";
    } else if (appliedCount > 0) {
      msg.textContent = "Success! Best coupon applied. No more codes will be tested.";
    } else {
      msg.textContent = "No coupon could be applied on this checkout page.";
    }

    setTimeout(() => { isTesting = false; }, 1500);
  }

  function showBanner(coupons) {
    if (document.getElementById("fs-coupon-banner")) return;
    const storeName = getStoreDisplayName(coupons);

    const banner = document.createElement("div");
    banner.id = "fs-coupon-banner";
    banner.innerHTML = `
      <div id="fs-banner-inner">
        <div id="fs-banner-header">
          <span id="fs-banner-logo">🛍️ ${storeName}</span>
          <span id="fs-banner-count">${coupons.length} coupon${coupons.length > 1 ? "s" : ""} available!</span>
          <button id="fs-banner-close">✕</button>
        </div>
        <button id="fs-auto-try-btn">${coupons.length === 1 ? "Apply coupon automatically" : `Test ${coupons.length} coupons automatically`}</button>
        <div id="fs-banner-coupons">
          ${coupons.map((c, i) => `
            <div class="fs-coupon-item" data-index="${i}">
              <div class="fs-coupon-info">
                <span class="fs-coupon-code">${c.couponCode || c.code || ""}</span>
                <span class="fs-coupon-title">${c.title || "Coupon"}</span>
              </div>
              <button class="fs-apply-btn" data-index="${i}">Apply</button>
            </div>
          `).join("")}
        </div>
        <div id="fs-banner-footer"><a href="https://forevershoppers.com" target="_blank">View all coupons →</a></div>
        <div id="fs-banner-status"></div>
      </div>`;

    const style = document.createElement("style");
    style.textContent = `
      #fs-coupon-banner{position:fixed;bottom:20px;right:20px;z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;animation:fs-slidein .4s ease}@keyframes fs-slidein{from{transform:translateY(100px);opacity:0}to{transform:translateY(0);opacity:1}}
      #fs-banner-inner{background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.18);width:340px;overflow:hidden;border:1.5px solid #e8e0f7}#fs-banner-header{background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:12px 16px;display:flex;align-items:center;gap:8px}#fs-banner-logo{font-weight:700;font-size:15px;flex:1}#fs-banner-count{font-size:12px;opacity:.9;background:rgba(255,255,255,.2);padding:2px 8px;border-radius:20px}#fs-banner-close{background:none;border:0;color:#fff;cursor:pointer;font-size:16px;padding:0;line-height:1;opacity:.8;margin-left:4px}
      #fs-auto-try-btn{width:calc(100% - 24px);margin:12px;border:0;border-radius:10px;background:#7c3aed;color:#fff;padding:10px 12px;font-weight:800;cursor:pointer}#fs-auto-try-btn:hover{background:#6d28d9}
      #fs-banner-coupons{max-height:220px;overflow-y:auto;padding:0 0 8px}.fs-coupon-item{display:flex;align-items:center;padding:10px 16px;gap:10px;border-bottom:1px solid #f3f0fb}.fs-coupon-info{flex:1;min-width:0}.fs-coupon-code{display:block;font-weight:700;color:#7c3aed;font-size:13px;letter-spacing:.5px}.fs-coupon-title{display:block;color:#555;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}.fs-apply-btn{background:#7c3aed;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap}.fs-apply-btn.applied{background:#16a34a}.fs-apply-btn.failed{background:#dc2626}#fs-banner-footer{padding:8px 16px;border-top:1px solid #f3f0fb;text-align:center}#fs-banner-footer a{color:#7c3aed;text-decoration:none;font-size:12px;font-weight:500}#fs-banner-status{padding:0 16px;font-size:12px;color:#16a34a;font-weight:500;min-height:0;text-align:center;transition:all .3s}#fs-banner-status.visible{padding:8px 16px}
    `;
    document.head.appendChild(style);
    document.body.appendChild(banner);

    document.getElementById("fs-banner-close").addEventListener("click", () => banner.remove());
    document.getElementById("fs-auto-try-btn").addEventListener("click", () => autoTestCoupons(coupons));

    banner.querySelectorAll(".fs-apply-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const idx = parseInt(btn.dataset.index, 10);
        const coupon = coupons[idx];
        const status = document.getElementById("fs-banner-status");
        btn.textContent = "Applying...";
        btn.disabled = true;
        const result = await tryApplyCoupon(coupon);
        if (result.ok && result.success) {
          btn.textContent = "✓ Success!";
          btn.classList.add("applied");
          status.textContent = `Success! Code "${coupon.couponCode || coupon.code}" worked.`;
          status.classList.add("visible");
          showSuccessPopup(coupon.couponCode || coupon.code, getStoreDisplayName(coupons));
        } else if (result.ok) {
          btn.textContent = "Try Again";
          btn.classList.add("failed");
          btn.disabled = false;
          status.textContent = `Code "${coupon.couponCode || coupon.code}" did not work.`;
          status.classList.add("visible");
        } else {
          btn.textContent = "Try Again";
          btn.classList.add("failed");
          btn.disabled = false;
          status.textContent = "Couldn't find a coupon field. Open the promo/coupon box and try again.";
          status.classList.add("visible");
        }
      });
    });

    if (coupons.length === 1) {
      setTimeout(() => autoTestCoupons(coupons), 900);
    }
  }

  async function init() {
    if (!isCheckoutPage()) return;
    chrome.runtime.sendMessage({ type: "GET_COUPONS_FOR_DOMAIN", domain }, res => {
      if (res && res.coupons && res.coupons.length > 0) {
        setTimeout(() => showBanner(res.coupons), 1200);
      }
    });
  }

  chrome.runtime.sendMessage({ type: "GET_COUPONS_FOR_DOMAIN", domain }, () => {});
  init();
})();
