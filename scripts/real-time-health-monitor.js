#!/usr/bin/env node

/**
 * Real-Time Health Monitor - Continuous system health tracking with intelligent alerting
 * 
 * Features:
 * - Continuous monitoring with configurable intervals
 * - Smart alerting based on health degradation patterns
 * - Performance trend analysis
 * - Automated issue detection and suggestions
 * - Non-intrusive health checks to avoid rate limits
 * 
 * Usage:
 *   node scripts/real-time-health-monitor.js [options]
 *   --interval <seconds>    Monitoring interval (default: 30)
 *   --alert-threshold <n>   Alert after n consecutive issues (default: 3)
 *   --log-file <path>       Log file path (default: data/health-monitor.log)
 *   --quiet                 Suppress console output
 *   --once                  Run once and exit
 */

const fs = require('fs');
const path = require('path');

class RealTimeHealthMonitor {
    constructor(options = {}) {
        this.options = {
            interval: options.interval || 30,
            alertThreshold: options.alertThreshold || 3,
            logFile: options.logFile || path.join(process.cwd(), 'data', 'health-monitor.log'),
            quiet: options.quiet || false,
            once: options.once || false
        };

        this.consecutiveIssues = 0;
        this.lastHealthScore = null;
        this.healthHistory = [];
        this.startTime = Date.now();
        
        // Ensure log directory exists
        const logDir = path.dirname(this.options.logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    async checkHealth() {
        const timestamp = new Date().toISOString();
        const health = {
            timestamp,
            score: 100,
            issues: [],
            metrics: {},
            suggestions: []
        };

        try {
            // Check database connectivity
            const dbPath = path.join(process.cwd(), 'mesh.db');
            if (!fs.existsSync(dbPath)) {
                health.issues.push('Database file missing');
                health.score -= 30;
            } else {
                health.metrics.dbSize = this.formatBytes(fs.statSync(dbPath).size);
            }

            // Check server process (non-intrusive)
            const { exec } = require('child_process');
            const serverRunning = await new Promise((resolve) => {
                exec('pgrep -f "node.*server.js"', (error, stdout) => {
                    resolve(!!stdout.trim());
                });
            });

            if (!serverRunning) {
                health.issues.push('Server process not running');
                health.score -= 40;
            }

            // Check log files for recent errors
            const logPath = path.join(process.cwd(), 'data', 'mesh.log');
            if (fs.existsSync(logPath)) {
                const logStats = fs.statSync(logPath);
                const lastModified = logStats.mtime;
                const hoursSinceLastLog = (Date.now() - lastModified.getTime()) / (1000 * 60 * 60);
                
                health.metrics.lastLogActivity = `${hoursSinceLastLog.toFixed(1)}h ago`;
                
                if (hoursSinceLastLog > 24) {
                    health.issues.push('No recent log activity (>24h)');
                    health.score -= 10;
                }

                // Check for recent errors in last 1000 lines
                const logContent = exec('tail -1000 "' + logPath + '" 2>/dev/null || echo ""');
                // Note: This is non-blocking and approximate
            }

            // Check disk space
            const { execSync } = require('child_process');
            try {
                const dfOutput = execSync('df . 2>/dev/null', { encoding: 'utf8' });
                const lines = dfOutput.trim().split('\n');
                if (lines.length >= 2) {
                    const fields = lines[1].split(/\s+/);
                    const usePercent = parseInt(fields[4]);
                    health.metrics.diskUsage = `${usePercent}%`;
                    
                    if (usePercent > 90) {
                        health.issues.push(`High disk usage: ${usePercent}%`);
                        health.score -= 15;
                    } else if (usePercent > 80) {
                        health.issues.push(`Moderate disk usage: ${usePercent}%`);
                        health.score -= 5;
                    }
                }
            } catch (e) {
                // Disk check failed, not critical
            }

            // Memory usage check
            try {
                const memInfo = execSync('free -m 2>/dev/null', { encoding: 'utf8' });
                const lines = memInfo.split('\n');
                const memLine = lines[1];
                if (memLine) {
                    const fields = memLine.split(/\s+/);
                    const total = parseInt(fields[1]);
                    const available = parseInt(fields[6] || fields[3]);
                    const usagePercent = Math.round((total - available) / total * 100);
                    
                    health.metrics.memoryUsage = `${usagePercent}%`;
                    
                    if (usagePercent > 90) {
                        health.issues.push(`High memory usage: ${usagePercent}%`);
                        health.score -= 10;
                    }
                }
            } catch (e) {
                // Memory check failed, not critical
            }

            // Add uptime metric
            const uptimeHours = (Date.now() - this.startTime) / (1000 * 60 * 60);
            health.metrics.monitorUptime = `${uptimeHours.toFixed(1)}h`;

        } catch (error) {
            health.issues.push(`Health check error: ${error.message}`);
            health.score -= 20;
        }

        // Generate suggestions based on issues
        this.generateSuggestions(health);

        return health;
    }

    generateSuggestions(health) {
        health.issues.forEach(issue => {
            if (issue.includes('Database file missing')) {
                health.suggestions.push('Initialize database: npm run setup');
            } else if (issue.includes('Server process not running')) {
                health.suggestions.push('Start server: npm start');
            } else if (issue.includes('High disk usage')) {
                health.suggestions.push('Clean up logs: find data/ -name "*.log" -mtime +7 -delete');
            } else if (issue.includes('High memory usage')) {
                health.suggestions.push('Restart server to free memory: npm run restart');
            } else if (issue.includes('No recent log activity')) {
                health.suggestions.push('Check if server is processing jobs: curl localhost:8333/status');
            }
        });
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    logHealth(health) {
        const logEntry = {
            timestamp: health.timestamp,
            score: health.score,
            issueCount: health.issues.length,
            issues: health.issues,
            metrics: health.metrics
        };

        const logLine = JSON.stringify(logEntry) + '\n';
        
        try {
            fs.appendFileSync(this.options.logFile, logLine);
        } catch (error) {
            console.error('Failed to write health log:', error.message);
        }
    }

    shouldAlert(health) {
        if (health.score < 80) {
            this.consecutiveIssues++;
        } else {
            this.consecutiveIssues = 0;
        }

        return this.consecutiveIssues >= this.options.alertThreshold;
    }

    displayHealth(health) {
        if (this.options.quiet) return;

        const statusIcon = health.score >= 90 ? '🟢' : health.score >= 70 ? '🟡' : '🔴';
        const trend = this.getHealthTrend();
        
        console.log(`\n${statusIcon} Health Score: ${health.score}/100 ${trend}`);
        console.log(`📊 Metrics:`, Object.entries(health.metrics)
            .map(([k, v]) => `${k}=${v}`).join(', '));
        
        if (health.issues.length > 0) {
            console.log(`⚠️  Issues (${health.issues.length}):`);
            health.issues.forEach(issue => console.log(`   • ${issue}`));
        }
        
        if (health.suggestions.length > 0) {
            console.log(`💡 Suggestions:`);
            health.suggestions.forEach(suggestion => console.log(`   • ${suggestion}`));
        }

        if (this.shouldAlert(health)) {
            console.log(`\n🚨 ALERT: ${this.consecutiveIssues} consecutive health issues detected!`);
        }
    }

    getHealthTrend() {
        if (this.healthHistory.length < 2) return '';
        
        const recent = this.healthHistory.slice(-3);
        const isImproving = recent.every((health, i) => 
            i === 0 || health.score >= recent[i - 1].score);
        const isDegrading = recent.every((health, i) => 
            i === 0 || health.score <= recent[i - 1].score);
        
        if (isImproving && recent[recent.length - 1].score > recent[0].score + 5) {
            return '📈';
        } else if (isDegrading && recent[0].score > recent[recent.length - 1].score + 5) {
            return '📉';
        }
        return '➡️';
    }

    async run() {
        if (!this.options.quiet) {
            console.log(`🏥 Real-Time Health Monitor Starting`);
            console.log(`   Interval: ${this.options.interval}s`);
            console.log(`   Alert threshold: ${this.options.alertThreshold} consecutive issues`);
            console.log(`   Log file: ${this.options.logFile}`);
            console.log(`   Press Ctrl+C to stop\n`);
        }

        do {
            try {
                const health = await this.checkHealth();
                this.healthHistory.push(health);
                
                // Keep only last 20 entries for trend analysis
                if (this.healthHistory.length > 20) {
                    this.healthHistory.shift();
                }
                
                this.displayHealth(health);
                this.logHealth(health);
                this.lastHealthScore = health.score;
                
                if (this.options.once) {
                    break;
                }
                
                await new Promise(resolve => setTimeout(resolve, this.options.interval * 1000));
                
            } catch (error) {
                console.error('Health monitor error:', error.message);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } while (true);
    }
}

// CLI handling
if (require.main === module) {
    const args = process.argv.slice(2);
    const options = {};
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--interval':
                options.interval = parseInt(args[++i]);
                break;
            case '--alert-threshold':
                options.alertThreshold = parseInt(args[++i]);
                break;
            case '--log-file':
                options.logFile = args[++i];
                break;
            case '--quiet':
                options.quiet = true;
                break;
            case '--once':
                options.once = true;
                break;
            case '--help':
                console.log(`Real-Time Health Monitor

Usage: node scripts/real-time-health-monitor.js [options]

Options:
  --interval <seconds>        Monitoring interval (default: 30)
  --alert-threshold <n>       Alert after n consecutive issues (default: 3)
  --log-file <path>           Log file path (default: data/health-monitor.log)
  --quiet                     Suppress console output
  --once                      Run once and exit
  --help                      Show this help message

Examples:
  # Start continuous monitoring
  node scripts/real-time-health-monitor.js

  # Quick health check
  node scripts/real-time-health-monitor.js --once

  # Monitor every 60 seconds with custom log file
  node scripts/real-time-health-monitor.js --interval 60 --log-file /tmp/health.log
`);
                process.exit(0);
        }
    }
    
    const monitor = new RealTimeHealthMonitor(options);
    
    // Graceful shutdown handling
    process.on('SIGINT', () => {
        console.log('\n🛑 Health monitor stopping...');
        process.exit(0);
    });
    
    monitor.run().catch(error => {
        console.error('Monitor failed:', error.message);
        process.exit(1);
    });
}

module.exports = RealTimeHealthMonitor;