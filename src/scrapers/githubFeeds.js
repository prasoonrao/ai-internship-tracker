'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

// Machine-readable JSON feeds maintained by SimplifyJobs & vanshb03
const JSON_FEEDS = [
  {
    name: 'SimplifyJobs/Summer2026-Internships',
    url: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json',
    type: 'internship',
    label: 'Summer 2026 Internships',
  },
  {
    name: 'vanshb03/Summer2026-Internships',
    url: 'https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/dev/.github/scripts/listings.json',
    type: 'internship',
    label: 'Summer 2026 Internships (vanshb03)',
  },
  {
    name: 'vanshb03/Summer2027-Internships',
    url: 'https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json',
    type: 'internship',
    label: 'Summer 2027 Internships (vanshb03)',
  },
];

// Fallback HTML/Markdown sources
const FALLBACK_REPOS = [
  {
    name: 'SimplifyJobs/Summer2026-Internships (README)',
    rawUrl: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md',
    type: 'internship',
  },
  {
    name: 'SimplifyJobs/New-Grad-Positions',
    rawUrl: 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md',
    type: 'fulltime',
  },
];

/**
 * Fetch and parse machine-readable JSON feeds (4000+ structured listings)
 */
async function fetchJsonFeed(feed) {
  try {
    console.log(`[GitHubFeeds] Fetching ${feed.label} JSON feed...`);
    const res = await axios.get(feed.url, {
      headers: {
        'User-Agent': 'ai-internship-tracker/1.0',
        'Accept': 'application/json',
      },
      timeout: 25000,
    });

    const items = Array.isArray(res.data) ? res.data : [];
    console.log(`[GitHubFeeds] ${feed.label}: ${items.length} raw listings`);

    const jobs = [];
    for (const item of items) {
      // Only include active and visible listings
      if (item.active === false || item.is_visible === false) continue;

      const title = item.title || '';
      const company = item.company_name || item.company || '';
      const locations = Array.isArray(item.locations) ? item.locations.join(', ') : (item.locations || 'Global / Remote');
      const url = item.url || item.application_url || '';
      const terms = Array.isArray(item.terms) ? item.terms.join(', ') : (item.terms || '');

      let postedAt = '';
      if (item.date_posted) {
        try {
          postedAt = new Date(item.date_posted * 1000).toISOString().split('T')[0];
        } catch {
          postedAt = '';
        }
      }

      if (title && company) {
        jobs.push({
          title,
          company,
          location: locations,
          url: url || 'https://github.com/SimplifyJobs',
          type: feed.type,
          postedAt,
          salary: terms ? `Terms: ${terms}` : '',
          source: 'GitHub Repos',
          rawCategory: item.category || '',
          sponsorship: item.sponsorship || '',
          description: `${title} | Location: ${locations} | Sponsorship: ${item.sponsorship || 'Unstated'}`,
        });
      }
    }

    return jobs;
  } catch (err) {
    console.warn(`[GitHubFeeds] Error fetching JSON feed for ${feed.name}:`, err.message);
    return [];
  }
}

/**
 * Parse SimplifyJobs HTML table format as fallback
 */
function parseHTMLTable(html, repoType) {
  const $ = cheerio.load(html);
  const jobs = [];

  $('table').each((_, table) => {
    const headers = [];
    $(table).find('thead th').each((_, th) => {
      headers.push($(th).text().trim().toLowerCase());
    });

    if (!headers.some(h => /company|role|position/i.test(h))) return;

    const companyIdx = headers.findIndex(h => /company/i.test(h));
    const roleIdx    = headers.findIndex(h => /role|position|title/i.test(h));
    const locIdx     = headers.findIndex(h => /location/i.test(h));
    const applyIdx   = headers.findIndex(h => /application|apply|link/i.test(h));

    $(table).find('tbody tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 2) return;

      const companyCell = cells.eq(companyIdx >= 0 ? companyIdx : 0);
      const roleCell    = cells.eq(roleIdx    >= 0 ? roleIdx    : 1);
      const locCell     = cells.eq(locIdx     >= 0 ? locIdx     : 2);
      const applyCell   = cells.eq(applyIdx   >= 0 ? applyIdx   : 3);

      const companyRaw = companyCell.text().replace(/🔥|↳|🎓|🛂|🇺🇸/g, '').trim();
      if (companyCell.text().trim().startsWith('↳')) return;

      const company = companyRaw || 'Unknown Company';
      const role    = roleCell.text().replace(/🎓|🛂|🇺🇸/g, '').trim();
      const location = locCell.text().replace(/\n/g, ', ').trim() || 'Global';

      let url = '';
      applyCell.find('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        if (!url && href && !href.includes('simplify.jobs/p/')) {
          url = href;
        }
      });
      if (!url) {
        $(row).find('a[href]').each((_, a) => {
          const href = $(a).attr('href') || '';
          if (!url && href.startsWith('http')) url = href;
        });
      }

      if (companyCell.html()?.includes('🔒') || roleCell.html()?.includes('🔒')) return;

      if (role && company) {
        jobs.push({
          title: role,
          company,
          location,
          url: url || 'https://github.com/SimplifyJobs',
          type: repoType,
          source: 'GitHub Repos',
        });
      }
    });
  });

  return jobs;
}

async function scrape() {
  const allJobs = [];
  const seen = new Set();

  // 1. Ingest structured JSON feeds first (highest fidelity)
  for (const feed of JSON_FEEDS) {
    const jobs = await fetchJsonFeed(feed);
    for (const job of jobs) {
      const key = `${job.title.toLowerCase().trim()}|${job.company.toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        allJobs.push(job);
      }
    }
  }

  // 2. If JSON feeds returned few results (e.g. rate limit/network), fallback to README tables
  if (allJobs.length < 500) {
    console.log('[GitHubFeeds] Fetching fallback README tables...');
    for (const repo of FALLBACK_REPOS) {
      try {
        const res = await axios.get(repo.rawUrl, {
          headers: { 'User-Agent': 'ai-internship-tracker/1.0' },
          timeout: 20000,
        });
        const parsed = parseHTMLTable(res.data, repo.type);
        for (const job of parsed) {
          const key = `${job.title.toLowerCase().trim()}|${job.company.toLowerCase().trim()}`;
          if (!seen.has(key)) {
            seen.add(key);
            allJobs.push(job);
          }
        }
      } catch (err) {
        console.warn(`[GitHubFeeds] Fallback error for ${repo.name}:`, err.message);
      }
    }
  }

  console.log(`[GitHubFeeds] Total unique listings aggregated: ${allJobs.length}`);
  return allJobs;
}

module.exports = { scrape };
