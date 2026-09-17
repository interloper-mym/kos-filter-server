/* ============================================================
   King of Sorrow's Filter Server
   Inappropriate Recycling v1 — by interloper-mym
   File: server.js
   Purpose: HTTP server. Loads every filter module.
            Exposes POST /check. CORS-enabled.
   ============================================================ */

const http = require("http");
const url = require("url");

/* ---------- LOAD ALL FILTERS ---------- */
/* Each filter module exports a function. If a module is
   missing or broken, we mark it as unavailable instead of
   crashing the whole server. */
const filterLoaders = {
  securly:       () => require("./filters/securly").securly,
  fortiguard:    () => require("./filters/fortiguard").fortiguard,
  goguardian:    () => require("./filters/goguardian").goguardian,
  lightspeed:    () => require("./filters/lightspeed").lightspeed,
  paloalto:      () => require("./filters/paloalto").palo,
  blocksiWeb:    () => require("./filters/blocksi").blocksiStandard,
  blocksiAI:     () => require("./filters/blocksi").blocksiAI,
  lanschool:     () => require("./filters/lanschool").lanschool,
  linewize:      () => require("./filters/linewize").linewize,
  senso:         () => require("./filters/senso").sensocloud,
  cisco:         () => require("./filters/cisco").cisco,
  contentkeeper: () => require("./filters/contentkeeper").contentkeeper,
  deledao:       () => require("./filters/deledao").deledao,
  iboss:         () => require("./filters/iboss").iboss,
  aristotle:     () => require("./filters/aristotle").aristotlek12
};

const filters = {};
const missing = [];
for (const [key, loader] of Object.entries(filterLoaders)) {
  try {
    const fn = loader();
    if (typeof fn === "function") {
      filters[key] = fn;
    } else {
      missing.push(key + " (not a function)");
    }
  } catch (err) {
    missing.push(key + " (" + err.message + ")");
  }
}

/* ---------- FILTER ORDER (canonical output order) ---------- */
const FILTER_ORDER = [
  "fortiguard", "lightspeed", "paloalto", "blocksiWeb", "blocksiAI",
  "linewize", "cisco", "securly", "goguardian", "lanschool",
  "contentkeeper", "aristotle", "senso", "deledao", "iboss"
];

/* ---------- RUN ALL FILTERS FOR A DOMAIN ---------- */
async function runAllFilters(domain, filterList) {
  const results = {};
  const filtersToRun = filterList && filterList.length > 0
    ? filterList.filter(f => filters[f])
    : FILTER_ORDER.filter(f => filters[f]);

  await Promise.all(filtersToRun.map(async (key) => {
    const fn = filters[key];
    if (!fn) {
      results[key] = ["(no module)", null, "missing"];
      return;
    }
    try {
      const result = await Promise.race([
        fn(domain),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), 15000)
        )
      ]);
      if (Array.isArray(result)) {
        results[key] = [String(result[0] ?? "Unknown"), result[1] ?? null, result[2] || "ok"];
      } else if (typeof result === "object" && result !== null) {
        results[key] = [
          String(result.category || result.name || "Unknown"),
          result.blocked ?? null,
          result.prob ?? "ok"
        ];
      } else {
        results[key] = [String(result || "Unknown"), null, "ok"];
      }
    } catch (err) {
      results[key] = ["ERROR", null, err.message];
    }
  }));

  return results;
}

/* ---------- JSON RESPONSE HELPER ---------- */
function sendJSON(res, code, data) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  res.end(JSON.stringify(data));
}

/* ---------- HTTP SERVER ---------- */
const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  /* Preflight */
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    res.end();
    return;
  }

  /* Health check */
  if (parsed.pathname === "/" || parsed.pathname === "/health") {
    sendJSON(res, 200, {
      status: "ok",
      service: "kos-filter-server",
      version: "1.0.0",
      owner: "interloper-mym",
      filters_loaded: Object.keys(filters),
      filters_missing: missing,
      filter_order: FILTER_ORDER,
      timestamp: new Date().toISOString()
    });
    return;
  }

  /* POST /check */
  if (parsed.pathname === "/check" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      let payload;
      try {
        payload = JSON.parse(body || "{}");
      } catch (err) {
        sendJSON(res, 400, { error: "Bad JSON: " + err.message });
        return;
      }

      const domain = payload.domain || payload.url;
      const filterList = Array.isArray(payload.filters) ? payload.filters : null;

      if (!domain) {
        sendJSON(res, 400, { error: "Missing 'domain' field" });
        return;
      }

      try {
        const results = await runAllFilters(domain, filterList);
        sendJSON(res, 200, {
          domain,
          results,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    });
    return;
  }

  /* GET /check/:domain — convenience for quick browser tests */
  if (parsed.pathname.startsWith("/check/") && req.method === "GET") {
    const domain = decodeURIComponent(parsed.pathname.slice("/check/".length));
    if (!domain) {
      sendJSON(res, 400, { error: "Missing domain" });
      return;
    }
    try {
      const results = await runAllFilters(domain, null);
      sendJSON(res, 200, { domain, results, timestamp: new Date().toISOString() });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return;
  }

  /* 404 */
  sendJSON(res, 404, { error: "Not found", path: parsed.pathname });
});

server.listen(PORT, () => {
  console.log("");
  console.log("👑 King of Sorrow's Filter Server");
  console.log("   Inappropriate Recycling v1 — by interloper-mym");
  console.log("   ─────────────────────────────────────────────");
  console.log("   Listening on port: " + PORT);
  console.log("   Filters loaded:    " + Object.keys(filters).length + " / " + FILTER_ORDER.length);
  if (missing.length) {
    console.log("   Filters missing:   " + missing.join(", "));
  } else {
    console.log("   Filters missing:   (none)");
  }
  console.log("   ─────────────────────────────────────────────");
  console.log("   Test:  curl -X POST http://localhost:" + PORT + "/check \\");
  console.log("            -H \"Content-Type: application/json\" \\");
  console.log("            -d '{\"domain\":\"unpkg.com\"}'");
  console.log("");
});
