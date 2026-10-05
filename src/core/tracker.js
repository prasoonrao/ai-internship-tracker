'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const APPS_FILE = path.join(DATA_DIR, 'applications.json');
const MD_FILE = path.join(ROOT_DIR, 'APPLICATIONS.md');

const VALID_STATUSES = [
  'Bookmarked',
  'Applied',
  'Screening',
  'Assessment',
  'Interview',
  'Offer',
  'Rejected',
  'Ghosted',
  'Withdrawn',
];

const STATUS_BADGES = {
  'Bookmarked': '📌 Bookmarked',
  'Applied': '⏳ Applied',
  'Screening': '🔍 Screening',
  'Assessment': '📝 OA / Assessment',
  'Interview': '🎙️ Interview',
  'Offer': '🎉 Offer',
  'Rejected': '❌ Rejected',
  'Ghosted': '👻 No Response',
  'Withdrawn': '🚪 Withdrawn',
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadApplications() {
  ensureDir();
  if (!fs.existsSync(APPS_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(APPS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[Tracker] Error reading applications:', err.message);
    return [];
  }
}

function saveApplications(apps) {
  ensureDir();
  fs.writeFileSync(APPS_FILE, JSON.stringify(apps, null, 2), 'utf8');
}

function calculateDaysOld(dateStr) {
  if (!dateStr) return 'Unknown';
  try {
    const applied = new Date(dateStr);
    const now = new Date();
    const diffTime = Math.abs(now - applied);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  } catch {
    return 'Unknown';
  }
}

function renderMarkdown(apps) {
  const todayStr = new Date().toISOString().split('T')[0];
  const total = apps.length;

  const statusCounts = {};
  VALID_STATUSES.forEach(s => { statusCounts[s] = 0; });
  apps.forEach(a => {
    const st = a.status || 'Applied';
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  });

  const activeCount = (statusCounts['Applied'] || 0) + (statusCounts['Screening'] || 0) + (statusCounts['Assessment'] || 0) + (statusCounts['Interview'] || 0);

  const lines = [
    '# 🎯 Internship Application Tracker',
    '',
    `> **Candidate:** NMAMIT B.Tech CSE (Batch of 2028) | **Target:** AI/ML & SWE Internships`,
    `> **Last Updated:** ${todayStr} | **Active Pipeline:** ${activeCount} roles in progress`,
    '',
    '## 📊 Pipeline Summary',
    '',
    '| Status | Count |',
    '|---|---|',
    `| ⏳ Applied / In Review | ${statusCounts['Applied'] || 0} |`,
    `| 🔍 Screening / Resume Pick | ${statusCounts['Screening'] || 0} |`,
    `| 📝 Online Assessment (OA) | ${statusCounts['Assessment'] || 0} |`,
    `| 🎙️ Technical Interview | ${statusCounts['Interview'] || 0} |`,
    `| 🎉 Offers Received | ${statusCounts['Offer'] || 0} |`,
    `| ❌ Rejected | ${statusCounts['Rejected'] || 0} |`,
    `| 👻 Stale / Ghosted (>30 days) | ${statusCounts['Ghosted'] || 0} |`,
    `| 📌 Bookmarked / To Apply | ${statusCounts['Bookmarked'] || 0} |`,
    `| **Total Tracked** | **${total}** |`,
    '',
    '---',
    '',
    '## 📋 Tracked Applications',
    '',
  ];

  if (apps.length === 0) {
    lines.push('*No applications logged yet.*');
    lines.push('');
    lines.push('### Quick Start:');
    lines.push('```bash');
    lines.push('npm run track -- add "Google" "AI/ML Intern" "2026-10-02" "Applied" "Applied via careers portal" "https://careers.google.com"');
    lines.push('```');
  } else {
    lines.push('| # | Company | Role | Eligibility | Date Applied | Days Old | Status | Notes | Link |');
    lines.push('|---|---|---|---|---|---|---|---|---|');

    apps.forEach((a, idx) => {
      const days = calculateDaysOld(a.dateApplied);
      const daysText = typeof days === 'number' ? `${days}d` : days;
      const statusBadge = STATUS_BADGES[a.status] || a.status;
      const linkCell = a.url ? `[Link](${a.url})` : '—';
      const followUp = typeof days === 'number' && days >= 14 && ['Applied', 'Screening'].includes(a.status) ? ' ⚠️ *Follow-up*' : '';
      const eligBadge = a.eligibility || '🟢 Eligible';

      lines.push(
        `| ${idx + 1} | **${a.company}** | ${a.role} | ${eligBadge} | ${a.dateApplied || '—'} | ${daysText}${followUp} | ${statusBadge} | ${a.notes || ''} | ${linkCell} |`
      );
    });
  }

  lines.push('');
  lines.push('---');
  lines.push('### 💡 Tracker CLI Cheat Sheet');
  lines.push('```bash');
  lines.push('# Add a new application');
  lines.push('npm run track -- add "Amazon" "Software Dev Intern" "2026-10-02" "Applied" "Referral by alum"');
  lines.push('');
  lines.push('# Update status');
  lines.push('npm run track -- update 1 "Interview" "Round 1 technical on Zoom"');
  lines.push('');
  lines.push('# List applications and regenerate markdown');
  lines.push('npm run track -- list');
  lines.push('npm run track -- render');
  lines.push('```');
  lines.push('');

  fs.writeFileSync(MD_FILE, lines.join('\n'), 'utf8');
  console.log(`[Tracker] Rendered ${MD_FILE} (${apps.length} applications)`);
}

function addApplication(company, role, dateApplied, status = 'Applied', notes = '', url = '', eligibility = '🟢 Eligible') {
  const apps = loadApplications();
  const today = new Date().toISOString().split('T')[0];
  const newApp = {
    id: `app_${Date.now()}`,
    company: company.trim(),
    role: role.trim(),
    dateApplied: dateApplied ? dateApplied.trim() : today,
    status: status.trim(),
    notes: notes ? notes.trim() : '',
    url: url ? url.trim() : '',
    eligibility: eligibility ? eligibility.trim() : '🟢 Eligible',
    updatedAt: new Date().toISOString(),
  };

  apps.push(newApp);
  saveApplications(apps);
  renderMarkdown(apps);
  console.log(`[Tracker] ✅ Added application: ${company} — ${role} (${newApp.status})`);
  return newApp;
}

function updateApplication(indexOrId, newStatus, newNotes) {
  const apps = loadApplications();
  let targetIndex = -1;

  if (typeof indexOrId === 'number' || /^\d+$/.test(indexOrId)) {
    const idx = parseInt(indexOrId, 10);
    // 1-indexed for users, or 0-indexed fallback
    if (idx >= 1 && idx <= apps.length) {
      targetIndex = idx - 1;
    } else if (idx === 0 && apps.length > 0) {
      targetIndex = 0;
    }
  } else {
    targetIndex = apps.findIndex(a => a.id === indexOrId);
  }

  if (targetIndex === -1) {
    console.error(`[Tracker] ❌ Application not found: ${indexOrId}`);
    return false;
  }

  if (newStatus) {
    apps[targetIndex].status = newStatus.trim();
  }
  if (newNotes) {
    apps[targetIndex].notes = newNotes.trim();
  }
  apps[targetIndex].updatedAt = new Date().toISOString();

  saveApplications(apps);
  renderMarkdown(apps);
  console.log(`[Tracker] ✅ Updated [${targetIndex + 1}] ${apps[targetIndex].company}: ${apps[targetIndex].status}`);
  return true;
}

function removeApplication(indexOrId) {
  const apps = loadApplications();
  let targetIndex = -1;

  if (typeof indexOrId === 'number' || /^\d+$/.test(indexOrId)) {
    const idx = parseInt(indexOrId, 10);
    if (idx >= 1 && idx <= apps.length) targetIndex = idx - 1;
    else if (idx === 0) targetIndex = 0;
  } else {
    targetIndex = apps.findIndex(a => a.id === indexOrId);
  }

  if (targetIndex === -1) {
    console.error(`[Tracker] ❌ Application not found: ${indexOrId}`);
    return false;
  }

  const removed = apps.splice(targetIndex, 1)[0];
  saveApplications(apps);
  renderMarkdown(apps);
  console.log(`[Tracker] 🗑️ Removed application: ${removed.company} — ${removed.role}`);
  return true;
}

function listApplications() {
  const apps = loadApplications();
  console.log(`\n📋 Current Applications (${apps.length}):\n`);
  apps.forEach((a, i) => {
    const days = calculateDaysOld(a.dateApplied);
    console.log(`  ${i + 1}. [${a.status}] ${a.company} - ${a.role} (Applied: ${a.dateApplied}, ${days}d ago)`);
    if (a.notes) console.log(`     Notes: ${a.notes}`);
  });
  console.log('');
}

// CLI entry point
function cli() {
  const args = process.argv.slice(2);
  const command = args[0] ? args[0].toLowerCase() : 'help';

  switch (command) {
    case 'add':
      if (args.length < 3) {
        console.log('Usage: npm run track -- add "<Company>" "<Role>" [dateApplied] [status] [notes] [url]');
        return;
      }
      addApplication(args[1], args[2], args[3], args[4], args[5], args[6]);
      break;

    case 'update':
      if (args.length < 3) {
        console.log('Usage: npm run track -- update <index> "<newStatus>" [notes]');
        return;
      }
      updateApplication(args[1], args[2], args[3]);
      break;

    case 'remove':
    case 'rm':
      if (args.length < 2) {
        console.log('Usage: npm run track -- remove <index>');
        return;
      }
      removeApplication(args[1]);
      break;

    case 'list':
    case 'ls':
      listApplications();
      break;

    case 'render':
      renderMarkdown(loadApplications());
      break;

    default:
      console.log(`
Internship Application Tracker CLI
---------------------------------
Commands:
  npm run track -- add "<Company>" "<Role>" [dateApplied] [status] [notes] [url]
  npm run track -- update <index> "<newStatus>" [notes]
  npm run track -- remove <index>
  npm run track -- list
  npm run track -- render
      `);
      break;
  }
}

if (require.main === module) {
  cli();
}

module.exports = {
  loadApplications,
  saveApplications,
  addApplication,
  updateApplication,
  removeApplication,
  renderMarkdown,
  calculateDaysOld,
  VALID_STATUSES,
};
