'use strict';

const { isRelevant } = require('./filter');
const { isIndia, passesGeoFilter, isRemote, isReputableCompany } = require('./geoFilter');
const { isAlertEligible, ELIGIBILITY_STATUSES } = require('./eligibilityFilter');
const Database = require('./database');

const MIN_QUEUE_MATCH_SCORE = 70;
const MAX_QUEUE_SIZE = 20;
const MAX_ROLES_PER_COMPANY = 3;

const EXCLUDED_STATUSES = new Set([
  'applied',
  'rejected',
  'withdrawn',
  'interview',
  'offer',
]);

/**
 * Normalized Role Category Names
 */
const ROLE_CATEGORIES = {
  AIML: 'AI/ML',
  SOFTWARE_BACKEND: 'Software/Backend',
  DATA_ANALYTICS: 'Data/Data Analytics',
  CLOUD_DEVOPS_AUTOMATION: 'Cloud/DevOps/Automation',
  OTHER_TECHNICAL: 'Other technical',
  EXCLUDED: 'Excluded',
};

/**
 * Suggested Allocation Targets for Candidate Evaluation Pool (Max 50 total).
 * These represent maximum target allocations per category, NOT mandatory quotas.
 */
const DEFAULT_CATEGORY_LIMITS = {
  [ROLE_CATEGORIES.AIML]: 25,
  [ROLE_CATEGORIES.SOFTWARE_BACKEND]: 10,
  [ROLE_CATEGORIES.DATA_ANALYTICS]: 10,
  [ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION]: 5,
};

/**
 * Transparent Career-Role Relevance Scoring (0–100 scale).
 * Evaluates title, description, and requirements.
 *
 * CATEGORY A — PRIMARY TARGETS (90–100 starting range):
 *   AI/ML, Machine Learning, GenAI, LLM, Data Science, Deep Learning, NLP, CV
 * CATEGORY B — STRONG SECONDARY TARGETS (78–92 starting range):
 *   Software Engineer, Backend, Python, Java, Data Engineer, Data Analyst, SQL/Data
 * CATEGORY C — VALID SECONDARY / BACKUP TARGETS (65–85 starting range):
 *   Cloud Engineer, DevOps, Automation, Full-Stack, Web, API, QA Automation/SDET
 * CATEGORY D — LOWER PRIORITY (55–70 starting range):
 *   Generic IT support, manual testing, non-programming operations/analyst
 * CATEGORY E — EXCLUDE (0–40 range):
 *   Sales, marketing, HR, recruitment, content writing, telecalling, customer support
 */
function calculateCareerRoleRelevance(job) {
  if (!job) return { score: 0, category: ROLE_CATEGORIES.EXCLUDED, reason: 'Empty job' };

  const title = (job.title || '').toLowerCase().trim();
  const desc = (job.description || '').toLowerCase();

  // 1. Check Category E (Non-technical / Exclude)
  const isNonTechnical = /\b(?:sales|marketing|hr\s+executive|human\s+resources|recruiter|recruitment|content\s+writer|copywriter|graphic\s+designer|finance|accounting|telecaller|telecalling|customer\s+support|customer\s+success|call\s+center)\b/i.test(title);
  if (isNonTechnical) {
    return {
      score: 20,
      category: ROLE_CATEGORIES.EXCLUDED,
      reason: 'Non-technical role category',
    };
  }

  let baseScore = 65;
  let category = ROLE_CATEGORIES.OTHER_TECHNICAL;
  let reason = '';

  // 2. Identify Role Category & Initial Base Range
  // CATEGORY A: AI/ML, GenAI, LLM, ML Engineering, Applied AI, Deep Learning, NLP, CV
  const isPrimaryAIML = /\b(?:ai\/ml|machine\s+learning|ai\s+engineer|ml\s+engineer|genai|generative\s+ai|llm|deep\s+learning|nlp|computer\s+vision|applied\s+ai|applied\s+ml|ai\s+research|ml\s+research|prompt\s+engineer|model\s+evaluation|fine-tuning)\b/i.test(title);
  const isDataScience = /\b(?:data\s+scientist|data\s+science)\b/i.test(title);

  // CATEGORY B: Data Engineering & Data Analytics / Data Analyst
  const isDataAnalyst = /\b(?:data\s+analyst|data\s+analytics|bi\s+analyst|business\s+intelligence)\b/i.test(title);
  const isDataEngineer = /\b(?:data\s+engineer|data\s+engineering|sql\s+developer|database\s+developer)\b/i.test(title);

  // CATEGORY B: Software Engineering / Backend / Python / Java
  const isSWE = /\b(?:software\s+engineer|software\s+developer|sde|swe|systems\s+engineer)\b/i.test(title);
  const isBackend = /\b(?:backend|back-end|api\s+developer)\b/i.test(title);
  const isPythonDev = /\b(?:python\s+developer|python\s+engineer)\b/i.test(title);
  const isJavaDev = /\b(?:java\s+developer|java\s+engineer)\b/i.test(title);

  // CATEGORY C: Cloud / DevOps / Automation
  const isCloudDevOps = /\b(?:cloud\s+engineer|devops|sre|platform\s+engineer|infrastructure\s+engineer)\b/i.test(title);
  const isAutomation = /\b(?:automation\s+engineer|qa\s+automation|sdet)\b/i.test(title);

  // CATEGORY C: Full-Stack / Web
  const isFullStack = /\b(?:full\s*stack|fullstack)\b/i.test(title);
  const isWebDev = /\b(?:web\s+developer|frontend|front-end)\b/i.test(title);

  if (isPrimaryAIML) {
    category = ROLE_CATEGORIES.AIML;
    baseScore = 95; // 90–100
    reason = 'Primary AI/ML Engineering Target';
  } else if (isDataScience) {
    category = ROLE_CATEGORIES.AIML;
    baseScore = 90; // 85–95
    reason = 'Data Science & Applied ML Target';
  } else if (isSWE) {
    category = ROLE_CATEGORIES.SOFTWARE_BACKEND;
    baseScore = 86; // 80–92
    reason = 'Software Engineering Core Target';
  } else if (isBackend || isPythonDev || isJavaDev) {
    category = ROLE_CATEGORIES.SOFTWARE_BACKEND;
    baseScore = 84; // 78–90
    reason = 'Backend & Systems Development Target';
  } else if (isDataEngineer) {
    category = ROLE_CATEGORIES.DATA_ANALYTICS;
    baseScore = 84; // 78–90
    reason = 'Data Engineering & Pipeline Target';
  } else if (isDataAnalyst) {
    category = ROLE_CATEGORIES.DATA_ANALYTICS;
    baseScore = 80; // 72–88
    reason = 'Data Analytics & Insights Target';
  } else if (isCloudDevOps || isAutomation) {
    category = ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION;
    baseScore = 76; // 70–85
    reason = 'Cloud, DevOps & Automation Target';
  } else if (isFullStack || isWebDev) {
    category = ROLE_CATEGORIES.SOFTWARE_BACKEND;
    baseScore = 72; // 65–82
    reason = 'Full-Stack & Web Engineering Target';
  } else {
    // Check description if title is general (e.g. "Technology Intern", "Engineering Intern")
    if (/\b(?:machine\s+learning|deep\s+learning|genai|llm|pytorch|tensorflow)\b/i.test(desc)) {
      category = ROLE_CATEGORIES.AIML;
      baseScore = 88;
      reason = 'AI/ML Focus in Description';
    } else if (/\b(?:data\s+analyst|data\s+analysis|pandas|sql|tableau|power\s+bi)\b/i.test(desc)) {
      category = ROLE_CATEGORIES.DATA_ANALYTICS;
      baseScore = 78;
      reason = 'Data Analytics Focus in Description';
    } else if (/\b(?:backend|python|java|rest\s+api|docker|databases)\b/i.test(desc)) {
      category = ROLE_CATEGORIES.SOFTWARE_BACKEND;
      baseScore = 78;
      reason = 'Software & Systems Focus in Description';
    } else {
      category = ROLE_CATEGORIES.OTHER_TECHNICAL;
      baseScore = 65; // 55–70
      reason = 'General Technical / CS Opportunity';
    }
  }

  // 3. Description & Responsibilities Refinement (Section 10)

  // (a) ML Trainer / Teaching / Tutoring adjustment:
  const isTrainerOrTeacher = /\b(?:trainer|instructor|mentor|tutor|teaching|curriculum|faculty)\b/i.test(title) ||
    (/\b(?:teach|tutoring|training students|conduct classes|grading)\b/i.test(desc) && !/\b(?:deploy|production|model architecture|fine-tuning)\b/i.test(desc));
  if (isTrainerOrTeacher) {
    baseScore -= 18; // Drops an ML Trainer from 95 to 77 so production SWE (86) outranks it
    reason += ' (Training/Teaching role adjustment)';
  }

  // (b) Marketing/sales dilution penalty in tech titles:
  if (/\b(?:sales|marketing|lead\s+generation|calling|cold\s+call)\b/i.test(desc)) {
    baseScore -= 25;
    reason += ' (Marketing/sales responsibilities dilution)';
  }

  // (c) Technical Data Analyst refinement (Python + SQL + Pandas/NumPy):
  if (category === ROLE_CATEGORIES.DATA_ANALYTICS) {
    const hasPythonOrPandas = desc.includes('python') || desc.includes('pandas') || desc.includes('numpy');
    const hasSqlOrDb = desc.includes('sql') || desc.includes('database') || desc.includes('postgres') || desc.includes('mysql');
    if (hasPythonOrPandas && hasSqlOrDb) {
      baseScore += 6; // Moves 80 to 86
      reason += ' (Technical Python + SQL + Pandas stack)';
    } else if (!hasPythonOrPandas && !hasSqlOrDb && (desc.includes('excel') || desc.includes('reporting') || desc.includes('business'))) {
      baseScore -= 10;
      reason += ' (Non-programming reporting focus)';
    }
  }

  // (d) SWE with AI/ML or Candidate Core Stack refinement:
  if (category === ROLE_CATEGORIES.SOFTWARE_BACKEND) {
    const hasDataOrML = /\b(?:ml|ai|machine\s+learning|llm|pipeline|analytics|data\s+processing)\b/i.test(desc);
    const hasCoreStack = /\b(?:python|sql|docker|kubernetes|fastapi|django|postgres)\b/i.test(desc);
    if (hasDataOrML) {
      baseScore += 6; // Boosts SWE to ~92
      reason += ' (SWE with AI/ML or Data Pipeline integration)';
    } else if (hasCoreStack) {
      baseScore += 3; // Boosts SWE to ~89
      reason += ' (Strong alignment with candidate stack)';
    }
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(baseScore)));
  return { score: finalScore, category, reason };
}

/**
 * Calculate the Application Priority Score (0–100 scale).
 * Separate from Gemini's matchScore.
 *
 * Weighted ranking factors:
 * - 40% — Skill / role match
 * - 20% — Career-role relevance
 * - 15% — Freshness
 * - 10% — Eligibility confidence
 * - 10% — Internship/student relevance
 * - 5% — Application practicality
 *
 * Total = 100%
 */
function calculateApplicationPriorityScore(job, options = {}) {
  // 1. Skill / Role Match (40%)
  const skillMatch = typeof job.matchScore === 'number'
    ? Math.max(0, Math.min(100, job.matchScore))
    : 70;

  // 2. Career-Role Relevance (20%)
  const roleEval = calculateCareerRoleRelevance(job);
  const careerRoleScore = roleEval.score;

  // 3. Freshness (15%)
  let freshnessScore = 70; // safe neutral default when postedAt is unavailable
  const postedAt = (job.postedAt || '').toLowerCase().trim();

  if (postedAt) {
    if (
      postedAt.includes('today') ||
      postedAt.includes('just now') ||
      postedAt.includes('minute') ||
      postedAt.includes('hour') ||
      postedAt.includes('< 24h') ||
      postedAt === '1d' ||
      postedAt === '1 day ago' ||
      postedAt === 'yesterday'
    ) {
      freshnessScore = 100;
    } else if (
      postedAt.includes('2 day') ||
      postedAt.includes('3 day') ||
      postedAt.includes('4 day') ||
      postedAt.includes('5 day') ||
      postedAt === '2d' ||
      postedAt === '3d'
    ) {
      freshnessScore = 85;
    } else if (
      postedAt.includes('6 day') ||
      postedAt.includes('week') ||
      postedAt.includes('7 day') ||
      postedAt.includes('10 day')
    ) {
      freshnessScore = 65;
    } else if (
      postedAt.includes('2 week') ||
      postedAt.includes('14 day')
    ) {
      freshnessScore = 45;
    } else if (
      postedAt.includes('month') ||
      postedAt.includes('30 day') ||
      postedAt.includes('30+ day')
    ) {
      freshnessScore = 25;
    } else {
      // Try parsing date
      try {
        const d = new Date(postedAt);
        if (!isNaN(d.getTime())) {
          const diffDays = Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
          if (diffDays <= 1) freshnessScore = 100;
          else if (diffDays <= 4) freshnessScore = 85;
          else if (diffDays <= 10) freshnessScore = 65;
          else if (diffDays <= 20) freshnessScore = 45;
          else freshnessScore = 25;
        }
      } catch {
        freshnessScore = 70;
      }
    }
  }

  // 4. Eligibility Confidence (10%)
  let eligibilityScore = 0;
  if (job.eligibility_status === 'ELIGIBLE') {
    eligibilityScore = 100;
  } else if (job.eligibility_status === 'LIKELY_ELIGIBLE') {
    eligibilityScore = 80;
  }

  // 5. Internship / Student Relevance (10%)
  let internshipScore = 60;
  const title = (job.title || '').toLowerCase();
  const isInternType = job.type === 'internship';
  const hasInternKeyword = /\b(?:intern|internship|trainee|co-?op|student|summer\s+202[6-8])\b/i.test(title);
  if (isInternType || hasInternKeyword) {
    internshipScore = 100;
  } else if (/\b(?:fresher|entry\s+level|new\s+grad)\b/i.test(title)) {
    internshipScore = 85;
  }

  // 6. Application Practicality (5%)
  // Based on observable directness, valid application URL, and listing clarity
  let practicalityScore = 70;
  const url = (job.url || '').toLowerCase();
  if (url.startsWith('http')) {
    practicalityScore += 15;
  }
  // Check observable ATS or direct career domain
  if (
    url.includes('greenhouse.io') ||
    url.includes('lever.co') ||
    url.includes('ashbyhq.com') ||
    url.includes('myworkdayjobs.com') ||
    url.includes('smartrecruiters.com') ||
    url.includes('workatastartup.com')
  ) {
    practicalityScore += 15;
  }
  if (job.salary) {
    practicalityScore = Math.min(100, practicalityScore + 5);
  }
  practicalityScore = Math.min(100, practicalityScore);

  // Compute final weighted composite
  const composite = (
    skillMatch * 0.40 +
    careerRoleScore * 0.20 +
    freshnessScore * 0.15 +
    eligibilityScore * 0.10 +
    internshipScore * 0.10 +
    practicalityScore * 0.05
  );

  return Math.max(0, Math.min(100, Math.round(composite)));
}

/**
 * Extract excluded URLs and company-role signatures from existing applications
 */
function getExcludedApplicationKeys(applications = []) {
  const excluded = new Set();
  if (!Array.isArray(applications)) return excluded;

  for (const app of applications) {
    const status = (app.status || '').toLowerCase().trim();
    if (EXCLUDED_STATUSES.has(status)) {
      if (app.url) {
        const clean = Database.normalizeUrl(app.url);
        if (clean) excluded.add(clean.toLowerCase());
      }
      if (app.company && app.role) {
        const signature = `${app.company.toLowerCase().trim()}|${app.role.toLowerCase().trim()}`;
        excluded.add(signature);
      }
    }
  }

  return excluded;
}

/**
 * Check if a job is eligible to enter the Top-20 Application Queue
 */
function isQueueEligible(job, excludedKeys = new Set()) {
  if (!job) return false;

  // 1. matchScore >= 70
  if (job.matchScore == null || job.matchScore < MIN_QUEUE_MATCH_SCORE) {
    return false;
  }

  // 2. Strict eligibility gate: only ELIGIBLE or LIKELY_ELIGIBLE
  // UNCLEAR, LIKELY_INELIGIBLE, and INELIGIBLE must NEVER enter the queue
  if (job.eligibility_status !== 'ELIGIBLE' && job.eligibility_status !== 'LIKELY_ELIGIBLE') {
    return false;
  }

  // 3. Must have a valid application URL
  if (!job.url || typeof job.url !== 'string' || !job.url.startsWith('http')) {
    return false;
  }

  // 4. Must not be already APPLIED, REJECTED, WITHDRAWN, INTERVIEW, or OFFER
  const cleanUrl = Database.normalizeUrl(job.url).toLowerCase();
  if (cleanUrl && excludedKeys.has(cleanUrl)) {
    return false;
  }

  const compRoleSig = `${(job.company || '').toLowerCase().trim()}|${(job.title || '').toLowerCase().trim()}`;
  if (excludedKeys.has(compRoleSig)) {
    return false;
  }

  // 5. Must pass candidate target role relevance
  if (!isRelevant(job)) {
    return false;
  }

  return true;
}

/**
 * Get category distribution counts for a queue
 */
function getQueueCategoryDistribution(queue = []) {
  const dist = {
    'AI/ML': 0,
    'Software/Backend': 0,
    'Data/Data Analytics': 0,
    'Cloud/DevOps/Automation': 0,
    'Other technical': 0,
  };
  queue.forEach(j => {
    const cat = j.roleCategory || 'Other technical';
    if (dist[cat] !== undefined) {
      dist[cat]++;
    } else {
      dist['Other technical']++;
    }
  });
  return dist;
}

/**
 * Normalize arbitrary category names or text strings to canonical ROLE_CATEGORIES
 */
function normalizeCategoryName(cat) {
  if (!cat) return ROLE_CATEGORIES.OTHER_TECHNICAL;
  const s = String(cat).toLowerCase().trim();
  if (s.includes('ai') || s.includes('ml') || s.includes('machine learning')) return ROLE_CATEGORIES.AIML;
  if (s.includes('software') || s.includes('backend') || s.includes('swe') || s.includes('web') || s.includes('developer')) return ROLE_CATEGORIES.SOFTWARE_BACKEND;
  if (s.includes('data')) return ROLE_CATEGORIES.DATA_ANALYTICS;
  if (s.includes('cloud') || s.includes('devops') || s.includes('automation') || s.includes('sre')) return ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION;
  if (s.includes('exclude')) return ROLE_CATEGORIES.EXCLUDED;
  return ROLE_CATEGORIES.OTHER_TECHNICAL;
}

/**
 * Determine canonical category for a job candidate
 */
function getCandidateCategory(job) {
  if (!job) return ROLE_CATEGORIES.OTHER_TECHNICAL;
  if (job.roleCategory && Object.values(ROLE_CATEGORIES).includes(job.roleCategory)) {
    return job.roleCategory;
  }
  const rel = calculateCareerRoleRelevance(job);
  return rel.category;
}

/**
 * Pre-evaluation candidate quality score for intra-category ranking (0–100+ composite).
 * Prioritizes:
 * 1. rolePriority & career-role relevance (30%)
 * 2. Geographic preference (India > Remote > Global) (25%)
 * 3. Internship over full-time (20%)
 * 4. Freshness (10%)
 * 5. Tier-1 company quality (10%)
 * 6. Eligibility confidence (5%)
 */
function calculatePreEvalCandidateScore(job) {
  if (!job) return 0;

  // 1. Role relevance & rolePriority
  const rel = calculateCareerRoleRelevance(job);
  const roleScore = rel.score || 70;
  const rolePrio = typeof job.rolePriority === 'number' ? job.rolePriority : 0;
  const roleFactor = Math.min(100, Math.round(roleScore * 0.7 + rolePrio * 0.6));

  // 2. Geographic preference: India (100) -> Remote (85) -> Global Tier-1 (65)
  let geoScore = 60;
  const loc = (job.location || '').toLowerCase();
  if (isIndia(loc)) {
    geoScore = 100;
  } else if (isRemote(loc) || loc.includes('remote') || loc.includes('wfh')) {
    geoScore = 85;
  } else if (isReputableCompany(job.company)) {
    geoScore = 70;
  }

  // 3. Internship over full-time
  const isIntern = job.type === 'internship' ||
    /\b(?:intern|internship|co-?op|trainee)\b/i.test(job.title || '') ||
    /\b(?:intern|internship|co-?op)\b/i.test(loc);
  const typeScore = isIntern ? 100 : 60;

  // 4. Freshness
  let freshnessScore = 70;
  const postedAt = (job.postedAt || '').toLowerCase().trim();
  if (postedAt) {
    if (
      postedAt.includes('today') ||
      postedAt.includes('just now') ||
      postedAt.includes('minute') ||
      postedAt.includes('hour') ||
      postedAt.includes('< 24h') ||
      postedAt === '1d' ||
      postedAt === '1 day ago' ||
      postedAt === 'yesterday'
    ) {
      freshnessScore = 100;
    } else if (
      postedAt.includes('2 day') ||
      postedAt.includes('3 day') ||
      postedAt.includes('4 day') ||
      postedAt.includes('5 day') ||
      postedAt === '2d' ||
      postedAt === '3d'
    ) {
      freshnessScore = 85;
    } else if (
      postedAt.includes('6 day') ||
      postedAt.includes('week') ||
      postedAt.includes('7 day') ||
      postedAt.includes('10 day')
    ) {
      freshnessScore = 65;
    } else if (
      postedAt.includes('2 week') ||
      postedAt.includes('14 day')
    ) {
      freshnessScore = 45;
    } else if (
      postedAt.includes('month') ||
      postedAt.includes('30 day')
    ) {
      freshnessScore = 25;
    } else {
      try {
        const d = new Date(postedAt);
        if (!isNaN(d.getTime())) {
          const diffDays = Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
          if (diffDays <= 1) freshnessScore = 100;
          else if (diffDays <= 4) freshnessScore = 85;
          else if (diffDays <= 10) freshnessScore = 65;
          else if (diffDays <= 20) freshnessScore = 45;
          else freshnessScore = 25;
        }
      } catch {
        freshnessScore = 70;
      }
    }
  }

  // 5. Tier-1 Company Quality
  const tier1Score = isReputableCompany(job.company) ? 100 : 60;

  // 6. Eligibility confidence boost
  const eligScore = job.eligibility_status === ELIGIBILITY_STATUSES.ELIGIBLE ? 100 : 85;

  const composite = (
    roleFactor * 0.30 +
    geoScore * 0.25 +
    typeScore * 0.20 +
    freshnessScore * 0.10 +
    tier1Score * 0.10 +
    eligScore * 0.05
  );

  return Math.round(composite);
}

/**
 * Compare two candidates within or across categories before evaluation
 */
function comparePreEvalCandidates(a, b) {
  const scoreDiff = calculatePreEvalCandidateScore(b) - calculatePreEvalCandidateScore(a);
  if (scoreDiff !== 0) return scoreDiff;
  return (a.title || '').localeCompare(b.title || '');
}

/**
 * Check if a candidate passes all pre-Gemini gates:
 * 1. Role relevance (CS role & not non-technical exclude)
 * 2. Geography filter
 * 3. International eligibility gate (strictly ELIGIBLE or LIKELY_ELIGIBLE)
 * 4. Application status (not already applied/rejected/withdrawn)
 */
function isEvaluationPoolEligible(job, options = {}) {
  if (!job || typeof job !== 'object') return false;
  if (!job.title || !job.url) return false;
  if (typeof job.url !== 'string' || !job.url.startsWith('http')) return false;

  // 1. Role relevance & CS check
  const rel = calculateCareerRoleRelevance(job);
  if (rel.category === ROLE_CATEGORIES.EXCLUDED || rel.score < 40) {
    return false;
  }
  if (typeof isRelevant === 'function' && !isRelevant(job)) {
    return false;
  }

  // 2. Geo filter check (if location is provided, enforce passesGeoFilter)
  if (job.location) {
    if (typeof passesGeoFilter === 'function' && !passesGeoFilter(job)) {
      return false;
    }
  }

  // 3. International eligibility gate (strictly ELIGIBLE or LIKELY_ELIGIBLE)
  // Zero UNCLEAR, LIKELY_INELIGIBLE, or INELIGIBLE
  if (job.eligibility_status) {
    if (
      job.eligibility_status !== ELIGIBILITY_STATUSES.ELIGIBLE &&
      job.eligibility_status !== ELIGIBILITY_STATUSES.LIKELY_ELIGIBLE
    ) {
      return false;
    }
  } else if (typeof isAlertEligible === 'function' && !isAlertEligible(job)) {
    return false;
  }

  // 4. Exclude already applied/rejected/withdrawn if applications or excludedKeys provided
  const excludedKeys = options.excludedKeys || (options.applications ? getExcludedApplicationKeys(options.applications) : null);
  if (excludedKeys && excludedKeys.size > 0) {
    const cleanUrl = Database.normalizeUrl(job.url).toLowerCase();
    if (cleanUrl && excludedKeys.has(cleanUrl)) return false;
    const compRoleSig = `${(job.company || '').toLowerCase().trim()}|${(job.title || '').toLowerCase().trim()}`;
    if (compRoleSig && excludedKeys.has(compRoleSig)) return false;
  }

  return true;
}

/**
 * Select a category-aware candidate evaluation pool (capped at maxTotal, default 50).
 *
 * Suggested Allocations:
 *   AI/ML: up to 25
 *   Software/Backend: up to 10
 *   Data/Data Analytics: up to 10
 *   Cloud/DevOps/Automation: up to 5
 *
 * Rules:
 *   1. Allocations are maximum targets, not mandatory quotas.
 *   2. Unused slots from under-filled categories are redistributed to other categories.
 *   3. If a category exceeds its target, the highest-quality candidates in that category are selected.
 *   4. Poor quality / ineligible candidates are NEVER added just to fill a category.
 *   5. All candidates must pass pre-Gemini filters (role relevance, geography, international eligibility).
 *   6. Candidate pool size never exceeds maxTotal.
 *   7. Intra-category ranking prioritizes:
 *      - rolePriority / relevance
 *      - geographic preference (India first, then global remote)
 *      - internship over full-time
 *      - freshness
 *      - tier-1 company quality
 */
function selectEvaluationPool(candidates = [], options = {}) {
  const maxTotal = options.maxTotal || 50;
  const shouldLog = options.log !== false;

  const categoryLimits = {
    [ROLE_CATEGORIES.AIML]: DEFAULT_CATEGORY_LIMITS[ROLE_CATEGORIES.AIML],
    [ROLE_CATEGORIES.SOFTWARE_BACKEND]: DEFAULT_CATEGORY_LIMITS[ROLE_CATEGORIES.SOFTWARE_BACKEND],
    [ROLE_CATEGORIES.DATA_ANALYTICS]: DEFAULT_CATEGORY_LIMITS[ROLE_CATEGORIES.DATA_ANALYTICS],
    [ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION]: DEFAULT_CATEGORY_LIMITS[ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION],
  };

  if (options.limits) {
    for (const [key, val] of Object.entries(options.limits)) {
      const normalizedKey = normalizeCategoryName(key);
      if (normalizedKey && categoryLimits[normalizedKey] !== undefined) {
        categoryLimits[normalizedKey] = val;
      }
    }
  }

  // Filter and deduplicate candidates by canonical URL
  const seenUrls = new Set();
  const eligible = [];

  for (const job of candidates) {
    if (!isEvaluationPoolEligible(job, options)) continue;

    const cleanUrl = job.url ? Database.normalizeUrl(job.url).toLowerCase() : null;
    if (cleanUrl) {
      if (seenUrls.has(cleanUrl)) continue;
      seenUrls.add(cleanUrl);
    }

    const rel = calculateCareerRoleRelevance(job);
    const cat = getCandidateCategory(job);
    const preScore = calculatePreEvalCandidateScore(job);

    eligible.push({
      ...job,
      roleCategory: cat,
      roleRelevanceScore: rel.score,
      roleRelevanceReason: rel.reason,
      _preEvalScore: preScore,
    });
  }

  // Group candidates into categories
  const poolByCategory = {
    [ROLE_CATEGORIES.AIML]: [],
    [ROLE_CATEGORIES.SOFTWARE_BACKEND]: [],
    [ROLE_CATEGORIES.DATA_ANALYTICS]: [],
    [ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION]: [],
    [ROLE_CATEGORIES.OTHER_TECHNICAL]: [],
  };

  for (const job of eligible) {
    const cat = poolByCategory[job.roleCategory] ? job.roleCategory : ROLE_CATEGORIES.OTHER_TECHNICAL;
    poolByCategory[cat].push(job);
  }

  // Sort within each category by pre-evaluation quality score
  for (const cat of Object.keys(poolByCategory)) {
    poolByCategory[cat].sort(comparePreEvalCandidates);
  }

  const preSelectionDist = {
    [ROLE_CATEGORIES.AIML]: poolByCategory[ROLE_CATEGORIES.AIML].length,
    [ROLE_CATEGORIES.SOFTWARE_BACKEND]: poolByCategory[ROLE_CATEGORIES.SOFTWARE_BACKEND].length,
    [ROLE_CATEGORIES.DATA_ANALYTICS]: poolByCategory[ROLE_CATEGORIES.DATA_ANALYTICS].length,
    [ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION]: poolByCategory[ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION].length,
    [ROLE_CATEGORIES.OTHER_TECHNICAL]: poolByCategory[ROLE_CATEGORIES.OTHER_TECHNICAL].length,
  };

  // Pass 1: Target allocation per category
  const selected = [];
  const selectedUrls = new Set();
  const selectedByCategory = {
    [ROLE_CATEGORIES.AIML]: 0,
    [ROLE_CATEGORIES.SOFTWARE_BACKEND]: 0,
    [ROLE_CATEGORIES.DATA_ANALYTICS]: 0,
    [ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION]: 0,
    [ROLE_CATEGORIES.OTHER_TECHNICAL]: 0,
  };

  const primaryCategories = [
    ROLE_CATEGORIES.AIML,
    ROLE_CATEGORIES.SOFTWARE_BACKEND,
    ROLE_CATEGORIES.DATA_ANALYTICS,
    ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION,
  ];

  for (const cat of primaryCategories) {
    const limit = categoryLimits[cat] != null ? categoryLimits[cat] : 0;
    const catJobs = poolByCategory[cat];
    const takeCount = Math.min(limit, catJobs.length);
    for (let i = 0; i < takeCount; i++) {
      if (selected.length >= maxTotal) break;
      const job = catJobs[i];
      selected.push(job);
      selectedUrls.add(job.url);
      selectedByCategory[cat]++;
    }
  }

  // Pass 2: Redistribution of unused slots to fill up to maxTotal
  const remainingSlots = maxTotal - selected.length;
  if (remainingSlots > 0) {
    const leftovers = [];
    for (const cat of Object.keys(poolByCategory)) {
      for (const job of poolByCategory[cat]) {
        if (!selectedUrls.has(job.url)) {
          leftovers.push(job);
        }
      }
    }

    leftovers.sort(comparePreEvalCandidates);

    const toTake = Math.min(remainingSlots, leftovers.length);
    for (let i = 0; i < toTake; i++) {
      const job = leftovers[i];
      selected.push(job);
      selectedUrls.add(job.url);
      const cat = selectedByCategory[job.roleCategory] !== undefined
        ? job.roleCategory
        : ROLE_CATEGORIES.OTHER_TECHNICAL;
      selectedByCategory[cat]++;
    }
  }

  // Clean internal _preEvalScore before returning
  const result = selected.map(j => {
    const copy = { ...j };
    delete copy._preEvalScore;
    return copy;
  });

  if (shouldLog) {
    console.log('\n' + '─'.repeat(60));
    console.log(`📊 CANDIDATE EVALUATION POOL SELECTION (Max: ${maxTotal})`);
    console.log('  Eligible Candidates by Category BEFORE Gemini:');
    console.log(`    • 🧠 ${ROLE_CATEGORIES.AIML}: ${preSelectionDist[ROLE_CATEGORIES.AIML]}`);
    console.log(`    • 💻 ${ROLE_CATEGORIES.SOFTWARE_BACKEND}: ${preSelectionDist[ROLE_CATEGORIES.SOFTWARE_BACKEND]}`);
    console.log(`    • 📈 ${ROLE_CATEGORIES.DATA_ANALYTICS}: ${preSelectionDist[ROLE_CATEGORIES.DATA_ANALYTICS]}`);
    console.log(`    • ☁️ ${ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION}: ${preSelectionDist[ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION]}`);
    console.log(`    • ⚙️ ${ROLE_CATEGORIES.OTHER_TECHNICAL}: ${preSelectionDist[ROLE_CATEGORIES.OTHER_TECHNICAL]}`);
    console.log(`    Total Eligible Candidate Pool: ${eligible.length}`);
    console.log('\n  Selected for Gemini Evaluation:');
    console.log(`    • 🧠 ${ROLE_CATEGORIES.AIML}: ${selectedByCategory[ROLE_CATEGORIES.AIML]} (target up to ${categoryLimits[ROLE_CATEGORIES.AIML]})`);
    console.log(`    • 💻 ${ROLE_CATEGORIES.SOFTWARE_BACKEND}: ${selectedByCategory[ROLE_CATEGORIES.SOFTWARE_BACKEND]} (target up to ${categoryLimits[ROLE_CATEGORIES.SOFTWARE_BACKEND]})`);
    console.log(`    • 📈 ${ROLE_CATEGORIES.DATA_ANALYTICS}: ${selectedByCategory[ROLE_CATEGORIES.DATA_ANALYTICS]} (target up to ${categoryLimits[ROLE_CATEGORIES.DATA_ANALYTICS]})`);
    console.log(`    • ☁️ ${ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION}: ${selectedByCategory[ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION]} (target up to ${categoryLimits[ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION]})`);
    if (selectedByCategory[ROLE_CATEGORIES.OTHER_TECHNICAL] > 0) {
      console.log(`    • ⚙️ ${ROLE_CATEGORIES.OTHER_TECHNICAL}: ${selectedByCategory[ROLE_CATEGORIES.OTHER_TECHNICAL]} (redistributed)`);
    }
    console.log(`  Total Sent to Gemini Evaluation: ${result.length} (Max: ${maxTotal})`);
    console.log('─'.repeat(60) + '\n');
  }

  return result;
}

/**
 * Build the Daily Top-20 Application Queue
 *
 * @param {Array} jobs - All evaluated jobs
 * @param {Object|Array} options - Options or existing applications array
 * @returns {Array} Queued jobs up to 20 with priority scores, role categories, and tier rankings
 */
function buildTop20Queue(jobs = [], options = {}) {
  const applications = Array.isArray(options) ? options : (options.applications || []);
  const excludedKeys = getExcludedApplicationKeys(applications);

  // Filter queue candidates
  const eligibleCandidates = jobs.filter(j => isQueueEligible(j, excludedKeys));

  // Score candidates with Application Priority Score and enrich with role category
  const scored = eligibleCandidates.map(j => {
    const roleEval = calculateCareerRoleRelevance(j);
    const priorityScore = calculateApplicationPriorityScore(j);
    return {
      ...j,
      roleCategory: roleEval.category,
      roleRelevanceScore: roleEval.score,
      roleRelevanceReason: roleEval.reason,
      applicationPriorityScore: priorityScore,
    };
  });

  // Sort candidates:
  // 1. applicationPriorityScore descending
  // 2. matchScore descending
  // 3. Internship over fulltime
  scored.sort((a, b) => {
    const prioDiff = (b.applicationPriorityScore || 0) - (a.applicationPriorityScore || 0);
    if (prioDiff !== 0) return prioDiff;

    const matchDiff = (b.matchScore || 0) - (a.matchScore || 0);
    if (matchDiff !== 0) return matchDiff;

    const typeDiff = (a.type === 'internship' ? 0 : 1) - (b.type === 'internship' ? 0 : 1);
    if (typeDiff !== 0) return typeDiff;

    return 0;
  });

  // Deduplicate:
  // - Unique clean canonical URL
  // - Same company + exact same role signature
  // - MAX_ROLES_PER_COMPANY = 3 (multiple distinct roles from same company can coexist)
  const queue = [];
  const companyCounts = new Map();
  const seenUrls = new Set();
  const seenCompRolePairs = new Set();

  for (const job of scored) {
    const cleanUrl = Database.normalizeUrl(job.url).toLowerCase();
    if (cleanUrl && seenUrls.has(cleanUrl)) continue;

    const compKey = (job.company || '').toLowerCase().trim();
    const roleKey = (job.title || '').toLowerCase().trim();
    const compRoleSig = `${compKey}|${roleKey}`;
    if (compRoleSig && seenCompRolePairs.has(compRoleSig)) continue;

    const currentCount = companyCounts.get(compKey) || 0;
    if (compKey && currentCount >= MAX_ROLES_PER_COMPANY) continue;

    if (cleanUrl) seenUrls.add(cleanUrl);
    if (compRoleSig) seenCompRolePairs.add(compRoleSig);
    if (compKey) companyCounts.set(compKey, currentCount + 1);

    queue.push(job);
    if (queue.length >= MAX_QUEUE_SIZE) break;
  }

  // Assign queue ranks & tiers
  queue.forEach((job, index) => {
    job.queueRank = index + 1;
    job.queueTier = (index < 5) ? 'PRIORITY' : (index < 15) ? 'NEXT' : 'BACKUP';
  });

  return queue;
}

/**
 * Split queue into the three canonical priority tiers:
 * - 🔥 PRIORITY: Ranks 1–5
 * - 🟢 NEXT: Ranks 6–15
 * - 🟡 BACKUP: Ranks 16–20
 */
function tierQueue(queue = []) {
  return {
    priority: queue.filter(j => j.queueTier === 'PRIORITY'),
    next: queue.filter(j => j.queueTier === 'NEXT'),
    backup: queue.filter(j => j.queueTier === 'BACKUP'),
  };
}

/**
 * Generate comprehensive Top 20 Application Queue Markdown
 */
function renderQueueMarkdown(queue = [], options = {}) {
  const today = new Date().toISOString().split('T')[0];
  const { priority, next, backup } = tierQueue(queue);
  const dist = getQueueCategoryDistribution(queue);

  const lines = [
    `# 🎯 Today's Top 20 Application Queue (${today})`,
    '',
    `> **Candidate:** NMAMIT B.Tech CSE (Batch of 2028) | **Target:** AI/ML, Software, Data & Cloud Internships`,
    `> **Today's recommended minimum:** Apply to the **5 Priority jobs** (Ranks 1–5) below. The remaining 15 are optional next/backup opportunities.`,
    `> *Screening Disclaimer: International work authorization and visa eligibility classifications are automated heuristic indicators for discovery and triage purposes only, not legal or immigration advice.*`,
    '',
    '[← Back to README](README.md) | [Application Tracker](APPLICATIONS.md)',
    '',
    '## 📊 Queue Summary',
    '',
    `| Priority Tier | Rank Range | Count | Action Recommendation |`,
    `|---|---|---|---|`,
    `| 🔥 **PRIORITY** | #1 – #5 | ${priority.length} / 5 | **Apply First (Today's Minimum Target)** |`,
    `| 🟢 **NEXT** | #6 – #15 | ${next.length} / 10 | Apply After Priority |`,
    `| 🟡 **BACKUP** | #16 – #20 | ${backup.length} / 5 | Additional Opportunities |`,
    `| **Total Queued** | #1 – #${queue.length} | **${queue.length}** | |`,
    '',
    '### 📈 Role Category Distribution',
    `- **AI/ML:** ${dist['AI/ML'] || 0}`,
    `- **Software/Backend:** ${dist['Software/Backend'] || 0}`,
    `- **Data/Data Analytics:** ${dist['Data/Data Analytics'] || 0}`,
    `- **Cloud/DevOps/Automation:** ${dist['Cloud/DevOps/Automation'] || 0}`,
    `- **Other technical:** ${dist['Other technical'] || 0}`,
    '',
    '---',
    '',
  ];

  function renderTierSection(title, emoji, description, jobs) {
    lines.push(`## ${emoji} ${title}`);
    lines.push(`*${description}*`);
    lines.push('');

    if (jobs.length === 0) {
      lines.push('*No opportunities currently queued in this tier.*');
      lines.push('');
      return;
    }

    // High-level table
    lines.push('| # | Company | Role | Category | Match | Priority | Eligibility | Location | Source | Apply |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');

    jobs.forEach(j => {
      const matchText = j.matchScore != null ? `${j.matchScore}%` : '—';
      const prioText = j.applicationPriorityScore != null ? `**${j.applicationPriorityScore}**` : '—';
      const eligBadge = j.eligibility_status === 'ELIGIBLE' ? '🟢 Eligible' : '🟢 Likely';
      const link = j.url ? `[Apply Now →](${j.url})` : '—';
      const loc = j.location || 'India / Remote';
      const cat = j.roleCategory || 'AI/ML';

      lines.push(
        `| **#${j.queueRank}** | **${j.company}** | ${j.title} | ${cat} | ${matchText} | ${prioText} | ${eligBadge} | ${loc} | ${j.source} | ${link} |`
      );
    });

    lines.push('');

    // Detailed cards for each job
    jobs.forEach(j => {
      const matchText = j.matchScore != null ? `${j.matchScore}%` : '—';
      const prioText = j.applicationPriorityScore != null ? `${j.applicationPriorityScore}` : '—';
      const eligBadge = j.eligibility_status === 'ELIGIBLE' ? '🟢 Eligible' : '🟢 Likely Eligible';
      const cat = j.roleCategory || 'AI/ML';
      const whyRec = j.roleRelevanceReason || (j.aiReason || 'Strong skill and curriculum fit for B.Tech CSE candidate');
      const posted = j.postedAt || 'Recently posted / Active';

      lines.push(`### #${j.queueRank} ${j.title} @ ${j.company}`);
      lines.push(`- **Company:** ${j.company}`);
      lines.push(`- **Role Category:** ${cat}`);
      lines.push(`- **Match Score:** ${matchText}`);
      lines.push(`- **Application Priority:** ${prioText}`);
      lines.push(`- **Eligibility:** ${eligBadge}`);
      lines.push(`- **Location:** ${j.location || 'India / Remote'}`);
      lines.push(`- **Source:** ${j.source}`);
      lines.push(`- **Posted:** ${posted}`);
      lines.push(`- **Why this is recommended:** ${whyRec}`);
      lines.push(`- **Apply:** [${j.url}](${j.url})`);
      lines.push(`- **Log Command:** \`npm run track -- add "${j.company.replace(/"/g, '')}" "${j.title.replace(/"/g, '')}" "${today}" "Applied" "Top-20 Queue #${j.queueRank}" "${j.url}"\``);
      lines.push('');
    });
  }

  renderTierSection('PRIORITY — APPLY FIRST', '🔥', "Today's recommended minimum target (Ranks 1–5)", priority);
  renderTierSection('NEXT — APPLY AFTER PRIORITY', '🟢', 'High-quality opportunities to apply to after priority roles (Ranks 6–15)', next);
  renderTierSection('BACKUP — OPPORTUNITIES TO CONSIDER', '🟡', 'Worthwhile opportunities for pipeline depth (Ranks 16–20)', backup);

  lines.push('---');
  lines.push('### 💡 How to Track These Applications:');
  lines.push('```bash');
  if (priority.length > 0) {
    const topJob = priority[0];
    lines.push(`npm run track -- add "${topJob.company.replace(/"/g, '')}" "${topJob.title.replace(/"/g, '')}" "${today}" "Applied" "Top-20 Queue #1" "${topJob.url}"`);
  } else {
    lines.push('npm run track -- add "Company" "Role" "2026-10-08" "Applied" "From Top-20 Queue" "URL"');
  }
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

/**
 * Format compact Top-5 Push Notification for Telegram
 */
function formatQueueSummaryTelegram(queue = []) {
  const { priority } = tierQueue(queue);
  if (priority.length === 0) return '';

  const nextCount = queue.filter(j => j.queueTier === 'NEXT').length;
  const backupCount = queue.filter(j => j.queueTier === 'BACKUP').length;

  const header = `🎯 *TODAY'S TOP 5 TO APPLY FIRST*\n_Today's recommended minimum: apply to these 5 Priority jobs\\._\n`;
  const items = priority.map((j) => {
    const title = (j.title || '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
    const comp = (j.company || '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
    const cat = (j.roleCategory || 'AI/ML').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
    const loc = (j.location || 'India/Remote').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
    const match = j.matchScore != null ? `${j.matchScore}%` : '70%';
    const prio = j.applicationPriorityScore != null ? j.applicationPriorityScore : '80';
    const link = j.url ? `[Apply Now](${j.url.replace(/\(/g, '%28').replace(/\)/g, '%29')})` : 'Link';
    return `🔥 *\\#${j.queueRank} ${title}* @ *${comp}*\n   _Category: ${cat} \\| Match: ${match} \\| Priority: ${prio}_\n   _📍 ${loc}_\n   🔗 ${link}`;
  }).join('\n\n');

  const footer = `\n\n🟢 *NEXT 10*: ${nextCount} opportunities\n🟡 *BACKUP 5*: ${backupCount} opportunities\n_Full details and tracker in \`TOP20.md\`_`;
  return header + '\n' + items + footer;
}

/**
 * Format compact Discord Embed for Top-20 Queue
 */
function formatQueueSummaryDiscord(queue = []) {
  const { priority, next, backup } = tierQueue(queue);
  const dist = getQueueCategoryDistribution(queue);

  const fields = [];

  if (priority.length > 0) {
    const pText = priority.map(j =>
      `🔥 **#${j.queueRank} [${j.title}](${j.url})** @ **${j.company}**\n` +
      `   • Category: **${j.roleCategory || 'AI/ML'}** | Match: **${j.matchScore}%** | Priority: **${j.applicationPriorityScore}**\n` +
      `   • Location: ${j.location || 'India / Remote'}`
    ).join('\n\n');
    fields.push({
      name: '🔥 TOP 5 TO APPLY TODAY (Today\'s Recommended Minimum Target)',
      value: pText.slice(0, 1024),
      inline: false,
    });
  }

  fields.push({
    name: '📋 Additional Queue Tiers',
    value: `🟢 **NEXT 10 (Apply After Priority):** ${next.length} opportunities\n🟡 **BACKUP 5 (Pipeline Depth):** ${backup.length} opportunities\n*Full details in \`TOP20.md\`*`,
    inline: false,
  });

  fields.push({
    name: '📊 Role Category Distribution',
    value: `🧠 AI/ML: ${dist['AI/ML'] || 0} | 💻 Software/Backend: ${dist['Software/Backend'] || 0} | 📈 Data/Analytics: ${dist['Data/Data Analytics'] || 0} | ☁️ Cloud/DevOps: ${dist['Cloud/DevOps/Automation'] || 0} | ⚙️ Other: ${dist['Other technical'] || 0}`,
    inline: false,
  });

  return {
    title: "🎯 Today's Top 20 Application Queue",
    description: "🎯 **Today's Recommended Minimum:** Apply to the **5 Priority jobs** below. The remaining 15 are next and backup opportunities.",
    color: 0xe67e22, // Orange for Action Queue
    fields,
    footer: {
      text: "Candidate: NMAMIT B.Tech CSE (Batch of 2028) | Top 20 Application Queue",
    },
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  MIN_QUEUE_MATCH_SCORE,
  MAX_QUEUE_SIZE,
  MAX_ROLES_PER_COMPANY,
  EXCLUDED_STATUSES,
  ROLE_CATEGORIES,
  DEFAULT_CATEGORY_LIMITS,
  calculateCareerRoleRelevance,
  calculateApplicationPriorityScore,
  calculatePreEvalCandidateScore,
  getExcludedApplicationKeys,
  isQueueEligible,
  isEvaluationPoolEligible,
  getQueueCategoryDistribution,
  selectEvaluationPool,
  buildTop20Queue,
  tierQueue,
  renderQueueMarkdown,
  formatQueueSummaryTelegram,
  formatQueueSummaryDiscord,
};
