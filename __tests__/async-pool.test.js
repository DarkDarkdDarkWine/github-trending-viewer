const { asyncPool } = require('../src/lib/async-pool');

describe('asyncPool', () => {
  test('limits concurrency and returns results in input order', async () => {
    let active = 0;
    let maxActive = 0;

    const results = await asyncPool(2, [1, 2, 3, 4], async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active -= 1;
      return value * 2;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([2, 4, 6, 8]);
  });

  test('rejects when an item fails', async () => {
    await expect(asyncPool(2, [1, 2, 3], async (value) => {
      if (value === 2) throw new Error('boom');
      return value;
    })).rejects.toThrow('boom');
  });
});
