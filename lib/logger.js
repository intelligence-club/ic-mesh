/**
 * Simple structured logging system for IC Mesh
 * Provides consistent logging format without external dependencies
 */

const fs = require('fs');
const path = require('path');

class Logger {
  constructor(options = {}) {
    this.level = options.level || process.env.LOG_LEVEL || 'info';
    this.logFile = options.logFile || path.join(__dirname, '..', 'data', 'mesh.log');
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;
    
    // Log levels (higher number = more verbose)
    this.levels = {
      error: 0,
      warn: 1, 
      info: 2,
      debug: 3,
      trace: 4
    };
    
    this.currentLevel = this.levels[this.level] || 2;
    
    // Ensure log directory exists
    if (this.enableFile) {
      const logDir = path.dirname(this.logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
    }
  }
  
  log(level, message, metadata = {}) {
    if (this.levels[level] > this.currentLevel) {
      return; // Skip if below current log level
    }
    
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...metadata
    };
    
    // Format for console output
    const consoleFormat = this.formatForConsole(logEntry);
    
    // Format for file output (JSON)
    const fileFormat = JSON.stringify(logEntry) + '\n';
    
    // Output to console
    if (this.enableConsole) {
      console.log(consoleFormat);
    }
    
    // Output to file
    if (this.enableFile) {
      try {
        fs.appendFileSync(this.logFile, fileFormat);
      } catch (error) {
        // Fallback to console if file logging fails
        console.error('Logger: Failed to write to log file:', error.message);
      }
    }
  }
  
  formatForConsole(entry) {
    const { timestamp, level, message, ...metadata } = entry;
    const timeStr = timestamp.split('T')[1].split('.')[0]; // HH:MM:SS format
    
    // Color coding for different levels
    const colors = {
      ERROR: '\x1b[31m', // Red
      WARN: '\x1b[33m',  // Yellow
      INFO: '\x1b[32m',  // Green  
      DEBUG: '\x1b[36m', // Cyan
      TRACE: '\x1b[37m'  // White
    };
    const reset = '\x1b[0m';
    
    const color = colors[level] || colors.INFO;
    const levelStr = level.padEnd(5);
    
    // Base format
    let formatted = `${color}${timeStr} [${levelStr}]${reset} ${message}`;
    
    // Add metadata if present
    if (Object.keys(metadata).length > 0) {
      const metaStr = Object.entries(metadata)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
      formatted += ` | ${metaStr}`;
    }
    
    return formatted;
  }
  
  // Convenience methods
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
  
  // Structured logging for specific IC Mesh events
  nodeEvent(nodeId, event, details = {}) {
    this.info(`Node event: ${event}`, { nodeId, event, ...details });
  }
  
  jobEvent(jobId, event, details = {}) {
    this.info(`Job event: ${event}`, { jobId, event, ...details });
  }
  
  apiEvent(method, path, status, details = {}) {
    const level = status >= 400 ? 'warn' : 'info';
    this.log(level, `API ${method} ${path} ${status}`, { method, path, status, ...details });
  }
  
  performanceEvent(component, metric, value, details = {}) {
    this.debug(`Performance: ${component} ${metric}`, { component, metric, value, ...details });
  }
  
  stripeEvent(event, details = {}) {
    this.info(`Stripe: ${event}`, { stripe: true, event, ...details });
  }
  
  // Get recent log entries (for debugging)
  getRecentLogs(lines = 100) {
    if (!this.enableFile || !fs.existsSync(this.logFile)) {
      return [];
    }
    
    try {
      const content = fs.readFileSync(this.logFile, 'utf8');
      const logLines = content.trim().split('\n').slice(-lines);
      return logLines.map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return { message: line, level: 'UNKNOWN' };
        }
      });
    } catch (error) {
      this.error('Failed to read log file', { error: error.message });
      return [];
    }
  }
  
  // Log rotation (simple implementation)
  rotateLogs() {
    if (!this.enableFile || !fs.existsSync(this.logFile)) {
      return;
    }
    
    try {
      const stats = fs.statSync(this.logFile);
      const maxSize = 10 * 1024 * 1024; // 10MB
      
      if (stats.size > maxSize) {
        const backupFile = this.logFile + '.' + Date.now();
        fs.renameSync(this.logFile, backupFile);
        this.info('Log file rotated', { oldFile: backupFile, newFile: this.logFile });
        
        // Keep only last 5 rotated files
        const logDir = path.dirname(this.logFile);
        const basename = path.basename(this.logFile);
        const rotatedFiles = fs.readdirSync(logDir)
          .filter(file => file.startsWith(basename + '.'))
          .sort()
          .reverse();
          
        if (rotatedFiles.length > 5) {
          rotatedFiles.slice(5).forEach(file => {
            fs.unlinkSync(path.join(logDir, file));
          });
        }
      }
    } catch (error) {
      this.error('Log rotation failed', { error: error.message });
    }
  }
}

// Create singleton instance
const logger = new Logger();

// Auto-rotate logs daily  
setInterval(() => {
  logger.rotateLogs();
}, 24 * 60 * 60 * 1000);

module.exports = logger;