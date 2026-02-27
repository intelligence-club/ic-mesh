/**
 * Enhanced Rate Limiter — Advanced Rate Limiting with Monitoring & Whitelist
 * 
 * Extends the basic rate limiter with:
 * - IP whitelist support
 * - Detailed metrics and logging
 * - Dynamic limit adjustments
 * - Rate limit headers for responses
 * - Trend analysis and anomaly detection
 * 
 * Usage:
 *   const EnhancedRateLimiter = require('./lib/enhanced-rate-limit');
 *   const limiter = new EnhancedRateLimiter();
 *   const result = limiter.check(ip, 'upload', 10);
 *   if (!result.allowed) { // 429 with result.headers }
 */

const fs = require('fs');
const path = require('path');

class EnhancedRateLimiter {
  constructor(options = {}) {
    // Map<string, { count: number, resetAt: number, firstHit: number }>
    this.hits = new Map();
    
    // Rate limit statistics
    this.stats = {
      totalRequests: 0,
      rateLimitedRequests: 0,
      whitelistedRequests: 0,
      startTime: Date.now()
    };

    // Default limits per group (requests per minute)
    this.limits = {
      upload: 10,
      'jobs-post': 30,
      'nodes-register': 20,
      'health': 120, // Allow more frequent health checks
      'status': 60,
      default: 60,
      ...options.limits
    };

    // Configuration
    this.whitelistFile = options.whitelistFile || './config/rate-limit-whitelist.json';
    this.logFile = options.logFile || './logs/rate-limits.log';
    this.enableLogging = options.enableLogging !== false;
    this.windowMs = options.windowMs || 60000; // 1 minute window

    // Load whitelist
    this.whitelist = this.loadWhitelist();

    // Ensure log directory exists
    if (this.enableLogging) {
      const logDir = path.dirname(this.logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
    }

    // Cleanup interval
    this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();
  }

  loadWhitelist() {
    try {
      if (fs.existsSync(this.whitelistFile)) {
        const data = JSON.parse(fs.readFileSync(this.whitelistFile, 'utf8'));
        return data.ips || [];
      }
    } catch (e) {
      // Silent fail, use default whitelist
    }
    
    // Default whitelist - localhost and monitoring IPs
    return ['127.0.0.1', '::1'];
  }

  saveWhitelist() {
    try {
      const dir = path.dirname(this.whitelistFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const data = {
        ips: this.whitelist,
        lastUpdated: new Date().toISOString(),
        description: 'Rate limit whitelist - IPs that bypass rate limiting'
      };
      
      fs.writeFileSync(this.whitelistFile, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('Failed to save whitelist:', e.message);
    }
  }

  isWhitelisted(ip) {
    return this.whitelist.includes(ip);
  }

  addToWhitelist(ip) {
    if (!this.whitelist.includes(ip)) {
      this.whitelist.push(ip);
      this.saveWhitelist();
      return true;
    }
    return false;
  }

  removeFromWhitelist(ip) {
    const index = this.whitelist.indexOf(ip);
    if (index > -1) {
      this.whitelist.splice(index, 1);
      this.saveWhitelist();
      return true;
    }
    return false;
  }

  /**
   * Check if a request is allowed and return detailed information
   * @param {string} ip - Client IP
   * @param {string} group - Endpoint group name
   * @param {number} customLimit - Override the default limit
   * @returns {Object} Result with allowed, headers, and metadata
   */
  check(ip, group = 'default', customLimit) {
    this.stats.totalRequests++;
    
    // Check whitelist first
    if (this.isWhitelisted(ip)) {
      this.stats.whitelistedRequests++;
      
      if (this.enableLogging) {
        this.log('whitelist_bypass', { ip, group, timestamp: Date.now() });
      }
      
      return {
        allowed: true,
        retryAfter: 0,
        headers: this.generateHeaders(ip, group, { whitelisted: true }),
        whitelisted: true
      };
    }

    const limit = customLimit || this.limits[group] || this.limits.default;
    const key = `${ip}:${group}`;
    const now = Date.now();

    let entry = this.hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { 
        count: 0, 
        resetAt: now + this.windowMs,
        firstHit: now
      };
      this.hits.set(key, entry);
    }

    entry.count++;
    const isAllowed = entry.count <= limit;

    if (!isAllowed) {
      this.stats.rateLimitedRequests++;
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      
      if (this.enableLogging) {
        this.log('rate_limited', {
          ip,
          group,
          count: entry.count,
          limit,
          retryAfter,
          timestamp: now
        });
      }

      return {
        allowed: false,
        retryAfter: Math.max(1, retryAfter),
        headers: this.generateHeaders(ip, group, { 
          count: entry.count, 
          limit, 
          resetAt: entry.resetAt 
        }),
        rateLimited: true
      };
    }

    return {
      allowed: true,
      retryAfter: 0,
      headers: this.generateHeaders(ip, group, { 
        count: entry.count, 
        limit, 
        resetAt: entry.resetAt 
      }),
      remaining: limit - entry.count
    };
  }

  /**
   * Generate rate limit headers for HTTP responses
   */
  generateHeaders(ip, group, metadata = {}) {
    const headers = {};

    if (metadata.whitelisted) {
      headers['X-RateLimit-Whitelisted'] = 'true';
      headers['X-RateLimit-Group'] = group;
      return headers;
    }

    const limit = this.limits[group] || this.limits.default;
    const remaining = Math.max(0, limit - (metadata.count || 0));

    headers['X-RateLimit-Limit'] = limit.toString();
    headers['X-RateLimit-Remaining'] = remaining.toString();
    headers['X-RateLimit-Group'] = group;

    if (metadata.resetAt) {
      headers['X-RateLimit-Reset'] = Math.floor(metadata.resetAt / 1000).toString();
    }

    if (metadata.count > limit) {
      headers['Retry-After'] = Math.ceil((metadata.resetAt - Date.now()) / 1000).toString();
    }

    return headers;
  }

  /**
   * Log rate limiting events
   */
  log(event, data) {
    if (!this.enableLogging) return;

    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        event,
        ...data
      };
      
      const logLine = JSON.stringify(logEntry) + '\n';
      fs.appendFileSync(this.logFile, logLine);
    } catch (e) {
      // Silent fail to avoid disrupting the main application
    }
  }

  /**
   * Get current statistics
   */
  getStats() {
    const uptime = Date.now() - this.stats.startTime;
    const rateLimitRate = this.stats.totalRequests > 0 
      ? (this.stats.rateLimitedRequests / this.stats.totalRequests) * 100 
      : 0;

    return {
      ...this.stats,
      uptime,
      rateLimitRate: Math.round(rateLimitRate * 100) / 100,
      whitelistSize: this.whitelist.length,
      activeConnections: this.hits.size,
      requestsPerMinute: this.stats.totalRequests / (uptime / 60000) || 0
    };
  }

  /**
   * Get current rate limit status for an IP/group
   */
  getStatus(ip, group = 'default') {
    const key = `${ip}:${group}`;
    const entry = this.hits.get(key);
    const limit = this.limits[group] || this.limits.default;
    
    if (!entry || Date.now() > entry.resetAt) {
      return {
        count: 0,
        limit,
        remaining: limit,
        resetAt: null,
        rateLimited: false
      };
    }

    return {
      count: entry.count,
      limit,
      remaining: Math.max(0, limit - entry.count),
      resetAt: entry.resetAt,
      rateLimited: entry.count > limit
    };
  }

  /**
   * Analyze rate limiting patterns for insights
   */
  analyzePatterns() {
    if (!this.enableLogging || !fs.existsSync(this.logFile)) {
      return { error: 'No log data available' };
    }

    try {
      const logs = fs.readFileSync(this.logFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .slice(-1000); // Last 1000 entries

      if (logs.length === 0) {
        return { error: 'No valid log entries found' };
      }

      // Analyze patterns
      const rateLimitEvents = logs.filter(l => l.event === 'rate_limited');
      const whitelistEvents = logs.filter(l => l.event === 'whitelist_bypass');
      
      const ipPatterns = {};
      const groupPatterns = {};
      
      rateLimitEvents.forEach(event => {
        ipPatterns[event.ip] = (ipPatterns[event.ip] || 0) + 1;
        groupPatterns[event.group] = (groupPatterns[event.group] || 0) + 1;
      });

      const topIPs = Object.entries(ipPatterns)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      const topGroups = Object.entries(groupPatterns)
        .sort((a, b) => b[1] - a[1]);

      return {
        totalAnalyzed: logs.length,
        rateLimitEvents: rateLimitEvents.length,
        whitelistBypasses: whitelistEvents.length,
        topRateLimitedIPs: topIPs,
        topRateLimitedGroups: topGroups,
        timeRange: {
          start: logs[0]?.timestamp,
          end: logs[logs.length - 1]?.timestamp
        }
      };
    } catch (e) {
      return { error: 'Failed to analyze patterns: ' + e.message };
    }
  }

  /**
   * Update rate limits dynamically
   */
  updateLimits(newLimits) {
    this.limits = { ...this.limits, ...newLimits };
    
    if (this.enableLogging) {
      this.log('limits_updated', { newLimits, timestamp: Date.now() });
    }
  }

  _cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.hits) {
      if (now > entry.resetAt) {
        this.hits.delete(key);
        cleaned++;
      }
    }

    if (this.enableLogging && cleaned > 0) {
      this.log('cleanup', { entriesRemoved: cleaned, timestamp: now });
    }
  }

  destroy() {
    clearInterval(this._cleanupInterval);
    
    if (this.enableLogging) {
      this.log('shutdown', { 
        finalStats: this.getStats(), 
        timestamp: Date.now() 
      });
    }
  }
}

module.exports = EnhancedRateLimiter;