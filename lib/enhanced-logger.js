/**
 * Enhanced Logger for IC Mesh
 * Structured logging with contextual metadata and performance tracking
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

class EnhancedLogger {
  constructor(options = {}) {
    this.level = process.env.LOG_LEVEL || options.level || 'info';
    this.format = process.env.LOG_FORMAT || options.format || 'human';
    this.context = options.context || {};
    this.component = options.component || 'unknown';
    this.enableColors = process.env.LOG_COLORS !== 'false' && process.stdout.isTTY;
    
    // Log levels (higher number = more verbose)
    this.levels = {
      error: 0,
      warn: 1, 
      info: 2,
      debug: 3,
      trace: 4
    };
    
    // Colors for terminal output
    this.colors = {
      error: '\x1b[31m', // red
      warn: '\x1b[33m',  // yellow
      info: '\x1b[36m',  // cyan
      debug: '\x1b[35m', // magenta
      trace: '\x1b[37m', // white
      reset: '\x1b[0m'
    };
  }
  
  shouldLog(level) {
    return this.levels[level] <= this.levels[this.level];
  }
  
  error(message, metadata = {}) {
    this.log('error', message, metadata);
  }
  
  warn(message, metadata = {}) {
    this.log('warn', message, metadata);
  }
  
  info(message, metadata = {}) {
    this.log('info', message, metadata);
  }
  
  debug(message, metadata = {}) {
    this.log('debug', message, metadata);
  }
  
  trace(message, metadata = {}) {
    this.log('trace', message, metadata);
  }
  
  // Performance timing helper
  time(label) {
    this.timers = this.timers || {};
    this.timers[label] = process.hrtime.bigint();
    return this;
  }
  
  timeEnd(label, metadata = {}) {
    if (!this.timers || !this.timers[label]) {
      this.warn(`Timer '${label}' not found`);
      return this;
    }
    
    const duration = Number(process.hrtime.bigint() - this.timers[label]) / 1000000; // ms
    delete this.timers[label];
    
    this.debug(`Timer: ${label}`, { 
      ...metadata, 
      duration_ms: Math.round(duration * 100) / 100
    });
    return this;
  }
  
  log(level, message, metadata = {}) {
    if (!this.shouldLog(level)) return;
    
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      level,
      message,
      component: this.component,
      ...this.context,
      ...metadata,
      pid: process.pid,
      hostname: os.hostname()
    };
    
    if (this.format === 'json') {
      console.log(JSON.stringify(entry));
    } else {
      this.formatHuman(entry);
    }
  }
  
  formatHuman(entry) {
    const timestamp = entry.timestamp.substring(11, 19); // HH:mm:ss
    const level = entry.level.toUpperCase().padEnd(5);
    const component = entry.component.padEnd(10);
    
    let output = '';
    
    if (this.enableColors) {
      const color = this.colors[entry.level] || this.colors.reset;
      output = `${color}[${timestamp}] ${level}${this.colors.reset} ${component}: ${entry.message}`;
    } else {
      output = `[${timestamp}] ${level} ${component}: ${entry.message}`;
    }
    
    // Add metadata if present (excluding standard fields)
    const metadata = { ...entry };
    delete metadata.timestamp;
    delete metadata.level;
    delete metadata.message;
    delete metadata.component;
    delete metadata.pid;
    delete metadata.hostname;
    
    if (Object.keys(metadata).length > 0) {
      if (this.format === 'human') {
        output += ` | ${JSON.stringify(metadata)}`;
      }
    }
    
    console.log(output);
  }
  
  // Create child logger with additional context
  child(additionalContext) {
    return new EnhancedLogger({
      level: this.level,
      format: this.format,
      component: this.component,
      context: { ...this.context, ...additionalContext }
    });
  }
  
  // Job-specific logger
  forJob(jobId) {
    return this.child({ jobId });
  }
  
  // Node-specific logger  
  forNode(nodeId) {
    return this.child({ nodeId });
  }
  
  // WebSocket-specific logger
  forWebSocket(wsId) {
    return this.child({ wsId });
  }
  
  // Performance profiling helper
  profile(label, fn) {
    this.time(label);
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        // Handle promises
        return result.finally(() => {
          this.timeEnd(label);
        });
      } else {
        this.timeEnd(label);
        return result;
      }
    } catch (error) {
      this.timeEnd(label);
      this.error(`Profile ${label} failed`, { error: error.message });
      throw error;
    }
  }
}

// Factory functions for common logger types
function createLogger(component, options = {}) {
  return new EnhancedLogger({ 
    component,
    ...options 
  });
}

function createServerLogger(options = {}) {
  return createLogger('server', options);
}

function createClientLogger(options = {}) {
  return createLogger('client', options);
}

function createJobLogger(jobId, options = {}) {
  return createLogger('job', { 
    context: { jobId },
    ...options 
  });
}

module.exports = {
  EnhancedLogger,
  createLogger,
  createServerLogger,
  createClientLogger,
  createJobLogger
};