async function asyncPool(limit, items, iterator) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('asyncPool limit must be a positive integer');
  }

  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await iterator(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

module.exports = { asyncPool };
