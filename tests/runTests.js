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
