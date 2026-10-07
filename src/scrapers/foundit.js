'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Clean URL by stripping tracking and search parameters
 */
function cleanUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    return u.origin + u.pathname;
  } catch {
    return rawUrl.split('?')[0].split('#')[0];
  }
}

/**
 * Normalize a Foundit job item into the standard Job object
 */
function normalizeFounditJob(item) {
  if (!item || !item.title || (!item.url && !item.link && !item.id)) {
    return null;
  }

  const title = (item.title || '').trim();
  const company = (item.company || item.companyName || 'Company on Foundit').trim();

  let rawUrl = item.url || item.link || '';
  if (!rawUrl && item.id) {
    rawUrl = `https://www.foundit.in/job/${item.id}`;
  }
  const url = cleanUrl(rawUrl);

  // Location & Remote resolution
  let location = (item.location || '').trim();
  const isRemote = Boolean(
    item.remote ||
    item.isRemote ||
    /\bremote\b/i.test(location) ||
    /\bwork\s+from\s+home\b/i.test(location) ||
    /\bwfh\b/i.test(location)
  );

  if (!location) {
    location = isRemote ? 'Remote (India)' : 'India';
  }

  // Type: internship vs fulltime
  const isIntern = /\b(?:intern|internship|trainee|co-?op)\b/i.test(title) ||
                   /\b(?:intern|internship|trainee)\b/i.test(item.type || '') ||
                   /\binternship\b/i.test(item.description || item.jobDescription || '');
  const type = isIntern ? 'internship' : (item.type || 'fulltime');

  // Description
  let description = (item.description || item.jobDescription || item.snippet || `${title} at ${company}. Location: ${location}.`).trim();
  description = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Salary
  const salary = (item.salary || item.salaryText || '').trim();

  // Skills
  const skills = Array.isArray(item.skills)
    ? item.skills.filter(Boolean)
    : (Array.isArray(item.skillSets)
      ? item.skillSets.filter(Boolean)
      : (typeof item.skills === 'string' && item.skills ? item.skills.split(',').map(s => s.trim()).filter(Boolean) : []));

  // Experience
  const experience = (item.experience || item.experienceText || '').trim();

  // Posted date
  const postedAt = (item.postedAt || item.date || item.postedOn || '').trim();

  return {
    title,
    company,
    location,
    remote: isRemote,
    url,
    description,
    type,
    source: '[FOUNDIT]',
    postedAt,
    salary,
    skills,
    experience,
  };
}

/**
 * Attempt to scrape Foundit via public search.
 * In accordance with anti-bot policies: if the search result is an SPA client-side shell
 * with no server-rendered listings or an automated block occurs, fail-safe activates immediately
 * and returns [] without attempting unauthorized bypasses.
 */
async function scrape(options = {}) {
  console.log('[Foundit] Checking public job discovery on Foundit...');
  const searchUrl = 'https://www.foundit.in/srp/results?query=machine%20learning%20intern&locations=India';

  try {
    const res = await axios.get(searchUrl, {
      headers: BASE_HEADERS,
      timeout: 10000,
      validateStatus: status => status === 200,
    });

    const $ = cheerio.load(res.data);
    const cards = $('.srpResultCard, [data-job-id], .cardContainer');
    if (cards.length === 0) {
      console.log('[Foundit] Client-rendered SPA shell detected without public SSR listings — fail-safe activated (returning 0 jobs).');
      return [];
    }

    const jobs = [];
    cards.each((_, el) => {
      const title = $(el).find('.jobTitle, h3').text().trim();
      const company = $(el).find('.companyName').text().trim();
      const location = $(el).find('.location').text().trim();
      const href = $(el).find('a').attr('href');
      const url = href ? (href.startsWith('http') ? href : `https://www.foundit.in${href}`) : '';

      const normalized = normalizeFounditJob({ title, company, location, url });
      if (normalized) jobs.push(normalized);
    });

    console.log(`[Foundit] Discovered ${jobs.length} jobs.`);
    return jobs;
  } catch (err) {
    const status = err.response?.status;
    if (status === 403 || status === 401 || status === 429) {
      console.warn(`[Foundit] Automated access restricted by anti-bot protection (HTTP ${status}) — fail-safe activated (returning 0 jobs).`);
    } else {
      console.warn(`[Foundit] Public endpoint unavailable (${err.message}) — fail-safe activated (returning 0 jobs).`);
    }
    return [];
  }
}

module.exports = {
  scrape,
  normalizeFounditJob,
  cleanUrl,
};
