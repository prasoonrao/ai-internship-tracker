'use strict';

const axios = require('axios');

const HEADERS = {
  'User-Agent': 'ai-internship-tracker/1.0 (India student career aggregator)',
  'Accept': 'application/json',
};

const INDIA_HINTS = [
  'india', 'bangalore', 'bengaluru', 'hyderabad', 'noida', 'pune',
  'mumbai', 'delhi', 'gurugram', 'gurgaon', 'chennai', 'kolkata', 'remote',
];

function looksIndia(text) {
  const t = (text || '').toLowerCase();
  return INDIA_HINTS.some(h => t.includes(h));
}

function looksIntern(title) {
  const t = (title || '').toLowerCase();
  return t.includes('intern') || t.includes('trainee') || t.includes('apprentice') || t.includes('student');
}

/**
 * Amazon Jobs India student programs API
 */
async function fetchAmazonIndia() {
  const jobs = [];
  try {
    const url = 'https://www.amazon.jobs/en/search.json?normalized_country_code[]=IND&business_category[]=studentprograms&offset=0&result_limit=100&sort=recent';
    const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const listings = res.data?.jobs || [];

    for (const j of listings) {
      const title = j.title || '';
      const location = j.city || j.location || 'India';
      const path = j.job_path || '';
      const postedAt = j.posted_date ? j.posted_date.slice(0, 10) : '';

      jobs.push({
        title,
        company: 'Amazon',
        location,
        url: path ? `https://www.amazon.jobs${path}` : 'https://www.amazon.jobs',
        type: 'internship',
        postedAt,
        source: 'IndiaDirect',
      });
    }
  } catch (err) {
    console.warn('[IndiaDirect] Amazon fetch notice:', err.message);
  }
  return jobs;
}

/**
 * Adobe Workday CXS API for internships
 */
async function fetchAdobeIndia() {
  const jobs = [];
  try {
    const url = 'https://adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/external_experienced/jobs';
    const res = await axios.post(
      url,
      { appliedFacets: {}, limit: 20, offset: 0, searchText: 'intern' },
      { headers: { ...HEADERS, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    const postings = res.data?.jobPostings || [];

    for (const j of postings) {
      const title = j.title || '';
      const loc = j.locationsText || '';
      if (!looksIntern(title) || !looksIndia(loc)) continue;

      jobs.push({
        title,
        company: 'Adobe',
        location: loc || 'India',
        url: j.externalPath ? `https://adobe.wd5.myworkdayjobs.com/en-US/external_experienced${j.externalPath}` : 'https://adobe.wd5.myworkdayjobs.com',
        type: 'internship',
        source: 'IndiaDirect',
      });
    }
  } catch (err) {
    console.warn('[IndiaDirect] Adobe fetch notice:', err.message);
  }
  return jobs;
}

/**
 * Razorpay Workable API
 */
async function fetchRazorpayIndia() {
  const jobs = [];
  try {
    const url = 'https://apply.workable.com/api/v3/accounts/razorpay/jobs';
    const res = await axios.post(
      url,
      { query: '', location: [] },
      { headers: { ...HEADERS, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    const results = res.data?.results || [];

    for (const j of results) {
      const title = j.title || '';
      if (!looksIntern(title)) continue;

      const locObj = j.location;
      const locStr = (typeof locObj === 'object' && locObj ? locObj.city : locObj) || 'Bangalore, India';

      jobs.push({
        title,
        company: 'Razorpay',
        location: locStr,
        url: j.url || 'https://apply.workable.com/razorpay/',
        type: 'internship',
        source: 'IndiaDirect',
      });
    }
  } catch (err) {
    console.warn('[IndiaDirect] Razorpay fetch notice:', err.message);
  }
  return jobs;
}

async function scrape() {
  console.log('[IndiaDirect] Querying direct employer career APIs (Amazon, Adobe, Razorpay)...');
  const results = await Promise.allSettled([
    fetchAmazonIndia(),
    fetchAdobeIndia(),
    fetchRazorpayIndia(),
  ]);

  const allJobs = [];
  results.forEach(r => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      allJobs.push(...r.value);
    }
  });

  console.log(`[IndiaDirect] Total direct company listings: ${allJobs.length}`);
  return allJobs;
}

module.exports = { scrape };
