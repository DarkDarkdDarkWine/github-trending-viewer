const db = require('../../db');
const { getShanghaiDateStr } = require('../lib/shanghai-date');

async function update(repos, since) {
  return db.saveTrendingData(repos, since);
}

async function getChanges(repos, since, todayDate = getShanghaiDateStr()) {
  let previous;
  try {
    previous = await db.getPreviousRanking(since, todayDate);
  } catch (err) {
    console.warn('Ranking history unavailable:', err.message);
    previous = null;
  }

  if (!previous || previous.length === 0) {
    return repos.map(() => ({ change: 0, isNew: true }));
  }

  const previousByRepo = new Map(
    previous.map(repo => [`${repo.author}/${repo.name}`, repo])
  );

  return repos.map((repo, index) => {
    const prev = previousByRepo.get(`${repo.author}/${repo.name}`);
    if (!prev) return { change: 0, isNew: true };
    return {
      change: prev.rank - (index + 1),
      isNew: false,
      previousRank: prev.rank
    };
  });
}

module.exports = { getChanges, update };
