'use strict';

const scrapers = {
  Internshala: require('../src/scrapers/internshala'),
  IndiaDirect: require('../src/scrapers/indiaDirect'),
  GitHubFeeds: require('../src/scrapers/githubFeeds'),
  RemoteOK: require('../src/scrapers/remoteok'),
  WeWorkRemotely: require('../src/scrapers/weworkremotely'),
  YCombinator: require('../src/scrapers/ycombinator'),
  Freshersworld: require('../src/scrapers/freshersworld'),
  Remotive: require('../src/scrapers/remotive'),
};

async function audit() {
  console.log('Testing each scraper individually:');
  const results = {};
  for (const [name, scraper] of Object.entries(scrapers)) {
    const start = Date.now();
    try {
      const jobs = await scraper.scrape();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      results[name] = { count: jobs.length, time: elapsed, status: 'OK' };
      console.log(`[PASS] ${name}: ${jobs.length} jobs fetched in ${elapsed}s`);
      if (jobs.length > 0) {
        console.log(`       Sample: "${jobs[0].title}" @ ${jobs[0].company} (${jobs[0].location})`);
      } else {
        console.log(`       [WARN] 0 jobs returned`);
      }
    } catch (e) {
      results[name] = { count: 0, status: 'ERROR', error: e.message };
      console.log(`[FAIL] ${name}: ${e.message}`);
    }
  }
  console.log('\nAudit Summary:');
  console.table(results);
}

audit();
