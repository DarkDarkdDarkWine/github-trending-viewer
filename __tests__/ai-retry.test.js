const { withRetry, isRetryable } = require('../src/lib/ai-retry');

const noSleep = () => Promise.resolve();

function httpError(status, headers = {}) {
  const err = new Error(`HTTP ${status}`);
  err.response = { status, headers };
  return err;
}

function codeError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

describe('isRetryable', () => {
  test('retries on 429 and 5xx', () => {
    expect(isRetryable(httpError(429))).toBe(true);
    expect(isRetryable(httpError(503))).toBe(true);
  });

  test('does not retry on 4xx (except 429)', () => {
    expect(isRetryable(httpError(400))).toBe(false);
    expect(isRetryable(httpError(401))).toBe(false);
    expect(isRetryable(httpError(404))).toBe(false);
  });

  test('retries on transient network codes', () => {
    expect(isRetryable(codeError('ECONNRESET'))).toBe(true);
    expect(isRetryable(codeError('ETIMEDOUT'))).toBe(true);
    expect(isRetryable(codeError('NOPE'))).toBe(false);
  });
});

describe('withRetry', () => {
  test('returns immediately on first success', async () => {
    let calls = 0;
    const result = await withRetry(async () => { calls += 1; return 'ok'; }, { sleep: noSleep });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  test('retries on 429 then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls < 3) throw httpError(429);
      return 'recovered';
    }, { sleep: noSleep, baseDelayMs: 1 });
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  test('gives up after max retries and throws the last error', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls += 1;
      throw httpError(429);
    }, { retries: 2, sleep: noSleep })).rejects.toThrow('HTTP 429');
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  test('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls += 1;
      throw httpError(400);
    }, { sleep: noSleep })).rejects.toThrow('HTTP 400');
    expect(calls).toBe(1);
  });

  test('honors Retry-After header for backoff delay', async () => {
    const delays = [];
    let calls = 0;
    await withRetry(async () => {
      calls += 1;
      if (calls < 2) throw httpError(429, { 'retry-after': '2' });
      return 'ok';
    }, { sleep: (ms) => { delays.push(ms); return Promise.resolve(); } });
    // 2 seconds (+ up to 250ms jitter)
    expect(delays[0]).toBeGreaterThanOrEqual(2000);
    expect(delays[0]).toBeLessThan(2300);
  });
});
