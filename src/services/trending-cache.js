const cache = new Map();

function get(since) {
  const entry = cache.get(keyFor(since));
  if (!entry) return null;
  if (Date.now() > entry.expires) return null;
  return entry;
}

function getLastSuccess(since) {
  return cache.get(keyFor(since)) || null;
}

function set(since, data, ttlMs = 5 * 60 * 1000) {
  const entry = {
    data,
    expires: Date.now() + ttlMs,
    lastSuccess: new Date().toISOString()
  };
  cache.set(keyFor(since), entry);
  return entry;
}

function invalidate(since) {
  cache.delete(keyFor(since));
}

function clear() {
  cache.clear();
}

function keyFor(since) {
  return `trending:${since}`;
}

module.exports = { clear, get, getLastSuccess, invalidate, set };
