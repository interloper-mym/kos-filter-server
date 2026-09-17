/* ============================================================
   King of Sorrow's Filter Server
   File: filters/securly.js
   Filter: Securly (crextn broker + blocked page)
   Fixed: verbose logging. Keeps cookie jar for follow-up request.
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

    /* ---- Step 1: hit the broker ---- */
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

    /* Broker responds with something like:
         ALLOW:policyid:categoryid
       or    BLOCK:policyid:categoryid
       or something else entirely. */
    const parts = html.split(":");
    steps.push("broker_parts_count=" + parts.length);

    if (parts.length < 3) {
      /* Try once more with a stricter split on newlines */
      const firstLine = html.split("\n")[0].trim();
      const lineParts = firstLine.split(":");
      if (lineParts.length < 3) {
        return ["BROKER_PARSE_FAIL", null, steps.join(" | ")];
      }
      parts.length = 0;
      parts.push(...lineParts);
    }

    const status = parts[0].replace(/\s+/g, "").trim();
    const policyid = parts[1];
    const categoryid = parts[2];
    steps.push("status=" + status + " policy=" + policyid + " catid=" + categoryid);

    /* If categoryid is "0" or empty, Securly didn't categorize the domain. */
    const isAllow = status.toUpperCase() === "ALLOW";

    /* ---- Step 2: fetch the blocked page to get the category name ---- */
    const blockedUrl =
      "https://www.securly.com/blocked" +
      "?useremail=admin@edison.k12.ca.us" +
      "&chrome=true" +
      "&reason=globalblacklist" +
      "&keyword=" +
      "&extension_id=kfiocjonplkilcjfgabfngiddebalkod" +
      "&extension_version=3.0.21" +
      "&categoryid=" + categoryid +
      "&policyid=" + policyid +
      "&url=" + encodedUrl;

    const res2 = await fetchURL(blockedUrl, {
      timeout: 10000,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/138.0.0.0 Safari/537.36",
        accept: "text/html,*/*"
      }
    });
    steps.push("blocked_status=" + res2.status);

    const html2 = await res2.text();
    steps.push("blocked_body_len=" + html2.length);

    /* Extract the category from the blocked page. */
    let category = "Unknown";

    /* Strategy 1: params['categories'] = "..." */
    const m1 = html2.match(/params\[['"]categories['"]\]\s*=\s*["']([^"']+)/);
    if (m1) { category = m1[1]; steps.push("cat_strategy1=hit"); }

    /* Strategy 2: <span class="category"> ... </span> */
    if (category === "Unknown") {
      const m2 = html2.match(/class=["'][^"']*category[^"']*["'][^>]*>([^<]+)/i);
      if (m2) { category = m2[1].trim(); steps.push("cat_strategy2=hit"); }
    }

    /* Strategy 3: search for known category keywords */
    if (category === "Unknown") {
      const known = [
        "Educational", "Audio/Video", "Computers", "Games", "Social Networking",
        "Pornography", "Entertainment", "News", "Shopping", "Sports"
      ];
      for (const k of known) {
        if (html2.includes(k)) { category = k; steps.push("cat_strategy3=" + k); break; }
      }
    }

    /* If status is ALLOW and the page didn't give us a category, trust the status */
    if (isAllow && category === "Unknown") {
      return ["Allowed", false, steps.join(" | ")];
    }

    const blocked = !isAllow;
    return [category, blocked, steps.join(" | ")];

  } catch (err) {
    steps.push("FATAL: " + err.message);
    console.warn("Securly Error:", err);
    return ["DEBUG_ERROR: " + err.message, null, steps.join(" | ")];
  }
}

module.exports = { securly };
