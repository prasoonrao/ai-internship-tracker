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
    assert.strictEqual(isAlertEligible(res), true, 'UNCLEAR positions should not be silently dropped');
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
