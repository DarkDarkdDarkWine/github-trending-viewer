const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const mockQuery = jest.fn();

jest.mock('../db', () => ({
  query: mockQuery
}));

const { migrateRankingHistory } = require('../scripts/migrate-ranking-history');

describe('migrate-ranking-history', () => {
  let dir;

  beforeEach(async () => {
    jest.clearAllMocks();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ranking-history-test-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('migrates JSON records into record and repo inserts', async () => {
    const historyFile = path.join(dir, 'ranking-history.json');
    await fs.writeFile(historyFile, JSON.stringify({
      records: [{
        timestamp: '2026-05-07T10:00:00.000Z',
        since: 'daily',
        repos: [
          { rank: 1, author: 'owner', name: 'repo', stars: 10, currentPeriodStars: 2 }
        ]
      }]
    }));
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await migrateRankingHistory({ historyFile });

    expect(result.migrated).toBe(1);
    expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT (since, collect_date)');
    expect(mockQuery.mock.calls[0][1]).toEqual(['daily', '2026-05-07T10:00:00.000Z', '2026-05-07']);
    expect(mockQuery.mock.calls[1]).toEqual([
      'DELETE FROM trending_repos WHERE record_id = $1',
      [42]
    ]);
    expect(mockQuery.mock.calls[2][1]).toEqual([
      42, 1, 'owner', 'repo', 10, 2, null, null
    ]);
  });

  test('treats a missing history file as no work', async () => {
    const result = await migrateRankingHistory({ historyFile: path.join(dir, 'missing.json') });

    expect(result.migrated).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
