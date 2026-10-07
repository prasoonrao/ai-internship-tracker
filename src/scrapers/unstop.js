'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Target keywords for high-relevance internship extraction on Unstop
const SEARCH_QUERIES = [
  'machine learning',
  'artificial intelligence',
  'data science',
  'software engineer',
  'python',
];

/**
 * Clean HTML description into plain text
 */
function cleanDescription(html) {
  if (!html) return '';
  try {
    const $ = cheerio.load(html);
    return $.text().replace(/\s+/g, ' ').trim().slice(0, 500);
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  }
}

/**
 * Normalize an Unstop raw item into the standard Job object
 */
function normalizeUnstopJob(item) {
  if (!item || !item.title) return null;

  const title = (item.title || '').trim();
  const company = (item.organisation?.name || 'Company on Unstop').trim();

  // Location & Remote resolution
  let location = 'India';
  const isOnline = item.region === 'online' || item.jobDetail?.type === 'wfh';

  if (item.locations && Array.isArray(item.locations) && item.locations.length > 0) {
    location = item.locations.map(l => (typeof l === 'string' ? l : l.city || l.name)).filter(Boolean).join(', ');
  } else if (item.jobDetail?.locations && Array.isArray(item.jobDetail.locations) && item.jobDetail.locations.length > 0) {
    location = item.jobDetail.locations.map(l => (typeof l === 'string' ? l : l.city || l.name)).filter(Boolean).join(', ');
  }

  if (isOnline) {
    location = location && location !== 'India' ? `${location} (Work from home)` : 'Remote / Work From Home (India)';
  } else if (!location) {
    location = 'India';
  }

  // URL resolution
  let url = 'https://unstop.com/internships';
  if (item.public_url) {
    url = item.public_url.startsWith('http') ? item.public_url : `https://unstop.com/${item.public_url}`;
  } else if (item.seo_url) {
    url = item.seo_url.startsWith('http') ? item.seo_url : `https://unstop.com/${item.seo_url}`;
  }

  // Stipend / Salary
  let salary = '';
  if (item.jobDetail?.min_salary != null) {
    const minSal = item.jobDetail.min_salary;
    const maxSal = item.jobDetail.max_salary;
    const payIn = item.jobDetail.pay_in || 'month';
    salary = maxSal ? `₹${minSal} - ₹${maxSal} / ${payIn}` : `₹${minSal} / ${payIn}`;
  } else if (item.jobDetail?.paid_unpaid === 'unpaid') {
    salary = 'Unpaid / Certificate';
  } else if (item.isPaid) {
    salary = 'Paid Internship';
  }

  // Skills
  const skills = Array.isArray(item.required_skills)
    ? item.required_skills.map(s => s.skill || s.skill_name).filter(Boolean)
    : [];

  // Description
  const rawDesc = cleanDescription(item.details);
  const skillText = skills.length > 0 ? ` Required skills: ${skills.join(', ')}.` : '';
  const desc = (rawDesc + skillText).slice(0, 500);

  // Experience requirement
  let experience = 'Fresher / College Students';
  if (item.jobDetail?.min_experience != null) {
    experience = `${item.jobDetail.min_experience}–${item.jobDetail.max_experience || item.jobDetail.min_experience} years`;
  }

  // Posted date
  const postedAt = item.updated_at
    ? new Date(item.updated_at).toLocaleDateString('en-IN')
    : item.approved_date
      ? new Date(item.approved_date).toLocaleDateString('en-IN')
      : '';

  return {
    title,
    company,
    location,
    salary,
    url,
    description: desc,
    skills,
    experience,
    postedAt,
    type: 'internship',
    source: '[UNSTOP]',
  };
}

async function scrapeQuery(searchTerm = '') {
  try {
    const url = searchTerm
      ? `https://unstop.com/api/public/opportunity/search-result?opportunity=internships&searchTerm=${encodeURIComponent(searchTerm)}&per_page=30&page=1`
      : 'https://unstop.com/api/public/opportunity/search-result?opportunity=internships&per_page=40&page=1';

    const res = await axios.get(url, {
      headers: BASE_HEADERS,
      timeout: 15000,
    });

    const items = res.data?.data?.data || res.data?.data || [];
    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.warn(`[Unstop] Query failed for "${searchTerm || 'general'}":`, err.message);
    return [];
  }
}

async function scrape() {
  console.log('[Unstop] Fetching internship listings from Unstop API...');
  try {
    // Run targeted queries concurrently
    const queries = ['', ...SEARCH_QUERIES];
    const results = await Promise.allSettled(queries.map(q => scrapeQuery(q)));

    const rawListings = [];
    const seenIds = new Set();

    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const item of r.value) {
          if (item && item.id && !seenIds.has(item.id)) {
            seenIds.add(item.id);
            rawListings.push(item);
          }
        }
      }
    }

    const normalizedJobs = rawListings
      .map(normalizeUnstopJob)
      .filter(Boolean);

    console.log(`[Unstop] Total unique internships: ${normalizedJobs.length}`);
    return normalizedJobs;
  } catch (err) {
    console.error('[Unstop] Error:', err.message);
    return [];
  }
}

module.exports = {
  scrape,
  normalizeUnstopJob,
};
