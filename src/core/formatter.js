'use strict';

const { getGeoTag } = require('./geoFilter');
const { getTelegramEligibilityBadge, getDiscordEligibilityField } = require('./eligibilityFilter');

// Emoji map
const TYPE_EMOJI = {
  internship: '🧪',
  fulltime: '💼',
  contract: '📝',
};

const SOURCE_EMOJI = {
  'Google Jobs': '🔍',
  'Internshala': '🎓',
  'IndiaDirect': '🏢',
  'RemoteOK': '🌐',
  'WeWorkRemotely': '🏠',
  'YCombinator': '🚀',
  'GitHub Repos': '📦',
  'Freshersworld': '🌱',
  'Remotive': '💡',
  '[UNSTOP]': '🎯',
  'UNSTOP': '🎯',
  'Unstop': '🎯',
  '[YC]': '🚀',
  'YC': '🚀',
  '[WELLFOUND]': '🦄',
  'WELLFOUND': '🦄',
  'Wellfound': '🦄',
  '[LINKEDIN]': '💼',
  'LINKEDIN': '💼',
  'LinkedIn': '💼',
  '[INDEED]': '💼',
  'INDEED': '💼',
  'Indeed': '💼',
  '[HIRIST]': '🎯',
  'HIRIST': '🎯',
  'Hirist': '🎯',
  '[FOUNDIT]': '🔎',
  'FOUNDIT': '🔎',
  'Foundit': '🔎',
  '[NAUKRI]': '📄',
  'NAUKRI': '📄',
  'Naukri': '📄',
};

// Escape special MarkdownV2 characters for Telegram
function escapeMdV2(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, c => `\\${c}`);
}

function safeUrl(url) {
  if (!url) return '';
  return url.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * Format a single job as Telegram MarkdownV2 message
 */
function formatTelegram(job) {
  const typeEmoji = TYPE_EMOJI[job.type] || '💼';
  const sourceEmoji = SOURCE_EMOJI[job.source] || '📌';
  const geoTag = getGeoTag(job);
  const categoryTag = job.category === 'AI / ML & Data Science' ? '🧠 AI/ML' : '💻 SWE';

  const title = escapeMdV2(job.title);
  const company = escapeMdV2(job.company || 'Unknown Company');
  const location = escapeMdV2(job.location || 'Not specified');
  const salary = job.salary ? `\n💰 ${escapeMdV2(job.salary)}` : '';
  const typeLabel = job.type === 'internship' ? 'Internship' : job.type === 'contract' ? 'Contract' : 'Full-Time';
  const type = escapeMdV2(typeLabel);
  const source = escapeMdV2(job.source || 'Unknown');
  const url = safeUrl(job.url || '');
  const posted = job.postedAt ? `\n⏱ ${escapeMdV2(job.postedAt)}` : '';

  // Quick tracker command helper
  const cleanComp = (job.company || 'Company').replace(/["'\\]/g, '');
  const cleanRole = (job.title || 'Role').replace(/["'\\]/g, '');
  const trackSnippet = escapeMdV2(`npm run track -- add "${cleanComp}" "${cleanRole}"`);
  const eligibilityBadge = getTelegramEligibilityBadge(job.eligibility_status, job.eligibility_reasons);

  let matchLine = '';
  if (job.matchScore != null) {
    if (job.matchScore >= 80) {
      matchLine = `\n🔥 *PRIORITY MATCH: ${escapeMdV2(String(job.matchScore))}%*`;
    } else if (job.matchScore >= 70) {
      matchLine = `\n⚡ *GOOD MATCH: ${escapeMdV2(String(job.matchScore))}%* _(Apply \\+ Learn)_`;
    } else {
      matchLine = `\n📊 *Match: ${escapeMdV2(String(job.matchScore))}%*`;
    }
  }

  return (
    `${typeEmoji} *${title}*\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `🏢 *${company}*\n` +
    `📍 ${location} ${escapeMdV2(geoTag)}\n` +
    `🏷 ${type} • ${escapeMdV2(categoryTag)} • ${sourceEmoji} ${source}\n` +
    `🌍 *International Eligibility:*\n${escapeMdV2(eligibilityBadge)}` +
    `${matchLine}` +
    `${job.aiReason ? `\n💡 ${escapeMdV2(job.aiReason)}` : ''}` +
    `${salary}` +
    `${posted}\n` +
    `${job.coldPitch && job.matchScore >= 80 ? `\n✉️ _${escapeMdV2(job.coldPitch)}_\n` : ''}` +
    `\n🔗 [Apply Now →](${url})` +
    `\n📝 Log App: \`${trackSnippet}\``
  );
}

/**
 * Format a batch header for Telegram
 */
function formatTelegramHeader(count, runType, queue = []) {
  const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  let header = (
    `🤖 *NMAMIT 2028 Internship Bot* — ${escapeMdV2(String(count))} new match${count > 1 ? 'es' : ''} found\\!\n` +
    `_Run: ${escapeMdV2(runType)} \\| ${escapeMdV2(time)} IST_\n`
  );

  if (queue && queue.length > 0) {
    const priority = queue.slice(0, 5);
    const nextCount = queue.filter(j => j.queueTier === 'NEXT').length;
    const backupCount = queue.filter(j => j.queueTier === 'BACKUP').length;

    header += `\n🎯 *TODAY'S DAILY TARGET: TOP 5 TO APPLY FIRST*\n`;
    header += `_Today's recommended minimum: apply to these 5 Priority jobs\\._\n\n`;

    priority.forEach(j => {
      const title = escapeMdV2(j.title);
      const company = escapeMdV2(j.company);
      const url = safeUrl(j.url);
      const match = j.matchScore != null ? `${j.matchScore}%` : '70%';
      const prio = j.applicationPriorityScore != null ? j.applicationPriorityScore : '80';
      const cat = escapeMdV2(j.roleCategory || 'AI/ML');
      const loc = escapeMdV2(j.location || 'India/Remote');

      header += `🔥 *\\#${j.queueRank || 1}* [${title}](${url}) @ *${company}*\n`;
      header += `   _Category: ${cat} \\| Match: ${escapeMdV2(match)} \\| Priority: ${escapeMdV2(String(prio))}_\n`;
      header += `   _📍 ${loc}_\n\n`;
    });

    header += `🟢 *NEXT 10*: ${nextCount} opportunities\n`;
    header += `🟡 *BACKUP 5*: ${backupCount} opportunities\n`;
    header += `_Full Top\\-20 queue and details in TOP20\\.md_\n`;
  }

  return header;
}

/**
 * Format a single job as a Discord embed object
 */
function formatDiscordEmbed(job) {
  const geoTag = getGeoTag(job);
  const sourceEmoji = SOURCE_EMOJI[job.source] || '📌';
  const categoryTag = job.category === 'AI / ML & Data Science' ? '🧠 AI / ML' : '💻 SWE / Backend';

  // Green for AI/ML internship, Cyan for SWE, Blue for other
  const color =
    job.category === 'AI / ML & Data Science' ? 0x9b59b6 : // Purple for AI/ML
    job.type === 'internship'                 ? 0x00b894 : // Green for Internship
                                                0x0984e3;   // Blue for Full-time

  const fields = [
    { name: '🏢 Company', value: (job.company || 'Unknown').slice(0, 1024), inline: true },
    { name: '📍 Location', value: `${(job.location || 'Not specified').slice(0, 900)} ${geoTag}`, inline: true },
    { name: '🏷 Category', value: categoryTag, inline: true },
    { name: '🧪 Type', value: job.type === 'internship' ? 'Internship' : 'Full-Time', inline: true },
    { name: `${sourceEmoji} Source`, value: (job.source || 'Unknown'), inline: true },
  ];

  if (job.salary) {
    fields.push({ name: '💰 Terms / Stipend', value: job.salary.slice(0, 1024), inline: true });
  }
  if (job.postedAt) {
    fields.push({ name: '⏱ Posted', value: job.postedAt, inline: true });
  }
  if (job.matchScore != null) {
    const scoreTitle = job.matchScore >= 80 ? '🔥 AI Match Score' : job.matchScore >= 70 ? '⚡ AI Match Score' : '📊 AI Match Score';
    const scoreVal = job.matchScore >= 80
      ? `**${job.matchScore}% — PRIORITY MATCH**`
      : job.matchScore >= 70
        ? `**${job.matchScore}% — GOOD MATCH (Apply + Learn)**`
        : `**${job.matchScore}%**`;
    fields.push({ name: scoreTitle, value: scoreVal, inline: true });
  }
  if (job.aiReason) {
    fields.push({ name: '💡 AI Profile Fit Insight', value: job.aiReason.slice(0, 1024), inline: false });
  }
  if (job.coldPitch && job.matchScore >= 80) {
    fields.push({ name: '✉️ Tailored Cold Pitch (LinkedIn)', value: job.coldPitch.slice(0, 1024), inline: false });
  }

  const eligField = getDiscordEligibilityField(job.eligibility_status, job.eligibility_reasons);
  fields.push({
    name: eligField.name,
    value: eligField.value,
    inline: eligField.inline,
  });

  // Quick tracker command
  const cleanComp = (job.company || 'Company').replace(/["'\\]/g, '');
  const cleanRole = (job.title || 'Role').replace(/["'\\]/g, '');
  fields.push({
    name: '📝 Log to Application Tracker',
    value: `\`npm run track -- add "${cleanComp}" "${cleanRole}"\``,
    inline: false,
  });

  return {
    title: ((TYPE_EMOJI[job.type] || '💼') + ' ' + (job.title || 'Job Opportunity')).slice(0, 256),
    url: job.url || undefined,
    color,
    fields,
    footer: {
      text: `NMAMIT CSE '28 Internship Tracker • ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format a Discord summary embed
 */
function formatDiscordHeader(count, runType, queue = []) {
  const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const embed = {
    title: `🤖 NMAMIT 2028 Bot — ${count} New Match${count > 1 ? 'es' : ''} Found!`,
    description: `Here are the latest AI/ML and SWE internship opportunities matched to your profile. Good luck! 🚀`,
    color: 0x6c5ce7,
    fields: [],
    footer: { text: `${runType} • ${time} IST` },
    timestamp: new Date().toISOString(),
  };

  if (queue && queue.length > 0) {
    const priority = queue.slice(0, 5);
    const nextCount = queue.filter(j => j.queueTier === 'NEXT').length;
    const backupCount = queue.filter(j => j.queueTier === 'BACKUP').length;

    const top5Text = priority.map(j => {
      const match = j.matchScore != null ? `${j.matchScore}%` : '70%';
      const prio = j.applicationPriorityScore != null ? j.applicationPriorityScore : '80';
      const cat = j.roleCategory || 'AI/ML';
      const loc = j.location || 'India / Remote';
      return `🔥 **#${j.queueRank || 1}** [${j.title}](${j.url || '#'}) @ **${j.company}**\n` +
             `   • **Category:** ${cat} | **Match:** ${match} | **Priority:** ${prio}\n` +
             `   • **Location:** ${loc}`;
    }).join('\n\n');

    embed.fields.push({
      name: `🔥 TOP 5 TO APPLY TODAY (Today's Minimum Target)`,
      value: top5Text.slice(0, 1024),
      inline: false,
    });
    embed.fields.push({
      name: `📋 Additional Opportunities`,
      value: `🟢 **NEXT 10:** ${nextCount} opportunities\n🟡 **BACKUP 5:** ${backupCount} opportunities\n*Full details & tracking commands in \`TOP20.md\`*`,
      inline: false,
    });
  }

  return embed;
}

module.exports = {
  formatTelegram,
  formatTelegramHeader,
  formatDiscordEmbed,
  formatDiscordHeader,
  escapeMdV2,
  safeUrl,
};
