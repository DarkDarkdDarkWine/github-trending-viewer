const axios = require('axios');
const { parseNumber, scrapeTrending } = require('../src/services/trending-scraper');

jest.mock('axios');

describe('trending-scraper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('parseNumber handles suffixes, commas, and empty values', () => {
    expect(parseNumber('1.2k')).toBe(1200);
    expect(parseNumber('2m')).toBe(2000000);
    expect(parseNumber('12,345')).toBe(12345);
    expect(parseNumber('')).toBe(0);
  });

  test('throws when GitHub HTML yields no repos', async () => {
    axios.get.mockResolvedValue({ data: '<html></html>' });

    await expect(scrapeTrending('daily')).rejects.toThrow('Scraping returned 0 repos');
  });

  test('extracts and sorts trending repositories', async () => {
    axios.get.mockResolvedValue({
      data: `
        <article class="Box-row">
          <h2><a href="/owner/slow"></a></h2>
          <p class="col-9">Slow repo</p>
          <span itemprop="programmingLanguage">JavaScript</span>
          <a href="/owner/slow/stargazers">1,000</a>
          <a href="/owner/slow/forks">10</a>
          <span class="float-sm-right">5 stars today</span>
        </article>
        <article class="Box-row">
          <h2><a href="/owner/fast"></a></h2>
          <p class="col-9">Fast repo</p>
          <span itemprop="programmingLanguage">Go</span>
          <a href="/owner/fast/stargazers">2k</a>
          <a href="/owner/fast/forks">20</a>
          <span class="float-sm-right">50 stars today</span>
          <img alt="@dev" src="https://avatar.test/dev.png">
        </article>
      `
    });

    const repos = await scrapeTrending('daily');

    expect(repos).toHaveLength(2);
    expect(repos[0]).toMatchObject({
      author: 'owner',
      name: 'fast',
      language: 'Go',
      stars: 2000,
      currentPeriodStars: 50
    });
    expect(repos[0].builtBy[0].username).toBe('dev');
  });
});
