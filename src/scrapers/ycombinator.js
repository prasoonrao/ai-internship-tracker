'use strict';

const Parser = require('rss-parser');
const parser = new Parser({ timeout: 15000 });

// FIX: news.ycombinator.com/jobs.rss returns 404.
// hnrss.org is a community-maintained stable RSS service for HN.
// /whoishiring/jobs fetches top-level job posts from the monthly
// "Ask HN: Who is hiring?" threads — verified live May 2026.
const HN_JOBS_RSS = 'https://hnrss.org/whoishiring/jobs';

const CS_KEYWORDS = [
  'engineer', 'developer', 'software', 'backend', 'frontend', 'fullstack',
  'full stack', 'data', 'ml', 'machine learning', 'ai', 'devops', 'sre',
  'platform', 'infrastructure', 'security', 'mobile', 'ios', 'android',
  'cloud', 'python', 'javascript', 'typescript', 'golang', 'rust',
];

function extractDetails(item) {
  const content = (item.contentSnippet || item.content || '').toLowerCase();
  const title = (item.title || '').toLowerCase();
  const isRemote = content.includes('remote') || title.includes('remote')
    || content.includes('work from home') || content.includes('wfh');
  const isIntern = content.includes('intern') || title.includes('intern');
  return { isRemote, isIntern };
}

/**
 * Parse company name and role from hnrss.org item.
 * hnrss format: 'New comment by user in "Ask HN: Who is hiring? (May 2026)"'
 * The actual job text is in contentSnippet.
 * We extract company from first line of description (format: "Company | Role | Location").
 */
function parseHNPost(item) {
  const snippet = item.contentSnippet || item.content || '';
  // Most HN job posts start with "Company | Role | Location | ..."
  const firstLine = snippet.split('\n')[0].trim();
  const parts = firstLine.split(/\s*[\|–—]\s*/);

  const company = parts[0]?.trim() || 'HN Company';
  const role = parts[1]?.trim() || firstLine || 'Engineering Role';

  return { company, role };
}

async function scrape() {
  console.log('[YCombinator] Fetching HN Who is Hiring RSS (hnrss.org)...');
  try {
    const result = await parser.parseURL(HN_JOBS_RSS);
    const items = result.items || [];
    console.log(`[YCombinator] Raw items: ${items.length}`);

    const jobs = items
      .filter(item => {
        const text = `${item.title || ''} ${item.contentSnippet || ''}`.toLowerCase();
        return CS_KEYWORDS.some(kw => text.includes(kw));
      })
      .map(item => {
        const { isRemote, isIntern } = extractDetails(item);
        const { company, role } = parseHNPost(item);

        return {
          title: role,
          company,
          location: isRemote ? 'Remote' : 'Global / On-site',
          url: item.link || item.guid || 'https://news.ycombinator.com/jobs',
          postedAt: item.pubDate ? new Date(item.pubDate).toLocaleDateString('en-IN') : '',
          description: item.contentSnippet ? item.contentSnippet.slice(0, 300) : '',
          type: isIntern ? 'internship' : 'fulltime',
          source: 'YCombinator',
        };
      });

    console.log(`[YCombinator] CS-relevant jobs: ${jobs.length}`);
    return jobs;
  } catch (err) {
    console.error('[YCombinator] Error:', err.message);
    return [];
  }
}

module.exports = { scrape };

