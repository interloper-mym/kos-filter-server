/* ============================================================
   King of Sorrow's Filter Server
   File: filters/paloalto.js
   Filter: Palo Alto URL Filtering (urlfiltering.paloaltonetworks.com)
   Fixed: verbose logging + fallback parsers + regex-based category
          extraction that doesn't depend on exact HTML structure.
   ============================================================ */

const { fetchURL } = require("../fetch.js");
const fs = require("fs");
const path = require("path");
const paloblocked = JSON.parse(
  fs.readFileSync(path.join(__dirname, "json", "paloblocked.json"), "utf8")
);

async function palo(targetUrl) {
  const steps = [];

  try {
    const encoded = encodeURIComponent(targetUrl);
    const url = `https://urlfiltering.paloaltonetworks.com/single_cr/?url=${encoded}`;
    steps.push("url=" + url);

    const resp = await fetchURL(url, {
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json,text/html,*/*",
        Referer: "https://urlfiltering.paloaltonetworks.com/"
      }
    });

    steps.push("status=" + resp.status);
    if (!resp.ok) {
      return ["HTTP_" + resp.status, null, steps.join(" | ")];
    }

    let text = await resp.text();
    steps.push("html_len=" + text.length);

    /* Normalize whitespace */
    text = text.replace(/[\t\n\r\f\v]+/g, " ");
    text = text.replace(/ {2,}/g, " ");

    /* Strategy 1: find the "Current Category" label and its sibling */
    let category = null;
    const m1 = text.match(/Current Category<\/label>\s*<div[^>]*>\s*([^<]+)/i);
    if (m1) { category = m1[1].trim(); steps.push("strategy1=hit"); }

    /* Strategy 2: look for "form-text" class near "Current Category" */
    if (!category) {
      const m2 = text.match(/Current Category.{0,300}?form-text[^>]*>\s*([^<]+)/i);
      if (m2) { category = m2[1].trim(); steps.push("strategy2=hit"); }
    }

    /* Strategy 3: any "col-sm-10 col-lg-10 form-text" block */
    if (!category) {
      const m3 = text.match(/col-sm-10 col-lg-10 form-text[^>]*>\s*([^<]+)/i);
      if (m3) { category = m3[1].trim(); steps.push("strategy3=hit"); }
    }

    /* Strategy 4: search for known category keywords in the HTML */
    if (!category) {
      const knownCats = [
        "content-delivery-networks", "computers-and-internet",
        "business-and-economy", "education", "entertainment",
        "government", "health-and-medicine", "news-and-media",
        "reference-and-research", "shopping", "social-networking",
        "sports", "travel", "games", "streaming-media"
      ];
      for (const k of knownCats) {
        if (text.toLowerCase().includes(k)) {
          category = k; steps.push("strategy4=hit:" + k); break;
        }
      }
    }

    if (!category) {
      /* Save a snippet of the HTML for debugging */
      const snippet = text.slice(0, 500).replace(/</g, "&lt;");
      return ["PARSE_FAIL", null, steps.join(" | ") + " | snippet=" + snippet];
    }

    const fixedcategory = category.replace(/<[^>]*>/g, "").trim();
    steps.push("category=" + fixedcategory);

    const categories = fixedcategory.split(",").map(c => c.trim());
    const blocked = categories.some(cat => paloblocked.includes(cat));
    steps.push("blocked=" + blocked);

    return [fixedcategory, blocked, steps.join(" | ")];

  } catch (err) {
    steps.push("FATAL: " + err.message);
    console.warn("Palo Error:", err);
    return ["DEBUG_ERROR: " + err.message, null, steps.join(" | ")];
  }
}

module.exports = { palo };
