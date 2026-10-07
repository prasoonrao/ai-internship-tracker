'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Target keywords for public guest job search
const KEYWORD_QUERIES = [
  { keyword: 'machine learning intern', location: 'India' },
  { keyword: 'artificial intelligence intern', location: 'India' },
  { keyword: 'data science intern', location: 'India' },
  { keyword: 'software engineer intern', location: 'India' },
];

function cleanText(raw) {
  return (raw || '').replace(/\s+/g, ' ').trim();
}

/**
 * Normalize a single LinkedIn job card
 */
function normalizeLinkedInJob(cardData) {
  if (!cardData || !cardData.title || !cardData.url) return null;

  const title = cleanText(cardData.title);
  const company = cleanText(cardData.company || 'Company on LinkedIn');
  const location = cleanText(cardData.location || 'India');
  // Strip tracking parameters from LinkedIn job URL
  const cleanUrl = cardData.url.split('?')[0].split('#')[0];

  const isIntern = title.toLowerCase().includes('intern') ||
                   (cardData.description || '').toLowerCase().includes('intern');

  return {
    title,
    company,
    location,
    salary: '',
    url: cleanUrl,
    description: cleanText(cardData.description || `${title} at ${company}. Location: ${location}`),
    type: isIntern ? 'internship' : 'fulltime',
    postedAt: cardData.postedAt || '',
    source: '[LINKEDIN]',
  };
}

/**
 * Query LinkedIn guest job search endpoint safely.
 * Fail-safe: Returns [] on any error, rate-limiting, or CAPTCHA block.
 */
async function queryGuestJobs(keyword, location) {
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}&start=0`;
  try {
    const res = await axios.get(url, {
      headers: BASE_HEADERS,
      timeout: 12000,
      validateStatus: status => status === 200, // strictly reject 429, 999, etc.
    });

    const $ = cheerio.load(res.data);
    const jobs = [];

    $('li').each((_, el) => {
      const card = $(el);
      const title = cleanText(card.find('.base-search-card__title, h3').text());
      const company = cleanText(card.find('.base-search-card__subtitle, h4').text());
      const loc = cleanText(card.find('.job-search-card__location').text());
      const listDate = card.find('time.job-search-card__listdate').attr('datetime') || cleanText(card.find('time').text());
      const rawLink = card.find('a.base-card__full-link, a').attr('href') || '';

      if (title && rawLink) {
        const norm = normalizeLinkedInJob({
          title,
          company,
          location: loc || location,
          postedAt: listDate,
          url: rawLink,
          description: `${title} at ${company} in ${loc || location}`,
        });
        if (norm) jobs.push(norm);
      }
    });

    return jobs;
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 || status === 999) {
      console.warn(`[LinkedIn] Public guest search rate-limited (${status}) for "${keyword}" — failing safe.`);
    } else {
      console.warn(`[LinkedIn] Guest query notice for "${keyword}": ${err.message}`);
    }
    return [];
  }
}

async function scrape() {
  console.log('[LinkedIn] Querying public guest job search API...');
  try {
    const allJobs = [];
    const seenUrls = new Set();

    for (const q of KEYWORD_QUERIES) {
      const jobs = await queryGuestJobs(q.keyword, q.location);
      for (const j of jobs) {
        if (!seenUrls.has(j.url)) {
          seenUrls.add(j.url);
          allJobs.push(j);
        }
      }
      // Brief polite delay to avoid triggering rate limits
      await new Promise(r => setTimeout(r, 400));
    }

    console.log(`[LinkedIn] Total public job postings extracted: ${allJobs.length}`);
    return allJobs;
  } catch (err) {
    console.error('[LinkedIn] Scraper error (fail-safe activated):', err.message);
    return [];
  }
}

module.exports = {
  scrape,
  normalizeLinkedInJob,
  queryGuestJobs,
};
