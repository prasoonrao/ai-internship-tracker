'use strict';

const axios = require('axios');

// FIX Issue 3: Replaced broken Jobicy (HTTP 400) with Remotive.com.
// Remotive has a stable, well-documented public JSON API — no auth, no rate
// limits documented, used widely in job-scraping projects.
// Docs: https://remotive.com/api/remote-jobs

const ENDPOINTS = [
  {
    url: 'https://remotive.com/api/remote-jobs?category=software-dev&limit=100',
    label: 'Software Dev',
  },
  {
    url: 'https://remotive.com/api/remote-jobs?category=data&limit=50',
    label: 'Data',
  },
  {
    url: 'https://remotive.com/api/remote-jobs?category=devops-sysadmin&limit=50',
    label: 'DevOps',
  },
];

const CS_TERMS = [
  'software', 'engineer', 'developer', 'backend', 'frontend', 'fullstack',
  'full stack', 'data', 'ml', 'machine learning', 'ai', 'devops',
  'cloud', 'platform', 'sre', 'mobile', 'ios', 'android', 'python',
  'javascript', 'typescript', 'golang', 'rust', 'java',
];

function isCSJob(job) {
  const text = (job.title || '').toLowerCase();
  return CS_TERMS.some(t => text.includes(t));
}

async function scrape() {
  const allJobs = [];
  const seen = new Set();

  for (const endpoint of ENDPOINTS) {
    try {
      console.log(`[Remotive] Fetching ${endpoint.label}...`);
      const res = await axios.get(endpoint.url, {
        headers: {
          'User-Agent': 'job-alert-bot/1.0',
          'Accept': 'application/json',
        },
        timeout: 15000,
      });

      const jobs = res.data?.jobs || [];
      console.log(`[Remotive] ${endpoint.label}: ${jobs.length} raw listings`);

      for (const item of jobs) {
        if (!isCSJob(item)) continue;

        const key = `${item.title}|${item.company_name}`;
        if (seen.has(key)) continue;
        seen.add(key);

        allJobs.push({
          title: item.title || '',
          company: item.company_name || '',
          location: item.candidate_required_location || 'Remote',
          salary: item.salary || '',
          url: item.url || '',
          postedAt: item.publication_date
            ? new Date(item.publication_date).toLocaleDateString('en-IN')
            : '',
          description: item.description
            ? item.description.replace(/<[^>]+>/g, '').slice(0, 300)
            : '',
          type: (item.title || '').toLowerCase().includes('intern') ? 'internship' : 'fulltime',
          source: 'Remotive',
        });
      }

      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[Remotive] Error on ${endpoint.label}:`, err.message);
    }
  }

  console.log(`[Remotive] Total: ${allJobs.length} unique CS jobs`);
  return allJobs;
}

module.exports = { scrape };
