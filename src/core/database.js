'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'seen_jobs.json');

class Database {
  constructor() {
    this.data = this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(DB_PATH)) {
        const empty = { jobs: {}, meta: { created: new Date().toISOString(), totalSeen: 0 } };
        this._write(empty);
        return empty;
      }
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[DB] Could not load DB, starting fresh:', err.message);
      return { jobs: {}, meta: { created: new Date().toISOString(), totalSeen: 0 } };
    }
  }

  _write(data) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * FIX Issue 4: Strip query params and fragments from URL before hashing.
   * Prevents tracking params (?utm_source=, ?ref=, etc.) from creating
   * duplicate hashes for the same job listing.
   */
  static normalizeUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      return u.origin + u.pathname; // drops ALL query params & fragments
    } catch {
      // Fallback for malformed URLs
      return url.split('?')[0].split('#')[0];
    }
  }

  /**
   * Generate a stable hash for a job listing
   */
  static hash(job) {
    const cleanUrl = Database.normalizeUrl(job.url || '');
    const raw = `${(job.title || '').toLowerCase().trim()}|${(job.company || '').toLowerCase().trim()}|${cleanUrl}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  /**
   * Check if a job is new (not yet seen)
   */
  isNew(job) {
    const id = Database.hash(job);
    return !this.data.jobs[id];
  }

  /**
   * Mark a job as seen after notification
   */
  markSeen(job) {
    const id = Database.hash(job);
    this.data.jobs[id] = {
      title: job.title,
      company: job.company,
      source: job.source,
      seenAt: new Date().toISOString(),
    };
    this.data.meta.totalSeen = (this.data.meta.totalSeen || 0) + 1;
  }

  /**
   * Remove entries older than 45 days to keep DB lean
   */
  cleanup() {
    const cutoffMs = Date.now() - 45 * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const [id, job] of Object.entries(this.data.jobs)) {
      if (new Date(job.seenAt).getTime() < cutoffMs) {
        delete this.data.jobs[id];
        removed++;
      }
    }
    if (removed > 0) console.log(`[DB] Cleaned up ${removed} old entries.`);
    return removed;
  }

  /**
   * Persist DB to disk
   */
  save() {
    this.data.meta.lastRun = new Date().toISOString();
    this._write(this.data);
    console.log(`[DB] Saved. Total unique jobs seen: ${Object.keys(this.data.jobs).length}`);
  }

  stats() {
    return {
      total: Object.keys(this.data.jobs).length,
      lastRun: this.data.meta.lastRun,
    };
  }
}

module.exports = Database;
