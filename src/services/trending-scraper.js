const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeTrending(since = 'daily') {
  const url = `https://github.com/trending?since=${since}`;
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  const $ = cheerio.load(response.data);
  const repos = [];

  $('article.Box-row').each((index, element) => {
    const $elem = $(element);
    const repoLink = $elem.find('h2 a').attr('href');
    if (!repoLink) return;

    const [, author, name] = repoLink.split('/');
    const description = $elem.find('p.col-9').text().trim();
    const language = $elem.find('[itemprop="programmingLanguage"]').text().trim();
    const starsText = $elem.find('a[href$="/stargazers"]').text().trim();
    const forksText = $elem.find('a[href$="/forks"]').text().trim();
    const starsSpan = $elem.find('span.float-sm-right').text().trim();
    const builtBy = [];

    $elem.find('img[alt^="@"]').each((i, img) => {
      const username = $(img).attr('alt').replace('@', '');
      builtBy.push({
        username,
        avatar: $(img).attr('src'),
        url: `https://github.com/${username}`
      });
    });

    repos.push({
      author,
      name,
      url: `https://github.com${repoLink}`,
      description: description || '',
      descriptionZh: '',
      language: language || '',
      stars: parseNumber(starsText),
      forks: parseNumber(forksText),
      currentPeriodStars: parseNumber(starsSpan.split(' ')[0]),
      builtBy
    });
  });

  if (repos.length === 0) {
    throw new Error('Scraping returned 0 repos — GitHub page structure may have changed');
  }

  repos.sort((a, b) => b.currentPeriodStars - a.currentPeriodStars);
  repos.splice(20);
  return repos;
}

function parseNumber(str) {
  if (!str) return 0;
  const normalized = String(str).replace(/,/g, '').trim();
  const match = normalized.match(/([\d.]+)([km])?/i);
  if (!match) return 0;

  const multipliers = { k: 1000, m: 1000000 };
  const multiplier = match[2] ? multipliers[match[2].toLowerCase()] : 1;
  return Math.round(parseFloat(match[1]) * multiplier);
}

module.exports = { parseNumber, scrapeTrending };
