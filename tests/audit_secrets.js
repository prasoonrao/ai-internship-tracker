'use strict';

const fs = require('fs');
const path = require('path');

const secretPatterns = [
  { name: 'Telegram Bot Token', pattern: /(?:bot)?\d{9,11}:[A-Za-z0-9_-]{35}/ },
  { name: 'Discord Webhook URL', pattern: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,}/ },
  { name: 'Google API Key', pattern: /AIza[0-9A-Za-z-_]{35}/ },
  { name: 'SerpAPI Key', pattern: /serpapi[_-]?key\s*[:=]\s*['"][0-9a-f]{32,}['"]/i },
];

let issues = 0;

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file === 'node_modules' || file === '.git' || file === 'seen_jobs.json') continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath);
    } else if (stat.isFile() && !file.endsWith('.png') && !file.endsWith('.jpg') && !file.endsWith('.lock')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      secretPatterns.forEach(({ name, pattern }) => {
        const match = content.match(pattern);
        if (match) {
          console.warn(`[EXPOSED SECRET WARNING] Found ${name} in ${fullPath}: ${match[0].slice(0, 8)}...`);
          issues++;
        }
      });
    }
  }
}

console.log('Scanning for exposed secrets across all tracked files...');
scanDir(path.join(__dirname, '..'));
if (issues === 0) {
  console.log('✅ CLEAN: No exposed credentials or secrets found.');
} else {
  console.error(`❌ FOUND ${issues} potential credential issues!`);
}
