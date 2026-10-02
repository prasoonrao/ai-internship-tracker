'use strict';

const Parser = require('rss-parser');
const parser = new Parser({ timeout: 15000 });

const FEEDS = [
  {
    url: 'https://weworkremotely.com/categories/remote-programming-jobs.rss',
    label: 'Programming',
  },
  {
    url: 'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
    label: 'DevOps',
  },
  {
    url: 'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss',
    label: 'Backend',
  },
  {
    url: 'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss',
    label: 'Frontend',
  },
];

function extractCompany(item) {
  // WWR includes company in the title like "Company: Role"
  const title = item.title || '';
  if (title.includes(': ')) {
    const [company, ...rest] = title.split(': ');
    return { company: company.trim(), cleanTitle: rest.join(': ').trim() };
  }
  return { company: item.creator || 'Unknown', cleanTitle: title };
}

async function scrape() {
  const allJobs = [];
  const seen = new Set();

  for (const feed of FEEDS) {
    try {
      console.log(`[WeWorkRemotely] Fetching ${feed.label} feed...`);
      const result = await parser.parseURL(feed.url);

      for (const item of (result.items || [])) {
        const { company, cleanTitle } = extractCompany(item);
        const key = `${cleanTitle}|${company}`;
        if (seen.has(key)) continue;
        seen.add(key);

        allJobs.push({
          title: cleanTitle || item.title || '',
          company,
          location: 'Remote',
          url: item.link || item.guid || '',
          postedAt: item.pubDate ? new Date(item.pubDate).toLocaleDateString('en-IN') : '',
          description: item.contentSnippet ? item.contentSnippet.slice(0, 300) : '',
          type: (cleanTitle || '').toLowerCase().includes('intern') ? 'internship' : 'fulltime',
          source: 'WeWorkRemotely',
        });
      }

      console.log(`[WeWorkRemotely] ${feed.label}: ${result.items?.length || 0} listings`);
    } catch (err) {
      console.error(`[WeWorkRemotely] Error on ${feed.label}:`, err.message);
    }
  }

  console.log(`[WeWorkRemotely] Total: ${allJobs.length} jobs`);
  return allJobs;
}

module.exports = { scrape };
