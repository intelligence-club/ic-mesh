#!/usr/bin/env node
/**
 * IC Mesh Log Analyzer
 * 
 * Analyzes logs from various sources to provide insights:
 * - Error pattern detection
 * - Performance metrics extraction
 * - Traffic analysis
 * - Health trend monitoring
 * - Alerting based on log patterns
 * 
 * Usage:
 *   node scripts/log-analyzer.js [command] [options]
 *   
 * Commands:
 *   analyze   - Analyze logs and generate report
 *   watch     - Real-time log monitoring with alerts
 *   summary   - Quick log summary
 *   errors    - Extract and analyze error patterns
 *   
 * Options:
 *   --file=<path>       - Analyze specific log file
 *   --since=<duration>  - Analyze logs from last N minutes/hours/days (e.g., '1h', '30m', '2d')
 *   --output=<format>   - Output format: console, json, html
 *   --alerts            - Enable real-time alerts
 *   --threshold=<n>     - Alert threshold (errors per minute)
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Configuration
const LOG_SOURCES = {
  deploy: path.join(__dirname, '..', 'data', 'deploy.log'),
  server: '/var/log/ic-mesh/server.log',  // If using systemd/external logging
  nginx: '/var/log/nginx/ic-mesh.log',    // If using nginx proxy
  system: '/var/log/syslog'               // System logs
};

const ERROR_PATTERNS = [
  { name: 'Database Errors', pattern: /database|sqlite|sql error/i },
  { name: 'Network Timeouts', pattern: /timeout|timed out|connection refused/i },
  { name: 'Memory Issues', pattern: /out of memory|heap|allocation failed/i },
  { name: 'Authentication Failures', pattern: /unauthorized|authentication failed|invalid token/i },
  { name: 'File System Errors', pattern: /no such file|permission denied|disk full/i },
  { name: 'API Errors', pattern: /error.*api|500|internal server error/i },
  { name: 'WebSocket Issues', pattern: /websocket|ws error|connection lost/i }
];

const PERFORMANCE_PATTERNS = [
  { name: 'Response Times', pattern: /response time: (\d+)ms/i, extract: 1 },
  { name: 'Job Processing', pattern: /job completed in (\d+)s/i, extract: 1 },
  { name: 'Memory Usage', pattern: /memory usage: ([\d.]+)%/i, extract: 1 },
  { name: 'Database Queries', pattern: /query time: (\d+)ms/i, extract: 1 }
];

// Color output (with better terminal compatibility)
const colors = process.stdout.isTTY ? {
  green: (text) => `\\x1b[32m${text}\\x1b[0m`,
  red: (text) => `\\x1b[31m${text}\\x1b[0m`,
  yellow: (text) => `\\x1b[33m${text}\\x1b[0m`,
  blue: (text) => `\\x1b[34m${text}\\x1b[0m`,
  bold: (text) => `\\x1b[1m${text}\\x1b[0m`,
  dim: (text) => `\\x1b[2m${text}\\x1b[0m`
} : {
  green: (text) => text,
  red: (text) => text,
  yellow: (text) => text,
  blue: (text) => text,
  bold: (text) => text,
  dim: (text) => text
};

function log(message, color = null) {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = colors.dim(`[${timestamp}]`);
  const output = color ? color(message) : message;
  console.log(`${prefix} ${output}`);
}

function success(message) {
  log(`✅ ${message}`, colors.green);
}

function error(message) {
  log(`❌ ${message}`, colors.red);
}

function warn(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

function info(message) {
  log(`ℹ️  ${message}`);
}

class LogAnalyzer {
  constructor() {
    this.results = {
      files: [],
      errors: [],
      warnings: [],
      metrics: {},
      patterns: {},
      timeline: [],
      summary: {
        totalLines: 0,
        errorCount: 0,
        warningCount: 0,
        timeRange: { start: null, end: null }
      }
    };
  }

  parseTimefilter(since) {
    const now = Date.now();
    const match = since.match(/(\d+)([mhd])/);
    
    if (!match) {
      throw new Error('Invalid time format. Use format like "30m", "2h", "1d"');
    }
    
    const [, amount, unit] = match;
    const multipliers = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
    const cutoff = now - (parseInt(amount) * multipliers[unit]);
    
    return new Date(cutoff);
  }

  async findLogFiles() {
    const files = [];
    
    for (const [name, path] of Object.entries(LOG_SOURCES)) {
      try {
        if (fs.existsSync(path)) {
          const stat = fs.statSync(path);
          files.push({
            name,
            path,
            size: stat.size,
            modified: stat.mtime,
            accessible: true
          });
        }
      } catch (err) {
        files.push({
          name,
          path,
          accessible: false,
          error: err.message
        });
      }
    }
    
    return files;
  }

  parseLogLine(line, lineNumber, fileName) {
    const entry = {
      line: lineNumber,
      file: fileName,
      raw: line,
      timestamp: null,
      level: null,
      message: line,
      patterns: []
    };

    // Extract timestamp (various formats)
    const timestampPatterns = [
      /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/, // [2026-02-25T05:04:24.179Z]
      /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/, // 2026-02-25 05:04:24
      /(\w{3} \w{3} \d{2} \d{2}:\d{2}:\d{2})/ // Wed Feb 25 05:04:24
    ];

    for (const pattern of timestampPatterns) {
      const match = line.match(pattern);
      if (match) {
        entry.timestamp = new Date(match[1]);
        break;
      }
    }

    // Extract log level
    const levelMatch = line.match(/\b(ERROR|WARN|WARNING|INFO|DEBUG|TRACE)\b/i);
    if (levelMatch) {
      entry.level = levelMatch[1].toUpperCase();
    }

    // Check for error patterns
    for (const errorPattern of ERROR_PATTERNS) {
      if (errorPattern.pattern.test(line)) {
        entry.patterns.push(errorPattern.name);
      }
    }

    // Extract performance metrics
    for (const perfPattern of PERFORMANCE_PATTERNS) {
      const match = line.match(perfPattern.pattern);
      if (match && perfPattern.extract) {
        const value = parseFloat(match[perfPattern.extract]);
        if (!this.results.metrics[perfPattern.name]) {
          this.results.metrics[perfPattern.name] = [];
        }
        this.results.metrics[perfPattern.name].push({
          value,
          timestamp: entry.timestamp,
          line: lineNumber,
          file: fileName
        });
      }
    }

    return entry;
  }

  async analyzeFile(filePath, options = {}) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Log file not found: ${filePath}`);
    }

    const fileName = path.basename(filePath);
    const cutoffTime = options.since ? this.parseTimefilter(options.since) : null;
    
    info(`Analyzing ${fileName}...`);

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\\n');
    
    let analyzedLines = 0;
    let errorCount = 0;
    let warningCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const entry = this.parseLogLine(line, i + 1, fileName);

      // Apply time filter
      if (cutoffTime && entry.timestamp && entry.timestamp < cutoffTime) {
        continue;
      }

      analyzedLines++;

      // Update summary
      if (!this.results.summary.timeRange.start || 
          (entry.timestamp && entry.timestamp < this.results.summary.timeRange.start)) {
        this.results.summary.timeRange.start = entry.timestamp;
      }
      if (!this.results.summary.timeRange.end || 
          (entry.timestamp && entry.timestamp > this.results.summary.timeRange.end)) {
        this.results.summary.timeRange.end = entry.timestamp;
      }

      // Categorize entries
      if (entry.level === 'ERROR' || entry.patterns.length > 0) {
        this.results.errors.push(entry);
        errorCount++;
      } else if (entry.level === 'WARN' || entry.level === 'WARNING') {
        this.results.warnings.push(entry);
        warningCount++;
      }

      // Track pattern occurrences
      for (const pattern of entry.patterns) {
        if (!this.results.patterns[pattern]) {
          this.results.patterns[pattern] = 0;
        }
        this.results.patterns[pattern]++;
      }

      // Add to timeline (sample every 100 lines for large files)
      if (i % 100 === 0 && entry.timestamp) {
        this.results.timeline.push({
          timestamp: entry.timestamp,
          line: i + 1,
          file: fileName
        });
      }
    }

    this.results.summary.totalLines += analyzedLines;
    this.results.summary.errorCount += errorCount;
    this.results.summary.warningCount += warningCount;

    success(`${fileName}: ${analyzedLines} lines, ${errorCount} errors, ${warningCount} warnings`);

    return { analyzedLines, errorCount, warningCount };
  }

  generateSummary() {
    console.log(colors.bold('\\n📊 Log Analysis Summary\\n'));

    const { summary, patterns, metrics } = this.results;
    
    // Time range
    if (summary.timeRange.start && summary.timeRange.end) {
      const duration = summary.timeRange.end - summary.timeRange.start;
      const hours = Math.round(duration / (1000 * 60 * 60) * 10) / 10;
      info(`Time range: ${summary.timeRange.start.toISOString()} to ${summary.timeRange.end.toISOString()} (${hours}h)`);
    }

    // Basic stats
    info(`Total lines analyzed: ${summary.totalLines}`);
    
    if (summary.errorCount > 0) {
      error(`Errors found: ${summary.errorCount}`);
    } else {
      success('No errors found');
    }
    
    if (summary.warningCount > 0) {
      warn(`Warnings found: ${summary.warningCount}`);
    }

    // Pattern breakdown
    if (Object.keys(patterns).length > 0) {
      console.log('\\n' + colors.bold('🔍 Error Patterns:'));
      const sortedPatterns = Object.entries(patterns)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10);
        
      for (const [pattern, count] of sortedPatterns) {
        console.log(`  ${colors.red('•')} ${pattern}: ${count} occurrences`);
      }
    }

    // Performance metrics summary
    if (Object.keys(metrics).length > 0) {
      console.log('\\n' + colors.bold('⚡ Performance Metrics:'));
      
      for (const [metric, values] of Object.entries(metrics)) {
        if (values.length > 0) {
          const nums = values.map(v => v.value);
          const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
          const max = Math.max(...nums);
          const min = Math.min(...nums);
          
          console.log(`  ${colors.blue('•')} ${metric}: avg ${avg.toFixed(1)}, max ${max}, min ${min} (${nums.length} samples)`);
        }
      }
    }

    // Health score
    const errorRate = summary.totalLines > 0 ? summary.errorCount / summary.totalLines : 0;
    const healthScore = Math.max(0, 100 - (errorRate * 1000)); // 1 error per 1000 lines = 99% health
    
    console.log('\\n' + colors.bold('🏥 System Health:'));
    if (healthScore >= 95) {
      success(`Health Score: ${healthScore.toFixed(1)}% - Excellent`);
    } else if (healthScore >= 80) {
      warn(`Health Score: ${healthScore.toFixed(1)}% - Good`);
    } else {
      error(`Health Score: ${healthScore.toFixed(1)}% - Needs Attention`);
    }
  }

  generateErrorReport() {
    if (this.results.errors.length === 0) {
      success('No errors found in analyzed logs');
      return;
    }

    console.log(colors.bold('\\n🚨 Error Analysis\\n'));

    // Recent errors (last 10)
    const recentErrors = this.results.errors
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 10);

    console.log(colors.bold('Recent Errors:'));
    for (const err of recentErrors) {
      const time = err.timestamp ? err.timestamp.toLocaleString() : 'Unknown time';
      const location = `${err.file}:${err.line}`;
      const patterns = err.patterns.length > 0 ? ` [${err.patterns.join(', ')}]` : '';
      
      console.log(colors.red(`• ${time} - ${location}${patterns}`));
      console.log(colors.dim(`  ${err.raw.substring(0, 100)}...`));
    }

    // Error frequency by pattern
    const patternCounts = {};
    for (const err of this.results.errors) {
      for (const pattern of err.patterns) {
        patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
      }
    }

    if (Object.keys(patternCounts).length > 0) {
      console.log('\\n' + colors.bold('Error Categories:'));
      const sortedPatterns = Object.entries(patternCounts)
        .sort(([,a], [,b]) => b - a);
        
      for (const [pattern, count] of sortedPatterns) {
        console.log(`${colors.red('•')} ${pattern}: ${count} errors`);
      }
    }
  }

  async watchLogs(options = {}) {
    const threshold = options.threshold || 5; // errors per minute
    const alertWindow = 60 * 1000; // 1 minute window
    
    info(`Starting log monitoring (alert threshold: ${threshold} errors/minute)...`);
    console.log(colors.yellow('Press Ctrl+C to stop monitoring\\n'));
    
    const errorHistory = [];
    let lastCheck = Date.now();
    
    // Find available log files
    const files = await this.findLogFiles();
    const watchableFiles = files.filter(f => f.accessible);
    
    if (watchableFiles.length === 0) {
      error('No accessible log files found for monitoring');
      return;
    }
    
    // Use tail to follow the most important log file
    const primaryLog = watchableFiles.find(f => f.name === 'deploy') || watchableFiles[0];
    info(`Monitoring: ${primaryLog.path}`);
    
    const tail = spawn('tail', ['-f', primaryLog.path], { stdio: ['ignore', 'pipe', 'ignore'] });
    
    tail.stdout.on('data', (data) => {
      const lines = data.toString().split('\\n');
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const entry = this.parseLogLine(line, 0, path.basename(primaryLog.path));
        
        // Check for errors
        if (entry.level === 'ERROR' || entry.patterns.length > 0) {
          errorHistory.push({
            timestamp: Date.now(),
            entry
          });
          
          // Real-time error display
          const time = new Date().toLocaleTimeString();
          console.log(colors.red(`[${time}] ERROR: ${entry.raw}`));
          
          if (entry.patterns.length > 0) {
            console.log(colors.yellow(`  Patterns: ${entry.patterns.join(', ')}`));
          }
        }
        
        // Check alert threshold
        const now = Date.now();
        if (now - lastCheck > 10000) { // Check every 10 seconds
          const recentErrors = errorHistory.filter(e => now - e.timestamp < alertWindow);
          
          if (recentErrors.length >= threshold) {
            console.log(colors.bold(colors.red(`\\n🚨 ALERT: ${recentErrors.length} errors in the last minute!\\n`)));
            
            // Show unique error patterns
            const patterns = [...new Set(recentErrors.flatMap(e => e.entry.patterns))];
            if (patterns.length > 0) {
              console.log(colors.yellow(`Error patterns: ${patterns.join(', ')}`));
            }
          }
          
          // Cleanup old entries
          errorHistory.splice(0, errorHistory.findIndex(e => now - e.timestamp < alertWindow * 2));
          lastCheck = now;
        }
      }
    });
    
    tail.on('close', (code) => {
      if (code === 0) {
        info('Log monitoring stopped');
      } else {
        error(`Log monitoring exited with code ${code}`);
      }
    });
    
    // Handle cleanup
    process.on('SIGINT', () => {
      info('\\nStopping log monitoring...');
      tail.kill();
      process.exit(0);
    });
  }

  outputResults(format = 'console') {
    switch (format) {
      case 'json':
        console.log(JSON.stringify(this.results, null, 2));
        break;
        
      case 'html':
        // Could generate HTML report
        warn('HTML output not implemented yet');
        break;
        
      case 'console':
      default:
        this.generateSummary();
        break;
    }
  }
}

async function main() {
  const command = process.argv[2] || 'help';
  const analyzer = new LogAnalyzer();
  
  // Parse options
  const options = {};
  for (const arg of process.argv.slice(3)) {
    const [key, value] = arg.split('=');
    if (key.startsWith('--')) {
      options[key.slice(2)] = value || true;
    }
  }
  
  try {
    switch (command) {
      case 'analyze':
        {
          const files = await analyzer.findLogFiles();
          const accessibleFiles = files.filter(f => f.accessible);
          
          if (accessibleFiles.length === 0) {
            error('No accessible log files found');
            process.exit(1);
          }
          
          info(`Found ${accessibleFiles.length} accessible log files`);
          
          // Analyze specified file or all available files
          if (options.file) {
            await analyzer.analyzeFile(options.file, options);
          } else {
            for (const file of accessibleFiles) {
              try {
                await analyzer.analyzeFile(file.path, options);
              } catch (err) {
                error(`Failed to analyze ${file.name}: ${err.message}`);
              }
            }
          }
          
          analyzer.outputResults(options.output);
        }
        break;
        
      case 'watch':
        await analyzer.watchLogs(options);
        break;
        
      case 'summary':
        {
          const files = await analyzer.findLogFiles();
          const accessibleFiles = files.filter(f => f.accessible);
          
          if (accessibleFiles.length === 0) {
            error('No accessible log files found');
            process.exit(1);
          }
          
          // Quick analysis of main log file
          const mainLog = accessibleFiles.find(f => f.name === 'deploy') || accessibleFiles[0];
          await analyzer.analyzeFile(mainLog.path, options);
          analyzer.generateSummary();
        }
        break;
        
      case 'errors':
        {
          const files = await analyzer.findLogFiles();
          const accessibleFiles = files.filter(f => f.accessible);
          
          if (accessibleFiles.length === 0) {
            error('No accessible log files found');
            process.exit(1);
          }
          
          for (const file of accessibleFiles) {
            try {
              await analyzer.analyzeFile(file.path, options);
            } catch (err) {
              error(`Failed to analyze ${file.name}: ${err.message}`);
            }
          }
          
          analyzer.generateErrorReport();
        }
        break;
        
      case 'help':
      default:
        console.log(colors.bold('\\nIC Mesh Log Analyzer\\n'));
        console.log('Commands:');
        console.log('  analyze   - Comprehensive log analysis and report');
        console.log('  watch     - Real-time log monitoring with alerts');
        console.log('  summary   - Quick log summary');
        console.log('  errors    - Detailed error analysis');
        console.log('');
        console.log('Options:');
        console.log('  --file=<path>       - Analyze specific log file');
        console.log('  --since=<duration>  - Analyze recent logs (e.g., "1h", "30m", "2d")');
        console.log('  --output=<format>   - Output format: console, json, html');
        console.log('  --threshold=<n>     - Alert threshold for watch mode (errors/minute)');
        console.log('');
        console.log('Examples:');
        console.log('  node scripts/log-analyzer.js analyze --since=1h');
        console.log('  node scripts/log-analyzer.js watch --threshold=3');
        console.log('  node scripts/log-analyzer.js errors --output=json');
        console.log('  node scripts/log-analyzer.js analyze --file=/var/log/custom.log');
        console.log('');
        break;
    }
  } catch (err) {
    error(`Log analysis failed: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}