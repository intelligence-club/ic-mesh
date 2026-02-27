#!/usr/bin/env node
/**
 * IC Mesh Structured Logger
 * 
 * Professional logging system to replace console.log scattered throughout codebase.
 * Features:
 * - Structured JSON logging for production
 * - Human-readable format for development
 * - Configurable log levels (debug, info, warn, error)
 * - File rotation and persistence
 * - Performance monitoring integration
 * - Contextual metadata support
 * 
 * Usage:
 *   const logger = require('./utils/logger');
 *   logger.info('User action', { userId: 123, action: 'login' });
 *   logger.error('Database error', { error: err.message, table: 'users' });
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

class ICMeshLogger {
  constructor(options = {}) {
    this.options = {
      level: options.level || process.env.LOG_LEVEL || 'info',
      format: options.format || process.env.LOG_FORMAT || 'human', // 'json' | 'human'
      file: options.file || process.env.LOG_FILE || null,
      maxFileSize: options.maxFileSize || 10 * 1024 * 1024, // 10MB
      maxFiles: options.maxFiles || 5,
      context: options.context || {},
      timestamp: options.timestamp !== false
    };
    
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
    
    this.colors = {
      debug: '\x1b[36m', // cyan
      info: '\x1b[32m',  // green
      warn: '\x1b[33m',  // yellow
      error: '\x1b[31m', // red
      reset: '\x1b[0m'
    };
    
    this.emojis = {
      debug: '🔍',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌'
    };
    
    this.setupFileLogging();
  }
  
  setupFileLogging() {
    if (this.options.file) {
      const dir = path.dirname(this.options.file);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
  
  shouldLog(level) {
    return this.levels[level] >= this.levels[this.options.level];
  }
  
  formatMessage(level, message, metadata = {}) {
    const timestamp = this.options.timestamp ? new Date().toISOString() : null;
    
    if (this.options.format === 'json') {
      return JSON.stringify({
        timestamp,
        level: level.toUpperCase(),
        message,
        ...this.options.context,
        ...metadata,
        service: 'ic-mesh',
        version: '0.1.0'
      });
    } else {
      // Human readable format
      const emoji = this.emojis[level] || '';
      const color = this.colors[level] || '';
      const reset = this.colors.reset;
      const ts = timestamp ? `[${timestamp}] ` : '';
      const context = Object.keys(metadata).length > 0 ? 
        ` ${util.inspect(metadata, { colors: false, compact: true })}` : '';
      
      return `${color}${emoji} ${ts}${level.toUpperCase()}: ${message}${context}${reset}`;
    }
  }
  
  writeToFile(formatted) {
    if (!this.options.file) return;
    
    try {
      // Check file size and rotate if needed
      if (fs.existsSync(this.options.file)) {
        const stats = fs.statSync(this.options.file);
        if (stats.size > this.options.maxFileSize) {
          this.rotateLogFiles();
        }
      }
      
      fs.appendFileSync(this.options.file, formatted + '\n');
    } catch (error) {
      console.error('Logger: Failed to write to file:', error.message);
    }
  }
  
  rotateLogFiles() {
    try {
      // Move current log to .1, and shift others
      for (let i = this.options.maxFiles - 1; i >= 1; i--) {
        const oldFile = `${this.options.file}.${i}`;
        const newFile = `${this.options.file}.${i + 1}`;
        
        if (fs.existsSync(oldFile)) {
          if (i === this.options.maxFiles - 1) {
            fs.unlinkSync(oldFile); // Delete oldest
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }
      
      if (fs.existsSync(this.options.file)) {
        fs.renameSync(this.options.file, `${this.options.file}.1`);
      }
    } catch (error) {
      console.error('Logger: Failed to rotate log files:', error.message);
    }
  }
  
  log(level, message, metadata = {}) {
    if (!this.shouldLog(level)) return;
    
    const formatted = this.formatMessage(level, message, metadata);
    
    // Always write to console for now (can be made configurable)
    console.log(formatted);
    
    // Write to file if configured
    this.writeToFile(formatted);
  }
  
  debug(message, metadata = {}) {
    this.log('debug', message, metadata);
  }
  
  info(message, metadata = {}) {
    this.log('info', message, metadata);
  }
  
  warn(message, metadata = {}) {
    this.log('warn', message, metadata);
  }
  
  error(message, metadata = {}) {
    this.log('error', message, metadata);
  }
  
  // Performance monitoring helpers
  time(label) {
    this._timers = this._timers || new Map();
    this._timers.set(label, process.hrtime.bigint());
    this.debug(`Timer started: ${label}`);
  }
  
  timeEnd(label, metadata = {}) {
    if (!this._timers || !this._timers.has(label)) {
      this.warn(`Timer not found: ${label}`);
      return;
    }
    
    const startTime = this._timers.get(label);
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    
    this._timers.delete(label);
    
    this.info(`Timer completed: ${label}`, {
      duration: `${duration.toFixed(2)}ms`,
      ...metadata
    });
    
    return duration;
  }
  
  // Create child logger with additional context
  child(context = {}) {
    return new ICMeshLogger({
      ...this.options,
      context: {
        ...this.options.context,
        ...context
      }
    });
  }
  
  // Migration helper for replacing console.log
  static createMigrationHelper() {
    return {
      replaceConsoleLog: (level = 'info') => {
        const originalLog = console.log;
        const logger = new ICMeshLogger();
        
        console.log = (...args) => {
          if (args.length === 1 && typeof args[0] === 'string') {
            logger[level](args[0]);
          } else {
            logger[level]('Console output', { data: args });
          }
        };
        
        return () => {
          console.log = originalLog;
        };
      }
    };
  }
}

// Create default logger instance
const defaultLogger = new ICMeshLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.NODE_ENV === 'production' ? 'json' : 'human',
  file: process.env.LOG_FILE || './data/ic-mesh.log'
});

// Export both the class and default instance
module.exports = defaultLogger;
module.exports.ICMeshLogger = ICMeshLogger;
module.exports.createLogger = (options) => new ICMeshLogger(options);

// Usage examples:
if (require.main === module) {
  console.log('🧪 IC Mesh Logger Test\n');
  
  const logger = new ICMeshLogger({ format: 'human' });
  
  logger.debug('Debug message', { userId: 123 });
  logger.info('System started', { port: 8333, env: 'development' });
  logger.warn('Deprecated API usage', { endpoint: '/old-api', replacement: '/v2/api' });
  logger.error('Database connection failed', { host: 'localhost', error: 'ECONNREFUSED' });
  
  // Performance timing
  logger.time('database-query');
  setTimeout(() => {
    logger.timeEnd('database-query', { query: 'SELECT * FROM nodes' });
  }, 100);
  
  // Child logger with context
  const userLogger = logger.child({ userId: 456, module: 'authentication' });
  userLogger.info('User logged in');
  userLogger.warn('Invalid password attempt');
}