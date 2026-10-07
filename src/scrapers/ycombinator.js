'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const parser = new Parser({ timeout: 15000 });

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const YC_URLS = [
  'https://www.ycombinator.com/jobs',
  'https://www.ycombinator.com/jobs/role/engineering',
];

const HN_JOBS_RSS = 'https://hnrss.org/whoishiring/jobs';

const CS_KEYWORDS = [
  'engineer', 'developer', 'software', 'backend', 'frontend', 'fullstack',
  'full stack', 'data', 'ml', 'machine learning', 'ai', 'devops', 'sre',
  'platform', 'infrastructure', 'security', 'mobile', 'ios', 'android',
  'cloud', 'python', 'javascript', 'typescript', 'golang', 'rust',
  'genai', 'llm', 'deep learning', 'nlp', 'computer vision',
];

function cleanText(raw) {
  return (raw || '').replace(/\s+/g, ' ').trim();
}

/**
 * Normalize an official YC startup listing card
 */
function normalizeYCJob(data) {
  if (!data || !data.title || !data.url) return null;

  const title = cleanText(data.title);
  // Company name: strip batch tags like "(S21)", "(W24)" and bullet subtitles
  const rawCompany = cleanText(data.company || 'YC Startup');
  const company = rawCompany.split(/[•·|\n]/)[0].replace(/\s*\([SW]\d+\)/gi, '').trim();

  const location = cleanText(data.location || 'Remote');
  const salary = cleanText(data.salary || '');
  const url = data.url.startsWith('http') ? data.url : `https://www.ycombinator.com${data.url}`;
  const isIntern = title.toLowerCase().includes('intern') ||
                   (data.tags || '').toLowerCase().includes('internship') ||
                   (data.description || '').toLowerCase().includes('intern');

  return {
    title,
    company,
    location,
    salary,
    url,
    description: cleanText(data.description || `${title} at ${company}. ${location}`),
    type: isIntern ? 'internship' : 'fulltime',
    source: '[YC]',
    postedAt: data.postedAt || '',
  };
}

/**
 * Parse HTML page from ycombinator.com/jobs
 */
function parseYCHtml(html) {
  const $ = cheerio.load(html);
  const jobs = [];

  $('a[href*="/companies/"][href*="/jobs/"]').each((_, el) => {
    const jobLink = $(el);
    const title = cleanText(jobLink.text());
    const href = jobLink.attr('href');

    if (!title || !href || href.endsWith('/jobs') || href.endsWith('/jobs/')) return;

    // Find enclosing card
    const card = jobLink.closest('li, div.flex.flex-col, div.mb-1');
    const compLink = card.find('a[href*="/companies/"]:not([href*="/jobs/"])').first();
    const company = cleanText(compLink.text()) || 'YC Startup';

    const cardText = cleanText(card.text());

    // Extract location & salary from card text
    let location = 'Remote';
    let salary = '';

    // Patterns in YC cards: e.g. "Full-time • Engineering • Machine learning • ₹2M - ₹5M INR • Bengaluru, KA, India"
    const bullets = cardText.split(/[•·|]/).map(cleanText);
    for (const b of bullets) {
      if (b.includes('$') || b.includes('€') || b.includes('£') || b.includes('₹') || b.toLowerCase().includes('inr') || b.toLowerCase().includes('usd')) {
        salary = b;
      } else if (
        b.toLowerCase().includes('remote') ||
        b.toLowerCase().includes('india') ||
        b.toLowerCase().includes('bengaluru') ||
        b.toLowerCase().includes('san francisco') ||
        b.toLowerCase().includes('new york') ||
        b.toLowerCase().includes('london') ||
        b.toLowerCase().includes('hybrid') ||
        b.toLowerCase().includes('ca,') ||
        b.toLowerCase().includes('ny,') ||
        b.toLowerCase().includes('wa,')
      ) {
        location = b;
      }
    }

    const norm = normalizeYCJob({
      title,
      company,
      location,
      salary,
      url: href,
      description: cardText.slice(0, 400),
      tags: cardText,
    });

    if (norm) jobs.push(norm);
  });

  return jobs;
}

/**
 * Scrape HN Who is Hiring RSS as companion YC feed
 */
async function scrapeHNRss() {
  try {
    const result = await parser.parseURL(HN_JOBS_RSS);
    const items = result.items || [];

    return items
      .filter(item => {
        const text = `${item.title || ''} ${item.contentSnippet || ''}`.toLowerCase();
        return CS_KEYWORDS.some(kw => text.includes(kw));
      })
      .map(item => {
        const snippet = item.contentSnippet || item.content || '';
        const firstLine = snippet.split('\n')[0].trim();
        const parts = firstLine.split(/\s*[\|–—]\s*/);
        const company = parts[0]?.trim() || 'YC Startup';
        const role = parts[1]?.trim() || firstLine || 'Software Engineer';

        const content = snippet.toLowerCase();
        const isRemote = content.includes('remote') || content.includes('wfh');
        const isIntern = content.includes('intern') || role.toLowerCase().includes('intern');

        return {
          title: role,
          company,
          location: isRemote ? 'Remote' : 'Global / On-site',
          url: item.link || item.guid || 'https://news.ycombinator.com/jobs',
          postedAt: item.pubDate ? new Date(item.pubDate).toLocaleDateString('en-IN') : '',
          description: snippet.slice(0, 300),
          type: isIntern ? 'internship' : 'fulltime',
          source: '[YC]',
        };
      });
  } catch (err) {
    console.warn('[YC] HN RSS fetch notice:', err.message);
    return [];
  }
}

async function scrape() {
  console.log('[YC] Fetching Y Combinator startup jobs...');
  try {
    const scrapedJobs = [];
    const seenUrls = new Set();

    // 1. Fetch official YC job directory pages
    for (const pageUrl of YC_URLS) {
      try {
        const res = await axios.get(pageUrl, {
          headers: BASE_HEADERS,
          timeout: 15000,
        });
        const pageJobs = parseYCHtml(res.data);
        for (const j of pageJobs) {
          if (!seenUrls.has(j.url)) {
            seenUrls.add(j.url);
            scrapedJobs.push(j);
          }
        }
      } catch (err) {
        console.warn(`[YC] Page fetch notice for ${pageUrl}:`, err.message);
      }
    }

    // 2. Fetch HN Who is Hiring feed
    const hnJobs = await scrapeHNRss();
    for (const j of hnJobs) {
      if (!seenUrls.has(j.url)) {
        seenUrls.add(j.url);
        scrapedJobs.push(j);
      }
    }

    console.log(`[YC] Total startup jobs: ${scrapedJobs.length}`);
    return scrapedJobs;
  } catch (err) {
    console.error('[YC] Error:', err.message);
    return [];
  }
}

module.exports = {
  scrape,
  normalizeYCJob,
  parseYCHtml,
};
