'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { filterJobs, isRelevant, categorizeJob, getRolePriority } = require('../src/core/filter');
const { passesGeoFilter, isIndia, isRemote } = require('../src/core/geoFilter');
const Database = require('../src/core/database');
const {
  addApplication,
  updateApplication,
  loadApplications,
  removeApplication,
  renderMarkdown,
  calculateDaysOld,
} = require('../src/core/tracker');
const { generateAllListings, calculateScore } = require('../src/core/digestGenerator');

let passedTests = 0;
let failedTests = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✅ ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ ${description}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

async function runAll() {
  console.log('\n' + '═'.repeat(60));
  console.log('  🧪 RUNNING TEST SUITE — AI Internship Tracker');
  console.log('═'.repeat(60) + '\n');

  // ── 1. CS & Role Filter Tests ─────────────────────────────────────────────
  console.log('🔹 1. Role Filter & Categorization Tests:');

  test('Should accept primary target roles (AI/ML, GenAI, LLM, Data Science)', () => {
    const roles = [
      { title: 'AI/ML Engineer Intern', company: 'Google', url: 'https://example.com/1' },
      { title: 'Machine Learning Intern - Summer 2027', company: 'Microsoft', url: 'https://example.com/2' },
      { title: 'GenAI Research Intern', company: 'Anthropic', url: 'https://example.com/3' },
      { title: 'LLM Systems Intern', company: 'NVIDIA', url: 'https://example.com/4' },
      { title: 'Data Science Intern', company: 'Razorpay', url: 'https://example.com/5' },
    ];
    roles.forEach(job => {
      assert.strictEqual(isRelevant(job), true, `Failed on ${job.title}`);
      assert.strictEqual(categorizeJob(job), 'AI / ML & Data Science', `Wrong category for ${job.title}`);
      assert.ok(getRolePriority(job) >= 40, `Priority too low for ${job.title}`);
    });
  });

  test('Should accept secondary target roles (SWE, Backend)', () => {
    const roles = [
      { title: 'Software Engineering Intern', company: 'Amazon', url: 'https://example.com/6' },
      { title: 'Backend Developer Intern', company: 'Swiggy', url: 'https://example.com/7' },
      { title: 'SDE Intern - Summer 2026', company: 'Uber', url: 'https://example.com/8' },
    ];
    roles.forEach(job => {
      assert.strictEqual(isRelevant(job), true, `Failed on ${job.title}`);
      assert.strictEqual(categorizeJob(job), 'Software & Backend Engineering');
    });
  });

  test('Should block non-CS and unrelated roles', () => {
    const nonCsRoles = [
      { title: 'Sales Executive', company: 'ABC Corp', url: 'https://example.com/9' },
      { title: 'Digital Marketing Manager', company: 'XYZ', url: 'https://example.com/10' },
      { title: 'HR Executive Intern', company: 'Talent Inc', url: 'https://example.com/11' },
      { title: 'Civil Engineer Intern', company: 'Builders LLC', url: 'https://example.com/12' },
      { title: 'Accountant', company: 'Finance Group', url: 'https://example.com/13' },
    ];
    nonCsRoles.forEach(job => {
      assert.strictEqual(isRelevant(job), false, `Should have blocked ${job.title}`);
    });
  });

  test('Should block over-experienced senior roles', () => {
    const seniorJobs = [
      { title: 'Senior Software Engineer (10+ years experience)', company: 'Tech Inc', url: 'https://example.com/14' },
      { title: 'Principal ML Engineer (minimum 5 years)', company: 'BigCo', url: 'https://example.com/15' },
      { title: 'Lead Software Engineer', company: 'StartCo', url: 'https://example.com/16' },
    ];
    seniorJobs.forEach(job => {
      assert.strictEqual(isRelevant(job), false, `Should have blocked senior role: ${job.title}`);
    });
  });

  // ── 2. Geo Filter Tests ───────────────────────────────────────────────────
  console.log('\n🔹 2. Geography Filter Tests:');

  test('Should accept Indian cities (Bangalore, Hyderabad, Pune, Mangalore, etc.)', () => {
    const indiaLocs = [
      'Bangalore, India',
      'Bengaluru, Karnataka',
      'Hyderabad, Telangana',
      'Pune, Maharashtra',
      'Noida, UP',
      'Gurgaon, Haryana',
      'Mangalore, Karnataka',
      'Udupi, Karnataka',
      'Mumbai',
      'Chennai',
    ];
    indiaLocs.forEach(loc => {
      assert.strictEqual(isIndia(loc), true, `Failed to recognize India in: ${loc}`);
      assert.strictEqual(passesGeoFilter({ location: loc, company: 'Local Co' }), true);
    });
  });

  test('Should accept Remote / Work From Home locations', () => {
    const remoteLocs = ['Remote', 'Work From Home', 'Anywhere in the world', 'Remote - India'];
    remoteLocs.forEach(loc => {
      assert.strictEqual(isRemote(loc) || isIndia(loc), true);
      assert.strictEqual(passesGeoFilter({ location: loc, company: 'Remote Co' }), true);
    });
  });

  test('FIX VERIFICATION: Should NOT falsely match Indianapolis or Indiana (USA) as India', () => {
    const usLocs = [
      'Indianapolis, IN',
      'Indianapolis, IN, USA',
      'Indiana, United States',
    ];
    usLocs.forEach(loc => {
      assert.strictEqual(isIndia(loc), false, `False positive on US location: ${loc}`);
      // An unknown US company should NOT pass geo filter
      const pass = passesGeoFilter({ location: loc, company: 'Unknown Indiana Bakery' });
      assert.strictEqual(pass, false, `Unknown company in Indianapolis should not pass: ${loc}`);
    });
  });

  test('Should accept Tier-1 global tech firms even if global on-site', () => {
    const tier1Global = [
      { company: 'Google', location: 'Mountain View, CA', source: 'GitHub Repos' },
      { company: 'NVIDIA', location: 'Santa Clara, CA', source: 'GitHub Repos' },
      { company: 'OpenAI', location: 'San Francisco, CA', source: 'GitHub Repos' },
    ];
    tier1Global.forEach(job => {
      assert.strictEqual(passesGeoFilter(job), true, `Tier-1 company rejected: ${job.company}`);
    });
  });

  // ── 3. Deduplication Tests ────────────────────────────────────────────────
  console.log('\n🔹 3. Deduplication & Normalization Tests:');

  test('URL normalization strips UTM and tracking params cleanly', () => {
    const rawUrl = 'https://jobs.example.com/apply/1234?utm_source=linkedin&utm_medium=job_post&ref=social#apply-section';
    const clean = Database.normalizeUrl(rawUrl);
    assert.strictEqual(clean, 'https://jobs.example.com/apply/1234');
  });

  test('Hash generation is stable across same listing with different tracking params', () => {
    const jobA = {
      title: 'AI Engineer Intern',
      company: 'Google',
      url: 'https://careers.google.com/jobs/results/123?utm_source=telegram',
    };
    const jobB = {
      title: 'AI Engineer Intern',
      company: 'Google',
      url: 'https://careers.google.com/jobs/results/123?utm_source=discord&ref=tracking',
    };
    assert.strictEqual(Database.hash(jobA), Database.hash(jobB));
  });

  test('Repeated runs: previously marked jobs are recognized as not new across database reloads', () => {
    const db = new Database();
    const testJob = {
      title: 'ML Systems Engineer Intern',
      company: 'Databricks',
      url: 'https://databricks.com/jobs/intern-ml-99999',
      source: 'GitHub Feeds',
    };

    assert.strictEqual(db.isNew(testJob), true, 'Job should be new initially');
    db.markSeen(testJob);
    db.save();

    // Reload from disk to simulate a subsequent run
    const reloadedDb = new Database();
    assert.strictEqual(reloadedDb.isNew(testJob), false, 'Job must be recognized as seen after reload');

    // Test with URL having tracking parameters appended
    const jobWithUtm = {
      ...testJob,
      url: 'https://databricks.com/jobs/intern-ml-99999?utm_source=telegram&ref=alert_bot',
    };
    assert.strictEqual(reloadedDb.isNew(jobWithUtm), false, 'Job with tracking params must also be recognized as seen');

    // Clean up test entry
    const hash = Database.hash(testJob);
    delete reloadedDb.data.jobs[hash];
    reloadedDb.save();
  });

  // ── 4. Application Tracker Tests ──────────────────────────────────────────
  console.log('\n🔹 4. Application Tracker Module Tests:');

  test('Should add, update, calculate days old, and render applications', () => {
    const testApp = addApplication(
      'TestCorp AI',
      'AI/ML Intern',
      '2026-10-01',
      'Applied',
      'Testing application flow',
      'https://testcorp.ai/careers'
    );
    assert.ok(testApp.id);
    assert.strictEqual(testApp.company, 'TestCorp AI');

    const apps = loadApplications();
    const found = apps.find(a => a.id === testApp.id);
    assert.ok(found);

    // Update status
    const updated = updateApplication(testApp.id, 'Interview', 'Passed OA, technical next');
    assert.strictEqual(updated, true);

    const updatedApps = loadApplications();
    const updatedFound = updatedApps.find(a => a.id === testApp.id);
    assert.strictEqual(updatedFound.status, 'Interview');

    // Days old calculation
    const days = calculateDaysOld('2026-10-01');
    assert.strictEqual(typeof days, 'number');

    // Cleanup test app
    removeApplication(testApp.id);
    const cleanedApps = loadApplications();
    assert.strictEqual(cleanedApps.some(a => a.id === testApp.id), false);
  });

  // ── 5. Digest & Recommendation Generator Tests ────────────────────────────
  console.log('\n🔹 5. Digest Generator & TOP20 Ranking Tests:');

  test('Should rank AI/ML roles higher than generic roles in TOP20 recommendations', () => {
    const mockJobs = [
      {
        title: 'Full Stack Web Developer',
        company: 'WebStudio',
        category: 'Software & Backend Engineering',
        location: 'Bangalore',
        type: 'internship',
        url: 'https://example.com/web',
        source: 'Internshala',
      },
      {
        title: 'AI Engineer Intern',
        company: 'NVIDIA',
        category: 'AI / ML & Data Science',
        location: 'Bangalore, India',
        type: 'internship',
        url: 'https://example.com/nvidia-ai',
        source: 'IndiaDirect',
      },
      {
        title: 'Machine Learning Research Intern',
        company: 'Google',
        category: 'AI / ML & Data Science',
        location: 'Remote',
        type: 'internship',
        url: 'https://example.com/google-ai',
        source: 'GitHub Repos',
      },
    ];

    const nvidiaScore = calculateScore(mockJobs[1]);
    const webScore = calculateScore(mockJobs[0]);
    assert.ok(nvidiaScore > webScore, `AI/ML score (${nvidiaScore}) should exceed generic web score (${webScore})`);

    const result = generateAllListings(mockJobs);
    const top2Companies = result.topPicks.slice(0, 2).map(p => p.company);
    assert.ok(top2Companies.includes('NVIDIA') && top2Companies.includes('Google'), 'Both NVIDIA and Google should be top 2 picks');
    assert.strictEqual(result.topPicks[2].company, 'WebStudio', 'Generic web studio should be ranked last');
  });

  // ── 6. Candidate Profile Integrity ────────────────────────────────────────
  console.log('\n🔹 6. Candidate Profile Integrity Tests:');

  test('Profile contains NMAMIT, Batch of 2028, and primary AI/ML targets', () => {
    const profilePath = path.join(__dirname, '..', 'data', 'resume_profile.json');
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

    assert.ok(profile.education.includes('NMAMIT'));
    assert.strictEqual(profile.graduationYear, 2028);
    assert.strictEqual(profile.cgpa, '8.45');
    assert.ok(profile.primaryTargetRoles.includes('AI/ML Engineer Intern'));
    assert.ok(profile.primaryTargetRoles.includes('Machine Learning Intern'));
    assert.ok(profile.primaryTargetRoles.includes('GenAI Intern'));
    assert.ok(profile.coreStack.includes('TensorFlow'));
    assert.ok(profile.coreStack.includes('scikit-learn'));
    assert.ok(profile.coreStack.includes('Python'));
  });

  test('Candidate profile contains PyTorch, Docker, Kubernetes, AWS, and SQL in coreStack and skills', () => {
    const profilePath = path.join(__dirname, '..', 'data', 'resume_profile.json');
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

    const requiredSkills = ['PyTorch', 'Docker', 'Kubernetes', 'AWS', 'SQL'];
    requiredSkills.forEach(skill => {
      assert.ok(profile.coreStack.includes(skill), `coreStack should include ${skill}`);
    });

    assert.ok(profile.skills['AI/ML'].includes('PyTorch'), 'AI/ML skills should include PyTorch');
    assert.ok(profile.skills['Cloud / Engineering'].includes('Docker'), 'Cloud skills should include Docker');
    assert.ok(profile.skills['Cloud / Engineering'].includes('Kubernetes'), 'Cloud skills should include Kubernetes');
    assert.ok(profile.skills['Cloud / Engineering'].includes('AWS'), 'Cloud skills should include AWS');
    assert.ok(profile.skills['Data'].includes('SQL'), 'Data skills should include SQL');
  });

  // ── 7. AI Match Scoring Engine Verification ───────────────────────────────
  console.log('\n🔹 7. AI Match Scoring Engine Verification:');

  test('LLM Evaluator gracefully passes jobs through when GEMINI_API_KEY is not set', async () => {
    const { evaluateJobs } = require('../src/core/llmEvaluator');
    const mockJobs = [
      { title: 'AI Engineer Intern', company: 'Google', location: 'India' }
    ];
    delete process.env.GEMINI_API_KEY;
    const evaluated = await evaluateJobs(mockJobs);
    assert.strictEqual(evaluated.length, 1);
    assert.strictEqual(evaluated[0].title, 'AI Engineer Intern');
  });

  test('Formatter includes tailored AI pitch and match percentage when matchScore >= 80', () => {
    const { formatTelegram, formatDiscordEmbed } = require('../src/core/formatter');
    const highMatchJob = {
      title: 'Machine Learning Intern',
      company: 'NVIDIA',
      location: 'Bangalore, India',
      category: 'AI / ML & Data Science',
      type: 'internship',
      source: 'IndiaDirect',
      url: 'https://nvidia.com/apply',
      matchScore: 92,
      aiReason: 'Direct alignment with NMAMIT CSE 2028 candidate profile in TensorFlow and deep learning.',
      coldPitch: 'Hi hiring team, as a 3rd-year CS student at NMAMIT with deep learning experience, I would love to connect!',
    };

    const tgMsg = formatTelegram(highMatchJob);
    assert.ok(tgMsg.includes('92%'), 'Telegram alert should display match percentage');
    assert.ok(tgMsg.includes('NVIDIA'), 'Telegram alert should display company');
    assert.ok(tgMsg.includes('AI/ML'), 'Telegram alert should display AI/ML category');

    const discordEmbed = formatDiscordEmbed(highMatchJob);
    assert.strictEqual(discordEmbed.color, 0x9b59b6, 'AI/ML roles should render in purple');
    const hasMatchField = discordEmbed.fields.some(f => f.name.includes('Match Score') && f.value.includes('92%'));
    assert.ok(hasMatchField, 'Discord embed should contain Match Score field');
  });

  // ── 8. International Work Authorization & Eligibility Screening ───────────
  console.log('\n🔹 8. International Eligibility & Work Authorization Screening Tests:');

  const {
    screenEligibility,
    isAlertEligible,
    getTelegramEligibilityBadge,
    getDiscordEligibilityField,
    ELIGIBILITY_STATUSES,
  } = require('../src/core/eligibilityFilter');

  test('1. US university requirement -> INELIGIBLE', () => {
    const job = {
      title: 'Software Engineering Intern',
      company: 'TechCorp USA',
      location: 'Seattle, WA',
      description: 'Applicants must be currently enrolled in an accredited US university.',
    };
    const res = screenEligibility(job);
    assert.strictEqual(res.eligibility_status, ELIGIBILITY_STATUSES.INELIGIBLE);
    assert.ok(res.study_location_requirement.includes('US'));
    assert.strictEqual(isAlertEligible(res), false);
  });

  test('2. Country residency requirement -> LIKELY_INELIGIBLE', () => {
    const job = {
      title: 'AI Research Intern',
      company: 'CloudSystems',
      location: 'Remote',
      description: 'Candidates must reside in the United States or Canada. No exceptions.',
    };
    const res = screenEligibility(job);
    assert.strictEqual(res.eligibility_status, ELIGIBILITY_STATUSES.LIKELY_INELIGIBLE);
    assert.ok(res.location_restriction.includes('Must reside'));
    assert.strictEqual(isAlertEligible(res), false);
  });

  test('3. Citizenship requirement -> INELIGIBLE', () => {
    const job = {
      title: 'Machine Learning Defense Intern',
      company: 'Defense Dynamics',
      location: 'Washington, DC',
      description: 'Must be a US Citizen due to federal government security requirements.',
    };
    const res = screenEligibility(job);
    assert.strictEqual(res.eligibility_status, ELIGIBILITY_STATUSES.INELIGIBLE);
    assert.ok(res.citizenship_requirement.includes('US Citizen'));
    assert.strictEqual(isAlertEligible(res), false);
  });

  test('4. Work authorization requirement -> LIKELY_INELIGIBLE', () => {
    const job = {
      title: 'Data Science Intern',
      company: 'Fintech Hub',
      location: 'San Francisco, CA',
      description: 'Must already have unrestricted work authorization to work in the US.',
    };
    const res = screenEligibility(job);
    assert.strictEqual(res.eligibility_status, ELIGIBILITY_STATUSES.LIKELY_INELIGIBLE);
    assert.ok(res.work_authorization_requirement.includes('Unrestricted') || res.work_authorization_requirement.includes('work authorization'));
    assert.strictEqual(isAlertEligible(res), false);
  });

  test('5. No sponsorship requirement -> LIKELY_INELIGIBLE', () => {
    const job = {
      title: 'Backend Engineering Intern',
      company: 'MarketSoft',
      location: 'New York, NY',
      description: 'Visa sponsorship is not available for this role now or in the future.',
    };
    const res = screenEligibility(job);
    assert.strictEqual(res.eligibility_status, ELIGIBILITY_STATUSES.LIKELY_INELIGIBLE);
    assert.strictEqual(res.visa_sponsorship, 'Not provided');
    assert.strictEqual(isAlertEligible(res), false);
  });

  test('6. International applicants welcome -> ELIGIBLE', () => {
    const job = {
      title: 'GenAI Research Intern',
      company: 'DeepAI Labs',
      location: 'London, UK',
      description: 'International students are welcome. Visa sponsorship provided for accepted fellows.',
    };
    const res = screenEligibility(job);
    assert.strictEqual(res.eligibility_status, ELIGIBILITY_STATUSES.ELIGIBLE);
    assert.ok(res.eligibility_reasons.some(r => r.includes('International students welcome')));
    assert.strictEqual(isAlertEligible(res), true);
  });

  test('7. Remote worldwide -> ELIGIBLE', () => {
    const job = {
      title: 'Applied AI Intern',
      company: 'GlobalOpen',
      location: 'Remote',
      description: 'Open to applicants worldwide. Work from anywhere in the world on foundation models.',
    };
    const res = screenEligibility(job);
    assert.strictEqual(res.eligibility_status, ELIGIBILITY_STATUSES.ELIGIBLE);
    assert.ok(res.eligibility_reasons.some(r => r.includes('worldwide') || r.includes('anywhere')));
    assert.strictEqual(isAlertEligible(res), true);
  });

  test('8. Ambiguous eligibility (foreign on-site without sponsorship info) -> UNCLEAR (REVIEW)', () => {
    const job = {
      title: 'AI Systems Intern',
      company: 'Swiss Robotics Institute',
      location: 'Zurich, Switzerland',
      description: 'Develop neuromorphic vision algorithms with our research group.',
    };
    const res = screenEligibility(job);
    assert.strictEqual(res.eligibility_status, ELIGIBILITY_STATUSES.UNCLEAR);
    assert.ok(res.eligibility_reasons[0].includes('Manual review recommended') || res.eligibility_reasons[0].includes('International on-site'));
    assert.strictEqual(isAlertEligible(res), false, 'UNCLEAR positions should not be alerted via Telegram/Discord');
  });

  test('9. India-based internship -> ELIGIBLE', () => {
    const job = {
      title: 'Machine Learning Intern',
      company: 'Swiggy',
      location: 'Bangalore, India',
      description: 'Build real-time delivery estimation and recommendation systems.',
    };
    const res = screenEligibility(job);
    assert.strictEqual(res.eligibility_status, ELIGIBILITY_STATUSES.ELIGIBLE);
    assert.ok(res.eligibility_reasons[0].includes('India-based'));
    assert.strictEqual(isAlertEligible(res), true);
  });

  test('10. India remote internship -> ELIGIBLE', () => {
    const job = {
      title: 'AI Engineering Intern',
      company: 'Flipkart',
      location: 'Remote, India',
      description: 'Help develop customer support agents using large language models.',
    };
    const res = screenEligibility(job);
    assert.strictEqual(res.eligibility_status, ELIGIBILITY_STATUSES.ELIGIBLE);
    assert.ok(res.eligibility_reasons[0].includes('India-based'));
    assert.strictEqual(isAlertEligible(res), true);
  });

  // ── 9. MIN_MATCH_SCORE=70 Notification Threshold & Formatting Tests ────────
  console.log('\n🔹 9. MIN_MATCH_SCORE Notification Threshold & Tiered Formatting Tests:');

  const { shouldAlert } = require('../src/core/eligibilityFilter');
  const { formatTelegram, formatDiscordEmbed } = require('../src/core/formatter');

  test('Score 90 -> alert (Priority Match)', () => {
    const job = { title: 'ML Intern', company: 'Google', eligibility_status: 'ELIGIBLE', matchScore: 90 };
    assert.strictEqual(shouldAlert(job, 70), true, 'Score 90 should be approved for alert');
    const tg = formatTelegram(job);
    assert.ok(tg.includes('PRIORITY MATCH'), '90 score should display PRIORITY MATCH in Telegram');
    const discord = formatDiscordEmbed(job);
    const scoreField = discord.fields.find(f => f.name.includes('Match Score'));
    assert.ok(scoreField.value.includes('PRIORITY MATCH'), '90 score should display PRIORITY MATCH in Discord');
  });

  test('Score 80 -> alert (Priority Match boundary)', () => {
    const job = { title: 'AI Intern', company: 'NVIDIA', eligibility_status: 'ELIGIBLE', matchScore: 80 };
    assert.strictEqual(shouldAlert(job, 70), true, 'Score 80 should be approved for alert');
    const tg = formatTelegram(job);
    assert.ok(tg.includes('PRIORITY MATCH'), '80 score should display PRIORITY MATCH in Telegram');
    const discord = formatDiscordEmbed(job);
    const scoreField = discord.fields.find(f => f.name.includes('Match Score'));
    assert.ok(scoreField.value.includes('PRIORITY MATCH'), '80 score should display PRIORITY MATCH in Discord');
  });

  test('Score 75 -> alert (Good Match / Apply + Learn)', () => {
    const job = { title: 'Backend Intern', company: 'Razorpay', eligibility_status: 'ELIGIBLE', matchScore: 75 };
    assert.strictEqual(shouldAlert(job, 70), true, 'Score 75 should be approved for alert');
    const tg = formatTelegram(job);
    assert.ok(tg.includes('GOOD MATCH'), '75 score should display GOOD MATCH in Telegram');
    const discord = formatDiscordEmbed(job);
    const scoreField = discord.fields.find(f => f.name.includes('Match Score'));
    assert.ok(scoreField.value.includes('GOOD MATCH (Apply + Learn)'), '75 score should display Good Match in Discord');
  });

  test('Score 70 -> alert (Minimum notification boundary)', () => {
    const job = { title: 'SWE Intern', company: 'Swiggy', eligibility_status: 'ELIGIBLE', matchScore: 70 };
    assert.strictEqual(shouldAlert(job, 70), true, 'Score 70 should be approved for alert');
    const tg = formatTelegram(job);
    assert.ok(tg.includes('GOOD MATCH'), '70 score should display GOOD MATCH in Telegram');
  });

  test('Score 69 -> no alert (Below MIN_MATCH_SCORE)', () => {
    const job = { title: 'Junior QA Intern', company: 'GenericCo', eligibility_status: 'ELIGIBLE', matchScore: 69 };
    assert.strictEqual(shouldAlert(job, 70), false, 'Score 69 should be suppressed from alerts');
  });

  test('Score 30 -> no alert (Far below threshold)', () => {
    const job = { title: 'Unrelated IT Intern', company: 'OtherCo', eligibility_status: 'ELIGIBLE', matchScore: 30 };
    assert.strictEqual(shouldAlert(job, 70), false, 'Score 30 should be suppressed from alerts');
  });

  // ── 10. Combined Eligibility + Match-Score Gate Tests ────────────────────
  console.log('\n🔹 10. Combined Eligibility + Match-Score Gate (shouldAlert) Tests:');

  test('Combined Gate: ELIGIBLE + score 85 -> true (Allowed)', () => {
    const job = { title: 'AI Intern', company: 'Google', eligibility_status: ELIGIBILITY_STATUSES.ELIGIBLE, matchScore: 85 };
    assert.strictEqual(shouldAlert(job, 70), true);
  });

  test('Combined Gate: LIKELY_ELIGIBLE + score 75 -> true (Allowed)', () => {
    const job = { title: 'ML Intern', company: 'DeepMind', eligibility_status: ELIGIBILITY_STATUSES.LIKELY_ELIGIBLE, matchScore: 75 };
    assert.strictEqual(shouldAlert(job, 70), true);
  });

  test('Combined Gate: UNCLEAR + score 95 -> false (High score but unclear eligibility suppressed)', () => {
    const job = { title: 'Research Intern', company: 'Foreign Uni', eligibility_status: ELIGIBILITY_STATUSES.UNCLEAR, matchScore: 95 };
    assert.strictEqual(shouldAlert(job, 70), false, 'UNCLEAR jobs must be suppressed from Telegram/Discord alerts even with score 95');
  });

  test('Combined Gate: LIKELY_INELIGIBLE + score 90 -> false (Restricted auth suppressed)', () => {
    const job = { title: 'Robotics Intern', company: 'US Firm', eligibility_status: ELIGIBILITY_STATUSES.LIKELY_INELIGIBLE, matchScore: 90 };
    assert.strictEqual(shouldAlert(job, 70), false, 'LIKELY_INELIGIBLE jobs must be suppressed');
  });

  test('Combined Gate: INELIGIBLE + score 100 -> false (US-only/ineligible suppressed)', () => {
    const job = { title: 'Defense AI Intern', company: 'GovLab', eligibility_status: ELIGIBILITY_STATUSES.INELIGIBLE, matchScore: 100 };
    assert.strictEqual(shouldAlert(job, 70), false, 'INELIGIBLE jobs must be suppressed');
  });

  test('Combined Gate: ELIGIBLE + score 65 -> false (Low match score suppressed)', () => {
    const job = { title: 'IT Support Intern', company: 'LocalCo', eligibility_status: ELIGIBILITY_STATUSES.ELIGIBLE, matchScore: 65 };
    assert.strictEqual(shouldAlert(job, 70), false, 'ELIGIBLE jobs with score < 70 must be suppressed');
  });

  test('Combined Gate: LIKELY_ELIGIBLE + score 69 -> false (Borderline low match suppressed)', () => {
    const job = { title: 'Web Intern', company: 'GlobalStartup', eligibility_status: ELIGIBILITY_STATUSES.LIKELY_ELIGIBLE, matchScore: 69 };
    assert.strictEqual(shouldAlert(job, 70), false, 'LIKELY_ELIGIBLE jobs with score < 70 must be suppressed');
  });

  test('Combined Gate: UNCLEAR + score 60 -> false (Fails both gates)', () => {
    const job = { title: 'Generic Intern', company: 'EuroCo', eligibility_status: ELIGIBILITY_STATUSES.UNCLEAR, matchScore: 60 };
    assert.strictEqual(shouldAlert(job, 70), false, 'UNCLEAR with low score must be suppressed');
  });

  test('Combined Gate: ELIGIBLE unscored (matchScore null) -> true (Allowed)', () => {
    const job = { title: 'AI Intern', company: 'Swiggy', eligibility_status: ELIGIBILITY_STATUSES.ELIGIBLE, matchScore: null };
    assert.strictEqual(shouldAlert(job, 70), true, 'Unscored ELIGIBLE job should pass shouldAlert');
  });

  test('Combined Gate: UNCLEAR unscored (matchScore null) -> false (Suppressed)', () => {
    const job = { title: 'AI Intern', company: 'EuroUni', eligibility_status: ELIGIBILITY_STATUSES.UNCLEAR, matchScore: null };
    assert.strictEqual(shouldAlert(job, 70), false, 'Unscored UNCLEAR job must be suppressed');
  });

  // ── 11. Discovery Scrapers Tests (Indeed, Hirist, Foundit, Naukri) ────────
  console.log('\n🔹 11. Discovery Scrapers Tests (Indeed, Hirist, Foundit, Naukri):');

  async function testAsync(description, fn) {
    try {
      await fn();
      console.log(`  ✅ ${description}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ ${description}`);
      console.error(`     Error: ${err.message}`);
      failedTests++;
    }
  }

  const { normalizeIndeedJob, scrape: scrapeIndeed } = require('../src/scrapers/indeed');
  const { normalizeHiristJob, scrape: scrapeHirist } = require('../src/scrapers/hirist');
  const { normalizeFounditJob, scrape: scrapeFoundit } = require('../src/scrapers/foundit');
  const { normalizeNaukriJob, scrape: scrapeNaukri } = require('../src/scrapers/naukri');

  // INDEED TESTS
  test('Indeed: Valid listing normalizes all required fields', () => {
    const raw = {
      title: 'Machine Learning Intern',
      company: 'TechCorp India',
      location: 'Bengaluru, Karnataka',
      url: 'https://in.indeed.com/viewjob?jk=abc12345&from=serp',
      description: 'Develop PyTorch and LLM pipelines for conversational agents.',
      salary: '₹35,000 / month',
      skills: ['Python', 'PyTorch', 'NLP'],
      experience: '0-1 years',
      postedAt: '2 days ago',
    };
    const job = normalizeIndeedJob(raw);
    assert.ok(job);
    assert.strictEqual(job.title, 'Machine Learning Intern');
    assert.strictEqual(job.company, 'TechCorp India');
    assert.strictEqual(job.location, 'Bengaluru, Karnataka');
    assert.strictEqual(job.remote, false);
    assert.strictEqual(job.url, 'https://in.indeed.com/viewjob');
    assert.strictEqual(job.type, 'internship');
    assert.strictEqual(job.source, '[INDEED]');
    assert.strictEqual(job.salary, '₹35,000 / month');
    assert.deepStrictEqual(job.skills, ['Python', 'PyTorch', 'NLP']);
    assert.strictEqual(job.experience, '0-1 years');
    assert.strictEqual(job.postedAt, '2 days ago');
    assert.ok(job.description.includes('PyTorch'));
  });

  test('Indeed: Malformed listings return null', () => {
    assert.strictEqual(normalizeIndeedJob(null), null);
    assert.strictEqual(normalizeIndeedJob({}), null);
    assert.strictEqual(normalizeIndeedJob({ title: '' }), null);
    assert.strictEqual(normalizeIndeedJob({ title: 'ML Intern' }), null, 'Missing URL must return null');
  });

  test('Indeed: Missing location defaults safely', () => {
    const job = normalizeIndeedJob({
      title: 'Data Science Intern',
      url: 'https://in.indeed.com/viewjob?jk=xyz',
      location: '',
    });
    assert.strictEqual(job.location, 'India');
    assert.strictEqual(passesGeoFilter(job), true);
  });

  test('Indeed: Duplicate URLs with tracking params produce identical clean URLs and hashes', () => {
    const job1 = normalizeIndeedJob({
      title: 'AI Intern',
      company: 'Google',
      url: 'https://in.indeed.com/viewjob?jk=123&utm_source=feed&tk=abc',
    });
    const job2 = normalizeIndeedJob({
      title: 'AI Intern',
      company: 'Google',
      url: 'https://in.indeed.com/viewjob?jk=123&ref=banner&from=vjs',
    });
    assert.strictEqual(job1.url, job2.url);
    assert.strictEqual(Database.hash(job1), Database.hash(job2));
  });

  test('Indeed: India listing passes geo & eligibility filters', () => {
    const job = normalizeIndeedJob({
      title: 'ML Intern',
      company: 'Swiggy',
      location: 'Hyderabad, India',
      url: 'https://in.indeed.com/viewjob?jk=ind1',
    });
    assert.strictEqual(passesGeoFilter(job), true);
    const elig = screenEligibility(job);
    assert.strictEqual(elig.eligibility_status, ELIGIBILITY_STATUSES.ELIGIBLE);
  });

  test('Indeed: Remote listing is recognized and passes geoFilter', () => {
    const job = normalizeIndeedJob({
      title: 'AI Engineer Intern',
      company: 'RemoteStart',
      location: 'Remote',
      url: 'https://in.indeed.com/viewjob?jk=rem1',
    });
    assert.strictEqual(job.remote, true);
    assert.strictEqual(passesGeoFilter(job), true);
  });

  test('Indeed: Foreign-restricted remote listing is flagged LIKELY_INELIGIBLE and blocked from alerts', () => {
    const job = normalizeIndeedJob({
      title: 'ML Research Intern',
      company: 'USLab',
      location: 'Remote',
      description: 'Remote in the US only. Must reside in the United States.',
      url: 'https://in.indeed.com/viewjob?jk=usrem1',
    });
    assert.strictEqual(job.remote, true);
    const elig = screenEligibility(job);
    assert.strictEqual(elig.eligibility_status, ELIGIBILITY_STATUSES.LIKELY_INELIGIBLE);
    job.eligibility_status = elig.eligibility_status;
    job.matchScore = 95;
    assert.strictEqual(shouldAlert(job, 70), false);
  });

  await testAsync('Indeed: Fail-safe returns empty array on network/anti-bot restriction without error', async () => {
    const res = await scrapeIndeed();
    assert.ok(Array.isArray(res));
  });

  // HIRIST TESTS
  test('Hirist: Valid listing normalizes all required fields', () => {
    const raw = {
      title: 'AI / Deep Learning Intern',
      company: 'AI Analytics Ltd',
      location: 'Pune',
      id: '987654',
      description: 'Work on Computer Vision and Transformer models.',
      ctc: '₹25,000 / month',
      keySkills: ['TensorFlow', 'Python', 'PyTorch'],
      exp: '0-0 years',
      postedOn: 'Today',
    };
    const job = normalizeHiristJob(raw);
    assert.ok(job);
    assert.strictEqual(job.title, 'AI / Deep Learning Intern');
    assert.strictEqual(job.company, 'AI Analytics Ltd');
    assert.strictEqual(job.location, 'Pune');
    assert.strictEqual(job.remote, false);
    assert.strictEqual(job.url, 'https://www.hirist.tech/j/987654');
    assert.strictEqual(job.type, 'internship');
    assert.strictEqual(job.source, '[HIRIST]');
    assert.strictEqual(job.salary, '₹25,000 / month');
    assert.deepStrictEqual(job.skills, ['TensorFlow', 'Python', 'PyTorch']);
    assert.strictEqual(job.experience, '0-0 years');
    assert.strictEqual(job.postedAt, 'Today');
  });

  test('Hirist: Malformed listings return null', () => {
    assert.strictEqual(normalizeHiristJob(null), null);
    assert.strictEqual(normalizeHiristJob({}), null);
    assert.strictEqual(normalizeHiristJob({ title: '' }), null);
    assert.strictEqual(normalizeHiristJob({ title: 'AI Intern' }), null, 'Missing URL/id must return null');
  });

  test('Hirist: Missing location defaults safely', () => {
    const job = normalizeHiristJob({
      title: 'GenAI Intern',
      id: '112233',
      location: '',
    });
    assert.strictEqual(job.location, 'India');
    assert.strictEqual(passesGeoFilter(job), true);
  });

  test('Hirist: Duplicate URLs with tracking query params resolve stably', () => {
    const job1 = normalizeHiristJob({
      title: 'SWE Intern',
      company: 'InnoTech',
      url: 'https://www.hirist.tech/j/12345?ref=search&utm_source=feed',
    });
    const job2 = normalizeHiristJob({
      title: 'SWE Intern',
      company: 'InnoTech',
      url: 'https://www.hirist.tech/j/12345?candidate=99',
    });
    assert.strictEqual(job1.url, job2.url);
    assert.strictEqual(Database.hash(job1), Database.hash(job2));
  });

  test('Hirist: India listing passes geo & eligibility filters', () => {
    const job = normalizeHiristJob({
      title: 'Data Science Intern',
      company: 'Razorpay',
      location: 'Bangalore',
      id: '5566',
    });
    assert.strictEqual(passesGeoFilter(job), true);
    const elig = screenEligibility(job);
    assert.strictEqual(elig.eligibility_status, ELIGIBILITY_STATUSES.ELIGIBLE);
  });

  test('Hirist: Remote listing is recognized and passes geoFilter', () => {
    const job = normalizeHiristJob({
      title: 'Backend Engineer Intern',
      company: 'DistributedTech',
      location: 'Work from home',
      id: '7788',
    });
    assert.strictEqual(job.remote, true);
    assert.strictEqual(passesGeoFilter(job), true);
  });

  test('Hirist: Foreign-restricted remote listing is flagged LIKELY_INELIGIBLE and blocked', () => {
    const job = normalizeHiristJob({
      title: 'ML Intern',
      company: 'GlobalCorp',
      location: 'Remote',
      description: 'Restricted to candidates residing in Canada.',
      id: '9900',
    });
    assert.strictEqual(job.remote, true);
    const elig = screenEligibility(job);
    assert.strictEqual(elig.eligibility_status, ELIGIBILITY_STATUSES.LIKELY_INELIGIBLE);
    job.eligibility_status = elig.eligibility_status;
    job.matchScore = 88;
    assert.strictEqual(shouldAlert(job, 70), false);
  });

  await testAsync('Hirist: Fail-safe returns empty array on auth/network restriction without error', async () => {
    const res = await scrapeHirist();
    assert.ok(Array.isArray(res));
  });

  // FOUNDIT TESTS
  test('Foundit: Valid listing normalizes all required fields', () => {
    const raw = {
      title: 'Generative AI Intern',
      company: 'Monster Innovation',
      location: 'Noida',
      id: 'fnt-54321',
      description: 'Building RAG applications and LLM fine-tuning pipelines.',
      salaryText: '₹30,000 - ₹40,000 / Month',
      skillSets: ['Python', 'LangChain', 'Vector DB'],
      experienceText: '0-1 Yrs',
      postedOn: '1 day ago',
    };
    const job = normalizeFounditJob(raw);
    assert.ok(job);
    assert.strictEqual(job.title, 'Generative AI Intern');
    assert.strictEqual(job.company, 'Monster Innovation');
    assert.strictEqual(job.location, 'Noida');
    assert.strictEqual(job.remote, false);
    assert.strictEqual(job.url, 'https://www.foundit.in/job/fnt-54321');
    assert.strictEqual(job.type, 'internship');
    assert.strictEqual(job.source, '[FOUNDIT]');
    assert.strictEqual(job.salary, '₹30,000 - ₹40,000 / Month');
    assert.deepStrictEqual(job.skills, ['Python', 'LangChain', 'Vector DB']);
    assert.strictEqual(job.experience, '0-1 Yrs');
    assert.strictEqual(job.postedAt, '1 day ago');
  });

  test('Foundit: Malformed listings return null', () => {
    assert.strictEqual(normalizeFounditJob(null), null);
    assert.strictEqual(normalizeFounditJob({}), null);
    assert.strictEqual(normalizeFounditJob({ title: '' }), null);
    assert.strictEqual(normalizeFounditJob({ title: 'AI Intern' }), null, 'Missing URL/id must return null');
  });

  test('Foundit: Missing location defaults safely', () => {
    const job = normalizeFounditJob({
      title: 'Python Intern',
      id: 'fnt-001',
      location: '',
    });
    assert.strictEqual(job.location, 'India');
    assert.strictEqual(passesGeoFilter(job), true);
  });

  test('Foundit: Duplicate URLs with tracking query params resolve stably', () => {
    const job1 = normalizeFounditJob({
      title: 'Data Analyst Intern',
      company: 'AnalyticsCo',
      url: 'https://www.foundit.in/job/1122?searchId=abc&source=srp',
    });
    const job2 = normalizeFounditJob({
      title: 'Data Analyst Intern',
      company: 'AnalyticsCo',
      url: 'https://www.foundit.in/job/1122?ref=external',
    });
    assert.strictEqual(job1.url, job2.url);
    assert.strictEqual(Database.hash(job1), Database.hash(job2));
  });

  test('Foundit: India listing passes geo & eligibility filters', () => {
    const job = normalizeFounditJob({
      title: 'AI Research Intern',
      company: 'Infosys',
      location: 'Mysore, Karnataka',
      id: 'fnt-999',
    });
    assert.strictEqual(passesGeoFilter(job), true);
    const elig = screenEligibility(job);
    assert.strictEqual(elig.eligibility_status, ELIGIBILITY_STATUSES.ELIGIBLE);
  });

  test('Foundit: Remote listing is recognized and passes geoFilter', () => {
    const job = normalizeFounditJob({
      title: 'SDE Intern',
      company: 'CloudWorks',
      location: 'Remote',
      id: 'fnt-888',
    });
    assert.strictEqual(job.remote, true);
    assert.strictEqual(passesGeoFilter(job), true);
  });

  test('Foundit: Foreign-restricted remote listing is flagged LIKELY_INELIGIBLE and blocked', () => {
    const job = normalizeFounditJob({
      title: 'ML Systems Intern',
      company: 'EuroTech',
      location: 'Remote',
      description: 'Candidates must be based in the UK. UK residents only.',
      id: 'fnt-777',
    });
    assert.strictEqual(job.remote, true);
    const elig = screenEligibility(job);
    assert.strictEqual(elig.eligibility_status, ELIGIBILITY_STATUSES.LIKELY_INELIGIBLE);
    job.eligibility_status = elig.eligibility_status;
    job.matchScore = 90;
    assert.strictEqual(shouldAlert(job, 70), false);
  });

  await testAsync('Foundit: Fail-safe returns empty array on SPA/WAF restriction without error', async () => {
    const res = await scrapeFoundit();
    assert.ok(Array.isArray(res));
  });

  // NAUKRI TESTS
  test('Naukri: Valid listing normalizes all required fields', () => {
    const raw = {
      title: 'Machine Learning Engineering Intern',
      company: 'Zomato',
      location: 'Gurgaon / Gurugram',
      jobId: '24052026001',
      description: 'Work on recommendation algorithms and feature engineering.',
      salaryPlaceholder: '₹40,000 - ₹50,000 / month',
      tagsAndSkills: 'Python, PyTorch, Scikit-learn, SQL',
      experienceText: '0 - 1 years',
      footerPlaceholderLabel: 'Just now',
    };
    const job = normalizeNaukriJob(raw);
    assert.ok(job);
    assert.strictEqual(job.title, 'Machine Learning Engineering Intern');
    assert.strictEqual(job.company, 'Zomato');
    assert.strictEqual(job.location, 'Gurgaon / Gurugram');
    assert.strictEqual(job.remote, false);
    assert.strictEqual(job.url, 'https://www.naukri.com/job-listings-24052026001');
    assert.strictEqual(job.type, 'internship');
    assert.strictEqual(job.source, '[NAUKRI]');
    assert.strictEqual(job.salary, '₹40,000 - ₹50,000 / month');
    assert.deepStrictEqual(job.skills, ['Python', 'PyTorch', 'Scikit-learn', 'SQL']);
    assert.strictEqual(job.experience, '0 - 1 years');
    assert.strictEqual(job.postedAt, 'Just now');
  });

  test('Naukri: Malformed listings return null', () => {
    assert.strictEqual(normalizeNaukriJob(null), null);
    assert.strictEqual(normalizeNaukriJob({}), null);
    assert.strictEqual(normalizeNaukriJob({ title: '' }), null);
    assert.strictEqual(normalizeNaukriJob({ title: 'AI Intern' }), null, 'Missing URL/jobId must return null');
  });

  test('Naukri: Missing location defaults safely', () => {
    const job = normalizeNaukriJob({
      title: 'AI Intern',
      jobId: 'nk-001',
      location: '',
    });
    assert.strictEqual(job.location, 'India');
    assert.strictEqual(passesGeoFilter(job), true);
  });

  test('Naukri: Duplicate URLs with tracking query params resolve stably', () => {
    const job1 = normalizeNaukriJob({
      title: 'Data Science Intern',
      company: 'Paytm',
      url: 'https://www.naukri.com/job-listings-1234?src=jobsearchDesk&sid=171&xp=1',
    });
    const job2 = normalizeNaukriJob({
      title: 'Data Science Intern',
      company: 'Paytm',
      url: 'https://www.naukri.com/job-listings-1234?utm_source=google',
    });
    assert.strictEqual(job1.url, job2.url);
    assert.strictEqual(Database.hash(job1), Database.hash(job2));
  });

  test('Naukri: India listing passes geo & eligibility filters', () => {
    const job = normalizeNaukriJob({
      title: 'Machine Learning Intern',
      company: 'Flipkart',
      location: 'Bengaluru / Bangalore',
      jobId: 'nk-777',
    });
    assert.strictEqual(passesGeoFilter(job), true);
    const elig = screenEligibility(job);
    assert.strictEqual(elig.eligibility_status, ELIGIBILITY_STATUSES.ELIGIBLE);
  });

  test('Naukri: Remote listing is recognized and passes geoFilter', () => {
    const job = normalizeNaukriJob({
      title: 'AI Engineer Intern',
      company: 'Zepto',
      location: 'Remote',
      jobId: 'nk-666',
    });
    assert.strictEqual(job.remote, true);
    assert.strictEqual(passesGeoFilter(job), true);
  });

  test('Naukri: Foreign-restricted remote listing is flagged LIKELY_INELIGIBLE and blocked', () => {
    const job = normalizeNaukriJob({
      title: 'NLP Research Intern',
      company: 'USLab',
      location: 'Remote',
      description: 'Must reside in the US. No visa sponsorship provided.',
      jobId: 'nk-555',
    });
    assert.strictEqual(job.remote, true);
    const elig = screenEligibility(job);
    assert.strictEqual(elig.eligibility_status, ELIGIBILITY_STATUSES.LIKELY_INELIGIBLE);
    job.eligibility_status = elig.eligibility_status;
    job.matchScore = 95;
    assert.strictEqual(shouldAlert(job, 70), false);
  });

  await testAsync('Naukri: Fail-safe returns empty array on anti-bot restriction without error', async () => {
    const res = await scrapeNaukri();
    assert.ok(Array.isArray(res));
  });

  // ── 12. Daily Top-20 Application Queue Tests ─────────────────────────────
  console.log('\n🔹 12. Daily Top-20 Application Queue Tests:');

  const {
    MIN_QUEUE_MATCH_SCORE,
    MAX_QUEUE_SIZE,
    MAX_ROLES_PER_COMPANY,
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
  } = require('../src/core/applicationQueue');
  const { generateTop20Queue } = require('../src/core/digestGenerator');
  const { formatTelegramHeader, formatDiscordHeader } = require('../src/core/formatter');

  // 1. AI/ML role gets strong relevance (Category A: 90-100)
  test('1. AI/ML role gets strong career-role relevance (Category A: 90-100)', () => {
    const roles = [
      'AI/ML Engineer Intern',
      'Machine Learning Intern',
      'AI Engineer Intern',
      'Applied AI Intern',
      'GenAI Intern',
      'LLM / GenAI Engineering Intern',
      'Deep Learning Intern',
      'NLP Research Intern',
    ];
    roles.forEach(title => {
      const res = calculateCareerRoleRelevance({ title });
      assert.strictEqual(res.category, ROLE_CATEGORIES.AIML, `Failed category for ${title}`);
      assert.ok(res.score >= 90 && res.score <= 100, `Score out of range for ${title}: ${res.score}`);
    });
  });

  // 2. Software Engineer Intern gets strong relevance (Category B: 80-92)
  test('2. Software Engineer Intern gets strong relevance (Category B: 80-92)', () => {
    const res = calculateCareerRoleRelevance({ title: 'Software Engineer Intern' });
    assert.strictEqual(res.category, ROLE_CATEGORIES.SOFTWARE_BACKEND);
    assert.ok(res.score >= 80 && res.score <= 92, `Score ${res.score} not in 80-92 range`);
  });

  // 3. Backend Developer Intern gets strong relevance (Category B: 78-90)
  test('3. Backend Developer Intern gets strong relevance (Category B: 78-90)', () => {
    const res = calculateCareerRoleRelevance({ title: 'Backend Developer Intern' });
    assert.strictEqual(res.category, ROLE_CATEGORIES.SOFTWARE_BACKEND);
    assert.ok(res.score >= 78 && res.score <= 90, `Score ${res.score} not in 78-90 range`);
  });

  // 4. Python Developer Intern gets strong relevance (Category B: 78-90)
  test('4. Python Developer Intern gets strong relevance (Category B: 78-90)', () => {
    const res = calculateCareerRoleRelevance({ title: 'Python Developer Intern' });
    assert.strictEqual(res.category, ROLE_CATEGORIES.SOFTWARE_BACKEND);
    assert.ok(res.score >= 78 && res.score <= 90, `Score ${res.score} not in 78-90 range`);
  });

  // 5. Java Developer Intern gets strong relevance (Category B: 78-90)
  test('5. Java Developer Intern gets strong relevance (Category B: 78-90)', () => {
    const res = calculateCareerRoleRelevance({ title: 'Java Developer Intern' });
    assert.strictEqual(res.category, ROLE_CATEGORIES.SOFTWARE_BACKEND);
    assert.ok(res.score >= 78 && res.score <= 90, `Score ${res.score} not in 78-90 range`);
  });

  // 6. Data Analyst Intern is accepted as a valid target (Category B: 72-88)
  test('6. Data Analyst Intern is accepted as a valid target (Category B: 72-88)', () => {
    const res = calculateCareerRoleRelevance({ title: 'Data Analyst Intern' });
    assert.strictEqual(res.category, ROLE_CATEGORIES.DATA_ANALYTICS);
    assert.ok(res.score >= 72 && res.score <= 88, `Score ${res.score} not in 72-88 range`);

    const job = {
      title: 'Data Analyst Intern',
      company: 'DataCorp',
      url: 'https://example.com/da-1',
      matchScore: 78,
      eligibility_status: 'ELIGIBLE',
    };
    assert.strictEqual(isQueueEligible(job), true, 'Data Analyst must be queue eligible');
  });

  // 7. Data Science Intern gets strong relevance (Category A: 85-95)
  test('7. Data Science Intern gets strong relevance (Category A: 85-95)', () => {
    const res = calculateCareerRoleRelevance({ title: 'Data Science Intern' });
    assert.strictEqual(res.category, ROLE_CATEGORIES.AIML);
    assert.ok(res.score >= 85 && res.score <= 95, `Score ${res.score} not in 85-95 range`);
  });

  // 8. Data Engineer Intern gets strong relevance (Category B: 78-90)
  test('8. Data Engineer Intern gets strong relevance (Category B: 78-90)', () => {
    const res = calculateCareerRoleRelevance({ title: 'Data Engineer Intern' });
    assert.strictEqual(res.category, ROLE_CATEGORIES.DATA_ANALYTICS);
    assert.ok(res.score >= 78 && res.score <= 90, `Score ${res.score} not in 78-90 range`);
  });

  // 9. Cloud/DevOps/Automation gets valid secondary relevance (Category C: 70-85)
  test('9. Cloud/DevOps/Automation gets valid secondary relevance (Category C: 70-85)', () => {
    const cloud = calculateCareerRoleRelevance({ title: 'Cloud Engineer Intern' });
    assert.strictEqual(cloud.category, ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION);
    assert.ok(cloud.score >= 70 && cloud.score <= 85);

    const devops = calculateCareerRoleRelevance({ title: 'DevOps Intern' });
    assert.strictEqual(devops.category, ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION);
    assert.ok(devops.score >= 70 && devops.score <= 85);

    const auto = calculateCareerRoleRelevance({ title: 'Automation Engineer Intern' });
    assert.strictEqual(auto.category, ROLE_CATEGORIES.CLOUD_DEVOPS_AUTOMATION);
    assert.ok(auto.score >= 70 && auto.score <= 85);
  });

  // 10. Full-stack/Web gets valid lower-secondary relevance (Category C: 65-82)
  test('10. Full-stack/Web gets valid lower-secondary relevance (Category C: 65-82)', () => {
    const fullstack = calculateCareerRoleRelevance({ title: 'Full Stack Developer Intern' });
    assert.strictEqual(fullstack.category, ROLE_CATEGORIES.SOFTWARE_BACKEND);
    assert.ok(fullstack.score >= 65 && fullstack.score <= 82);

    const web = calculateCareerRoleRelevance({ title: 'Web Developer Intern' });
    assert.strictEqual(web.category, ROLE_CATEGORIES.SOFTWARE_BACKEND);
    assert.ok(web.score >= 65 && web.score <= 82);
  });

  // 11. ML Trainer is lower than genuine ML engineering when other factors are similar
  test('11. ML Trainer is lower than genuine ML engineering when other factors are similar', () => {
    const mlEng = calculateCareerRoleRelevance({
      title: 'Machine Learning Engineer Intern',
      description: 'Develop and train deep learning models for production recommendation engines.',
    });
    const mlTrainer = calculateCareerRoleRelevance({
      title: 'Machine Learning Trainer Intern',
      description: 'Teach student batches Python and ML basics and grade coding assignments.',
    });
    assert.ok(mlEng.score > mlTrainer.score, `ML Eng (${mlEng.score}) should exceed ML Trainer (${mlTrainer.score})`);
    assert.ok(mlEng.score - mlTrainer.score >= 15, 'Penalty should clearly differentiate teaching from engineering');
  });

  // 12. Generic non-technical roles are excluded (Category E: 0-40)
  test('12. Generic non-technical roles are excluded (Category E: 0-40)', () => {
    const nonTech = ['Sales Executive', 'Marketing Intern', 'HR Recruiter', 'Telecaller', 'Graphic Designer'];
    nonTech.forEach(title => {
      const res = calculateCareerRoleRelevance({ title });
      assert.strictEqual(res.category, ROLE_CATEGORIES.EXCLUDED);
      assert.ok(res.score <= 40, `Non-tech role score too high: ${res.score} for ${title}`);
    });
  });

  // 13. 90% SWE can outrank 75% ML
  test('13. 90% SWE can outrank 75% ML', () => {
    const swe90 = {
      title: 'Software Engineer Intern',
      company: 'TechCorp',
      url: 'https://example.com/swe',
      description: 'Build robust backend microservices in Python and SQL.',
      matchScore: 90,
      eligibility_status: 'ELIGIBLE',
      type: 'internship',
    };
    const mlTrainer75 = {
      title: 'ML Trainer Intern',
      company: 'EduCorp',
      url: 'https://example.com/ml-trainer',
      description: 'Train students and teach machine learning courses.',
      matchScore: 75,
      eligibility_status: 'ELIGIBLE',
      type: 'internship',
    };

    const sweScore = calculateApplicationPriorityScore(swe90);
    const mlScore = calculateApplicationPriorityScore(mlTrainer75);
    assert.ok(sweScore > mlScore, `90% SWE priority (${sweScore}) must outrank 75% ML Trainer (${mlScore})`);

    const queue = buildTop20Queue([mlTrainer75, swe90]);
    assert.strictEqual(queue[0].title, 'Software Engineer Intern');
  });

  // 14. 84% technical Data Analyst can outrank weaker ML opportunity
  test('14. 84% technical Data Analyst can outrank weaker ML opportunity', () => {
    const da84 = {
      title: 'Data Analyst Intern',
      company: 'AnalyticsCo',
      url: 'https://example.com/da',
      description: 'Perform exploratory data analysis using Python, SQL, and Pandas.',
      matchScore: 84,
      eligibility_status: 'ELIGIBLE',
      type: 'internship',
    };
    const genericAi78 = {
      title: 'AI Intern',
      company: 'BasicAI',
      url: 'https://example.com/ai',
      description: 'Generic AI assistant tasks.',
      matchScore: 78,
      eligibility_status: 'ELIGIBLE',
      type: 'internship',
    };

    const daScore = calculateApplicationPriorityScore(da84);
    const aiScore = calculateApplicationPriorityScore(genericAi78);
    assert.ok(daScore > aiScore, `84% technical Data Analyst (${daScore}) must outrank 78% generic AI (${aiScore})`);

    const queue = buildTop20Queue([genericAi78, da84]);
    assert.strictEqual(queue[0].title, 'Data Analyst Intern');
  });

  // 15. Multiple distinct roles from same company can coexist
  test('15. Multiple distinct roles from same company can coexist', () => {
    const jobs = [
      { title: 'ML Engineer Intern', company: 'Google', url: 'https://careers.google.com/1', matchScore: 92, eligibility_status: 'ELIGIBLE' },
      { title: 'Software Engineer Intern', company: 'Google', url: 'https://careers.google.com/2', matchScore: 89, eligibility_status: 'ELIGIBLE' },
    ];
    const queue = buildTop20Queue(jobs);
    assert.strictEqual(queue.length, 2, 'Distinct roles from same company should both enter queue');
    assert.strictEqual(queue[0].title, 'ML Engineer Intern');
    assert.strictEqual(queue[1].title, 'Software Engineer Intern');
  });

  // 16. Maximum 3 roles per company
  test('16. Maximum 3 roles per company', () => {
    const jobs = [
      { title: 'AI Engineer Intern', company: 'MegaCorp', url: 'https://mega.com/1', matchScore: 95, eligibility_status: 'ELIGIBLE' },
      { title: 'ML Researcher Intern', company: 'MegaCorp', url: 'https://mega.com/2', matchScore: 92, eligibility_status: 'ELIGIBLE' },
      { title: 'Software Developer Intern', company: 'MegaCorp', url: 'https://mega.com/3', matchScore: 89, eligibility_status: 'ELIGIBLE' },
      { title: 'Data Scientist Intern', company: 'MegaCorp', url: 'https://mega.com/4', matchScore: 86, eligibility_status: 'ELIGIBLE' },
      { title: 'Backend Developer Intern', company: 'MegaCorp', url: 'https://mega.com/5', matchScore: 83, eligibility_status: 'ELIGIBLE' },
      { title: 'Cloud Engineer Intern', company: 'OtherCo', url: 'https://other.com/1', matchScore: 80, eligibility_status: 'ELIGIBLE' },
    ];
    const queue = buildTop20Queue(jobs);
    assert.strictEqual(queue.length, 4);
    const megaCount = queue.filter(j => j.company === 'MegaCorp').length;
    assert.strictEqual(megaCount, MAX_ROLES_PER_COMPANY, 'Should cap at exactly 3 roles for MegaCorp');
    assert.strictEqual(queue[3].company, 'OtherCo');
  });

  // 17. Duplicate canonical URLs remain deduplicated
  test('17. Duplicate canonical URLs remain deduplicated', () => {
    const jobs = [
      { title: 'ML Intern', company: 'Flipkart', url: 'https://careers.flipkart.com/job1?ref=feed', matchScore: 90, eligibility_status: 'ELIGIBLE' },
      { title: 'ML Intern', company: 'Flipkart', url: 'https://careers.flipkart.com/job1?utm_source=linkedin', matchScore: 90, eligibility_status: 'ELIGIBLE' },
    ];
    const queue = buildTop20Queue(jobs);
    assert.strictEqual(queue.length, 1, 'Duplicate canonical URLs must be deduplicated');
  });

  // 18. <70 match remains excluded
  test('18. <70 match remains excluded from queue', () => {
    const lowMatch = { title: 'AI Intern', company: 'Co', url: 'https://example.com/1', matchScore: 69, eligibility_status: 'ELIGIBLE' };
    assert.strictEqual(isQueueEligible(lowMatch), false);
    const queue = buildTop20Queue([lowMatch]);
    assert.strictEqual(queue.length, 0);
  });

  // 19. UNCLEAR remains excluded
  test('19. UNCLEAR remains excluded from queue', () => {
    const unclear = { title: 'AI Intern', company: 'Co', url: 'https://example.com/1', matchScore: 95, eligibility_status: 'UNCLEAR' };
    assert.strictEqual(isQueueEligible(unclear), false);
    const queue = buildTop20Queue([unclear]);
    assert.strictEqual(queue.length, 0);
  });

  // 20. LIKELY_INELIGIBLE remains excluded
  test('20. LIKELY_INELIGIBLE remains excluded from queue', () => {
    const likelyInelig = { title: 'AI Intern', company: 'Co', url: 'https://example.com/1', matchScore: 95, eligibility_status: 'LIKELY_INELIGIBLE' };
    assert.strictEqual(isQueueEligible(likelyInelig), false);
    const queue = buildTop20Queue([likelyInelig]);
    assert.strictEqual(queue.length, 0);
  });

  // 21. INELIGIBLE remains excluded
  test('21. INELIGIBLE remains excluded from queue', () => {
    const inelig = { title: 'AI Intern', company: 'Co', url: 'https://example.com/1', matchScore: 100, eligibility_status: 'INELIGIBLE' };
    assert.strictEqual(isQueueEligible(inelig), false);
    const queue = buildTop20Queue([inelig]);
    assert.strictEqual(queue.length, 0);
  });

  // 22. APPLIED remains excluded
  test('22. APPLIED remains excluded from queue', () => {
    const apps = [{ company: 'Google', role: 'SWE Intern', url: 'https://careers.google.com/swe', status: 'Applied' }];
    const job = { title: 'SWE Intern', company: 'Google', url: 'https://careers.google.com/swe', matchScore: 90, eligibility_status: 'ELIGIBLE' };
    const queue = buildTop20Queue([job], { applications: apps });
    assert.strictEqual(queue.length, 0);
  });

  // 23. REJECTED remains excluded
  test('23. REJECTED remains excluded from queue', () => {
    const apps = [{ company: 'Meta', role: 'AI Intern', url: 'https://metacareers.com/ai', status: 'Rejected' }];
    const job = { title: 'AI Intern', company: 'Meta', url: 'https://metacareers.com/ai', matchScore: 90, eligibility_status: 'ELIGIBLE' };
    const queue = buildTop20Queue([job], { applications: apps });
    assert.strictEqual(queue.length, 0);
  });

  // 24. WITHDRAWN remains excluded
  test('24. WITHDRAWN remains excluded from queue', () => {
    const apps = [{ company: 'Amazon', role: 'SDE Intern', url: 'https://amazon.jobs/sde', status: 'Withdrawn' }];
    const job = { title: 'SDE Intern', company: 'Amazon', url: 'https://amazon.jobs/sde', matchScore: 90, eligibility_status: 'ELIGIBLE' };
    const queue = buildTop20Queue([job], { applications: apps });
    assert.strictEqual(queue.length, 0);
  });

  // 25. Rolling queue promotion works
  test('25. Rolling queue promotion works', () => {
    const pool = [
      { title: 'AI Intern 1', company: 'CompA', url: 'https://example.com/1', matchScore: 92, eligibility_status: 'ELIGIBLE', type: 'internship' },
      { title: 'AI Intern 2', company: 'CompB', url: 'https://example.com/2', matchScore: 88, eligibility_status: 'ELIGIBLE', type: 'internship' },
      { title: 'AI Intern 3', company: 'CompC', url: 'https://example.com/3', matchScore: 85, eligibility_status: 'ELIGIBLE', type: 'internship' },
    ];
    const initialQueue = buildTop20Queue(pool);
    assert.strictEqual(initialQueue[0].company, 'CompA');
    assert.strictEqual(initialQueue[0].queueRank, 1);

    // Apply to CompA
    const apps = [{ company: 'CompA', role: 'AI Intern 1', url: 'https://example.com/1', status: 'Applied' }];
    const nextQueue = buildTop20Queue(pool, { applications: apps });
    assert.strictEqual(nextQueue.length, 2);
    assert.strictEqual(nextQueue[0].company, 'CompB', 'CompB should be promoted to #1');
    assert.strictEqual(nextQueue[0].queueRank, 1);
    assert.strictEqual(nextQueue[1].company, 'CompC', 'CompC should be promoted to #2');
    assert.strictEqual(nextQueue[1].queueRank, 2);
  });

  // 26. Freshness affects ranking
  test('26. Freshness affects ranking', () => {
    const freshJob = {
      title: 'AI/ML Intern',
      company: 'FreshStartup',
      url: 'https://example.com/fresh',
      category: 'AI / ML & Data Science',
      type: 'internship',
      postedAt: 'today',
      matchScore: 78,
      eligibility_status: 'ELIGIBLE',
    };
    const staleJob = {
      title: 'AI/ML Intern',
      company: 'StaleStartup',
      url: 'https://example.com/stale',
      category: 'AI / ML & Data Science',
      type: 'internship',
      postedAt: '30+ days ago',
      matchScore: 78,
      eligibility_status: 'ELIGIBLE',
    };
    const freshScore = calculateApplicationPriorityScore(freshJob);
    const staleScore = calculateApplicationPriorityScore(staleJob);
    assert.ok(freshScore > staleScore, `Fresh job priority (${freshScore}) must exceed stale job (${staleScore})`);
  });

  // 27. Missing postedAt is safe
  test('27. Missing postedAt is safe', () => {
    const job = {
      title: 'Data Science Intern',
      company: 'NoDateCo',
      url: 'https://example.com/nodate',
      matchScore: 80,
      eligibility_status: 'ELIGIBLE',
      postedAt: null,
    };
    const score = calculateApplicationPriorityScore(job);
    assert.ok(typeof score === 'number' && score >= 0 && score <= 100);
  });

  // 28. Missing optional fields are safe
  test('28. Missing optional fields are safe', () => {
    const minimal = {
      title: 'Software Developer Intern',
      company: 'MinCo',
      url: 'https://example.com/min',
      matchScore: 75,
      eligibility_status: 'ELIGIBLE',
      description: null,
      salary: null,
      skills: null,
    };
    assert.strictEqual(isQueueEligible(minimal), true);
    const score = calculateApplicationPriorityScore(minimal);
    assert.ok(score > 0);
  });

  // 29. Top 5 / Next 10 / Backup 5 tiering works
  test('29. Top 5 / Next 10 / Backup 5 tiering works', () => {
    const jobs20 = Array.from({ length: 20 }, (_, i) => ({
      title: `Developer Intern ${i + 1}`,
      company: `Company${i + 1}`,
      url: `https://example.com/job-${i + 1}`,
      matchScore: 85,
      eligibility_status: 'ELIGIBLE',
    }));
    const queue = buildTop20Queue(jobs20);
    const { priority, next, backup } = tierQueue(queue);
    assert.strictEqual(priority.length, 5);
    assert.strictEqual(next.length, 10);
    assert.strictEqual(backup.length, 5);

    const jobs8 = Array.from({ length: 8 }, (_, i) => ({
      title: `Developer Intern ${i + 1}`,
      company: `Company${i + 1}`,
      url: `https://example.com/job-${i + 1}`,
      matchScore: 85,
      eligibility_status: 'ELIGIBLE',
    }));
    const queue8 = buildTop20Queue(jobs8);
    const tiers8 = tierQueue(queue8);
    assert.strictEqual(tiers8.priority.length, 5);
    assert.strictEqual(tiers8.next.length, 3);
    assert.strictEqual(tiers8.backup.length, 0);
  });

  // 30. Queue never pads with invalid jobs
  test('30. Queue never pads with invalid jobs', () => {
    const mixed = [
      { title: 'ML Intern', company: 'C1', url: 'https://ex.com/1', matchScore: 85, eligibility_status: 'ELIGIBLE' },
      { title: 'SWE Intern', company: 'C2', url: 'https://ex.com/2', matchScore: 80, eligibility_status: 'ELIGIBLE' },
      { title: 'Bad Job 1', company: 'C3', url: 'https://ex.com/3', matchScore: 60, eligibility_status: 'ELIGIBLE' },
      { title: 'Bad Job 2', company: 'C4', url: 'https://ex.com/4', matchScore: 90, eligibility_status: 'UNCLEAR' },
      { title: 'Bad Job 3', company: 'C5', url: 'https://ex.com/5', matchScore: 90, eligibility_status: 'INELIGIBLE' },
    ];
    const queue = buildTop20Queue(mixed);
    assert.strictEqual(queue.length, 2, 'Must never pad queue with bad/ineligible/low-score jobs');
  });

  test('renderQueueMarkdown: Formats 3 tiers with action recommendations, distribution summary, and cards', () => {
    const queue = [
      { title: 'AI Intern', company: 'Tier1Co', url: 'https://example.com/1', roleCategory: 'AI/ML', matchScore: 90, applicationPriorityScore: 92, eligibility_status: 'ELIGIBLE', queueRank: 1, queueTier: 'PRIORITY' },
      { title: 'SWE Intern', company: 'NextCo', url: 'https://example.com/6', roleCategory: 'Software/Backend', matchScore: 78, applicationPriorityScore: 75, eligibility_status: 'ELIGIBLE', queueRank: 6, queueTier: 'NEXT' },
      { title: 'Data Intern', company: 'BackupCo', url: 'https://example.com/16', roleCategory: 'Data/Data Analytics', matchScore: 72, applicationPriorityScore: 68, eligibility_status: 'ELIGIBLE', queueRank: 16, queueTier: 'BACKUP' },
    ];
    const md = renderQueueMarkdown(queue);
    assert.ok(md.includes('PRIORITY — APPLY FIRST'));
    assert.ok(md.includes('NEXT — APPLY AFTER PRIORITY'));
    assert.ok(md.includes('BACKUP — OPPORTUNITIES TO CONSIDER'));
    assert.ok(md.includes("Today's recommended minimum"));
    assert.ok(md.includes('Role Category Distribution'));
    assert.ok(md.includes('Why this is recommended:'));
    assert.ok(md.includes('Apply:'));
  });

  test('formatQueueSummaryTelegram & formatQueueSummaryDiscord produce compact Top-5 highlights with counts', () => {
    const queue = [
      { title: 'AI Intern', company: 'AlphaAI', url: 'https://alpha.ai/job', roleCategory: 'AI/ML', matchScore: 92, applicationPriorityScore: 95, eligibility_status: 'ELIGIBLE', queueRank: 1, queueTier: 'PRIORITY' },
      { title: 'ML Intern', company: 'BetaML', url: 'https://beta.ml/job', roleCategory: 'AI/ML', matchScore: 88, applicationPriorityScore: 89, eligibility_status: 'ELIGIBLE', queueRank: 2, queueTier: 'PRIORITY' },
    ];

    const tg = formatQueueSummaryTelegram(queue);
    assert.ok(tg.includes("TODAY'S TOP 5 TO APPLY FIRST"));
    assert.ok(tg.includes('AlphaAI'));
    assert.ok(tg.includes('NEXT 10'));

    const dc = formatQueueSummaryDiscord(queue);
    assert.ok(dc.title.includes("Today's Top 20 Application Queue"));
    assert.ok(dc.fields.some(f => f.name.includes('TOP 5 TO APPLY TODAY')));

    const tgHeader = formatTelegramHeader(10, 'Morning Run', queue);
    assert.ok(tgHeader.includes("TODAY'S DAILY TARGET: TOP 5 TO APPLY FIRST"));
    assert.ok(tgHeader.includes('AlphaAI'));

    const dcHeader = formatDiscordHeader(10, 'Morning Run', queue);
    assert.ok(dcHeader.fields.some(f => f.name.includes('TOP 5 TO APPLY TODAY')));
  });

  test('Digest Generator: generateTop20Queue generates valid TOP20.md artifact', () => {
    const jobs = [
      { title: 'Machine Learning Intern', company: 'DeepLab', url: 'https://deeplab.ai/careers', matchScore: 88, eligibility_status: 'ELIGIBLE', type: 'internship' },
    ];
    const queue = generateTop20Queue(jobs, []);
    assert.strictEqual(queue.length, 1);
    const top20Path = path.join(__dirname, '..', 'TOP20.md');
    assert.ok(fs.existsSync(top20Path));
    const content = fs.readFileSync(top20Path, 'utf8');
    assert.ok(content.includes('DeepLab'));
    assert.ok(content.includes('PRIORITY — APPLY FIRST'));
  });

  // ── 13. Category-Aware Evaluation Pool Tests ──────────────────────────────
  console.log('\n🔹 13. Category-Aware Candidate Evaluation Pool Tests:');

  // Test 1: AI/ML does not consume all 50 slots when qualified SWE/Data candidates exist
  test('1. AI/ML does not consume all 50 slots when qualified SWE/Data candidates exist', () => {
    const candidates = [];
    // 60 AI/ML jobs
    for (let i = 1; i <= 60; i++) {
      candidates.push({
        title: `Machine Learning Intern ${i}`,
        company: `AI Co ${i}`,
        url: `https://example.com/aiml-${i}`,
        location: 'Bangalore, India',
        eligibility_status: 'ELIGIBLE',
        type: 'internship',
      });
    }
    // 15 SWE jobs
    for (let i = 1; i <= 15; i++) {
      candidates.push({
        title: `Software Engineer Intern ${i}`,
        company: `SWE Co ${i}`,
        url: `https://example.com/swe-${i}`,
        location: 'Bangalore, India',
        eligibility_status: 'ELIGIBLE',
        type: 'internship',
      });
    }
    // 10 Data jobs
    for (let i = 1; i <= 10; i++) {
      candidates.push({
        title: `Data Analyst Intern ${i}`,
        company: `Data Co ${i}`,
        url: `https://example.com/data-${i}`,
        location: 'Bangalore, India',
        eligibility_status: 'ELIGIBLE',
        type: 'internship',
      });
    }

    const pool = selectEvaluationPool(candidates, { maxTotal: 50, log: false });
    assert.strictEqual(pool.length, 50, 'Pool size must be 50');

    const dist = getQueueCategoryDistribution(pool);
    assert.ok(dist['AI/ML'] <= 35, `AI/ML should not consume all slots (got ${dist['AI/ML']})`);
    assert.ok(dist['Software/Backend'] >= 10, `Software/Backend must be represented (got ${dist['Software/Backend']})`);
    assert.ok(dist['Data/Data Analytics'] >= 10, `Data/Data Analytics must be represented (got ${dist['Data/Data Analytics']})`);
  });

  // Test 2: Category-aware pool includes candidates from AI/ML, SWE/Backend, Data, and Cloud
  test('2. Category-aware pool includes representation from all 4 primary target categories', () => {
    const candidates = [
      { title: 'Machine Learning Intern', company: 'C1', url: 'https://ex.com/1', location: 'India', eligibility_status: 'ELIGIBLE' },
      { title: 'Software Engineer Intern', company: 'C2', url: 'https://ex.com/2', location: 'India', eligibility_status: 'ELIGIBLE' },
      { title: 'Data Analyst Intern', company: 'C3', url: 'https://ex.com/3', location: 'India', eligibility_status: 'ELIGIBLE' },
      { title: 'Cloud DevOps Intern', company: 'C4', url: 'https://ex.com/4', location: 'India', eligibility_status: 'ELIGIBLE' },
    ];
    const pool = selectEvaluationPool(candidates, { maxTotal: 50, log: false });
    assert.strictEqual(pool.length, 4);
    const dist = getQueueCategoryDistribution(pool);
    assert.strictEqual(dist['AI/ML'], 1);
    assert.strictEqual(dist['Software/Backend'], 1);
    assert.strictEqual(dist['Data/Data Analytics'], 1);
    assert.strictEqual(dist['Cloud/DevOps/Automation'], 1);
  });

  // Test 3: Unused slots redistribution when a category is under-filled
  test('3. Unused slots redistribution when a category has fewer candidates', () => {
    const candidates = [];
    // 35 AI/ML jobs
    for (let i = 1; i <= 35; i++) {
      candidates.push({
        title: `AI Engineer Intern ${i}`,
        company: `AICo ${i}`,
        url: `https://ex.com/ai-${i}`,
        location: 'India',
        eligibility_status: 'ELIGIBLE',
      });
    }
    // 15 SWE jobs
    for (let i = 1; i <= 15; i++) {
      candidates.push({
        title: `Backend Developer Intern ${i}`,
        company: `SWECo ${i}`,
        url: `https://ex.com/swe-${i}`,
        location: 'India',
        eligibility_status: 'ELIGIBLE',
      });
    }
    // 2 Data jobs (under-filled vs limit of 10)
    for (let i = 1; i <= 2; i++) {
      candidates.push({
        title: `Data Engineering Intern ${i}`,
        company: `DataCo ${i}`,
        url: `https://ex.com/data-${i}`,
        location: 'India',
        eligibility_status: 'ELIGIBLE',
      });
    }
    // 0 Cloud jobs (under-filled vs limit of 5)

    const pool = selectEvaluationPool(candidates, { maxTotal: 50, log: false });
    // Total available = 35 + 15 + 2 = 52. Pool should select 50.
    assert.strictEqual(pool.length, 50, 'Unused slots should be redistributed to fill 50 total');

    const dist = getQueueCategoryDistribution(pool);
    assert.strictEqual(dist['Data/Data Analytics'], 2, 'All 2 Data jobs should be selected');
    assert.strictEqual(dist['Cloud/DevOps/Automation'], 0);
    // Unused slots (8 from Data + 5 from Cloud = 13 unused) should be redistributed to AI/ML and SWE
    assert.ok(dist['AI/ML'] > 25, `AI/ML should receive redistributed slots (got ${dist['AI/ML']})`);
    assert.ok(dist['Software/Backend'] > 10, `Software should receive redistributed slots (got ${dist['Software/Backend']})`);
    assert.strictEqual(dist['AI/ML'] + dist['Software/Backend'] + dist['Data/Data Analytics'], 50);
  });

  // Test 4: Poor quality / ineligible candidates are NEVER added just to satisfy category allocation
  test('4. Poor quality / ineligible candidates are never added to satisfy category allocation', () => {
    const candidates = [
      { title: 'Machine Learning Intern', company: 'C1', url: 'https://ex.com/1', location: 'India', eligibility_status: 'ELIGIBLE' },
      { title: 'Software Engineer Intern', company: 'C2', url: 'https://ex.com/2', location: 'India', eligibility_status: 'ELIGIBLE' },
      // Ineligible jobs that should be blocked
      { title: 'Cloud Engineer Intern', company: 'C3', url: 'https://ex.com/3', location: 'US', eligibility_status: 'INELIGIBLE' },
      { title: 'Data Analyst Intern', company: 'C4', url: 'https://ex.com/4', location: 'UK', eligibility_status: 'UNCLEAR' },
      { title: 'DevOps Intern', company: 'C5', url: 'https://ex.com/5', location: 'Germany', eligibility_status: 'LIKELY_INELIGIBLE' },
      { title: 'Sales Executive Intern', company: 'C6', url: 'https://ex.com/6', location: 'India', eligibility_status: 'ELIGIBLE' }, // Non-technical
      { title: 'SWE Intern Bad URL', company: 'C7', url: 'invalid-url', location: 'India', eligibility_status: 'ELIGIBLE' },
    ];
    const pool = selectEvaluationPool(candidates, { maxTotal: 50, log: false });
    // Only C1 and C2 are valid eligible technical positions!
    assert.strictEqual(pool.length, 2, 'Pool must strictly contain only the 2 eligible technical candidates');
    assert.ok(pool.every(j => j.eligibility_status === 'ELIGIBLE' || j.eligibility_status === 'LIKELY_ELIGIBLE'));
    assert.ok(!pool.some(j => j.company === 'C3' || j.company === 'C4' || j.company === 'C5' || j.company === 'C6' || j.company === 'C7'));
  });

  // Test 5: Candidate pool size never exceeds maxTotal
  test('5. Candidate pool size strictly capped at maxTotal', () => {
    const candidates = [];
    for (let i = 1; i <= 80; i++) {
      candidates.push({
        title: `Software Engineer Intern ${i}`,
        company: `TechCo ${i}`,
        url: `https://ex.com/tech-${i}`,
        location: 'Bangalore, India',
        eligibility_status: 'ELIGIBLE',
      });
    }
    const pool50 = selectEvaluationPool(candidates, { maxTotal: 50, log: false });
    assert.strictEqual(pool50.length, 50);

    const pool20 = selectEvaluationPool(candidates, { maxTotal: 20, log: false });
    assert.strictEqual(pool20.length, 20);
  });

  // Test 6: Intra-category ranking prioritizes rolePriority, geo, internship, freshness, tier-1
  test('6. Intra-category ranking prioritizes high-quality signals (tier-1, India, internship, freshness)', () => {
    const sweJobs = [
      {
        title: 'Junior Software Engineer',
        company: 'GenericStartup',
        url: 'https://ex.com/swe-old',
        location: 'Remote',
        type: 'fulltime',
        postedAt: '1 month ago',
        eligibility_status: 'LIKELY_ELIGIBLE',
      },
      {
        title: 'Software Engineer Intern',
        company: 'Google',
        url: 'https://ex.com/swe-top',
        location: 'Bangalore, India',
        type: 'internship',
        postedAt: 'today',
        eligibility_status: 'ELIGIBLE',
      },
      {
        title: 'Software Developer Intern',
        company: 'MidStartup',
        url: 'https://ex.com/swe-mid',
        location: 'Bangalore, India',
        type: 'internship',
        postedAt: '3 days ago',
        eligibility_status: 'ELIGIBLE',
      },
    ];

    const pool = selectEvaluationPool(sweJobs, { maxTotal: 2, limits: { 'Software/Backend': 2 }, log: false });
    assert.strictEqual(pool.length, 2);
    // Google (Tier 1, India, Intern, Today) must be #1
    assert.strictEqual(pool[0].company, 'Google');
    // MidStartup must be #2
    assert.strictEqual(pool[1].company, 'MidStartup');
    // GenericStartup (old fulltime) should have been dropped due to limit of 2
    assert.ok(!pool.some(j => j.company === 'GenericStartup'));
  });

  // Test 7: Duplicate canonical URLs are deduplicated before evaluation
  test('7. Duplicate canonical URLs are deduplicated before evaluation', () => {
    const duplicates = [
      { title: 'AI Intern', company: 'Alpha', url: 'https://ex.com/job?utm_source=linkedin', location: 'India', eligibility_status: 'ELIGIBLE' },
      { title: 'AI Intern', company: 'Alpha', url: 'https://ex.com/job?utm_source=twitter', location: 'India', eligibility_status: 'ELIGIBLE' },
      { title: 'AI Intern', company: 'Alpha', url: 'https://ex.com/job#apply', location: 'India', eligibility_status: 'ELIGIBLE' },
    ];
    const pool = selectEvaluationPool(duplicates, { maxTotal: 50, log: false });
    assert.strictEqual(pool.length, 1, 'Duplicate canonical URLs must result in a single evaluation entry');
  });

  // Test 8: Final Top 20 is not subject to artificial category quotas (purely merit-based)
  test('8. Final Top 20 queue is not subject to artificial category quotas (pure merit-based)', () => {
    const evaluated = [
      { title: 'SWE Intern', company: 'Uber', url: 'https://ex.com/1', roleCategory: 'Software/Backend', matchScore: 95, eligibility_status: 'ELIGIBLE' },
      { title: 'Backend Intern', company: 'Stripe', url: 'https://ex.com/2', roleCategory: 'Software/Backend', matchScore: 92, eligibility_status: 'ELIGIBLE' },
      { title: 'Data Intern', company: 'Databricks', url: 'https://ex.com/3', roleCategory: 'Data/Data Analytics', matchScore: 90, eligibility_status: 'ELIGIBLE' },
      { title: 'ML Intern', company: 'SmallCo', url: 'https://ex.com/4', roleCategory: 'AI/ML', matchScore: 72, eligibility_status: 'ELIGIBLE' },
    ];
    const queue = buildTop20Queue(evaluated);
    assert.strictEqual(queue[0].title, 'SWE Intern', 'Highest priority SWE intern should be #1 in queue');
    assert.strictEqual(queue[1].title, 'Backend Intern', 'High priority Backend intern should be #2 in queue');
    assert.strictEqual(queue[2].title, 'Data Intern', 'High priority Data intern should be #3 in queue');
    assert.strictEqual(queue[3].title, 'ML Intern', 'Lower scoring ML intern should be #4');
  });

  // Test 9: End-to-end integration: Category-aware pool allows SWE/Data to reach Gemini and enter Top 20
  test('9. Category-aware evaluation pool enables qualified SWE & Data roles to reach Gemini evaluation and enter Top 20', () => {
    // Simulate candidate pool where AI/ML has 40 listings, SWE has 10 listings, Data has 5 listings
    const candidatePool = [];
    for (let i = 1; i <= 40; i++) {
      candidatePool.push({
        title: `AI/ML Research Intern ${i}`,
        company: `Startup AI ${i}`,
        url: `https://ex.com/ai-${i}`,
        location: 'Bangalore, India',
        eligibility_status: 'ELIGIBLE',
        type: 'internship',
      });
    }
    // High quality SWE roles
    candidatePool.push({
      title: 'Software Engineer Intern',
      company: 'Amazon',
      url: 'https://amazon.jobs/swe-intern',
      location: 'Hyderabad, India',
      eligibility_status: 'ELIGIBLE',
      type: 'internship',
      postedAt: 'today',
    });
    // High quality Data role
    candidatePool.push({
      title: 'Data Analyst Intern',
      company: 'Swiggy',
      url: 'https://swiggy.com/careers/data-analyst',
      location: 'Bangalore, India',
      eligibility_status: 'ELIGIBLE',
      type: 'internship',
      postedAt: 'today',
    });

    // Run selectEvaluationPool
    const toEvaluate = selectEvaluationPool(candidatePool, { maxTotal: 50, log: false });
    assert.ok(toEvaluate.some(j => j.title === 'Software Engineer Intern' && j.company === 'Amazon'), 'Amazon SWE must be selected for evaluation');
    assert.ok(toEvaluate.some(j => j.title === 'Data Analyst Intern' && j.company === 'Swiggy'), 'Swiggy Data Analyst must be selected for evaluation');

    // Simulate LLM evaluation where Amazon SWE scores 88%, Swiggy Data scores 82%, and Startup AI jobs score 75%
    const evaluated = toEvaluate.map(j => {
      let score = 75;
      if (j.company === 'Amazon') score = 90;
      if (j.company === 'Swiggy') score = 84;
      return { ...j, matchScore: score };
    });

    // Build Top 20 Queue
    const queue = buildTop20Queue(evaluated);
    assert.ok(queue.length > 0);
    // Amazon SWE and Swiggy Data should be in Top 5 Priority tier!
    const queueTitles = queue.slice(0, 5).map(j => `${j.title} @ ${j.company}`);
    assert.ok(queueTitles.includes('Software Engineer Intern @ Amazon'), `Amazon SWE must enter Top 5 queue (got: ${queueTitles.join(', ')})`);
    assert.ok(queueTitles.includes('Data Analyst Intern @ Swiggy'), `Swiggy Data Analyst must enter Top 5 queue (got: ${queueTitles.join(', ')})`);
  });

  console.log('\n' + '═'.repeat(60));
  console.log(`  📊 TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('═'.repeat(60) + '\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
