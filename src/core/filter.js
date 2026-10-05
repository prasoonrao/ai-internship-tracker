'use strict';

// ─── Primary Role Keywords (AI / ML / Data Science / GenAI) ─────────────────
const AI_ML_KEYWORDS = [
  'ai/ml', 'ai engineer', 'ml engineer', 'machine learning', 'artificial intelligence',
  'genai', 'gen ai', 'generative ai', 'llm', 'large language model',
  'data scientist', 'data science', 'deep learning', 'nlp', 'natural language',
  'computer vision', 'applied ai', 'applied ml', 'ai research', 'ml research',
  'ai intern', 'ml intern', 'genai intern', 'data science intern',
  'data analyst', 'data engineering', 'data engineer',
  'prompt engineer', 'model evaluation', 'fine-tuning',
];

// ─── Secondary Role Keywords (SWE / Backend / General Engineering) ──────────
const SWE_KEYWORDS = [
  'software engineer', 'software developer', 'software development',
  'sde', 'swe', 'backend engineer', 'backend developer', 'back-end',
  'full stack', 'fullstack', 'full-stack',
  'systems engineer', 'systems developer', 'platform engineer',
  'cloud engineer', 'infrastructure engineer',
  'python developer', 'python engineer', 'java developer', 'java engineer',
  'api developer', 'distributed systems', 'devops engineer', 'sre',
  'security engineer', 'qa engineer', 'automation engineer',
];

// ─── General Internship / Fresher Indicators ─────────────────────────────────
const INTERN_KEYWORDS = [
  'intern', 'internship', 'trainee', 'fresher', 'new grad', 'entry level',
  'junior developer', 'junior engineer', 'associate engineer', 'graduate engineer',
  'co-op', 'summer 2026', 'summer 2027', 'summer 2028', 'student',
];

// ─── Complete Allowlist (Title match only) ───────────────────────────────────
const ALLOW_KEYWORDS = [
  ...AI_ML_KEYWORDS,
  ...SWE_KEYWORDS,
  ...INTERN_KEYWORDS,
  'computer science', 'c++ developer', 'golang developer',
];

// ─── Explicit Blocklist (Title match only) ───────────────────────────────────
const BLOCK_KEYWORDS = [
  'sales executive', 'sales manager', 'sales representative', 'sales associate',
  'business development', 'marketing manager', 'digital marketing', 'growth marketing',
  'financial analyst', 'accountant', 'hr executive', 'human resources', 'talent acquisition',
  'recruiter', 'legal counsel', 'operations manager', 'product manager', 'project manager',
  'content writer', 'copywriter', 'graphic designer', 'ui/ux designer', 'visual designer',
  'customer success', 'customer support', 'help desk', 'technical support specialist',
  'mechanical engineer', 'civil engineer', 'electrical engineer', 'chemical engineer',
  'hardware engineer', 'supply chain', 'logistics coordinator', 'office assistant',
  'security guard', 'receptionist', 'telecaller', 'call center',
];

// ─── Experience / Seniority Killers (Full text match) ───────────────────────
const OVER_EXPERIENCED = [
  '10+ years', '10 years experience', '9+ years', '8+ years',
  '7+ years', '6+ years', '5+ years', '5 years of experience',
  '6 years of experience', '7 years of experience',
  'minimum 5 years', 'at least 5 years', '4+ years', '3+ years',
  'lead software engineer', 'principal engineer', 'staff engineer',
  'engineering manager', 'director of engineering', 'vp of engineering',
  'head of engineering', 'chief technology officer',
];

/**
 * Check if job passes candidate's CS / Tech criteria
 */
function isRelevant(job) {
  const titleOnly = (job.title || '').toLowerCase().trim();
  const fullText = `${job.title || ''} ${job.description || ''}`.toLowerCase();

  // 1. Must match at least one CS/Tech keyword
  const hasCS = ALLOW_KEYWORDS.some(kw => titleOnly.includes(kw));
  if (!hasCS) return false;

  // 2. Must not match blocked titles
  const isBlocked = BLOCK_KEYWORDS.some(kw => titleOnly.includes(kw));
  if (isBlocked) return false;

  // 3. Exclude senior-level roles
  const isInternTitle = titleOnly.includes('intern') || titleOnly.includes('trainee') || titleOnly.includes('co-op') || titleOnly.includes('student');
  if (!isInternTitle) {
    // Block senior title indicators
    const SENIOR_TITLE_WORDS = ['senior', 'sr', 'sr.', 'staff', 'principal', 'lead', 'architect', 'director', 'vp', 'manager'];
    const hasSeniorWord = SENIOR_TITLE_WORDS.some(w => {
      const regex = new RegExp(`\\b${w}\\b`, 'i');
      return regex.test(titleOnly);
    });
    if (hasSeniorWord) return false;

    const isTooSenior = OVER_EXPERIENCED.some(kw => fullText.includes(kw) || titleOnly.includes(kw));
    if (isTooSenior) return false;
  } else {
    // For interns, only block if the title itself implies senior role
    const titleSenior = ['lead', 'principal', 'staff', 'manager', 'director'].some(w => {
      const regex = new RegExp(`\\b${w}\\b`, 'i');
      return regex.test(titleOnly);
    });
    if (titleSenior) return false;
  }

  return true;
}

/**
 * Classify job into primary candidate focus categories
 */
function categorizeJob(job) {
  const title = (job.title || '').toLowerCase();
  const desc = (job.description || '').toLowerCase();

  const isAIML = AI_ML_KEYWORDS.some(kw => title.includes(kw) || desc.includes(kw));
  if (isAIML) return 'AI / ML & Data Science';

  const isSWE = SWE_KEYWORDS.some(kw => title.includes(kw));
  if (isSWE) return 'Software & Backend Engineering';

  return 'Other CS Opportunities';
}

/**
 * Priority score for sorting listings (higher = more relevant to candidate)
 * AI/ML roles (Primary): +40
 * SWE/Backend roles (Secondary): +20
 * Internship type: +15
 * 2026/2027/2028 batch specific: +10
 */
function getRolePriority(job) {
  let score = 0;
  const title = (job.title || '').toLowerCase();
  const desc = (job.description || '').toLowerCase();
  const text = `${title} ${desc}`;

  // Primary: AI/ML
  if (AI_ML_KEYWORDS.some(kw => title.includes(kw))) {
    score += 40;
  } else if (AI_ML_KEYWORDS.some(kw => desc.includes(kw))) {
    score += 20;
  }

  // Secondary: SWE / Backend
  if (SWE_KEYWORDS.some(kw => title.includes(kw))) {
    score += 20;
  }

  // Internship fit
  if (job.type === 'internship' || title.includes('intern') || title.includes('co-op')) {
    score += 15;
  }

  // Batch alignment: 2026, 2027, 2028
  if (text.includes('2028') || text.includes('2027') || text.includes('2026')) {
    score += 10;
  }

  return score;
}

/**
 * Detect job type from title/description
 */
function detectJobType(job) {
  const text = `${job.title || ''} ${job.description || ''}`.toLowerCase();
  if (text.includes('intern') || text.includes('internship') || text.includes('trainee') || text.includes('co-op')) {
    return 'internship';
  }
  if (text.includes('contract') || text.includes('freelance') || text.includes('part-time')) {
    return 'contract';
  }
  return 'fulltime';
}

const { screenEligibility } = require('./eligibilityFilter');

/**
 * Filter and enrich an array of raw jobs
 */
function filterJobs(jobs) {
  return jobs
    .filter(j => j && j.title && j.url)
    .filter(isRelevant)
    .map(job => {
      const type = job.type || detectJobType(job);
      const category = categorizeJob(job);
      const rolePriority = getRolePriority({ ...job, type });
      const eligibility = screenEligibility({ ...job, type, category });
      return {
        ...job,
        type,
        category,
        rolePriority,
        ...eligibility,
      };
    });
}

module.exports = {
  filterJobs,
  isRelevant,
  detectJobType,
  categorizeJob,
  getRolePriority,
  AI_ML_KEYWORDS,
  SWE_KEYWORDS,
};
