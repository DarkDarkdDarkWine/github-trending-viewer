const mockGetPreviousRanking = jest.fn();
const mockSaveTrendingData = jest.fn();

jest.mock('../db', () => ({
  getPreviousRanking: mockGetPreviousRanking,
  saveTrendingData: mockSaveTrendingData
}));

const rankingHistory = require('../src/services/ranking-history');

describe('ranking-history service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('marks all repos as new when no previous ranking exists', async () => {
    mockGetPreviousRanking.mockResolvedValue(null);

    const changes = await rankingHistory.getChanges([
      { author: 'a', name: 'one' },
      { author: 'b', name: 'two' }
    ], 'daily', '2026-05-08');

    expect(changes).toEqual([
      { change: 0, isNew: true },
      { change: 0, isNew: true }
    ]);
  });

  test('computes rank changes against previous ranking', async () => {
    mockGetPreviousRanking.mockResolvedValue([
      { rank: 3, author: 'a', name: 'one' },
      { rank: 1, author: 'b', name: 'two' }
    ]);

    const changes = await rankingHistory.getChanges([
      { author: 'a', name: 'one' },
      { author: 'b', name: 'two' },
      { author: 'c', name: 'three' }
    ], 'daily', '2026-05-08');

    expect(changes).toEqual([
      { change: 2, isNew: false, previousRank: 3 },
      { change: -1, isNew: false, previousRank: 1 },
      { change: 0, isNew: true }
    ]);
  });

  test('delegates update to database persistence', async () => {
    mockSaveTrendingData.mockResolvedValue({ success: true });
    const repos = [{ author: 'a', name: 'one' }];

    await rankingHistory.update(repos, 'weekly');

    expect(mockSaveTrendingData).toHaveBeenCalledWith(repos, 'weekly');
  });
});
