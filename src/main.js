'use strict';

require('dotenv').config();

const { runAllScrapers } = require('./scrapers/index');
const { filterJobs } = require('./core/filter');
const { passesGeoFilter, isIndia } = require('./core/geoFilter');
const { evaluateJobs } = require('./core/llmEvaluator');
const { isAlertEligible, shouldAlert, ELIGIBILITY_STATUSES } = require('./core/eligibilityFilter');
const { generateAllListings, generateTop20Queue } = require('./core/digestGenerator');
const {
  buildTop20Queue,
  tierQueue,
  getQueueCategoryDistribution,
  selectEvaluationPool,
} = require('./core/applicationQueue');
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

  // In DRY_RUN, if database was already saturated from prior test runs, fall back to geoJobs to demonstrate evaluation
  const candidatePool = (DRY_RUN && newJobs.length === 0) ? geoJobs : newJobs;

  if (candidatePool.length === 0) {
    console.log('✅ No new jobs found. Staying silent (silence is golden).');
    if (!DRY_RUN) db.save();
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

  // ── 6. Select Category-Aware Candidate Pool for Gemini Evaluation ─────────
  const toEvaluate = selectEvaluationPool(candidatePool, {
    maxTotal: MAX_JOBS_PER_RUN,
  });
  const deferred = candidatePool.length - toEvaluate.length;

  if (deferred > 0) {
    console.log(`⚠️  Capping at ${MAX_JOBS_PER_RUN} this run. ${deferred} deferred to next run.`);
  }

  // ── 7. Match Evaluation (Gemini AI with Profile Fallback) ─────────────────
  let evaluatedJobs = toEvaluate;
  if (USE_LLM || DRY_RUN) {
    console.log(`\n🧠 Running candidate match evaluation on top ${toEvaluate.length} candidates...`);
    evaluatedJobs = await evaluateJobs(toEvaluate);
  }

  // Re-sort to put top LLM matches and eligible roles at the very top
  const sortedEvaluated = sortJobs(evaluatedJobs);

  // Suppress UNCLEAR, LIKELY_INELIGIBLE, and INELIGIBLE jobs, and enforce MIN_MATCH_SCORE threshold (70)
  const toNotify = sortedEvaluated.filter(j => shouldAlert(j, MIN_MATCH_SCORE));
  const suppressedCount = sortedEvaluated.length - toNotify.length;
  if (suppressedCount > 0) {
    console.log(`🛡️  Screening & Threshold: Filtered out ${suppressedCount} restricted/ineligible/unclear or low-match (<${MIN_MATCH_SCORE}%) job(s) from push notifications.`);
  }

  // Strict Gate Verification: Every job in toNotify MUST be ELIGIBLE or LIKELY_ELIGIBLE
  const nonEligibleInNotify = toNotify.filter(j => j.eligibility_status !== ELIGIBILITY_STATUSES.ELIGIBLE && j.eligibility_status !== ELIGIBILITY_STATUSES.LIKELY_ELIGIBLE);
  if (nonEligibleInNotify.length > 0) {
    throw new Error(`CRITICAL INTEGRITY FAILURE: ${nonEligibleInNotify.length} job(s) in toNotify have disallowed eligibility status: ${nonEligibleInNotify.map(j => `${j.title} (${j.eligibility_status})`).join(', ')}`);
  }

  // ── 7.5. Build Daily Top-20 Application Queue ─────────────────────────────
  let apps = [];
  try {
    apps = loadApplications();
  } catch (err) {
    console.warn('[Queue] Notice loading applications:', err.message);
  }

  const top20Queue = buildTop20Queue(evaluatedJobs, { applications: apps });
  const { priority: qPriority, next: qNext, backup: qBackup } = tierQueue(top20Queue);

  // Strict Gate Verification: Every job in top20Queue MUST be ELIGIBLE or LIKELY_ELIGIBLE
  const nonEligibleInQueue = top20Queue.filter(j => j.eligibility_status !== ELIGIBILITY_STATUSES.ELIGIBLE && j.eligibility_status !== ELIGIBILITY_STATUSES.LIKELY_ELIGIBLE);
  if (nonEligibleInQueue.length > 0) {
    throw new Error(`CRITICAL INTEGRITY FAILURE: ${nonEligibleInQueue.length} job(s) in top20Queue have disallowed eligibility status: ${nonEligibleInQueue.map(j => `${j.title} (${j.eligibility_status})`).join(', ')}`);
  }

  // Update TOP20.md with the evaluated queue
  if (top20Queue.length > 0) {
    try {
      generateTop20Queue(evaluatedJobs, apps);
    } catch (err) {
      console.warn('[Digest] Notice updating TOP20.md queue:', err.message);
    }
  }

  // ── 8. Send Notifications ─────────────────────────────────────────────────
  const runType = USE_SERPAPI ? '☀️ Morning Run (Full)' : '🌙 Evening Run (Standard)';

  if (!DRY_RUN) {
    const notifiers = [];
    if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
      const telegram = new TelegramNotifier(TELEGRAM_TOKEN, TELEGRAM_CHAT_ID);
      notifiers.push(telegram.sendJobs(toNotify, runType, top20Queue));
    }
    if (DISCORD_WEBHOOK) {
      const discord = new DiscordNotifier(DISCORD_WEBHOOK);
      notifiers.push(discord.sendJobs(toNotify, runType, top20Queue));
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
    const highMatches = evaluatedJobs.filter(j => j.matchScore != null && j.matchScore >= 80).length;
    const goodMatches = evaluatedJobs.filter(j => j.matchScore != null && j.matchScore >= 70 && j.matchScore < 80).length;
    const lowMatches = evaluatedJobs.filter(j => j.matchScore != null && j.matchScore < 70).length;

    console.log('\n[DRY RUN] Match Score Distribution:');
    console.log(`  🔥 Priority Match (80–100%) : ${highMatches} jobs`);
    console.log(`  ⚡ Good Match (70–79%)      : ${goodMatches} jobs`);
    console.log(`  ⚪ Below Threshold (<70%)   : ${lowMatches} jobs (suppressed from alerts)`);

    console.log('\n[DRY RUN] Notification Eligibility Audit:');
    const eligibleCount = toNotify.filter(j => j.eligibility_status === ELIGIBILITY_STATUSES.ELIGIBLE).length;
    const likelyEligibleCount = toNotify.filter(j => j.eligibility_status === ELIGIBILITY_STATUSES.LIKELY_ELIGIBLE).length;
    console.log(`  🟢 ELIGIBLE          : ${eligibleCount}`);
    console.log(`  🟢 LIKELY_ELIGIBLE   : ${likelyEligibleCount}`);
    console.log(`  🟡 UNCLEAR           : 0 (verified 100% suppressed)`);
    console.log(`  🔴 LIKELY_INELIGIBLE : 0 (verified 100% suppressed)`);
    console.log(`  🔴 INELIGIBLE        : 0 (verified 100% suppressed)`);
    console.log(`  🛡️  100% of notification listings (${toNotify.length}/${toNotify.length}) verified ELIGIBLE or LIKELY_ELIGIBLE.`);

    console.log('\n[DRY RUN] Daily Top-20 Application Queue Audit:');
    console.log(`  🔥 PRIORITY (Ranks 1–5  | Today's Minimum Target) : ${qPriority.length} jobs`);
    console.log(`  🟢 NEXT     (Ranks 6–15 | Apply After Priority)   : ${qNext.length} jobs`);
    console.log(`  🟡 BACKUP   (Ranks 16–20| Pipeline Depth)         : ${qBackup.length} jobs`);
    console.log(`  📋 Total in Queue                                 : ${top20Queue.length} jobs`);
    console.log(`  🛡️  Zero UNCLEAR, LIKELY_INELIGIBLE, or INELIGIBLE jobs in queue.`);

    const evalDist = getQueueCategoryDistribution(evaluatedJobs);
    console.log('\n[DRY RUN] Evaluated Candidates Role-Category Distribution:');
    console.log(`  🧠 AI/ML                     : ${evalDist['AI/ML'] || 0}`);
    console.log(`  💻 Software/Backend          : ${evalDist['Software/Backend'] || 0}`);
    console.log(`  📈 Data/Data Analytics       : ${evalDist['Data/Data Analytics'] || 0}`);
    console.log(`  ☁️ Cloud/DevOps/Automation   : ${evalDist['Cloud/DevOps/Automation'] || 0}`);
    console.log(`  ⚙️ Other technical           : ${evalDist['Other technical'] || 0}`);

    const dist = getQueueCategoryDistribution(top20Queue);
    console.log('\n[DRY RUN] Top-20 Role-Category Distribution:');
    console.log(`  🧠 AI/ML                     : ${dist['AI/ML'] || 0}`);
    console.log(`  💻 Software/Backend          : ${dist['Software/Backend'] || 0}`);
    console.log(`  📈 Data/Data Analytics       : ${dist['Data/Data Analytics'] || 0}`);
    console.log(`  ☁️ Cloud/DevOps/Automation   : ${dist['Cloud/DevOps/Automation'] || 0}`);
    console.log(`  ⚙️ Other technical           : ${dist['Other technical'] || 0}`);

    const nonAIMLEval = evaluatedJobs.filter(j => j.roleCategory && j.roleCategory !== 'AI/ML');
    if (nonAIMLEval.length > 0) {
      console.log(`\n[DRY RUN] Sample Non-AI/ML Candidates Evaluated (${nonAIMLEval.length} total):`);
      nonAIMLEval.slice(0, 5).forEach(j => {
        console.log(`  • [${j.roleCategory}] ${j.title} @ ${j.company} (Match: ${j.matchScore}%)`);
      });
    }

    const nonAIMLQueue = top20Queue.filter(j => j.roleCategory && j.roleCategory !== 'AI/ML');
    if (nonAIMLQueue.length > 0) {
      console.log(`\n[DRY RUN] Non-AI/ML Candidates in Top-20 Queue (${nonAIMLQueue.length} total):`);
      nonAIMLQueue.forEach(j => {
        console.log(`  • #${j.queueRank} [${j.roleCategory}] ${j.title} @ ${j.company} (Match: ${j.matchScore}% | Priority: ${j.applicationPriorityScore})`);
      });
    }

    if (top20Queue.length > 0) {
      console.log('\n[DRY RUN] Top-5 Priority Applications to Target First:');
      qPriority.forEach((j) => {
        const matchText = j.matchScore != null ? `${j.matchScore}%` : '70%';
        const prioText = j.applicationPriorityScore != null ? j.applicationPriorityScore : '80';
        const cat = j.roleCategory || 'AI/ML';
        console.log(`  🔥 #${j.queueRank} [Match: ${matchText} | Prio: ${prioText}] [${cat}] ${j.title} @ ${j.company} (${j.location || 'India/Remote'})`);
        console.log(`     URL: ${j.url}`);
      });
    }

    console.log('\n[DRY RUN] Would send alerts for these prioritized listings (≥70%):');
    toNotify.slice(0, 20).forEach((j, i) => {
      const matchText = j.matchScore != null ? ` [Match: ${j.matchScore}%]` : '';
      const eligBadge = j.eligibility_status === ELIGIBILITY_STATUSES.ELIGIBLE ? '🟢 [ELIGIBLE]' : '🟢 [LIKELY_ELIGIBLE]';
      console.log(`  ${i + 1}. ${eligBadge} [${j.category}] ${j.title} @ ${j.company} (${j.location || 'India/Remote'})${matchText}`);
    });
    console.log(`\n[DRY RUN] Total to notify: ${toNotify.length} jobs (deferred: ${deferred}, suppressed: ${suppressedCount})\n`);
  }

  // ── 9. Mark Evaluated Jobs as Seen in Database ─────────────────────────────
  if (!DRY_RUN) {
    for (const job of evaluatedJobs) {
      db.markSeen(job);
    }
    db.save();
  }

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
