'use strict';

const fs = require('fs');
const path = require('path');
const { getGeoTag, isIndia } = require('./geoFilter');

const ROOT_DIR = path.join(__dirname, '..', '..');
const LISTINGS_DIR = path.join(ROOT_DIR, 'listings');
const TOP20_PATH = path.join(ROOT_DIR, 'TOP20.md');

// High-signal companies
const TIER1_COMPANIES = new Set([
  'google', 'microsoft', 'meta', 'apple', 'amazon', 'nvidia', 'netflix',
  'openai', 'anthropic', 'deepmind', 'hugging face', 'cohere', 'mistral',
  'databricks', 'snowflake', 'scale ai', 'palantir', 'stripe', 'uber',
  'jane street', 'citadel', 'de shaw', 'two sigma', 'jump trading', 'optiver',
  'razorpay', 'swiggy', 'zomato', 'cred', 'zepto', 'groww', 'flipkart'
]);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function calculateScore(job) {
  let score = 0;
  const title = (job.title || '').toLowerCase();
  const company = (job.company || '').toLowerCase();
  const loc = (job.location || '').toLowerCase();

  // 1. Role match: Primary AI/ML gets highest weight
  if (job.category === 'AI / ML & Data Science' || title.includes('ai') || title.includes('ml') || title.includes('machine learning')) {
    score += 45;
  } else if (job.category === 'Software & Backend Engineering' || title.includes('backend') || title.includes('software')) {
    score += 25;
  }

  // 2. Internship type
  if (job.type === 'internship') {
    score += 15;
  }

  // 3. Location: India / Remote gets priority
  if (isIndia(loc)) {
    score += 20;
  } else if (loc.includes('remote') || loc.includes('wfh')) {
    score += 15;
  }

  // 4. Company tier
  if (TIER1_COMPANIES.has(company)) {
    score += 25;
  }

  // 5. LLM match score (if present)
  if (job.matchScore != null) {
    score += Math.round(job.matchScore * 0.4);
  }

  return score;
}

function generateCategoryMarkdown(categoryTitle, jobs, filename) {
  ensureDir(LISTINGS_DIR);
  const targetPath = path.join(LISTINGS_DIR, filename);
  const today = new Date().toISOString().split('T')[0];

  const lines = [
    `# 📚 ${categoryTitle} (${jobs.length} Active Listings)`,
    '',
    `[← Back to Main Repository](../README.md) | [Top 20 Picks](../TOP20.md)`,
    `*Generated on ${today} for B.Tech CSE (Batch of 2028)*`,
    '',
    '| Company | Role | Location | Type | Source | Apply |',
    '|---|---|---|---|---|---|',
  ];

  jobs.forEach(j => {
    const geo = getGeoTag(j);
    const loc = j.location || 'Not specified';
    const link = j.url ? `[Apply Now →](${j.url})` : '—';
    const type = j.type === 'internship' ? '🧪 Internship' : '💼 Full-time';

    lines.push(
      `| **${j.company}** | ${j.title} | ${loc} ${geo} | ${type} | ${j.source} | ${link} |`
    );
  });

  lines.push('');
  fs.writeFileSync(targetPath, lines.join('\n'), 'utf8');
}

function generateTop20(jobs) {
  const today = new Date().toISOString().split('T')[0];

  // Score jobs
  const scored = jobs.map(j => ({
    ...j,
    recommendScore: calculateScore(j),
  }));

  scored.sort((a, b) => b.recommendScore - a.recommendScore);

  // One best role per company
  const topPicks = [];
  const seenCompanies = new Set();

  for (const job of scored) {
    const compKey = (job.company || '').toLowerCase().trim();
    if (seenCompanies.has(compKey)) continue;
    seenCompanies.add(compKey);
    topPicks.push(job);
    if (topPicks.length >= 20) break;
  }

  const lines = [
    `# 🏆 Today's Top 20 Internship Recommendations (${today})`,
    '',
    `Curated for **B.Tech CSE 2028 (NMAMIT)** targeting **AI/ML & SWE Internships**.`,
    `Ranked by **AI/ML role alignment + tier-1 employer signal + geographic fit + freshness**.`,
    '',
    '[← Back to README](README.md) | [Application Tracker](APPLICATIONS.md)',
    '',
    '| # | Company | Role | Location | Focus | Apply | Log Application |',
    '|---|---|---|---|---|---|---|',
  ];

  topPicks.forEach((j, idx) => {
    const geo = getGeoTag(j);
    const loc = j.location || 'India / Remote';
    const link = j.url ? `[Apply →](${j.url})` : '—';
    const focus = j.category === 'AI / ML & Data Science' ? '🧠 AI/ML' : '💻 SWE';
    const trackCmd = `\`npm run track -- add "${j.company.replace(/"/g, '')}" "${j.title.replace(/"/g, '')}"\``;

    lines.push(
      `| ${idx + 1} | **${j.company}** | ${j.title} | ${loc} ${geo} | ${focus} | ${link} | ${trackCmd} |`
    );
  });

  lines.push('');
  lines.push('---');
  lines.push('*Rankings auto-update twice daily with every scheduled pipeline run.*');
  lines.push('');

  fs.writeFileSync(TOP20_PATH, lines.join('\n'), 'utf8');
  console.log(`[Digest] Rendered ${TOP20_PATH} (${topPicks.length} picks)`);
  return topPicks;
}

function generateAllListings(allJobs) {
  ensureDir(LISTINGS_DIR);

  // Group by categories
  const aimlJobs = allJobs.filter(j => j.category === 'AI / ML & Data Science');
  const sweJobs = allJobs.filter(j => j.category === 'Software & Backend Engineering');
  const indiaJobs = allJobs.filter(j => isIndia(j.location || ''));

  generateCategoryMarkdown('AI, Machine Learning & Data Science Internships', aimlJobs, 'ai-ml-data-science.md');
  generateCategoryMarkdown('Software & Backend Engineering Internships', sweJobs, 'software-engineering.md');
  generateCategoryMarkdown('Domestic India Opportunities', indiaJobs, 'india-internships.md');

  const topPicks = generateTop20(allJobs);
  console.log(`[Digest] Generated categorized markdown files in ${LISTINGS_DIR}`);
  return { topPicks, aimlJobs, sweJobs, indiaJobs };
}

module.exports = {
  generateAllListings,
  generateTop20,
  calculateScore,
};
