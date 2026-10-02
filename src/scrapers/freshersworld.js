'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const SEARCH_URLS = [
  'https://www.freshersworld.com/jobs/jobsearch/IT-Software-jobs-for-freshers',
  'https://www.freshersworld.com/jobs/jobsearch/Software-Engineering-jobs-for-freshers',
  'https://www.freshersworld.com/jobs/jobsearch/Computer-Science-jobs-for-freshers',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.freshersworld.com/',
};

/**
 * Strip "Less More\nLess" UI artifacts injected by Freshersworld's
 * show-more toggle button into the scraped text content.
 */
function cleanTitle(raw) {
  return (raw || '')
    .replace(/Less\s+More[\s\S]*?Less/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function scrape() {
  const allJobs = [];
  const seen = new Set();

  for (const url of SEARCH_URLS) {
    try {
      console.log(`[Freshersworld] Fetching ${url}`);
      const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
      const $ = cheerio.load(res.data);
      let count = 0;

      // Try multiple possible selectors for job cards
      const selectors = ['.job-container', '.jobs-list li', '.job_container', 'article', '.job-box'];
      for (const sel of selectors) {
        const cards = $(sel);
        if (cards.length === 0) continue;

        cards.each((_, el) => {
          const card = $(el);
          const title = cleanTitle(card.find('h3, h2, .job-title, [class*="title"]').first().text());
          const company = card.find('.company, [class*="company"], .org-name').first().text().trim();
          const location = card.find('.location, [class*="location"], .city').first().text().trim() || 'India';
          const linkEl = card.find('a[href*="/jobs/"], a[href*="/job/"]').first();
          let href = linkEl.attr('href') || card.find('a').first().attr('href') || '';
          if (href && !href.startsWith('http')) href = 'https://www.freshersworld.com' + href;

          if (title && href) {
            const key = `${title}|${company}`;
            if (!seen.has(key)) {
              seen.add(key);
              allJobs.push({
                title,
                company: company || 'Company on Freshersworld',
                location,
                url: href,
                type: title.toLowerCase().includes('intern') ? 'internship' : 'fulltime',
                source: 'Freshersworld',
              });
              count++;
            }
          }
        });

        if (count > 0) break; // found listings with this selector
      }

      console.log(`[Freshersworld]   Found ${count} jobs`);
      await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
      console.error(`[Freshersworld] Error:`, err.message);
    }
  }

  console.log(`[Freshersworld] Total: ${allJobs.length} jobs`);
  return allJobs;
}

module.exports = { scrape };
