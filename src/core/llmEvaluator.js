'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ─── Load candidate profile ────────────────────────────────────────────────
const PROFILE_PATH = path.join(__dirname, '..', '..', 'data', 'resume_profile.json');
let candidateProfile;
try {
  candidateProfile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
} catch {
  console.warn('[LLM] Could not load resume_profile.json — using default NMAMIT 2028 AI/ML profile.');
  candidateProfile = {
    name: 'Candidate',
    education: 'B.Tech CSE, NMAMIT (Batch of 2028)',
    currentLevel: '3rd year / 5th semester',
    graduationYear: 2028,
    cgpa: '8.45',
    targetRoles: ['AI/ML Engineer Intern', 'Machine Learning Intern', 'Software Engineer Intern'],
    skills: {
      Programming: ['Python', 'Java', 'C', 'DSA'],
      'AI/ML': ['Machine Learning', 'Deep Learning', 'Generative AI', 'LLMs', 'TensorFlow', 'PyTorch', 'scikit-learn'],
      Data: ['NumPy', 'Pandas', 'SQL'],
      'Cloud / Engineering': ['AWS', 'Docker', 'Kubernetes', 'REST APIs', 'Git', 'GitHub'],
    },
    coreStack: [
      'Python', 'Java', 'C', 'DSA',
      'Machine Learning', 'Deep Learning', 'Generative AI', 'LLMs', 'TensorFlow', 'PyTorch', 'scikit-learn',
      'NumPy', 'Pandas', 'SQL',
      'AWS', 'Docker', 'Kubernetes', 'REST APIs', 'Git', 'GitHub',
    ],
    targetLocations: ['India', 'Remote'],
  };
}

const skillsFormatted = candidateProfile.skills
  ? Object.entries(candidateProfile.skills)
      .map(([cat, list]) => `- ${cat}: ${list.join(', ')}`)
      .join('\n')
  : (candidateProfile.coreStack || []).join(', ');

const PROFILE_SUMMARY = `
Candidate: ${candidateProfile.name || 'Candidate'}
Education: ${candidateProfile.education}
Graduation Year: ${candidateProfile.graduationYear || '2028'} (${candidateProfile.currentLevel || '3rd year / 5th sem'})
CGPA: ${candidateProfile.cgpa || '8.45'}
Primary Target Roles: ${(candidateProfile.primaryTargetRoles || candidateProfile.targetRoles || []).join(', ')}
Secondary Target Roles: ${(candidateProfile.secondaryTargetRoles || []).join(', ')}
Verified Candidate Skills:
${skillsFormatted}
Full Core Stack: ${(candidateProfile.coreStack || []).join(', ')}
Citizenship & Location: Indian Citizen residing and studying in India (NMAMIT)
Work Authorization Context:
- Authorized for employment in India (Domestic citizen/student).
- Does NOT possess existing work authorization, citizenship, residency, or visa in the US, Canada, UK, EU, or Australia.
- Eligible for foreign roles ONLY if employer provides international visa sponsorship (e.g. J-1/F-1) or if the role is remote worldwide accessible from India.
- Excluded from roles requiring foreign citizenship, domestic university enrollment, or requiring pre-existing foreign work authorization without sponsorship.
`.trim();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Direct REST API call to Gemini (fallback or primary)
 */
async function callGeminiRest(apiKey, prompt, model = 'gemini-1.5-flash') {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  };

  const response = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(text);
}

/**
 * Call Gemini using official @google/genai SDK with REST fallback
 */
async function callGemini(apiKey, prompt) {
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  try {
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });

    const text = response.text;
    return JSON.parse(text);
  } catch (sdkErr) {
    // If SDK fails or has version mismatch, fallback to direct REST API with gemini-2.5-flash or gemini-1.5-flash
    try {
      return await callGeminiRest(apiKey, prompt, modelName);
    } catch {
      return await callGeminiRest(apiKey, prompt, 'gemini-1.5-flash');
    }
  }
}

/**
 * Calculate match score (0-100) based on verified candidate profile and skills
 */
function calculateHeuristicMatch(job, profile = candidateProfile) {
  let score = 50; // Baseline
  const title = (job.title || '').toLowerCase();
  const desc = (job.description || '').toLowerCase();
  const text = `${title} ${desc} ${job.category || ''}`;

  // 1. Role alignment (Target Roles)
  const isAIML = ['ai', 'ml', 'machine learning', 'data science', 'genai', 'llm', 'deep learning']
    .some(kw => title.includes(kw));
  const isSWE = ['software', 'backend', 'developer', 'sde', 'engineer']
    .some(kw => title.includes(kw));

  if (isAIML) score += 25;
  else if (isSWE) score += 15;

  // 2. Verified Candidate Skill Alignment
  if (text.includes('pytorch') || text.includes('tensorflow') || text.includes('scikit-learn')) score += 10;
  if (text.includes('machine learning') || text.includes('deep learning') || text.includes('llm') || text.includes('genai')) score += 5;
  if (text.includes('python')) score += 5;
  if (text.includes('sql') || text.includes('pandas') || text.includes('numpy')) score += 5;
  if (text.includes('docker') || text.includes('kubernetes') || text.includes('aws') || text.includes('rest')) score += 5;

  // 3. Internship fit
  if (job.type === 'internship' || title.includes('intern') || title.includes('co-op')) score += 5;

  // 4. Batch 2028 fit
  if (text.includes('2028') || text.includes('summer 2026') || text.includes('summer 2027')) score += 5;

  // 5. Ineligibility penalties
  if (job.eligibility_status === 'INELIGIBLE') {
    score = Math.min(score, 20);
  } else if (job.eligibility_status === 'LIKELY_INELIGIBLE') {
    score = Math.min(score, 35);
  } else if (job.eligibility_status === 'UNCLEAR') {
    score = Math.min(score, 75);
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Evaluate a single job against candidate profile and work authorization
 */
async function evaluateSingleJob(apiKey, job) {
  const prompt = `You are an expert technical recruiter evaluating an internship for a specific undergraduate candidate.

CANDIDATE PROFILE:
${PROFILE_SUMMARY}

JOB LISTING:
Title: ${job.title || 'Unknown'}
Company: ${job.company || 'Unknown'}
Location: ${job.location || 'Not specified'}
Category: ${job.category || 'General CS'}
Type: ${job.type || 'Internship'}
Preliminary Eligibility: ${job.eligibility_status || 'UNCLEAR'}
Eligibility Context: ${(job.eligibility_reasons || []).join('; ') || 'No restrictions detected'}
Sponsorship: ${job.visa_sponsorship || job.sponsorship || 'Unstated'}
Description: ${(job.description || 'No description available').slice(0, 800)}

TASKS:
1. Provide a match score (0 to 100) assessing relevance to the candidate's target roles (Highest preference: AI/ML, GenAI, LLM, Data Science, Python; Secondary: SWE, Backend), college graduation timeline (Batch of 2028), and technical skill alignment (evaluate against candidate's verified skills: Python, Java, C, DSA; AI/ML: Machine Learning, Deep Learning, Generative AI, LLMs, TensorFlow, PyTorch, scikit-learn; Data: NumPy, Pandas, SQL; Cloud/Engineering: AWS, Docker, Kubernetes, REST APIs, Git, GitHub).
   CRITICAL ELIGIBILITY RULE:
   - If the role requires US/foreign citizenship, security clearance, host-country university enrollment, or explicitly states no visa sponsorship for foreign on-site, rate match score low (<= 30) or mark ineligible in reason.
   - If India-based, remote worldwide, or offers visa sponsorship, rate normally based on technical alignment.
2. Write exactly 1 concise sentence explaining the match and eligibility fit.
3. If the score is >= 80 and the job is international-friendly/eligible, write a 2-sentence polite cold outreach pitch the candidate can send to a recruiter or engineering manager on LinkedIn mentioning their NMAMIT B.Tech background and AI/ML projects. If score < 80 or ineligible, set coldPitch to empty string.

Return ONLY valid JSON matching this exact schema:
{"matchScore": 88, "reason": "Strong match because...", "coldPitch": "Hi [Name], I noticed..."}`;

  try {
    const result = await callGemini(apiKey, prompt);
    const score = Math.min(100, Math.max(0, Number(result.matchScore) || 0));

    return {
      ...job,
      matchScore: score,
      aiReason: (result.reason || '').slice(0, 250),
      coldPitch: (result.coldPitch || '').slice(0, 350),
    };
  } catch (err) {
    console.warn(`[LLM] ⚠️ Failed to evaluate "${job.title}" @ ${job.company}: ${err.message}`);
    return job; // Graceful fallback
  }
}

/**
 * Evaluate filtered jobs against candidate profile
 */
async function evaluateJobs(jobs) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[LLM] GEMINI_API_KEY not set — using candidate profile heuristic matcher for scoring.');
    const evaluated = jobs.map(job => {
      const matchScore = calculateHeuristicMatch(job, candidateProfile);
      return {
        ...job,
        matchScore,
        aiReason: `Profile skill match aligned with NMAMIT 2028 target stack (${candidateProfile.coreStack.slice(0, 6).join(', ')}).`,
        coldPitch: matchScore >= 80 ? `Hi hiring team, as a B.Tech CSE student at NMAMIT (Batch of 2028) with hands-on experience in ${job.category === 'AI / ML & Data Science' ? 'PyTorch, TensorFlow, and LLMs' : 'Python, SQL, and backend systems'}, I would love to connect!` : '',
      };
    });

    const highMatches = evaluated.filter(j => j.matchScore >= 80).length;
    const goodMatches = evaluated.filter(j => j.matchScore >= 70 && j.matchScore < 80).length;
    const lowMatches = evaluated.filter(j => j.matchScore < 70).length;
    console.log(`[LLM] ✅ Evaluated ${evaluated.length} jobs (80–100: ${highMatches}, 70–79: ${goodMatches}, <70: ${lowMatches})`);
    return evaluated;
  }

  const evaluated = [];
  const total = jobs.length;

  console.log(`[LLM] Evaluating ${total} jobs against candidate profile (Batch of 2028 / AI-ML focus)...`);

  for (let i = 0; i < total; i++) {
    const job = jobs[i];
    console.log(`[LLM] ${i + 1}/${total}: "${job.title}" @ ${job.company}`);

    const result = await evaluateSingleJob(apiKey, job);
    evaluated.push(result);

    if (result.matchScore != null) {
      console.log(`[LLM]   → Score: ${result.matchScore}% | ${result.aiReason || ''}`);
    }

    if (i < total - 1) {
      await sleep(600); // Polite rate limit delay
    }
  }

  const scored = evaluated.filter(j => j.matchScore != null);
  console.log(`[LLM] ✅ Scored ${scored.length}/${total} jobs.`);

  if (scored.length > 0) {
    const avg = Math.round(scored.reduce((sum, j) => sum + j.matchScore, 0) / scored.length);
    const highMatches = scored.filter(j => j.matchScore >= 80).length;
    const goodMatches = scored.filter(j => j.matchScore >= 70 && j.matchScore < 80).length;
    const lowMatches = scored.filter(j => j.matchScore < 70).length;
    console.log(`[LLM]   Average score: ${avg}% | Breakdown: 80–100: ${highMatches}, 70–79: ${goodMatches}, <70: ${lowMatches}`);
  }

  return evaluated;
}

module.exports = { evaluateJobs, evaluateSingleJob, calculateHeuristicMatch };
