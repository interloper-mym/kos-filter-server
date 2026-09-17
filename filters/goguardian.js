/* ============================================================
   King of Sorrow's Filter Server
   File: filters/goguardian.js
   Filter: GoGuardian (panther.goguardian.com categories API)
   Fixed: use Node classic crypto (createHash) instead of WebCrypto
          because crypto.subtle doesn't support MD5.
   ============================================================ */

const { fetchURL } = require("../fetch.js");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const goguardiancats = JSON.parse(
  fs.readFileSync(path.join(__dirname, "json", "goguardian.json"), "utf8")
);

/* ---------- MD5 via Node classic crypto ---------- */
function md5(data) {
  return Uint8Array.from(
    crypto.createHash("md5").update(Buffer.from(data)).digest()
  );
}

function concatUint8(...arrays) {
  let total = arrays.reduce((s, a) => s + a.length, 0);
  let out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function evpBytesToKey(password, salt) {
  let derived = new Uint8Array(0);
  let prev = new Uint8Array(0);
  while (derived.length < 48) {
    const input = concatUint8(prev, password, salt);
    prev = md5(input);
    derived = concatUint8(derived, prev);
  }
  return {
    key: derived.slice(0, 32),
    iv: derived.slice(32, 48)
  };
}

/* ---------- AES-CBC decrypt via Node classic crypto ---------- */
function decryptOpenSSL(encryptedB64, password) {
  const raw = Buffer.from(encryptedB64, "base64");
  const header = raw.slice(0, 8).toString("utf8");
  if (header !== "Salted__") {
    throw new Error("Invalid OpenSSL salt header: " + JSON.stringify(header));
  }
  const salt = raw.slice(8, 16);
  const ciphertext = raw.slice(16);

  const { key, iv } = evpBytesToKey(password, salt);

  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key), Buffer.from(iv));
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

async function goguardian(urlToCheck) {
  const steps = [];

  try {
    const PUBLIC_KEY = "82fdbf93-6361-454a-9460-e03bc2baaeff";
    const PASSWORD_PREFIX = "59afe4da-9a47-4cff-b024-c9e8fab53eb1";

    const password = Buffer.from(PASSWORD_PREFIX + PUBLIC_KEY, "utf8");
    steps.push("password built: " + password.length + " bytes");

    /* Step 1: fetch encrypted token from GitHub raw */
    const lolUrl =
      "https://raw.githubusercontent.com/supercoolgenizy/superman/refs/heads/main/lol?" +
      Date.now();
    const lolRes = await fetchURL(lolUrl, { timeout: 8000 });
    steps.push("token fetch status: " + lolRes.status);
    const lolText = (await lolRes.text()).trim();
    steps.push("token length: " + lolText.length + " chars");

    /* Step 2: decrypt token */
    let token;
    try {
      token = decryptOpenSSL(lolText, password);
      steps.push("token decrypted: " + token.length + " chars");
    } catch (decryptErr) {
      steps.push("DECRYPT FAILED: " + decryptErr.message);
      throw decryptErr;
    }

    /* Step 3: POST to panther.goguardian.com */
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
    steps.push("panther status: " + apiRes.status);

    const apiJson = await apiRes.json();
    if (apiJson.error) {
      steps.push("panther error: " + JSON.stringify(apiJson.error));
      return ["API_ERROR", null, steps.join(" | ")];
    }
    const cats = Array.isArray(apiJson.cats) ? apiJson.cats : [];
    steps.push("cats returned: " + JSON.stringify(cats));

    const pairs = cats
      .filter(c => goguardiancats[String(c)])
      .map(c => ({
        name: goguardiancats[String(c)][0],
        blocked: goguardiancats[String(c)][1]
      }));

    const names = pairs.map(p => p.name);
    const blocked = pairs.some(p => p.blocked);

    if (names.length === 0) {
      return ["(empty)", false, steps.join(" | ")];
    }
    return [names.join(", "), blocked, steps.join(" | ")];

  } catch (err) {
    steps.push("FATAL: " + err.message);
    console.warn("GoGuardian Error:", err);
    return ["DEBUG_ERROR: " + err.message, null, steps.join(" | ")];
  }
}

module.exports = { goguardian };
