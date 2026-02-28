/**
 * Enhanced Error Context
 * 
 * Provides enriched error context for better debugging and monitoring.
 * Adds request context, timing information, and structured error details.
 */

class EnhancedErrorContext {
  constructor() {
    this.errorCounts = new Map();
    this.errorHistory = [];
    this.maxHistorySize = 100;
    
    // Initialize error pattern tracking
    this.resetCounters();
  }

  /**
   * Create enriched error context for an HTTP request
   */
  createRequestContext(req, startTime = Date.now()) {
    return {
      requestId: this.generateRequestId(),
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'] || 'unknown',
      remoteIP: req.connection?.remoteAddress || req.ip || 'unknown',
      startTime: startTime,
      headers: this.sanitizeHeaders(req.headers),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Log error with enhanced context
   */
  logError(error, context = {}, req = null) {
    const timestamp = Date.now();
    const errorContext = {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code
      },
      context: context,
      request: req ? this.createRequestContext(req) : null,
      timestamp: timestamp,
      iso: new Date(timestamp).toISOString(),
      processInfo: this.getProcessInfo()
    };

    // Track error patterns
    this.trackErrorPattern(error);
    
    // Add to history
    this.errorHistory.push(errorContext);
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }

    return errorContext;
  }

  /**
   * Track error patterns for analysis
   */
  trackErrorPattern(error) {
    const pattern = `${error.name}:${error.code || 'unknown'}`;
    const count = this.errorCounts.get(pattern) || 0;
    this.errorCounts.set(pattern, count + 1);
  }

  /**
   * Get error statistics
   */
  getErrorStats() {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    const recentErrors = this.errorHistory.filter(e => e.timestamp > hourAgo);

    return {
      totalErrors: this.errorHistory.length,
      errorsLastHour: recentErrors.length,
      errorPatterns: Object.fromEntries(this.errorCounts.entries()),
      errorRate: this.calculateErrorRate(recentErrors),
      topErrors: this.getTopErrorPatterns(5)
    };
  }

  /**
   * Calculate error rate per minute for recent errors
   */
  calculateErrorRate(recentErrors) {
    if (recentErrors.length === 0) return 0;
    
    const timeSpan = Math.max(1, (Date.now() - recentErrors[0].timestamp) / (60 * 1000));
    return Math.round((recentErrors.length / timeSpan) * 100) / 100; // errors per minute
  }

  /**
   * Get top error patterns by frequency
   */
  getTopErrorPatterns(limit = 5) {
    return Array.from(this.errorCounts.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([pattern, count]) => ({ pattern, count }));
  }

  /**
   * Generate unique request ID for tracing
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sanitize headers to remove sensitive information
   */
  sanitizeHeaders(headers) {
    const sensitive = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
    const sanitized = { ...headers };
    
    sensitive.forEach(key => {
      if (sanitized[key]) {
        sanitized[key] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  /**
   * Get current process information
   */
  getProcessInfo() {
    const memUsage = process.memoryUsage();
    return {
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024) // MB
      },
      cpuUsage: process.cpuUsage()
    };
  }

  /**
   * Create error summary for monitoring
   */
  createErrorSummary(error, context = {}) {
    return {
      type: error.name,
      message: error.message.substring(0, 100), // Truncate long messages
      code: error.code,
      severity: this.determineSeverity(error),
      context: context,
      timestamp: Date.now(),
      fingerprint: this.generateErrorFingerprint(error)
    };
  }

  /**
   * Determine error severity based on type and context
   */
  determineSeverity(error) {
    // Critical errors that affect core functionality
    if (error.code === 'ECONNREFUSED' || error.name === 'DatabaseError') {
      return 'critical';
    }
    
    // High priority errors that affect user experience
    if (error.code === 'ETIMEDOUT' || error.name === 'ValidationError') {
      return 'high';
    }
    
    // Medium priority errors that are recoverable
    if (error.code === 'ENOENT' || error.name === 'TypeError') {
      return 'medium';
    }
    
    // Low priority errors that are expected in normal operation
    return 'low';
  }

  /**
   * Generate error fingerprint for deduplication
   */
  generateErrorFingerprint(error) {
    const crypto = require('crypto');
    const data = `${error.name}:${error.message}:${error.code || ''}`;
    return crypto.createHash('md5').update(data).digest('hex').substring(0, 8);
  }

  /**
   * Reset error counters (called periodically)
   */
  resetCounters() {
    this.errorCounts.clear();
    this.counterResetTime = Date.now();
  }

  /**
   * Check if counters should be reset (daily reset)
   */
  shouldResetCounters() {
    const daysSinceReset = (Date.now() - this.counterResetTime) / (24 * 60 * 60 * 1000);
    return daysSinceReset >= 1;
  }

  /**
   * Create middleware for Express/HTTP servers
   */
  createMiddleware() {
    return (req, res, next) => {
      req.errorContext = this.createRequestContext(req);
      req.logError = (error, context = {}) => {
        return this.logError(error, context, req);
      };
      
      // Add timing information
      req.startTime = Date.now();
      
      next();
    };
  }
}

module.exports = EnhancedErrorContext;