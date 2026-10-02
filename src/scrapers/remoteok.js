'use strict';

const axios = require('axios');

const CS_TAGS = [
  'dev', 'software', 'backend', 'frontend', 'fullstack', 'full-stack',
  'javascript', 'python', 'golang', 'rust', 'typescript', 'react', 'node',
  'data', 'ml', 'ai', 'devops', 'cloud', 'infrastructure', 'platform',
  'engineer', 'developer', 'programmer', 'sre', 'security', 'mobile',
  'ios', 'android', 'api', 'database', 'architect',
];

function hasCSTag(job) {
  const tags = (job.tags || []).map(t => t.toLowerCase());
  const title = (job.position || '').toLowerCase();
  return CS_TAGS.some(ct => tags.some(t => t.includes(ct)) || title.includes(ct));
}

async function scrape() {
  console.log('[RemoteOK] Fetching public API...');
  try {
    const res = await axios.get('https://remoteok.com/api', {
      headers: {
        'User-Agent': 'job-alert-bot/1.0 (github.com/personal-bot)',
        'Accept': 'application/json',
      },
      timeout: 15000,
    });

    // First item is metadata, skip it
    const listings = Array.isArray(res.data) ? res.data.slice(1) : [];
    console.log(`[RemoteOK] Raw listings: ${listings.length}`);

    const jobs = listings
      .filter(item => item && item.position && hasCSTag(item))
      .map(item => ({
        title: item.position || '',
        company: item.company || '',
        location: item.location || 'Remote',
        salary: item.salary || (item.salary_min ? `$${item.salary_min}–$${item.salary_max}` : ''),
        url: item.url || item.apply_url || `https://remoteok.com/remote-jobs/${item.id}`,
        postedAt: item.date ? new Date(item.date).toLocaleDateString('en-IN') : '',
        description: item.description ? item.description.replace(/<[^>]+>/g, '').slice(0, 300) : '',
        type: (item.position || '').toLowerCase().includes('intern') ? 'internship' : 'fulltime',
        source: 'RemoteOK',
      }));

    console.log(`[RemoteOK] CS-relevant jobs: ${jobs.length}`);
    return jobs;
  } catch (err) {
    console.error('[RemoteOK] Error:', err.message);
    return [];
  }
}

module.exports = { scrape };
