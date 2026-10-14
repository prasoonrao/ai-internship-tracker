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
    const defaultOptions = {
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: false,
      ...options,
    };

    try {
      await this.bot.sendMessage(this.chatId, text, defaultOptions);
    } catch (err) {
      const statusCode = err.response?.statusCode || err.response?.body?.error_code;
      const isRateLimited = statusCode === 429 || (err.message && err.message.includes('429'));
      const isParseError =
        statusCode === 400 &&
        ((err.message && err.message.includes("can't parse entities")) ||
          (err.response?.body?.description && err.response.body.description.includes("can't parse entities")));

      // 1. Rate-limiting: Wait and retry once
      if (isRateLimited) {
        const retryAfter = err.response?.body?.parameters?.retry_after || 5;
        console.warn(`[Telegram] Rate limited (429). Waiting ${retryAfter}s before retrying...`);
        await sleep(retryAfter * 1000);
        try {
          await this.bot.sendMessage(this.chatId, text, defaultOptions);
          return;
        } catch (retryErr) {
          console.error('[Telegram] Rate limit retry failed:', retryErr.message);
          throw retryErr; // Re-throw so main.js allSettled can detect failure
        }
      }

      // 2. MarkdownV2 entity-parsing error: Fallback to plain text without parse_mode
      if (isParseError && defaultOptions.parse_mode === 'MarkdownV2') {
        console.warn(`[Telegram] MarkdownV2 parsing error: ${err.message}. Retrying with plain text fallback...`);
        // Strip MarkdownV2 backslash escapes so plain text is clean
        const plainText = text.replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, '$1');
        const fallbackOptions = { ...defaultOptions };
        delete fallbackOptions.parse_mode;
        try {
          await this.bot.sendMessage(this.chatId, plainText, fallbackOptions);
          console.log('[Telegram] ✅ Plain-text fallback sent successfully.');
          return;
        } catch (fallbackErr) {
          console.error('[Telegram] Plain text fallback failed:', fallbackErr.message);
          throw fallbackErr; // Re-throw so main.js allSettled can detect failure
        }
      }

      // 3. Other non-retryable errors (e.g. 401 Unauthorized, 403 Forbidden, or unhandled 400)
      console.error(`[Telegram] Send error (${statusCode || 'unknown'}):`, err.message);
      throw err; // Re-throw so main.js allSettled can detect failure
    }
  }

  /**
   * FIX Issue 5: Only sends messages when jobs.length > 0.
   * The zero-job case is now handled in main.js with a silent exit.
   */
  async sendJobs(jobs, runType = 'Morning Run', queue = []) {
    const dryRun = process.env.DRY_RUN === 'true';

    if (jobs.length === 0) {
      console.log('[Telegram] No jobs to send (called with empty array).');
      return;
    }

    // Send header
    const header = formatTelegramHeader(jobs.length, runType, queue);
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
