'use strict';

const { getJson } = require('serpapi');

// FIX Issue 2: Replaced broken Naukri scraper with 2 site-specific SerpAPI
// queries. Also replaced erroring 'Worldwide' location queries (gave undefined
// errors) with better-targeted queries.
//
// Budget: 8 queries × 1 morning run/day × 30 days = 240 searches/month.
// Free tier: 250/month → 10 buffer remaining.
// Note: Evening run has USE_SERPAPI=false, so no credits used then.
const QUERIES = [
  // ── India: Internships ──────────────────────────────────────────────────
  {
    q: 'software engineer intern India 2025 2026',
    location: 'India',
    type: 'internship',
  },
  {
    q: 'SDE internship fresher computer science India apply',
    location: 'India',
    type: 'internship',
  },

  // ── India: Full-Time Fresher ─────────────────────────────────────────────
  {
    q: 'software developer fresher 0-1 year experience India hiring',
    location: 'India',
    type: 'fulltime',
  },
  {
    q: 'backend frontend full stack developer fresher entry level India',
    location: 'India',
    type: 'fulltime',
  },

  // ── India: Specialist roles ─────────────────────────────────────────────
  {
    q: 'data engineer ML AI machine learning intern fresher India',
    location: 'India',
    type: 'internship',
  },

  // ── Naukri-specific (replaces dead naukri.js scraper) ───────────────────
  {
    q: 'site:naukri.com software engineer fresher 0-1 years India',
    location: 'India',
    type: 'fulltime',
  },

  // ── Campus / New Grad ────────────────────────────────────────────────────
  {
    q: 'campus hiring new grad software engineer 2025 2026 India',
    location: 'India',
    type: 'fulltime',
  },

  // ── Global Remote ────────────────────────────────────────────────────────
  {
    q: 'remote software engineer internship new grad 2025 2026',
    location: 'United States', // Explicit country avoids the 'Worldwide' error
    type: 'internship',
  },
];

async function scrape(apiKey) {
  const jobs = [];
  console.log(`[SerpAPI] Running ${QUERIES.length} queries (budget: ${QUERIES.length}/day × 30 = ${QUERIES.length * 30}/month)...`);

  for (const query of QUERIES) {
    try {
      console.log(`[SerpAPI]  → "${query.q}"`);
      const results = await getJson({
        engine: 'google_jobs',
        q: query.q,
        location: query.location,
        hl: 'en',
        api_key: apiKey,
        num: 10,
      });

      const listings = results.jobs_results || [];
      console.log(`[SerpAPI]    Found ${listings.length} results`);

      for (const item of listings) {
        jobs.push({
          title: item.title || '',
          company: item.company_name || '',
          location: item.location || query.location,
          description: item.description ? item.description.slice(0, 300) : '',
          url: item.apply_options?.[0]?.link || item.share_link || '',
          postedAt: item.detected_extensions?.posted_at || '',
          salary: item.detected_extensions?.salary || '',
          type: query.type,
          source: 'Google Jobs',
        });
      }

      // Polite delay between SerpAPI calls
      await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      console.error(`[SerpAPI] Error for query "${query.q}":`, err.message);
    }
  }

  console.log(`[SerpAPI] Total fetched: ${jobs.length} jobs`);
  return jobs;
}

module.exports = { scrape };
