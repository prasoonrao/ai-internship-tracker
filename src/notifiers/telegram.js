'use strict';

const TelegramBot = require('node-telegram-bot-api');
const { formatTelegram, formatTelegramHeader } = require('../core/formatter');

// 1.5s between messages — well under Telegram's 1 msg/sec burst limit
const DELAY_MS = 1500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class TelegramNotifier {
  constructor(token, chatId) {
    this.bot = new TelegramBot(token);
    this.chatId = chatId;
  }

  async sendMessage(text, options = {}) {
    try {
      await this.bot.sendMessage(this.chatId, text, {
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: false,
        ...options,
      });
    } catch (err) {
      if (err.response && err.response.body) {
        const retryAfter = err.response.body.parameters?.retry_after || 5;
        console.warn(`[Telegram] Rate limited. Waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        try {
          await this.bot.sendMessage(this.chatId, text, { parse_mode: 'MarkdownV2', ...options });
        } catch (retryErr) {
          console.error('[Telegram] Retry failed:', retryErr.message);
          throw retryErr; // Re-throw so main.js allSettled can detect failure
        }
      } else {
        console.error('[Telegram] Send error:', err.message);
        throw err; // Re-throw so main.js allSettled can detect failure
      }
    }
  }

  /**
   * FIX Issue 5: Only sends messages when jobs.length > 0.
   * The zero-job case is now handled in main.js with a silent exit.
   */
  async sendJobs(jobs, runType = 'Morning Run') {
    const dryRun = process.env.DRY_RUN === 'true';

    if (jobs.length === 0) {
      console.log('[Telegram] No jobs to send (called with empty array).');
      return;
    }

    // Send header
    const header = formatTelegramHeader(jobs.length, runType);
    if (dryRun) {
      console.log('[DRY RUN][Telegram] Header:', jobs.length, 'jobs');
    } else {
      await this.sendMessage(header);
      await sleep(DELAY_MS);
    }

    // Send each job
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const msg = formatTelegram(job);

      if (dryRun) {
        console.log(`[DRY RUN][Telegram] ${i + 1}/${jobs.length}: ${job.title} @ ${job.company}`);
      } else {
        console.log(`[Telegram] Sending ${i + 1}/${jobs.length}: ${job.title} @ ${job.company}`);
        await this.sendMessage(msg);
        await sleep(DELAY_MS);
      }
    }

    console.log(`[Telegram] ✅ Sent ${jobs.length} notifications.`);
  }
}

module.exports = TelegramNotifier;
