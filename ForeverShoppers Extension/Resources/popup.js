// Safari/WebExtension compatibility shim
(function () {
  if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
    globalThis.chrome = globalThis.browser;
  }
})();

let allCoupons = [];
let currentDomain = "";
let activeTab = "this-site";

const listEl = document.getElementById("couponList");
const searchInput = document.getElementById("searchInput");
const footerCount = document.getElementById("footerCount");
const currentStoreBar = document.getElementById("currentStoreBar");
const currentStoreLabel = document.getElementById("currentStoreLabel");

function normalizeHost(host) {
  return String(host || "").toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(":")[0].replace(/^www\./, "").trim();
}

function rootDomain(host) {
  const h = normalizeHost(host);
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return h;
  const twoPartTlds = new Set(["co.uk","com.au","com.tr","com.br","co.nz","co.jp","com.mx","com.sg"]);
  if (twoPartTlds.has(parts.slice(-2).join(".")) && parts.length >= 3) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

function strictDomainMatch(siteDomain, couponDomain) {
  const siteRoot = rootDomain(siteDomain);
  const couponRoot = rootDomain(couponDomain);
  return !!siteRoot && !!couponRoot && siteRoot === couponRoot;
}

// Get current tab's domain
async function getCurrentDomain() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.url) {
        try {
          const url = new URL(tabs[0].url);
          resolve(url.hostname.replace("www.", ""));
        } catch {
          resolve("");
        }
      } else {
        resolve("");
      }
    });
  });
}

function renderCoupons(coupons) {
  if (!coupons || coupons.length === 0) {
    listEl.innerHTML = `
      <div class="state-msg">
        <div class="icon">🔍</div>
        <p>No coupons found for this site.<br/>Try the <strong>All Coupons</strong> tab.</p>
      </div>`;
    footerCount.textContent = "";
    return;
  }

  listEl.innerHTML = coupons.map((c, i) => `
    <div class="coupon-item">
      ${c.image
        ? `<img class="coupon-logo" src="${c.image}" alt="${c.store}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="coupon-logo-placeholder" style="display:none">🛍️</div>`
        : `<div class="coupon-logo-placeholder">🛍️</div>`
      }
      <div class="coupon-info">
        <div class="coupon-store">${c.store}</div>
        <div class="coupon-title">${c.title}</div>
        <div class="coupon-code-row">
          <span class="coupon-code">${c.couponCode}</span>
          <button class="copy-btn" data-code="${c.couponCode}" data-index="${i}">Copy</button>
        </div>
      </div>
      <a class="shop-link" href="${c.affiliateUrl}" target="_blank">Shop →</a>
    </div>
  `).join("");

  footerCount.textContent = `${coupons.length} coupon${coupons.length !== 1 ? "s" : ""}`;

  // Copy buttons
  listEl.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(btn.dataset.code).then(() => {
        btn.textContent = "✓ Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 2000);
      });
    });
  });
}

function getFilteredCoupons() {
  const query = searchInput.value.trim().toLowerCase();
  let coupons = allCoupons;

  if (activeTab === "this-site" && currentDomain) {
    coupons = allCoupons.filter(c => strictDomainMatch(currentDomain, c.domain));
  }

  if (query) {
    coupons = coupons.filter(c =>
      c.store?.toLowerCase().includes(query) ||
      c.couponCode?.toLowerCase().includes(query) ||
      c.title?.toLowerCase().includes(query)
    );
  }

  return coupons;
}

function render() {
  renderCoupons(getFilteredCoupons());
}

// Tab switching
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    activeTab = tab.dataset.tab;
    currentStoreBar.style.display = activeTab === "this-site" ? "" : "none";
    render();
  });
});

// Search
searchInput.addEventListener("input", render);

// Refresh
document.getElementById("refreshBtn").addEventListener("click", () => {
  listEl.innerHTML = `<div class="state-msg"><div class="spinner"></div><p style="margin-top:10px">Refreshing...</p></div>`;
  chrome.runtime.sendMessage({ type: "REFRESH_COUPONS" }, res => {
    allCoupons = res?.coupons || [];
    render();
  });
});

// Init
async function init() {
  currentDomain = await getCurrentDomain();

  if (currentDomain) {
    currentStoreBar.classList.remove("no-store");
    currentStoreLabel.textContent = `Showing coupons for: ${currentDomain}`;
  } else {
    currentStoreLabel.textContent = "Not on a shopping site";
  }

  chrome.runtime.sendMessage({ type: "GET_ALL_COUPONS" }, res => {
    allCoupons = res?.coupons || [];
    render();
  });
}

init();
