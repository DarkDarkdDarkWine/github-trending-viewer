/**
 * ai-retry.js — retry wrapper for AI/HTTP calls with exponential backoff.
 *
 * Retries only on transient failures (HTTP 429 / 5xx, network resets,
 * timeouts). Honors a `Retry-After` response header when present.
 * `sleep` is injectable so tests stay fast and deterministic.
 */

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN']);

function isRetryable(err) {
  const status = err?.response?.status;
  if (status && RETRYABLE_STATUS.has(status)) return true;
  return RETRYABLE_CODES.has(err?.code);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` with retries. `fn` receives the 0-based attempt index.
 *
 * @param {(attempt: number) => Promise<any>} fn
 * @param {object} [opts]
 * @param {number} [opts.retries=3]       max retries after the first attempt
 * @param {number} [opts.baseDelayMs=1000] backoff base (doubles each retry)
 * @param {number} [opts.maxDelayMs=20000] backoff ceiling
 * @param {string} [opts.label='AI']      log label
 * @param {(info: object) => void} [opts.onRetry]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 */
async function withRetry(fn, opts = {}) {
  const {
    retries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 20000,
    label = 'AI',
    onRetry,
    sleep = defaultSleep,
  } = opts;

  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      attempt += 1;
      if (attempt > retries || !isRetryable(err)) throw err;

      const status = err?.response?.status;
      const retryAfter = Number(err?.response?.headers?.['retry-after']);
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delay = backoff + Math.floor(Math.random() * 250);

      if (onRetry) {
        onRetry({ attempt, status, delay, error: err });
      } else {
        console.warn(`[${label}] retry ${attempt}/${retries} after ${delay}ms (reason=${status || err.code})`);
      }

      await sleep(delay);
    }
  }
}

module.exports = { withRetry, isRetryable };
