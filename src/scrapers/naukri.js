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
 * Normalize a Naukri job item into the standard Job object
 */
function normalizeNaukriJob(item) {
  if (!item || !item.title || (!item.url && !item.link && !item.jobId)) {
    return null;
  }

  const title = (item.title || '').trim();
  const company = (item.company || item.companyName || 'Company on Naukri').trim();

  let rawUrl = item.url || item.link || '';
  if (!rawUrl && item.jobId) {
    rawUrl = `https://www.naukri.com/job-listings-${item.jobId}`;
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
  const salary = (item.salary || item.salaryPlaceholder || '').trim();

  // Skills
  const skills = Array.isArray(item.skills)
    ? item.skills.filter(Boolean)
    : (Array.isArray(item.tagsAndSkills)
      ? item.tagsAndSkills.filter(Boolean)
      : (typeof item.tagsAndSkills === 'string' && item.tagsAndSkills
        ? item.tagsAndSkills.split(',').map(s => s.trim()).filter(Boolean)
        : (typeof item.skills === 'string' && item.skills ? item.skills.split(',').map(s => s.trim()).filter(Boolean) : [])));

  // Experience
  const experience = (item.experience || item.experienceText || item.exp || '').trim();

  // Posted date
  const postedAt = (item.postedAt || item.createdDate || item.footerPlaceholderLabel || '').trim();

  return {
    title,
    company,
    location,
    remote: isRemote,
    url,
    description,
    type,
    source: '[NAUKRI]',
    postedAt,
    salary,
    skills,
    experience,
  };
}

/**
 * Attempt to scrape Naukri via public endpoints.
 * In accordance with anti-bot policies: if Akamai anti-bot protection blocks automated requests
 * (HTTP 406 / challenge), fail-safe activates immediately, returns [], and reports the source as unavailable.
 */
async function scrape(options = {}) {
  console.log('[Naukri] Checking public job discovery on Naukri...');
  const searchUrl = 'https://www.naukri.com/jobapi/v3/search?noOfResults=20&urlType=search_by_keyword&searchType=adv&keyword=machine%20learning%20intern&location=India';

  try {
    const res = await axios.get(searchUrl, {
      headers: {
        ...BASE_HEADERS,
        'appid': '109',
        'systemid': '109',
      },
      timeout: 10000,
      validateStatus: status => status === 200,
    });

    const list = res.data?.jobDetails || [];
    if (!Array.isArray(list) || list.length === 0) {
      console.log('[Naukri] No public listings returned — fail-safe returned 0 jobs.');
      return [];
    }

    const jobs = list
      .map(normalizeNaukriJob)
      .filter(Boolean);

    console.log(`[Naukri] Discovered ${jobs.length} jobs.`);
    return jobs;
  } catch (err) {
    const status = err.response?.status;
    if (status === 406 || status === 403 || status === 401) {
      console.warn(`[Naukri] Automated search access restricted by anti-bot protection (HTTP ${status}) — fail-safe activated (returning 0 jobs).`);
    } else {
      console.warn(`[Naukri] Public endpoint unavailable (${err.message}) — fail-safe activated (returning 0 jobs).`);
    }
    return [];
  }
}

module.exports = {
  scrape,
  normalizeNaukriJob,
  cleanUrl,
};
