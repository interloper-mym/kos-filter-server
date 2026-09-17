/* ============================================================
   King of Sorrow's Filter Server
   File: filters/goguardian.js
   Filter: GoGuardian
   Status: token source is dead (404). Returns TOKEN_UNAVAILABLE.
   ============================================================ */

const { fetchURL } = require("../fetch.js");

async function goguardian(urlToCheck) {
  const tokenSources = [
    "https://raw.githubusercontent.com/supercoolgenizy/superman/refs/heads/main/lol"
  ];

  for (const src of tokenSources) {
    try {
      const res = await fetchURL(src + "?" + Date.now(), { timeout: 6000 });
      if (res.status === 200) {
        const text = (await res.text()).trim();
        if (text.startsWith("U2FsdGVkX1") || text.includes("Salted__")) {
          return await queryGoGuardian(text, urlToCheck);
        }
      }
    } catch (e) {}
  }

  return ["TOKEN_UNAVAILABLE (token source dead)", null, "no-token"];
}

async function queryGoGuardian(encryptedB64, urlToCheck) {
  const crypto = require("crypto");
  const fs = require("fs");
  const path = require("path");
  const goguardiancats = JSON.parse(
    fs.readFileSync(path.join(__dirname, "json", "goguardian.json"), "utf8")
  );

  const PUBLIC_KEY = "82fdbf93-6361-454a-9460-e03bc2baaeff";
  const PASSWORD_PREFIX = "59afe4da-9a47-4cff-b024-c9e8fab53eb1";
  const password = Buffer.from(PASSWORD_PREFIX + PUBLIC_KEY, "utf8");

  const raw = Buffer.from(encryptedB64, "base64");
  if (raw.slice(0, 8).toString() !== "Salted__") {
    return ["BAD_TOKEN_FORMAT", null, "salt-header"];
  }
  const salt = raw.slice(8, 16);
  const ciphertext = raw.slice(16);

  let derived = Buffer.alloc(0);
  let prev = Buffer.alloc(0);
  while (derived.length < 48) {
    prev = crypto.createHash("md5").update(Buffer.concat([prev, password, salt])).digest();
    derived = Buffer.concat([derived, prev]);
  }
  const key = derived.slice(0, 32);
  const iv = derived.slice(32, 48);

  let token;
  try {
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    token = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (e) {
    return ["DECRYPT_FAIL", null, e.message];
  }

  const body = JSON.stringify({
    cleanUrl: urlToCheck.replace(/^https?:\/\//, ""),
    rawUrl: urlToCheck
  });
  const headers = {
    authorization: "Bearer " + token,
    "extension-version": "4.1.210",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/138.0.0.0 Safari/537.36",
    "content-type": "text/plain;charset=UTF-8",
    accept: "*/*",
    origin: "chrome-extension://haldlgldplgnggkjaafhelgiaglafanh"
  };

  const apiRes = await fetchURL("https://panther.goguardian.com/api/v2/categories", {
    method: "POST",
    headers,
    body,
    timeout: 10000
  });

  if (apiRes.status !== 200) {
    return ["API_HTTP_" + apiRes.status, null, "panther"];
  }
  const apiJson = await apiRes.json();
  const cats = Array.isArray(apiJson.cats) ? apiJson.cats : [];
  const pairs = cats
    .filter(c => goguardiancats[String(c)])
    .map(c => ({
      name: goguardiancats[String(c)][0],
      blocked: goguardiancats[String(c)][1]
    }));
  const names = pairs.map(p => p.name);
  const blocked = pairs.some(p => p.blocked);
  return [names.join(", ") || "(empty)", blocked, "panther"];
}

module.exports = { goguardian };
