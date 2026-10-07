'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Clean URL by stripping tracking parameters
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
 * Normalize a Hirist job item into the standard Job object
 */
function normalizeHiristJob(item) {
  if (!item || !item.title || (!item.url && !item.link && !item.id)) {
    return null;
  }

  const title = (item.title || '').trim();
  const company = (item.company || item.companyName || item.recruiterName || 'Tech Startup on Hirist').trim();

  let rawUrl = item.url || item.link || '';
  if (!rawUrl && item.id) {
    rawUrl = `https://www.hirist.tech/j/${item.id}`;
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
  let description = (item.description || item.jobDescription || `${title} at ${company}. Location: ${location}.`).trim();
  description = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Salary
  const salary = (item.salary || item.ctc || item.salaryText || '').trim();

  // Skills
  const skills = Array.isArray(item.skills)
    ? item.skills.filter(Boolean)
    : (Array.isArray(item.keySkills)
      ? item.keySkills.filter(Boolean)
      : (typeof item.skills === 'string' && item.skills ? item.skills.split(',').map(s => s.trim()).filter(Boolean) : []));

  // Experience
  const experience = (item.experience || item.exp || '').trim();

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
    source: '[HIRIST]',
    postedAt,
    salary,
    skills,
    experience,
  };
}

/**
 * Attempt to scrape Hirist via public endpoints.
 * In accordance with anti-bot policies: if automated API access requires auth (HTTP 401)
 * or web pages lack public SSR listings, fail-safe activates immediately and returns [].
 */
async function scrape(options = {}) {
  console.log('[Hirist] Checking public job discovery on Hirist...');
  const searchUrl = 'https://api.hirist.tech/job/getCategoryJobs?category=1&page=1';

  try {
    const res = await axios.get(searchUrl, {
      headers: BASE_HEADERS,
      timeout: 10000,
      validateStatus: status => status === 200,
    });

    const list = res.data?.data?.jobs || res.data?.jobs;
    if (!Array.isArray(list) || list.length === 0) {
      console.log('[Hirist] No public job listings found — fail-safe returned 0 jobs.');
      return [];
    }

    const jobs = list
      .map(normalizeHiristJob)
      .filter(Boolean);

    console.log(`[Hirist] Discovered ${jobs.length} jobs.`);
    return jobs;
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      console.warn(`[Hirist] Automated API access restricted (HTTP ${status} Authentication Required) — fail-safe activated (returning 0 jobs).`);
    } else {
      console.warn(`[Hirist] Public endpoint unavailable (${err.message}) — fail-safe activated (returning 0 jobs).`);
    }
    return [];
  }
}

module.exports = {
  scrape,
  normalizeHiristJob,
  cleanUrl,
};
