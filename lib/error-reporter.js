/**
 * IC Mesh Error Reporter
 * 
 * Structured error reporting and logging for better debugging and monitoring.
 * Provides consistent error formatting, context tracking, and integration hooks.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ErrorReporter {
  constructor(options = {}) {
    this.config = {
      logDir: options.logDir || 'logs',
      enableConsole: options.enableConsole !== false,
      enableFile: options.enableFile !== false,
      includeStack: options.includeStack !== false,
      maxLogSize: options.maxLogSize || 10 * 1024 * 1024, // 10MB
      ...options
    };
    
    this.sessionId = crypto.randomBytes(8).toString('hex');
    this.errorCounts = new Map();
    
    // Ensure log directory exists
    if (this.config.enableFile) {
      try {
        fs.mkdirSync(this.config.logDir, { recursive: true });
      } catch (error) {
        console.warn('Failed to create log directory:', error.message);
        this.config.enableFile = false;
      }
    }
  }
  
  /**
   * Report an error with context
   */
  reportError(error, context = {}) {
    const errorInfo = this.formatError(error, context);
    
    // Track error frequency
    const errorKey = `${errorInfo.code}:${errorInfo.type}`;
    this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);
    
    // Log to console
    if (this.config.enableConsole) {
      this.logToConsole(errorInfo);
    }
    
    // Log to file
    if (this.config.enableFile) {
      this.logToFile(errorInfo);
    }
    
    return errorInfo.id;
  }
  
  /**
   * Format error into structured object
   */
  formatError(error, context = {}) {
    const timestamp = new Date().toISOString();
    const errorId = crypto.randomBytes(4).toString('hex');
    
    // Determine error type and code
    let errorType = 'UnknownError';
    let errorCode = 'UNKNOWN_ERROR';
    
    if (error instanceof Error) {
      errorType = error.constructor.name;
      
      // Map common errors to codes
      switch (errorType) {
        case 'ValidationError':
          errorCode = 'VALIDATION_ERROR';
          break;
        case 'TypeError':
          errorCode = 'TYPE_ERROR';
          break;
        case 'ReferenceError':
          errorCode = 'REFERENCE_ERROR';
          break;
        case 'SyntaxError':
          errorCode = 'SYNTAX_ERROR';
          break;
        case 'RangeError':
          errorCode = 'RANGE_ERROR';
          break;
        case 'NetworkError':
        case 'FetchError':
          errorCode = 'NETWORK_ERROR';
          break;
        case 'TimeoutError':
          errorCode = 'TIMEOUT_ERROR';
          break;
        case 'AuthenticationError':
          errorCode = 'AUTH_ERROR';
          break;
        case 'PermissionError':
          errorCode = 'PERMISSION_ERROR';
          break;
        default:
          errorCode = 'APPLICATION_ERROR';
      }
    }
    
    // Override with custom code if provided
    if (context.code) {
      errorCode = context.code;
    }
    
    const errorInfo = {
      id: errorId,
      timestamp,
      sessionId: this.sessionId,
      type: errorType,
      code: errorCode,
      message: error.message || String(error),
      
      // Context information
      context: {
        endpoint: context.endpoint,
        method: context.method,
        userId: context.userId,
        nodeId: context.nodeId,
        jobId: context.jobId,
        ip: context.ip,
        userAgent: context.userAgent,
        ...context.custom
      },
      
      // Technical details
      technical: {
        stack: this.config.includeStack && error.stack ? error.stack : undefined,
        pid: process.pid,
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        version: process.version
      },
      
      // Frequency information
      frequency: {
        count: this.errorCounts.get(`${errorCode}:${errorType}`) || 1,
        firstSeen: timestamp // This would be better tracked in persistent storage
      }
    };
    
    return errorInfo;
  }
  
  /**
   * Log error to console with formatting
   */
  logToConsole(errorInfo) {
    const level = this.getLogLevel(errorInfo.code);
    const emoji = this.getLogEmoji(level);
    
    console.error(`${emoji} [${errorInfo.timestamp}] ${errorInfo.code}: ${errorInfo.message}`);
    console.error(`   ID: ${errorInfo.id} | Session: ${errorInfo.sessionId}`);
    
    if (errorInfo.context.endpoint) {
      console.error(`   Context: ${errorInfo.context.method || 'GET'} ${errorInfo.context.endpoint}`);
    }
    
    if (errorInfo.context.userId || errorInfo.context.nodeId) {
      console.error(`   User: ${errorInfo.context.userId || 'anonymous'} | Node: ${errorInfo.context.nodeId || 'none'}`);
    }
    
    if (errorInfo.frequency.count > 1) {
      console.error(`   Frequency: ${errorInfo.frequency.count} occurrences`);
    }
    
    if (this.config.includeStack && errorInfo.technical.stack) {
      console.error('   Stack:');
      errorInfo.technical.stack.split('\n').forEach(line => {
        if (line.trim()) {
          console.error(`     ${line.trim()}`);
        }
      });
    }
  }
  
  /**
   * Log error to file
   */
  logToFile(errorInfo) {
    const logFile = path.join(this.config.logDir, 'errors.jsonl');
    const logEntry = JSON.stringify(errorInfo) + '\n';
    
    try {
      // Check file size and rotate if needed
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        if (stats.size > this.config.maxLogSize) {
          this.rotateLogFile(logFile);
        }
      }
      
      fs.appendFileSync(logFile, logEntry);
    } catch (error) {
      console.warn('Failed to write error log:', error.message);
    }
  }
  
  /**
   * Rotate log file when it gets too large
   */
  rotateLogFile(logFile) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const rotatedFile = logFile.replace('.jsonl', `-${timestamp}.jsonl`);
    
    try {
      fs.renameSync(logFile, rotatedFile);
    } catch (error) {
      console.warn('Failed to rotate log file:', error.message);
    }
  }
  
  /**
   * Get log level based on error code
   */
  getLogLevel(errorCode) {
    const criticalErrors = ['DATABASE_ERROR', 'NETWORK_ERROR', 'AUTH_ERROR'];
    const warningErrors = ['VALIDATION_ERROR', 'TIMEOUT_ERROR', 'RATE_LIMIT_EXCEEDED'];
    
    if (criticalErrors.includes(errorCode)) {
      return 'critical';
    } else if (warningErrors.includes(errorCode)) {
      return 'warning';
    } else {
      return 'error';
    }
  }
  
  /**
   * Get emoji for log level
   */
  getLogEmoji(level) {
    switch (level) {
      case 'critical': return '🚨';
      case 'warning': return '⚠️';
      case 'error': return '❌';
      default: return '🔍';
    }
  }
  
  /**
   * Get error statistics
   */
  getStats() {
    const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0);
    const uniqueErrors = this.errorCounts.size;
    const topErrors = Array.from(this.errorCounts.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([key, count]) => {
        const [code, type] = key.split(':');
        return { code, type, count };
      });
    
    return {
      sessionId: this.sessionId,
      totalErrors,
      uniqueErrors,
      topErrors,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
  }
  
  /**
   * Express middleware for automatic error reporting
   */
  middleware() {
    return (error, req, res, next) => {
      const context = {
        endpoint: req.path,
        method: req.method,
        userId: req.user?.id,
        nodeId: req.headers['x-node-id'],
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent']
      };
      
      const errorId = this.reportError(error, context);
      
      // Add error ID to response headers for debugging
      res.set('X-Error-ID', errorId);
      
      // Continue with default error handling
      next(error);
    };
  }
  
  /**
   * WebSocket error handler
   */
  handleWebSocketError(error, ws, context = {}) {
    const wsContext = {
      ...context,
      connectionType: 'websocket',
      nodeId: context.nodeId || ws.nodeId,
      ip: ws._socket?.remoteAddress
    };
    
    const errorId = this.reportError(error, wsContext);
    
    // Send error ID to client if connection is open
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'error',
          errorId,
          message: 'An error occurred',
          code: error.code || 'WEBSOCKET_ERROR'
        }));
      } catch (sendError) {
        // Connection might be closed, just log it
        console.warn('Failed to send error to WebSocket client:', sendError.message);
      }
    }
    
    return errorId;
  }
  
  /**
   * Database error handler with connection context
   */
  handleDatabaseError(error, query, context = {}) {
    const dbContext = {
      ...context,
      database: 'sqlite',
      query: query?.substring(0, 100), // Truncate long queries
      code: 'DATABASE_ERROR'
    };
    
    return this.reportError(error, dbContext);
  }
  
  /**
   * Job processing error handler
   */
  handleJobError(error, jobId, handlerName, context = {}) {
    const jobContext = {
      ...context,
      jobId,
      handler: handlerName,
      code: 'JOB_PROCESSING_ERROR'
    };
    
    return this.reportError(error, jobContext);
  }
}

/**
 * Create singleton instance
 */
const defaultReporter = new ErrorReporter({
  logDir: process.env.LOG_DIR || 'logs',
  enableConsole: process.env.NODE_ENV !== 'test',
  includeStack: process.env.NODE_ENV === 'development'
});

module.exports = {
  ErrorReporter,
  default: defaultReporter,
  reportError: (...args) => defaultReporter.reportError(...args),
  getStats: () => defaultReporter.getStats(),
  middleware: () => defaultReporter.middleware(),
  handleWebSocketError: (...args) => defaultReporter.handleWebSocketError(...args),
  handleDatabaseError: (...args) => defaultReporter.handleDatabaseError(...args),
  handleJobError: (...args) => defaultReporter.handleJobError(...args)
};