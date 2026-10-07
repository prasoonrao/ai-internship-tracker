'use strict';

/**
 * INTERNATIONAL WORK AUTHORIZATION & ELIGIBILITY SCREENING ENGINE
 *
 * DISCLAIMER:
 * This screening system provides automated heuristic classification for internship discovery
 * and informational triage only. It does NOT provide legal advice, immigration counsel, or
 * official determinations of work authorization. Actual legal eligibility depends on international
 * immigration regulations, bilateral treaties, visa programs (e.g., US J-1/F-1, UK Youth Mobility/Tier 5),
 * and individual employer policies.
 */

// ─── Classification Statuses ─────────────────────────────────────────────────
const ELIGIBILITY_STATUSES = {
  ELIGIBLE: 'ELIGIBLE',                     // 🟢 Positive signals: India-based, remote worldwide, or explicitly invites international students
  LIKELY_ELIGIBLE: 'LIKELY_ELIGIBLE',       // 🟢 General remote or India-focused with no restrictive qualifiers
  UNCLEAR: 'UNCLEAR',                       // 🟡 Global on-site (e.g. Tier-1) with no explicit sponsorship or residency requirements stated; review required
  LIKELY_INELIGIBLE: 'LIKELY_INELIGIBLE',   // 🔴 Strong probability of ineligibility (e.g. explicit residency required outside India or no sponsorship on foreign on-site)
  INELIGIBLE: 'INELIGIBLE',                 // 🔴 Definite disqualifiers: citizenship restricted (US only), US-university enrolled only, security clearance
};

// ─── Citizenship / Legal Status Disqualifiers (Regex Patterns) ───────────────
const CITIZENSHIP_PATTERNS = [
  { regex: /\b(?:u\.?s\.?|united states|american)\s+(?:citizens?|nationals?)\s+only\b/i, label: 'US Citizens only' },
  { regex: /\b(?:u\.?s\.?|united states)\s+citizenship\s+(?:is\s+)?required\b/i, label: 'US Citizenship required' },
  { regex: /\bmust\s+be\s+a\s+(?:u\.?s\.?|united states)\s+citizen\b/i, label: 'Must be US Citizen' },
  { regex: /\bcanadian\s+citizens?\s+only\b/i, label: 'Canadian Citizens only' },
  { regex: /\b(?:eu|eea|uk)\s+citizens?\s+only\b/i, label: 'EU/EEA/UK Citizens only' },
  { regex: /\baustralian\s+citizens?\s+only\b/i, label: 'Australian Citizens only' },
  { regex: /\bsecurity\s+clearance\s+(?:required|is\s+required|active)\b/i, label: 'Security Clearance required' },
  { regex: /\b(?:itar|export control)\s+complian(?:ce|t)\b/i, label: 'ITAR compliance / US Person required' },
  { regex: /\bmust\s+be\s+a\s+u\.?s\.?\s+person\b/i, label: 'Must be US Person (ITAR)' },
  { regex: /\blawful\s+permanent\s+residents?\s+only\b/i, label: 'Permanent Residents only' },
];

// ─── Study / University Enrollment Restrictions ──────────────────────────────
const STUDY_LOCATION_PATTERNS = [
  { regex: /\b(?:currently\s+enrolled\s+(?:in|at)|must\s+be\s+studying\s+(?:in|at))\s+(?:a|an)?\s*(?:u\.?s\.?|united states)\s+(?:college|university|institution)\b/i, label: 'Must be enrolled in a US college/university' },
  { regex: /\b(?:currently\s+)?enrolled\s+(?:in|at)\s+(?:a\s+)?(?:u\.?s\.?|united states)\s+(?:university|college)\b/i, label: 'Enrolled in a US university' },
  { regex: /\benrolled\s+in\s+an\s+accredited\s+u\.?s\.?\s+(?:college|university)\b/i, label: 'Must be enrolled in an accredited US university' },
  { regex: /\battending\s+(?:a|an)\s*(?:u\.?s\.?|canadian|uk|european)\s+university\b/i, label: 'Must attend a local university in host country' },
  { regex: /\bmust\s+be\s+studying\s+at\s+a\s+university\s+in\b/i, label: 'Host country university enrollment required' },
  { regex: /\blocal\s+students?\s+only\b/i, label: 'Local students only' },
  { regex: /\bco-?op\s+work\s+permit\b/i, label: 'Domestic Co-op work permit required' },
];

// ─── Work Authorization & No-Sponsorship Patterns ────────────────────────────
const WORK_AUTH_DISQUALIFIERS = [
  { regex: /\b(?:does\s+not|will\s+not|not\s+able\s+to|cannot|unable\s+to)\s+(?:offer|provide|support)?\s*(?:visa\s+)?sponsorship\b/i, label: 'No visa sponsorship available' },
  { regex: /\bvisa\s+sponsorship\s+(?:is\s+)?(?:not\s+available|unavailable|not\s+offered|not\s+provided)\b/i, label: 'Visa sponsorship unavailable' },
  { regex: /\bno\s+(?:visa\s+)?sponsorship\s+(?:available|offered|provided)?\b/i, label: 'No visa sponsorship provided' },
  { regex: /\bwithout\s+(?:the\s+need\s+for\s+)?(?:future\s+)?(?:visa\s+)?sponsorship\b/i, label: 'Must work without sponsorship' },
  { regex: /\bunrestricted\s+work\s+authorization\b/i, label: 'Unrestricted work authorization required' },
  { regex: /\bmust\s+(?:already\s+)?(?:have|possess)\s+(?:the\s+)?(?:legal\s+)?(?:right|authorization)\s+to\s+work\s+in\b/i, label: 'Must possess existing work authorization in host country' },
  { regex: /\bmust\s+(?:already\s+)?be\s+authorized\s+to\s+work\s+in\b/i, label: 'Must be authorized to work in host country' },
  { regex: /\bauthorized\s+to\s+work\s+in\s+the\s+(?:u\.?s\.?|united states|uk|canada)\s+without\s+restriction\b/i, label: 'Authorized to work without restriction' },
  { regex: /\bexisting\s+(?:u\.?s\.?|work)\s+authorization\b/i, label: 'Existing work authorization required' },
];

// ─── Geographic Residency Restrictions on Remote ─────────────────────────────
const RESIDENCY_RESTRICTIONS = [
  { regex: /\b(?:must\s+(?:currently\s+)?reside\s+in|candidates?\s+must\s+reside\s+in|restricted\s+to\s+(?:candidates|applicants|residents)\s+(?:currently\s+)?residing\s+in)\s+(?:the\s+)?(?:u\.?s\.?|united states|canada|uk|europe|north america|serbia|poland|germany|france|australia)/i, label: 'Must reside in foreign host country' },
  { regex: /\b(?:u\.?s\.?|united states|canada|uk|europe)\s+residents?\s+only\b/i, label: 'Host country residents only' },
  { regex: /\bmust\s+be\s+(?:physically\s+)?located\s+in\s+(?:the\s+)?(?:u\.?s\.?|united states|canada|uk|europe)\b/i, label: 'Must be physically located in foreign host country' },
  { regex: /\bcandidates?\s+must\s+be\s+based\s+in\s+(?:the\s+)?(?:u\.?s\.?|united states|canada|uk)\b/i, label: 'Must be based in foreign host country' },
  { regex: /\bcontinental\s+u\.?s\.?\s+only\b/i, label: 'Continental US only' },
  { regex: /\bremote\s+(?:in|within|only)\s+(?:the\s+)?(?:u\.?s\.?|united states|usa|canada|uk|europe|germany|france|australia)\b/i, label: 'Remote restricted to specific foreign country' },
  { regex: /\bremote\s*\(\s*(?:only\s+)?(?:in\s+)?(?:the\s+)?(?:u\.?s\.?|united states|usa|canada|uk|europe|latam|emea|apac|north america|serbia|poland|germany|france)[^)]*\)/i, label: 'Remote restricted to designated foreign territory' },
  { regex: /\b(?:u\.?s\.?|usa|uk|canada|europe)\s+remote\b/i, label: 'Remote restricted to specific foreign country' },
  { regex: /\b(?:u\.?s\.?|usa|canada|uk|europe|eu|emea|latam)\s+only\b/i, label: 'Foreign region restricted' },
];

// ─── Positive Signals: Welcomes International Candidates ─────────────────────
const POSITIVE_SIGNALS = [
  { regex: /\binternational\s+students?\s+(?:are\s+)?(?:welcome|encouraged|eligible)\b/i, label: 'International students welcome' },
  { regex: /\bopen\s+to\s+applicants?\s+worldwide\b/i, label: 'Open to applicants worldwide' },
  { regex: /\b(?:remote\s+worldwide|anywhere\s+in\s+the\s+world|work\s+from\s+anywhere)\b/i, label: 'Remote worldwide' },
  { regex: /\b(?:visa\s+)?sponsorship\s+(?:is\s+)?(?:available|provided|offered|supported)\b/i, label: 'Visa sponsorship available' },
  { regex: /\b(?:will|can)\s+sponsor\s+(?:visas?|j-?1|f-?1|h-?1b)\b/i, label: 'Employer provides visa sponsorship' },
  { regex: /\bcandidates?\s+(?:located\s+)?outside\s+(?:the\s+)?(?:u\.?s\.?|united states)\s+may\s+apply\b/i, label: 'Candidates outside host country may apply' },
  { regex: /\bglobal\s+(?:internship|program)\s+open\s+to\s+all\b/i, label: 'Global internship open to all' },
];

/**
 * Helper to check if a location string points to India
 */
function isDomesticIndia(loc, source) {
  if ([
    'Internshala', 'Freshersworld', 'IndiaDirect',
    '[UNSTOP]', 'UNSTOP', 'Unstop',
    '[NAUKRI]', 'NAUKRI', 'Naukri',
    '[HIRIST]', 'HIRIST', 'Hirist',
    '[FOUNDIT]', 'FOUNDIT', 'Foundit',
  ].includes(source)) {
    return true;
  }
  if (!loc) return false;
  const l = loc.toLowerCase();
  if (l.includes('indianapolis') || l.includes('indiana')) return false;

  const indiaKeywords = [
    'india', 'indian', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'new delhi',
    'hyderabad', 'pune', 'chennai', 'kolkata', 'noida', 'gurgaon', 'gurugram',
    'ahmedabad', 'jaipur', 'kochi', 'coimbatore', 'mangalore', 'mangaluru',
    'udupi', 'mysore', 'mysuru', 'chandigarh', 'mohali', 'indore', 'bhopal'
  ];

  return indiaKeywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(l));
}

/**
 * Screen a single job listing for international eligibility & work authorization
 *
 * @param {Object} job - Standardized job object
 * @returns {Object} Full eligibility evaluation record
 */
function screenEligibility(job) {
  const title = job.title || '';
  const location = job.location || '';
  const desc = job.description || '';
  const sponsorshipField = job.sponsorship || '';
  const source = job.source || '';
  const fullText = `${title} ${location} ${desc} ${sponsorshipField}`.toLowerCase();

  const reasons = [];
  let locationRestriction = 'None explicitly stated';
  let workAuthReq = 'None explicitly stated';
  let visaSponsorship = 'Unstated';
  let studyLocationReq = 'None stated';
  let citizenshipReq = 'None stated';

  // ── 1. Explicit Citizenship Disqualifiers ──────────────────────────────────
  for (const item of CITIZENSHIP_PATTERNS) {
    if (item.regex.test(fullText)) {
      citizenshipReq = item.label;
      reasons.push(item.label);
    }
  }

  if (sponsorshipField.toLowerCase().includes('u.s. citizen')) {
    citizenshipReq = 'U.S. Citizenship is Required';
    reasons.push('Employer structured feed metadata specifies U.S. Citizenship required');
  }

  if (citizenshipReq !== 'None stated') {
    return {
      eligibility_status: ELIGIBILITY_STATUSES.INELIGIBLE,
      location_restriction: location || 'International',
      work_authorization_requirement: 'Requires specific foreign citizenship or security clearance',
      visa_sponsorship: 'Unavailable',
      study_location_requirement: studyLocationReq,
      citizenship_requirement: citizenshipReq,
      eligibility_confidence: 0.98,
      eligibility_reasons: reasons,
    };
  }

  // ── 2. Study / University Location Restrictions ────────────────────────────
  for (const item of STUDY_LOCATION_PATTERNS) {
    if (item.regex.test(fullText)) {
      studyLocationReq = item.label;
      reasons.push(item.label);
    }
  }

  if (studyLocationReq !== 'None stated') {
    return {
      eligibility_status: ELIGIBILITY_STATUSES.INELIGIBLE,
      location_restriction: location || 'International',
      work_authorization_requirement: 'Host country university enrollment required',
      visa_sponsorship: 'Unavailable for international non-domestic students',
      study_location_requirement: studyLocationReq,
      citizenship_requirement: citizenshipReq,
      eligibility_confidence: 0.96,
      eligibility_reasons: reasons,
    };
  }

  // ── 3. Residency Restrictions on Remote / Distributed Roles ─────────────────
  let hasResidencyRestriction = false;
  for (const item of RESIDENCY_RESTRICTIONS) {
    if (item.regex.test(fullText)) {
      locationRestriction = item.label;
      hasResidencyRestriction = true;
      reasons.push(item.label);
    }
  }

  // If remote is restricted to US/Canada/Europe, Indian candidate cannot legally reside there
  if (hasResidencyRestriction) {
    return {
      eligibility_status: ELIGIBILITY_STATUSES.LIKELY_INELIGIBLE,
      location_restriction: locationRestriction,
      work_authorization_requirement: workAuthReq !== 'None explicitly stated' ? workAuthReq : 'Must reside in designated foreign country',
      visa_sponsorship: visaSponsorship,
      study_location_requirement: studyLocationReq,
      citizenship_requirement: citizenshipReq,
      eligibility_confidence: 0.92,
      eligibility_reasons: reasons,
    };
  }

  // ── 4. Domestic India Check (Candidate is citizen and student in India) ────
  if (isDomesticIndia(location, source)) {
    return {
      eligibility_status: ELIGIBILITY_STATUSES.ELIGIBLE,
      location_restriction: location || 'India',
      work_authorization_requirement: 'Citizen / Local Student (Eligible in India)',
      visa_sponsorship: 'Not required (Domestic)',
      study_location_requirement: 'None (Enrolled in NMAMIT, India)',
      citizenship_requirement: 'None (Indian citizen)',
      eligibility_confidence: 0.99,
      eligibility_reasons: [
        'India-based opportunity; candidate is an Indian citizen and student studying in India'
      ],
    };
  }

  // ── 5. Explicit Work Authorization & Sponsorship Restrictions ──────────────
  let hasNoSponsorship = false;
  for (const item of WORK_AUTH_DISQUALIFIERS) {
    if (item.regex.test(fullText)) {
      workAuthReq = item.label;
      visaSponsorship = 'Not provided';
      hasNoSponsorship = true;
      reasons.push(item.label);
    }
  }

  // Structured feed metadata check (e.g. SimplifyJobs 'Does Not Offer Sponsorship')
  if (sponsorshipField.toLowerCase().includes('does not offer') || sponsorshipField.toLowerCase().includes('no sponsorship')) {
    visaSponsorship = 'Not provided';
    hasNoSponsorship = true;
    reasons.push('Structured listing feed explicitly flags: Does Not Offer Sponsorship');
  }

  // If role explicitly does not offer sponsorship or requires pre-existing foreign work authorization
  if (hasNoSponsorship) {
    return {
      eligibility_status: ELIGIBILITY_STATUSES.LIKELY_INELIGIBLE,
      location_restriction: location || 'Foreign / Regional Restriction',
      work_authorization_requirement: workAuthReq !== 'None explicitly stated' ? workAuthReq : 'Must possess existing local work authorization (No sponsorship)',
      visa_sponsorship: 'Not provided',
      study_location_requirement: studyLocationReq,
      citizenship_requirement: citizenshipReq,
      eligibility_confidence: 0.94,
      eligibility_reasons: reasons,
    };
  }

  // ── 6. Positive Signals (International Welcome / Global Remote) ─────────────
  const positiveMatches = [];
  for (const item of POSITIVE_SIGNALS) {
    if (item.regex.test(fullText)) {
      positiveMatches.push(item.label);
    }
  }

  if (sponsorshipField.toLowerCase().includes('offers sponsorship')) {
    positiveMatches.push('Employer explicitly offers visa sponsorship');
    visaSponsorship = 'Provided / Available';
  }

  if (positiveMatches.length > 0) {
    return {
      eligibility_status: ELIGIBILITY_STATUSES.ELIGIBLE,
      location_restriction: location || 'Worldwide / International-friendly',
      work_authorization_requirement: 'International candidates eligible / Visa sponsorship supported',
      visa_sponsorship: visaSponsorship !== 'Unstated' ? visaSponsorship : 'Available or not required',
      study_location_requirement: studyLocationReq,
      citizenship_requirement: citizenshipReq,
      eligibility_confidence: 0.92,
      eligibility_reasons: positiveMatches,
    };
  }

  // ── 7. Fully Remote Worldwide with No Negative Flags ────────────────────────
  const isGlobalRemote = Boolean(
    location.toLowerCase().includes('remote') ||
    location.toLowerCase().includes('wfh') ||
    location.toLowerCase().includes('anywhere') ||
    location.toLowerCase().includes('worldwide')
  );

  if (isGlobalRemote && !hasNoSponsorship && !hasResidencyRestriction) {
    return {
      eligibility_status: ELIGIBILITY_STATUSES.LIKELY_ELIGIBLE,
      location_restriction: 'Remote (No local restriction detected)',
      work_authorization_requirement: 'None explicitly stated',
      visa_sponsorship: 'Not applicable (Remote)',
      study_location_requirement: 'None stated',
      citizenship_requirement: 'None stated',
      eligibility_confidence: 0.80,
      eligibility_reasons: [
        'Remote role with no explicit country residency or foreign citizenship restrictions stated'
      ],
    };
  }

  // ── 8. Ambiguous International On-site (e.g. Tier-1 Global) ─────────────────
  // A role on-site in US/UK/Canada/EU with no explicit statement about sponsorship or enrollment.
  // It is NOT silently rejected, but marked UNCLEAR — REVIEW.
  return {
    eligibility_status: ELIGIBILITY_STATUSES.UNCLEAR,
    location_restriction: location || 'International on-site',
    work_authorization_requirement: 'Unclear — review company policy on J-1/F-1 or local authorization',
    visa_sponsorship: 'Unclear — not stated in listing',
    study_location_requirement: 'Unclear — check if local university enrollment required',
    citizenship_requirement: 'None explicitly stated',
    eligibility_confidence: 0.55,
    eligibility_reasons: [
      'International on-site position without explicit visa sponsorship or local enrollment details stated. Manual review recommended.'
    ],
  };
}

/**
 * Format Telegram eligibility status badge
 */
function getTelegramEligibilityBadge(status, reasons = []) {
  switch (status) {
    case ELIGIBILITY_STATUSES.ELIGIBLE:
      return '🟢 International-friendly (or India-based)';
    case ELIGIBILITY_STATUSES.LIKELY_ELIGIBLE:
      return '🟢 Likely eligible — Remote / No restrictions stated';
    case ELIGIBILITY_STATUSES.UNCLEAR:
      return '🟡 Unclear — Review eligibility (International on-site)';
    case ELIGIBILITY_STATUSES.LIKELY_INELIGIBLE:
      return `🔴 Likely ineligible — ${reasons[0] || 'Requires local work authorization'}`;
    case ELIGIBILITY_STATUSES.INELIGIBLE:
      return `🔴 Ineligible — ${reasons[0] || 'Strict local/citizenship restriction'}`;
    default:
      return '🟡 Unclear — Review eligibility';
  }
}

/**
 * Format Discord eligibility embed field
 */
function getDiscordEligibilityField(status, reasons = []) {
  switch (status) {
    case ELIGIBILITY_STATUSES.ELIGIBLE:
      return {
        name: '🌍 International Eligibility',
        value: `🟢 **International-friendly / Eligible**\n_${reasons.slice(0, 2).join(' • ') || 'Verified accessible'}_`,
        inline: false,
      };
    case ELIGIBILITY_STATUSES.LIKELY_ELIGIBLE:
      return {
        name: '🌍 International Eligibility',
        value: `🟢 **Likely Eligible**\n_${reasons[0] || 'Remote with no regional restrictions'}_`,
        inline: false,
      };
    case ELIGIBILITY_STATUSES.UNCLEAR:
      return {
        name: '🌍 International Eligibility',
        value: `🟡 **Unclear — Review Eligibility**\n_${reasons[0] || 'International on-site; verify visa policy before applying'}_`,
        inline: false,
      };
    case ELIGIBILITY_STATUSES.LIKELY_INELIGIBLE:
    case ELIGIBILITY_STATUSES.INELIGIBLE:
      return {
        name: '🌍 International Eligibility',
        value: `🔴 **Likely Ineligible**\n_${reasons[0] || 'Requires local work authorization or host country enrollment'}_`,
        inline: false,
      };
    default:
      return {
        name: '🌍 International Eligibility',
        value: '🟡 **Unclear — Review**',
        inline: false,
      };
  }
}

/**
 * Check if a job should be allowed in high-priority alerts
 * Strictly allows only ELIGIBLE and LIKELY_ELIGIBLE.
 * Suppresses UNCLEAR, LIKELY_INELIGIBLE, and INELIGIBLE from push notifications.
 */
function isAlertEligible(job) {
  if (!job) return false;
  const status = job.eligibility_status || (typeof screenEligibility === 'function' ? screenEligibility(job).eligibility_status : null);
  return status === ELIGIBILITY_STATUSES.ELIGIBLE || status === ELIGIBILITY_STATUSES.LIKELY_ELIGIBLE;
}

/**
 * Check if a job meets all criteria for notification dispatch:
 * 1. Must pass international work authorization/eligibility screening
 * 2. If scored by AI matcher (matchScore != null), must meet or exceed minScore (default 70)
 *
 * @param {Object} job - Standardized job object
 * @param {number} minScore - Minimum match score required if scored (default: 70)
 * @returns {boolean}
 */
function shouldAlert(job, minScore = 70) {
  if (!isAlertEligible(job)) return false;
  if (job.matchScore != null && job.matchScore < minScore) return false;
  return true;
}

module.exports = {
  screenEligibility,
  getTelegramEligibilityBadge,
  getDiscordEligibilityField,
  isAlertEligible,
  shouldAlert,
  ELIGIBILITY_STATUSES,
};
