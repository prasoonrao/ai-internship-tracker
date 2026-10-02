'use strict';

const axios = require('axios');
const { formatDiscordEmbed, formatDiscordHeader } = require('../core/formatter');

// 2s between webhook calls — safely under Discord's 30 webhooks/min limit
const DELAY_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postWebhook(url, payload, retries = 2) {
  try {
    const res = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    return res;
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      if (status === 429 && retries > 0) {
        const retryAfter = parseFloat(
          err.response.headers['x-ratelimit-reset-after'] ||
          err.response.headers['retry-after'] || '5'
        );
        console.warn(`[Discord] Rate limited. Waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        return postWebhook(url, payload, retries - 1);
      }
      const errMsg = `Discord HTTP ${status}: ${JSON.stringify(err.response.data)}`;
      console.error(`[Discord] ${errMsg}`);
      throw new Error(errMsg); // Re-throw for allSettled detection
    }
    console.error('[Discord] Request error:', err.message);
    throw err; // Re-throw for allSettled detection
  }
}

class DiscordNotifier {
  constructor(webhookUrl) {
    this.webhookUrl = webhookUrl;
  }

  async sendEmbed(embed) {
    await postWebhook(this.webhookUrl, { embeds: [embed] });
  }

  /**
   * FIX Issue 5: Only sends messages when jobs.length > 0.
   * FIX Issue 7: Errors propagate up to main.js allSettled.
   */
  async sendJobs(jobs, runType = 'Morning Run') {
    const dryRun = process.env.DRY_RUN === 'true';

    if (jobs.length === 0) {
      console.log('[Discord] No jobs to send (called with empty array).');
      return;
    }

    // Send header embed
    const headerEmbed = formatDiscordHeader(jobs.length, runType);
    if (dryRun) {
      console.log('[DRY RUN][Discord] Header:', jobs.length, 'jobs');
    } else {
      await this.sendEmbed(headerEmbed);
      await sleep(DELAY_MS);
    }

    // Send each job as an embed
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const embed = formatDiscordEmbed(job);

      if (dryRun) {
        console.log(`[DRY RUN][Discord] ${i + 1}/${jobs.length}: ${job.title} @ ${job.company}`);
      } else {
        console.log(`[Discord] Sending ${i + 1}/${jobs.length}: ${job.title} @ ${job.company}`);
        await this.sendEmbed(embed);
        await sleep(DELAY_MS);
      }
    }

    console.log(`[Discord] ✅ Sent ${jobs.length} embeds.`);
  }
}

module.exports = DiscordNotifier;
