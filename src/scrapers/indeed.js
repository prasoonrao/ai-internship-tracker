'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Clean URL by stripping tracking and redirect parameters
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
 * Normalize an Indeed job item into the standard Job object
 */
function normalizeIndeedJob(item) {
  if (!item || !item.title || (!item.url && !item.link)) {
    return null;
  }

  const title = (item.title || '').trim();
  const company = (item.company || item.companyName || 'Company on Indeed').trim();
  const rawUrl = item.url || item.link || '';
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
                   /\binternship\b/i.test(item.description || '');
  const type = isIntern ? 'internship' : (item.type || 'fulltime');

  // Description
  let description = (item.description || item.snippet || `${title} at ${company}. Location: ${location}.`).trim();
  description = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Salary
  const salary = (item.salary || item.estimatedSalary || '').trim();

  // Skills
  const skills = Array.isArray(item.skills)
    ? item.skills.filter(Boolean)
    : (typeof item.skills === 'string' && item.skills ? item.skills.split(',').map(s => s.trim()).filter(Boolean) : []);

  // Experience
  const experience = (item.experience || '').trim();

  // Posted date
  const postedAt = (item.postedAt || item.date || '').trim();

  return {
    title,
    company,
    location,
    remote: isRemote,
    url,
    description,
    type,
    source: '[INDEED]',
    postedAt,
    salary,
    skills,
    experience,
  };
}

/**
 * Attempt to scrape Indeed via public endpoints.
 * In accordance with anti-bot policies: if Cloudflare blocks or challenges automated requests,
 * fail-safe activates immediately, returns [], and reports the source as unavailable without bypasses.
 */
async function scrape(options = {}) {
  console.log('[Indeed] Checking public job discovery on Indeed...');
  const targetUrl = 'https://in.indeed.com/jobs?q=machine+learning+intern&l=India';

  try {
    const res = await axios.get(targetUrl, {
      headers: BASE_HEADERS,
      timeout: 10000,
      validateStatus: status => status === 200,
    });

    const $ = cheerio.load(res.data);
    const cards = $('.job_seen_beacon, [data-jk]');
    if (cards.length === 0) {
      console.log('[Indeed] No public listings in SSR HTML — fail-safe returned 0 jobs.');
      return [];
    }

    const jobs = [];
    cards.each((_, el) => {
      const title = $(el).find('h2.jobTitle, a[data-jk] span').text().trim();
      const company = $(el).find('[data-testid="company-name"], .companyName').text().trim();
      const location = $(el).find('[data-testid="text-location"], .companyLocation').text().trim();
      const jk = $(el).attr('data-jk') || $(el).find('a[data-jk]').attr('data-jk');
      const url = jk ? `https://in.indeed.com/viewjob?jk=${jk}` : '';

      const normalized = normalizeIndeedJob({ title, company, location, url });
      if (normalized) jobs.push(normalized);
    });

    console.log(`[Indeed] Discovered ${jobs.length} jobs.`);
    return jobs;
  } catch (err) {
    const status = err.response?.status;
    if (status === 403 || status === 401 || status === 429) {
      console.warn(`[Indeed] Automated access restricted by anti-bot protection (HTTP ${status}) — fail-safe activated (returning 0 jobs).`);
    } else {
      console.warn(`[Indeed] Public endpoint unavailable (${err.message}) — fail-safe activated (returning 0 jobs).`);
    }
    return [];
  }
}

module.exports = {
  scrape,
  normalizeIndeedJob,
  cleanUrl,
};
