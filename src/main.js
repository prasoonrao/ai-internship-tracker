'use strict';

require('dotenv').config();

const { runAllScrapers } = require('./scrapers/index');
const { filterJobs } = require('./core/filter');
const { passesGeoFilter, isIndia } = require('./core/geoFilter');
const { evaluateJobs } = require('./core/llmEvaluator');
const { isAlertEligible, ELIGIBILITY_STATUSES } = require('./core/eligibilityFilter');
const { generateAllListings } = require('./core/digestGenerator');
const { loadApplications, renderMarkdown } = require('./core/tracker');
const Database = require('./core/database');
const TelegramNotifier = require('./notifiers/telegram');
const DiscordNotifier = require('./notifiers/discord');

// ─── Config ────────────────────────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const USE_SERPAPI = process.env.USE_SERPAPI === 'true';
const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const USE_LLM = process.env.USE_LLM === 'true';
const SEED_MODE = process.env.SEED_MODE === 'true' || process.argv.includes('--seed');
const MIN_MATCH_SCORE = parseInt(process.env.MIN_MATCH_SCORE || '70', 10);

const MAX_JOBS_PER_RUN = 50;

function validateConfig() {
  if (SEED_MODE || DRY_RUN) return;
  const missing = [];
  if (!TELEGRAM_TOKEN && !DISCORD_WEBHOOK) {
    missing.push('TELEGRAM_BOT_TOKEN or DISCORD_WEBHOOK_URL (at least one notification channel required)');
  }
  if (TELEGRAM_TOKEN && !TELEGRAM_CHAT_ID) {
    missing.push('TELEGRAM_CHAT_ID (needed when TELEGRAM_BOT_TOKEN is provided)');
  }
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    console.error('   Copy .env.example to .env and fill in your values.');
    process.exit(1);
  }
}

/**
 * Sort jobs: AI/ML primary first -> LLM match score -> Role priority -> Geo (India -> Remote -> Global) -> Internships first
 */
function sortJobs(jobs) {
  return jobs.sort((a, b) => {
    // 0. Eligibility rank: ELIGIBLE (0) -> LIKELY_ELIGIBLE (1) -> UNCLEAR (2) -> LIKELY_INELIGIBLE (3) -> INELIGIBLE (4)
    const eligRank = j => {
      switch (j.eligibility_status) {
        case ELIGIBILITY_STATUSES.ELIGIBLE: return 0;
        case ELIGIBILITY_STATUSES.LIKELY_ELIGIBLE: return 1;
        case ELIGIBILITY_STATUSES.UNCLEAR: return 2;
        case ELIGIBILITY_STATUSES.LIKELY_INELIGIBLE: return 3;
        case ELIGIBILITY_STATUSES.INELIGIBLE: return 4;
        default: return 2;
      }
    };
    const eligDiff = eligRank(a) - eligRank(b);
    if (eligDiff !== 0) return eligDiff;

    // 1. If LLM scores exist, highest match first
    if (a.matchScore != null && b.matchScore != null) {
      const scoreDiff = b.matchScore - a.matchScore;
      if (scoreDiff !== 0) return scoreDiff;
    }

    // 2. Candidate role priority score (AI/ML > SWE > other)
    const prioDiff = (b.rolePriority || 0) - (a.rolePriority || 0);
    if (prioDiff !== 0) return prioDiff;

    // 3. Category match: AI / ML & Data Science prioritized
    if (a.category === 'AI / ML & Data Science' && b.category !== 'AI / ML & Data Science') return -1;
    if (b.category === 'AI / ML & Data Science' && a.category !== 'AI / ML & Data Science') return 1;

    // 4. Geography: India -> Remote -> Global
    const geoScore = j => {
      const loc = (j.location || '').toLowerCase();
      if (isIndia(loc)) return 0;
      if (loc.includes('remote') || loc.includes('wfh')) return 1;
      return 2;
    };
    const geo = geoScore(a) - geoScore(b);
    if (geo !== 0) return geo;

    // 5. Internships before full-time
    return (a.type === 'internship' ? 0 : 1) - (b.type === 'internship' ? 0 : 1);
  });
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  🤖 AI INTERNSHIP TRACKER & ALERT BOT — Starting Run');
  console.log('  Target: B.Tech CSE 2028 (NMAMIT) — AI/ML & SWE Internships');
  console.log(`  Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log(`  Mode: ${USE_SERPAPI ? 'FULL (SerpAPI enabled)' : 'Standard Sources'}`);
  console.log(`  Dry Run: ${DRY_RUN ? 'YES (no alerts sent)' : 'NO'}`);
  if (SEED_MODE) {
    console.log('  🌱 SEED MODE: Indexing all existing jobs — no notifications will be sent.');
  }
  console.log(`  LLM Eval: ${USE_LLM ? 'YES (Gemini AI scoring enabled)' : 'OFF'}`);
  console.log('═'.repeat(60) + '\n');

  validateConfig();

  // ── 0. Update Application Tracker Markdown ─────────────────────────────────
  try {
    const apps = loadApplications();
    renderMarkdown(apps);
  } catch (err) {
    console.warn('[Tracker] Notice updating applications markdown:', err.message);
  }

  // ── 1. Scrape All Platforms ───────────────────────────────────────────────
  const rawJobs = await runAllScrapers({ useSerpapi: USE_SERPAPI });

  // ── 2. Filter by CS & Candidate Role Relevance ────────────────────────────
  const csJobs = filterJobs(rawJobs);
  console.log(`📋 After CS & Role filter: ${csJobs.length} relevant positions`);

  // ── 3. Filter by Geography (India, Remote, Tier-1 Global) ─────────────────
  const geoJobs = csJobs.filter(passesGeoFilter);
  console.log(`🌍 After Geo filter: ${geoJobs.length} eligible jobs`);

  // ── 4. Generate TOP20 & Categorized Markdown Listings ──────────────────────
  try {
    generateAllListings(geoJobs);
  } catch (err) {
    console.warn('[Digest] Notice generating markdown listings:', err.message);
  }

  // ── 5. Deduplicate Against Seen Jobs Database ─────────────────────────────
  const db = new Database();
  db.cleanup();

  const newJobs = geoJobs.filter(job => db.isNew(job));
  console.log(`✨ New (not previously seen): ${newJobs.length} jobs`);

  if (newJobs.length === 0) {
    console.log('✅ No new jobs found. Staying silent (silence is golden).');
    db.save();
    return;
  }

  // ── SEED MODE: catalogue all as seen, send nothing ───────────────────────
  if (SEED_MODE) {
    console.log(`\n🌱 [SEED MODE] Cataloguing ${newJobs.length} jobs as already seen...`);
    for (const job of newJobs) {
      db.markSeen(job);
    }
    db.save();
    const stats = db.stats();
    console.log('\n' + '═'.repeat(60));
    console.log('  🌱 Seed Run Complete!');
    console.log(`  Jobs catalogued (will NOT be sent) : ${newJobs.length}`);
    console.log(`  Total DB entries                   : ${stats.total}`);
    console.log('  Next step: set SEED_MODE=false for live alerts.');
    console.log('═'.repeat(60) + '\n');
    return;
  }

  // ── 6. Sort and Select Top Candidates for Evaluation & Delivery ────────────
  const sorted = sortJobs(newJobs);
  const toEvaluate = sorted.slice(0, MAX_JOBS_PER_RUN);
  const deferred = newJobs.length - toEvaluate.length;

  if (deferred > 0) {
    console.log(`⚠️  Capping at ${MAX_JOBS_PER_RUN} this run. ${deferred} deferred to next run.`);
  }

  // ── 7. LLM Match Evaluation (Gemini) ──────────────────────────────────────
  let evaluatedJobs = toEvaluate;
  if (USE_LLM) {
    console.log(`\n🧠 Running Gemini evaluation on top ${toEvaluate.length} candidates...`);
    evaluatedJobs = await evaluateJobs(toEvaluate);
  }

  // Re-sort to put top LLM matches and eligible roles at the very top
  const sortedEvaluated = sortJobs(evaluatedJobs);

  // Suppress LIKELY_INELIGIBLE and INELIGIBLE jobs from high-priority alert notifications,
  // and enforce MIN_MATCH_SCORE threshold (70%) when AI evaluation is active
  const toNotify = sortedEvaluated
    .filter(isAlertEligible)
    .filter(j => j.matchScore == null || j.matchScore >= MIN_MATCH_SCORE);
  const suppressedCount = sortedEvaluated.length - toNotify.length;
  if (suppressedCount > 0) {
    console.log(`🛡️  Screening & Threshold: Filtered out ${suppressedCount} restricted/ineligible or low-match (<${MIN_MATCH_SCORE}%) job(s) from push notifications.`);
  }

  // ── 8. Send Notifications ─────────────────────────────────────────────────
  const runType = USE_SERPAPI ? '☀️ Morning Run (Full)' : '🌙 Evening Run (Standard)';

  if (!DRY_RUN) {
    const notifiers = [];
    if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
      const telegram = new TelegramNotifier(TELEGRAM_TOKEN, TELEGRAM_CHAT_ID);
      notifiers.push(telegram.sendJobs(toNotify, runType));
    }
    if (DISCORD_WEBHOOK) {
      const discord = new DiscordNotifier(DISCORD_WEBHOOK);
      notifiers.push(discord.sendJobs(toNotify, runType));
    }

    if (notifiers.length === 0) {
      console.warn('⚠️  No notification credentials configured — skipping dispatch.');
    } else {
      const results = await Promise.allSettled(notifiers);
      const anySucceeded = results.some(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected').map(r => r.reason?.message);

      if (failures.length > 0) {
        console.warn(`⚠️  Some notifiers failed: ${failures.join(', ')}`);
      }

      if (!anySucceeded) {
        console.error('💥 All notifiers failed — NOT marking jobs as seen. Will retry next run.');
        process.exit(1);
      }
    }
  } else {
    console.log('\n[DRY RUN] Would send alerts for these prioritized listings:');
    toNotify.slice(0, 20).forEach((j, i) => {
      const matchText = j.matchScore != null ? ` [Match: ${j.matchScore}%]` : '';
      const eligBadge = j.eligibility_status === 'ELIGIBLE' ? '🟢' : j.eligibility_status === 'LIKELY_ELIGIBLE' ? '🟢' : '🟡';
      console.log(`  ${i + 1}. ${eligBadge} [${j.category}] ${j.title} @ ${j.company} (${j.location || 'India/Remote'})${matchText}`);
    });
    console.log(`[DRY RUN] Total to notify: ${toNotify.length} jobs (deferred: ${deferred}, ineligible suppressed: ${suppressedCount})\n`);
  }

  // ── 9. Mark Evaluated Jobs as Seen in Database ─────────────────────────────
  for (const job of evaluatedJobs) {
    db.markSeen(job);
  }
  db.save();

  // ── 10. Summary ───────────────────────────────────────────────────────────
  const stats = db.stats();
  console.log('\n' + '═'.repeat(60));
  console.log('  ✅ Pipeline Run Complete!');
  console.log(`  Notified this run : ${toNotify.length}`);
  console.log(`  Deferred to next  : ${deferred}`);
  console.log(`  Total DB entries  : ${stats.total}`);
  console.log('═'.repeat(60) + '\n');
}

main().catch(err => {
  console.error('\n💥 Fatal error in main():', err);
  process.exit(1);
});
