'use strict';

const serpapi = require('./serpapi');
const internshala = require('./internshala');
const remoteok = require('./remoteok');
const weworkremotely = require('./weworkremotely');
const ycombinator = require('./ycombinator');
const githubFeeds = require('./githubFeeds');
const freshersworld = require('./freshersworld');
const remotive = require('./remotive');
const indiaDirect = require('./indiaDirect');
const unstop = require('./unstop');
const wellfound = require('./wellfound');
const linkedin = require('./linkedin');
const indeed = require('./indeed');
const hirist = require('./hirist');
const foundit = require('./foundit');
const naukri = require('./naukri');

/**
 * Run all scrapers concurrently with Promise.allSettled.
 * Individual scraper failures never crash the whole run.
 * Returns a flat array of raw job objects.
 */
async function runAllScrapers(options = {}) {
  const { useSerpapi = false } = options;

  const tasks = [
    { name: 'Internshala',         fn: internshala.scrape },
    { name: '[UNSTOP]',            fn: unstop.scrape },
    { name: 'IndiaDirect (APIs)',  fn: indiaDirect.scrape },
    { name: 'GitHub Feeds (2026/27)', fn: githubFeeds.scrape },
    { name: '[YC]',                fn: ycombinator.scrape },
    { name: '[WELLFOUND]',         fn: wellfound.scrape },
    { name: '[LINKEDIN]',          fn: linkedin.scrape },
    { name: '[INDEED]',            fn: indeed.scrape },
    { name: '[HIRIST]',            fn: hirist.scrape },
    { name: '[FOUNDIT]',           fn: foundit.scrape },
    { name: '[NAUKRI]',            fn: naukri.scrape },
    { name: 'RemoteOK',           fn: remoteok.scrape },
    { name: 'WeWorkRemotely',     fn: weworkremotely.scrape },
    { name: 'Freshersworld',      fn: freshersworld.scrape },
    { name: 'Remotive',           fn: remotive.scrape },
  ];

  if (useSerpapi) {
    const apiKey = process.env.SERPAPI_KEY;
    if (apiKey) {
      tasks.push({ name: 'SerpAPI (Google Jobs)', fn: () => serpapi.scrape(apiKey) });
    } else {
      console.warn('[Scrapers] USE_SERPAPI=true but SERPAPI_KEY is not set — skipping.');
    }
  }

  console.log(`\n🔍 Running ${tasks.length} scrapers${useSerpapi ? ' (SerpAPI enabled)' : ' (free sources only)'}...\n`);

  const results = await Promise.allSettled(tasks.map(t => t.fn()));

  const allJobs = [];
  for (let i = 0; i < tasks.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      const jobs = result.value || [];
      console.log(`✅ ${tasks[i].name}: ${jobs.length} jobs`);
      allJobs.push(...jobs);
    } else {
      console.error(`❌ ${tasks[i].name} FAILED:`, result.reason?.message || result.reason);
    }
  }

  console.log(`\n📦 Total raw jobs from all scrapers: ${allJobs.length}\n`);
  return allJobs;
}

module.exports = { runAllScrapers };
