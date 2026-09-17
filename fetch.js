/* ============================================================
   King of Sorrow's Filter Server
   Inappropriate Recycling v1 — by interloper-mym
   File: fetch.js
   Purpose: Wrapper around native fetch with timeout + retry.
            Used by every filter module in ./filters/
   ============================================================ */

const DEFAULT_TIMEOUT = 10000; // 10 seconds
const DEFAULT_RETRIES = 1;     // 1 retry on failure

/**
 * fetch() with an abort timer and optional retries.
 * @param {string} url
 * @param {object} [opts] - standard fetch options, plus:
 *   @param {number} [opts.timeout] - ms before abort (default 10000)
 *   @param {number} [opts.retries] - number of retry attempts (default 1)
 * @returns {Promise<Response>}
 */
async function fetchURL(url, opts = {}) {
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const { timeout: _t, retries: _r, ...fetchOpts } = opts;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...fetchOpts, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        // Exponential backoff: 500ms, 1000ms, ...
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

module.exports = { fetchURL };
