/* ============================================================
   King of Sorrow's Filter Server — DEBUG EDITION
   Inappropriate Recycling v1 — by interloper-mym
   File: server.js (debug)
   Purpose: Same as server.js, but logs every filter's internal
            error in full detail. Use this to diagnose failures.
   ============================================================ */

const http = require("http");

/* ---------- LOAD ALL FILTERS ---------- */
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
    if (typeof fn === "function") filters[key] = fn;
    else missing.push(key + " (not a function)");
  } catch (err) {
    missing.push(key + " (" + err.message + ")");
  }
}

const FILTER_ORDER = [
  "fortiguard", "lightspeed", "paloalto", "blocksiWeb", "blocksiAI",
  "linewize", "cisco", "securly", "goguardian", "lanschool",
  "contentkeeper", "aristotle", "senso", "deledao", "iboss"
];

/* ---------- RUN ALL FILTERS WITH FULL DEBUG LOGGING ---------- */
async function runAllFilters(domain) {
  const results = {};
  const debugLog = {};

  await Promise.all(FILTER_ORDER.map(async (key) => {
    const fn = filters[key];
    if (!fn) {
      results[key] = ["(no module)", null, "missing"];
      debugLog[key] = { error: "No filter module loaded" };
      return;
    }
    const t0 = Date.now();
    const debug = { started: new Date().toISOString(), steps: [] };
    try {
      const result = await Promise.race([
        fn(domain),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("HARD_TIMEOUT_15s")), 15000)
        )
      ]);
      const elapsed = Date.now() - t0;
      debug.elapsed_ms = elapsed;
      debug.result_raw = result;
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
      debug.status = "ok";
    } catch (err) {
      const elapsed = Date.now() - t0;
      debug.elapsed_ms = elapsed;
      debug.status = "error";
      debug.error_name = err.name;
      debug.error_message = err.message;
      debug.error_stack = (err.stack || "").split("\n").slice(0, 8);
      results[key] = ["DEBUG_ERROR", null, err.message];
    }
    debugLog[key] = debug;
  }));

  return { results, debug: debugLog };
}

/* ---------- SEND JSON ---------- */
function sendJSON(res, code, data) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  res.end(JSON.stringify(data, null, 2));
}

/* ---------- HTTP SERVER ---------- */
const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split("?")[0];

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    res.end();
    return;
  }

  if (pathname === "/" || pathname === "/health") {
    sendJSON(res, 200, {
      status: "ok",
      service: "kos-filter-server",
      version: "1.0.0-debug",
      owner: "interloper-mym",
      filters_loaded: Object.keys(filters),
      filters_missing: missing,
      filter_order: FILTER_ORDER,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (pathname === "/check" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      let payload;
      try { payload = JSON.parse(body || "{}"); }
      catch (err) { sendJSON(res, 400, { error: "Bad JSON: " + err.message }); return; }
      const domain = payload.domain || payload.url;
      if (!domain) { sendJSON(res, 400, { error: "Missing 'domain' field" }); return; }
      try {
        const { results, debug } = await runAllFilters(domain);
        sendJSON(res, 200, {
          domain,
          results,
          debug,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    });
    return;
  }

  if (pathname.startsWith("/check/") && req.method === "GET") {
    const domain = decodeURIComponent(pathname.slice("/check/".length));
    try {
      const { results, debug } = await runAllFilters(domain);
      sendJSON(res, 200, { domain, results, debug, timestamp: new Date().toISOString() });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return;
  }

  sendJSON(res, 404, { error: "Not found", path: pathname });
});

server.listen(PORT, () => {
  console.log("");
  console.log("👑 King of Sorrow's Filter Server — DEBUG EDITION");
  console.log("   ─────────────────────────────────────────────");
  console.log("   Listening on port: " + PORT);
  console.log("   Filters loaded:    " + Object.keys(filters).length + " / " + FILTER_ORDER.length);
  console.log("   Filters missing:   " + (missing.length ? missing.join(", ") : "(none)"));
  console.log("   ─────────────────────────────────────────────");
  console.log("   Debug: POST /check returns a `debug` object with");
  console.log("          per-filter error stacks + elapsed times.");
  console.log("");
});
