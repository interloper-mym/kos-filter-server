/* ============================================================
   King of Sorrow's Filter Server
   File: filters/securly.js
   Filter: Securly (crextn broker)
   Final: uses broker status + category ID directly.
   ============================================================ */

const { fetchURL } = require("../fetch.js");

async function securly(url) {
  const steps = [];

  try {
    let raw = url.includes("://") ? url.split("://")[1] : url;
    raw = raw.split("?")[0].split("#")[0];
    const encodedUrl = Buffer.from(raw).toString("base64");
    steps.push("raw=" + raw);

    const brokerUrl =
      "https://uswest-www.securly.com/crextn/broker" +
      "?useremail=admin@edison.k12.ca.us" +
      "&chrome=true" +
      "&reason=crextn" +
      "&version=-" +
      "&cu=https://uswest-www.securly.com/crextn" +
      "&uf=1&cf=1" +
      "&host=" + raw +
      "&url=" + encodedUrl;

    const res = await fetchURL(brokerUrl, {
      timeout: 10000,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/138.0.0.0 Safari/537.36",
        accept: "*/*"
      }
    });
    steps.push("broker_status=" + res.status);

    const html = await res.text();
    steps.push("broker_body=" + JSON.stringify(html.slice(0, 200)));

    const parts = html.split(":");
    if (parts.length < 3) {
      return ["BROKER_PARSE_FAIL", null, steps.join(" | ")];
    }

    const status = parts[0].replace(/\s+/g, "").trim();
    const categoryid = parts[2];
    const isAllow = status.toUpperCase() === "ALLOW";
    const isBlocked = !isAllow;

    steps.push("status=" + status + " catid=" + categoryid);

    if (isBlocked && categoryid && categoryid !== "0" && categoryid !== "-1") {
      try {
        const blockedUrl =
          "https://www.securly.com/blocked" +
          "?useremail=admin@edison.k12.ca.us" +
          "&chrome=true" +
          "&reason=globalblacklist" +
          "&keyword=" +
          "&extension_id=kfiocjonplkilcjfgabfngiddebalkod" +
          "&extension_version=3.0.21" +
          "&categoryid=" + categoryid +
          "&policyid=" + parts[1] +
          "&url=" + encodedUrl;

        const res2 = await fetchURL(blockedUrl, {
          timeout: 8000,
          headers: {
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
              "AppleWebKit/537.36 (KHTML, like Gecko) " +
              "Chrome/138.0.0.0 Safari/537.36",
            accept: "text/html,*/*"
          }
        });
        const html2 = await res2.text();
        steps.push("blocked_status=" + res2.status + " len=" + html2.length);

        const m1 = html2.match(/params\[['"]categories['"]\]\s*=\s*["']([^"']+)/);
        if (m1) {
          steps.push("category_extracted=" + m1[1]);
          return [m1[1], true, steps.join(" | ")];
        }
        const m2 = html2.match(/class=["'][^"']*category[^"']*["'][^>]*>([^<]+)/i);
        if (m2) {
          steps.push("category_extracted=" + m2[1].trim());
          return [m2[1].trim(), true, steps.join(" | ")];
        }
        steps.push("category_extraction_failed");
      } catch (e) {
        steps.push("blocked_page_error=" + e.message);
      }
    }

    if (isAllow) {
      return ["Allowed", false, steps.join(" | ")];
    }
    return ["Blocked (cat:" + categoryid + ")", true, steps.join(" | ")];

  } catch (err) {
    steps.push("FATAL: " + err.message);
    console.warn("Securly Error:", err);
    return ["DEBUG_ERROR: " + err.message, null, steps.join(" | ")];
  }
}

module.exports = { securly };
