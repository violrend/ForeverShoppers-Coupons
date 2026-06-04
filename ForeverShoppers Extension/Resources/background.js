// Safari/WebExtension compatibility shim
(function () {
  if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
    globalThis.chrome = globalThis.browser;
  }
})();

const FEED_URL = "https://forevershoppers.com/wp-content/uploads/wpallexport/exports/c2880b028bf04c0cf44b8369e075ea8f/current-Posts-Export-2026-May-19-1104.xml?wpae_nocache=209110504";
const CACHE_KEY = "fs_coupons_cache";
const CACHE_TIME_KEY = "fs_coupons_cache_time";
const CACHE_DURATION = 0; // Always refresh coupon feed so new coupons appear immediately

function normalizeHost(host) {
  return String(host || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .replace(/^www\./, "")
    .trim();
}

function rootDomain(host) {
  const h = normalizeHost(host);
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return h;
  const sld = parts.slice(-2).join(".");
  const twoPartTlds = new Set(["co.uk","com.au","com.tr","com.br","co.nz","co.jp","com.mx","com.sg"]);
  const lastTwo = parts.slice(-2).join(".");
  if (twoPartTlds.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join(".");
  return sld;
}

function strictDomainMatch(siteDomain, couponDomain) {
  const siteRoot = rootDomain(siteDomain);
  const couponRoot = rootDomain(couponDomain);
  if (!siteRoot || !couponRoot) return false;
  return siteRoot === couponRoot;
}

// Extract text between XML tags using regex (no DOMParser in Service Worker)
function getTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
}

function parseFeed(xmlText) {
  const coupons = [];
  const postMatches = xmlText.match(/<post>[\s\S]*?<\/post>/gi) || [];

  postMatches.forEach(postXml => {
    const store = getTag(postXml, "AffiliateStore");
    const couponCode = getTag(postXml, "rehub_offer_product_coupon");
    const rawUrl = getTag(postXml, "rehub_offer_product_url");
    const title = getTag(postXml, "Title");
    const image = getTag(postXml, "ImageFeatured");
    const content = getTag(postXml, "Content");

    if (!store || !couponCode || !rawUrl) return;

    // Strip all whitespace from URL
    const affiliateUrl = rawUrl.replace(/\s+/g, "").replace(/&amp;/g, "&");

    // Extract destination URL from affiliate link
    let storeUrl = affiliateUrl;
    try {
      const match = affiliateUrl.match(/[?&]url=([^&]+)/);
      if (match) storeUrl = decodeURIComponent(match[1]);
    } catch (e) {}

    // Extract domain
    let domain = "";
    try {
      domain = new URL(storeUrl).hostname.replace("www.", "").toLowerCase();
    } catch (e) {
      domain = store.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
    }

    coupons.push({ store, domain, couponCode, affiliateUrl, storeUrl, title, content, image });
  });

  return coupons;
}

async function fetchAndCacheCoupons() {
  try {
    const sep = FEED_URL.includes("?") ? "&" : "?";
    const response = await fetch(FEED_URL + sep + "fs_ts=" + Date.now(), {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache" }
    });
    const text = await response.text();
    const coupons = parseFeed(text);
    await chrome.storage.local.set({
      [CACHE_KEY]: JSON.stringify(coupons),
      [CACHE_TIME_KEY]: Date.now()
    });
    console.log(`[ForeverShoppers] Cached ${coupons.length} coupons. Domains:`, coupons.slice(0,5).map(c => c.domain));
    return coupons;
  } catch (err) {
    console.error("[ForeverShoppers] Fetch error:", err);
    return null;
  }
}

async function getCoupons(forceRefresh = true) {
  // Always try to fetch fresh data first. Storage is used only as a fallback if the feed request fails.
  const fresh = await fetchAndCacheCoupons();
  if (fresh && Array.isArray(fresh)) return fresh;

  const result = await chrome.storage.local.get([CACHE_KEY]);
  const cached = result[CACHE_KEY];
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  return [];
}

async function getCouponsForDomain(domain) {
  const coupons = await getCoupons();
  if (!coupons) return [];

  const clean = normalizeHost(domain);
  const siteRoot = rootDomain(clean);

  // IMPORTANT: strict root-domain matching only.
  // This prevents unrelated coupons such as Herman Miller appearing on disneystore.com.
  const matched = coupons.filter(c => strictDomainMatch(siteRoot, c.domain));

  console.log(`[ForeverShoppers] "${clean}" / root "${siteRoot}" → ${matched.length} strict match(es)`);
  return matched;
}


function domainFromUrl(url) {
  try {
    const u = new URL(url || "");
    if (!/^https?:$/.test(u.protocol)) return "";
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch (e) {
    return "";
  }
}

async function updateBadgeForTab(tabId, url) {
  const domain = domainFromUrl(url);
  if (!tabId) return;

  if (!domain) {
    chrome.action.setBadgeText({ tabId, text: "" });
    return;
  }

  try {
    const coupons = await getCouponsForDomain(domain);
    const count = coupons.length;
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#7c3aed" });
    chrome.action.setBadgeTextColor?.({ tabId, color: "#ffffff" });
    chrome.action.setBadgeText({ tabId, text: count > 0 ? String(Math.min(count, 99)) : "" });
    chrome.action.setTitle({
      tabId,
      title: count > 0
        ? `ForeverShoppers Coupons - ${count} coupon${count !== 1 ? "s" : ""} available`
        : "ForeverShoppers Coupons"
    });
  } catch (e) {
    chrome.action.setBadgeText({ tabId, text: "" });
  }
}

async function updateActiveTabBadge() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (tab && tab.id) updateBadgeForTab(tab.id, tab.url);
  } catch (e) {}
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    updateBadgeForTab(tabId, changeInfo.url || tab.url);
  }
});

chrome.tabs.onActivated.addListener(async activeInfo => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    updateBadgeForTab(activeInfo.tabId, tab.url);
  } catch (e) {}
});

chrome.windows.onFocusChanged.addListener(() => updateActiveTabBadge());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_COUPONS_FOR_DOMAIN") {
    getCouponsForDomain(msg.domain).then(coupons => sendResponse({ coupons }));
    return true;
  }
  if (msg.type === "GET_ALL_COUPONS") {
    getCoupons().then(coupons => sendResponse({ coupons: coupons || [] }));
    return true;
  }
  if (msg.type === "REFRESH_COUPONS") {
    fetchAndCacheCoupons().then(coupons => { updateActiveTabBadge(); sendResponse({ coupons: coupons || [] }); });
    return true;
  }
});

chrome.alarms.create("refreshCoupons", { periodInMinutes: 360 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "refreshCoupons") fetchAndCacheCoupons().then(() => updateActiveTabBadge());
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.clear();
  fetchAndCacheCoupons().then(() => updateActiveTabBadge());
});

chrome.runtime.onStartup.addListener(() => fetchAndCacheCoupons().then(() => updateActiveTabBadge()));

fetchAndCacheCoupons().then(() => updateActiveTabBadge());
