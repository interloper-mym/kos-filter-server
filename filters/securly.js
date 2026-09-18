/* ============================================================ */
/* King of Sorrow — filters/securly.js — simple broker parse    */
/* ============================================================ */

const { fetchURL } = require("../fetch.js");

async function securly(url) {
  try {
    let raw = url.includes("://") ? url.split("://")[1] : url;
    raw = raw.split("?")[0].split("#")[0];
    const encodedUrl = Buffer.from(raw).toString("base64");
    const brokerUrl = "https://uswest-www.securly.com/crextn/broker" +
      "?useremail=admin@edison.k12.ca.us" +
      "&chrome=true&reason=crextn&version=-" +
      "&cu=https://uswest-www.securly.com/crextn&uf=1&cf=1" +
      "&host=" + raw + "&url=" + encodedUrl;
    const res = await fetchURL(brokerUrl, { timeout: 10000 });
    const html = await res.text();
    const parts = html.split(":");
    if (parts.length < 3) return ["BROKER_PARSE_FAIL", null, JSON.stringify(html.slice(0, 100))];
    const status = parts[0].replace(/\s+/g, "").trim();
    const categoryid = parts[2];
    if (status.toUpperCase() === "ALLOW") return ["Allowed", false, "broker"];
    return ["Blocked (cat:" + categoryid + ")", true, "broker"];
  } catch (err) {
    return ["DEBUG_ERROR: " + err.message, null, "broker"];
  }
}

module.exports = { securly };
