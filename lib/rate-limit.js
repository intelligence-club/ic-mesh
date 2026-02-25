/**
 * Rate Limiter — In-Memory Per-IP Rate Limiting
 * 
 * Standalone module. No dependencies.
 * 
 * Usage:
 *   const RateLimiter = require('./lib/rate-limit');
 *   const limiter = new RateLimiter();
 *   if (!limiter.check(ip, 'upload', 10)) { // 429 }
 */

class RateLimiter {
  constructor() {
    // Map<string, { count: number, resetAt: number }>
    // key = `${ip}:${group}`
    this.hits = new Map();

    // Limits per group (requests per minute)
    this.limits = {
      upload: 10,
      'jobs-post': 30,
      'nodes-register': 20,
      default: 60
    };

    // Cleanup old entries every 60s
    this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();
  }

  /**
   * Check if a request is allowed. Returns true if allowed, false if rate-limited.
   * @param {string} ip - Client IP
   * @param {string} group - Endpoint group name
   * @param {number} [customLimit] - Override the default limit for this group
   * @returns {{ allowed: boolean, retryAfter: number }}
   */
  check(ip, group = 'default', customLimit) {
    const limit = customLimit || this.limits[group] || this.limits.default;
    const key = `${ip}:${group}`;
    const now = Date.now();
    const windowMs = 60000; // 1 minute window

    let entry = this.hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      this.hits.set(key, entry);
    }

    entry.count++;

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }

    return { allowed: true, retryAfter: 0 };
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.hits) {
      if (now > entry.resetAt) this.hits.delete(key);
    }
  }

  destroy() {
    clearInterval(this._cleanupInterval);
  }
}

module.exports = RateLimiter;
