#!/usr/bin/env node
/**
 * Rate Limit Dashboard — Comprehensive Rate Limiting Management
 * 
 * Provides a unified interface for monitoring, analyzing, and managing
 * rate limiting across the IC Mesh network. Includes real-time stats,
 * trend analysis, and optimization recommendations.
 * 
 * Usage:
 *   node scripts/rate-limit-dashboard.js              # Interactive dashboard
 *   node scripts/rate-limit-dashboard.js --stats      # Show current statistics
 *   node scripts/rate-limit-dashboard.js --patterns   # Analyze patterns
 *   node scripts/rate-limit-dashboard.js --health     # Health check
 */

const fs = require('fs');
const path = require('path');
const EnhancedRateLimiter = require('../lib/enhanced-rate-limit');

class RateLimitDashboard {
  constructor() {
    // Initialize with file paths that match the server configuration
    this.limiter = new EnhancedRateLimiter({
      whitelistFile: './config/rate-limit-whitelist.json',
      logFile: './logs/rate-limits.log',
      enableLogging: true
    });
    
    this.colors = {
      reset: '\x1b[0m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m'
    };
  }

  colorize(text, color) {
    return this.colors[color] + text + this.colors.reset;
  }

  async showInteractiveDashboard() {
    console.clear();
    this.showHeader();
    await this.showCurrentStats();
    console.log('\n');
    await this.showRecentActivity();
    console.log('\n');
    this.showCommands();
  }

  showHeader() {
    console.log(this.colorize('═══════════════════════════════════════════', 'cyan'));
    console.log(this.colorize('           📊 RATE LIMIT DASHBOARD           ', 'cyan'));
    console.log(this.colorize('═══════════════════════════════════════════', 'cyan'));
    console.log();
  }

  async showCurrentStats() {
    const stats = this.limiter.getStats();
    
    console.log(this.colorize('📈 SYSTEM STATISTICS', 'blue'));
    console.log('─────────────────────');
    
    const uptimeHours = (stats.uptime / (1000 * 60 * 60)).toFixed(2);
    const reqPerMin = stats.requestsPerMinute.toFixed(2);
    
    console.log(`⏱️  Uptime: ${uptimeHours} hours`);
    console.log(`📊 Total Requests: ${stats.totalRequests.toLocaleString()}`);
    console.log(`🚫 Rate Limited: ${stats.rateLimitedRequests.toLocaleString()} (${stats.rateLimitRate}%)`);
    console.log(`🛡️  Whitelisted: ${stats.whitelistedRequests.toLocaleString()}`);
    console.log(`⚡ Rate: ${reqPerMin} req/min`);
    console.log(`🔗 Active Connections: ${stats.activeConnections}`);
    console.log(`📝 Whitelist Size: ${stats.whitelistSize}`);

    // Health indicator
    let healthColor = 'green';
    let healthStatus = 'HEALTHY';
    
    if (stats.rateLimitRate > 20) {
      healthColor = 'red';
      healthStatus = 'HIGH RATE LIMITING';
    } else if (stats.rateLimitRate > 5) {
      healthColor = 'yellow';
      healthStatus = 'MODERATE RATE LIMITING';
    }
    
    console.log(`🏥 Health: ${this.colorize(healthStatus, healthColor)}`);
  }

  async showRecentActivity() {
    console.log(this.colorize('📋 RECENT ACTIVITY', 'blue'));
    console.log('────────────────────');
    
    const analysis = this.limiter.analyzePatterns();
    
    if (analysis.error) {
      console.log(this.colorize('⚠️  No activity data available', 'yellow'));
      return;
    }

    console.log(`📊 Analyzed ${analysis.totalAnalyzed} log entries`);
    console.log(`🚫 Rate Limit Events: ${analysis.rateLimitEvents}`);
    console.log(`🛡️  Whitelist Bypasses: ${analysis.whitelistBypasses}`);

    if (analysis.topRateLimitedIPs && analysis.topRateLimitedIPs.length > 0) {
      console.log('\n🔥 Top Rate Limited IPs:');
      analysis.topRateLimitedIPs.slice(0, 5).forEach(([ip, count], index) => {
        const color = count > 50 ? 'red' : count > 20 ? 'yellow' : 'white';
        console.log(`   ${index + 1}. ${this.colorize(ip, color)} (${count} events)`);
      });
    }

    if (analysis.topRateLimitedGroups && analysis.topRateLimitedGroups.length > 0) {
      console.log('\n📂 Top Rate Limited Endpoints:');
      analysis.topRateLimitedGroups.slice(0, 5).forEach(([group, count], index) => {
        const color = count > 50 ? 'red' : count > 20 ? 'yellow' : 'white';
        console.log(`   ${index + 1}. ${this.colorize(group, color)} (${count} events)`);
      });
    }
  }

  showCommands() {
    console.log(this.colorize('🎛️  AVAILABLE COMMANDS', 'blue'));
    console.log('─────────────────────');
    console.log('  📊 stats         - Show detailed statistics');
    console.log('  📋 patterns      - Analyze rate limiting patterns');
    console.log('  🛡️  whitelist     - Manage IP whitelist');
    console.log('  🏥 health        - Run health check');
    console.log('  📈 trends        - Show rate limiting trends');
    console.log('  🔧 optimize      - Get optimization suggestions');
    console.log('  🔄 refresh       - Refresh dashboard');
    console.log('  ❌ quit          - Exit dashboard');
    console.log('\nExample: node scripts/rate-limit-dashboard.js --stats');
  }

  async showDetailedStats() {
    const stats = this.limiter.getStats();
    
    console.log(this.colorize('📊 DETAILED STATISTICS', 'cyan'));
    console.log('═══════════════════════');
    console.log();
    
    // System metrics
    console.log(this.colorize('🖥️  SYSTEM METRICS', 'blue'));
    console.log(`   Total Requests: ${stats.totalRequests.toLocaleString()}`);
    console.log(`   Rate Limited: ${stats.rateLimitedRequests.toLocaleString()}`);
    console.log(`   Whitelisted: ${stats.whitelistedRequests.toLocaleString()}`);
    console.log(`   Success Rate: ${((stats.totalRequests - stats.rateLimitedRequests) / stats.totalRequests * 100).toFixed(2)}%`);
    console.log();
    
    // Performance metrics
    console.log(this.colorize('⚡ PERFORMANCE METRICS', 'blue'));
    const uptimeHours = stats.uptime / (1000 * 60 * 60);
    console.log(`   Uptime: ${uptimeHours.toFixed(2)} hours`);
    console.log(`   Requests/minute: ${stats.requestsPerMinute.toFixed(2)}`);
    console.log(`   Active connections: ${stats.activeConnections}`);
    console.log();
    
    // Configuration
    console.log(this.colorize('⚙️  CONFIGURATION', 'blue'));
    console.log(`   Whitelist size: ${stats.whitelistSize} IPs`);
    console.log(`   Rate limit groups: ${Object.keys(this.limiter.limits).length}`);
    
    console.log('\n📋 Rate Limit Groups:');
    Object.entries(this.limiter.limits).forEach(([group, limit]) => {
      console.log(`   ${group}: ${limit}/minute`);
    });
  }

  async analyzePatterns() {
    console.log(this.colorize('🔍 PATTERN ANALYSIS', 'cyan'));
    console.log('══════════════════════');
    console.log();
    
    const analysis = this.limiter.analyzePatterns();
    
    if (analysis.error) {
      console.log(this.colorize('⚠️  Error: ' + analysis.error, 'red'));
      return;
    }

    console.log(`📊 Analysis of ${analysis.totalAnalyzed} log entries`);
    console.log(`🕐 Time Range: ${analysis.timeRange.start} to ${analysis.timeRange.end}`);
    console.log();
    
    // Rate limiting summary
    const rateLimitRate = (analysis.rateLimitEvents / analysis.totalAnalyzed * 100).toFixed(2);
    console.log(this.colorize('🚫 RATE LIMITING SUMMARY', 'blue'));
    console.log(`   Total Events: ${analysis.rateLimitEvents}`);
    console.log(`   Rate: ${rateLimitRate}% of all requests`);
    console.log(`   Whitelist Bypasses: ${analysis.whitelistBypasses}`);
    console.log();

    // Top offending IPs
    if (analysis.topRateLimitedIPs && analysis.topRateLimitedIPs.length > 0) {
      console.log(this.colorize('🔥 TOP RATE LIMITED IPs', 'blue'));
      analysis.topRateLimitedIPs.forEach(([ip, count], index) => {
        const severity = count > 100 ? '🔴' : count > 50 ? '🟠' : count > 20 ? '🟡' : '🟢';
        console.log(`   ${index + 1}. ${severity} ${ip} - ${count} events`);
      });
      console.log();
    }

    // Endpoint analysis
    if (analysis.topRateLimitedGroups && analysis.topRateLimitedGroups.length > 0) {
      console.log(this.colorize('📂 ENDPOINT ANALYSIS', 'blue'));
      analysis.topRateLimitedGroups.forEach(([group, count], index) => {
        const severity = count > 100 ? '🔴' : count > 50 ? '🟠' : count > 20 ? '🟡' : '🟢';
        console.log(`   ${index + 1}. ${severity} ${group} - ${count} events`);
      });
      console.log();
    }

    // Recommendations
    this.generateRecommendations(analysis);
  }

  generateRecommendations(analysis) {
    console.log(this.colorize('💡 OPTIMIZATION RECOMMENDATIONS', 'blue'));
    console.log();

    const rateLimitRate = analysis.rateLimitEvents / analysis.totalAnalyzed * 100;

    if (rateLimitRate > 20) {
      console.log('🔴 CRITICAL: Very high rate limiting detected!');
      console.log('   • Immediately review top offending IPs');
      console.log('   • Consider increasing rate limits for legitimate traffic');
      console.log('   • Implement IP-based blocking for abuse');
      console.log('   • Add monitoring alerts');
    } else if (rateLimitRate > 5) {
      console.log('🟡 MODERATE: Notable rate limiting activity');
      console.log('   • Monitor rate limiting trends');
      console.log('   • Consider whitelist additions for legitimate services');
      console.log('   • Review client retry logic');
    } else {
      console.log('🟢 GOOD: Rate limiting within normal parameters');
      console.log('   • Continue monitoring for trends');
      console.log('   • Periodic whitelist review recommended');
    }

    // IP-specific recommendations
    if (analysis.topRateLimitedIPs && analysis.topRateLimitedIPs.length > 0) {
      console.log('\n🎯 IP-SPECIFIC ACTIONS:');
      analysis.topRateLimitedIPs.slice(0, 3).forEach(([ip, count]) => {
        if (count > 100) {
          console.log(`   🔴 ${ip}: Consider blocking or investigation (${count} violations)`);
        } else if (count > 20) {
          console.log(`   🟡 ${ip}: Monitor closely, possible whitelist candidate (${count} violations)`);
        }
      });
    }

    console.log('\n📋 GENERAL BEST PRACTICES:');
    console.log('   • Implement exponential backoff in clients');
    console.log('   • Use rate limit headers for client guidance');
    console.log('   • Regular whitelist review and cleanup');
    console.log('   • Monitor for distributed attack patterns');
    console.log('   • Consider adaptive rate limiting based on load');
  }

  async runHealthCheck() {
    console.log(this.colorize('🏥 RATE LIMITING HEALTH CHECK', 'cyan'));
    console.log('════════════════════════════════');
    console.log();

    const stats = this.limiter.getStats();
    let healthScore = 100;
    const issues = [];

    // Check rate limiting frequency
    if (stats.rateLimitRate > 20) {
      healthScore -= 40;
      issues.push('🔴 CRITICAL: Very high rate limiting (>20%)');
    } else if (stats.rateLimitRate > 5) {
      healthScore -= 15;
      issues.push('🟡 WARNING: Elevated rate limiting (>5%)');
    }

    // Check whitelist size
    if (stats.whitelistSize === 0) {
      healthScore -= 10;
      issues.push('🟡 WARNING: No IPs whitelisted (monitoring may be affected)');
    } else if (stats.whitelistSize > 100) {
      healthScore -= 5;
      issues.push('🟡 INFO: Large whitelist (review recommended)');
    }

    // Check active connections
    if (stats.activeConnections > 1000) {
      healthScore -= 10;
      issues.push('🟡 WARNING: High number of active connections');
    }

    // Check if logging is working
    const analysis = this.limiter.analyzePatterns();
    if (analysis.error) {
      healthScore -= 20;
      issues.push('🔴 ERROR: Rate limiting logs not accessible');
    }

    // Display results
    let healthColor = 'green';
    let healthStatus = 'EXCELLENT';
    
    if (healthScore < 50) {
      healthColor = 'red';
      healthStatus = 'CRITICAL';
    } else if (healthScore < 70) {
      healthColor = 'yellow';
      healthStatus = 'WARNING';
    } else if (healthScore < 90) {
      healthColor = 'blue';
      healthStatus = 'GOOD';
    }

    console.log(`🏥 Health Score: ${this.colorize(healthScore + '/100', healthColor)} (${healthStatus})`);
    console.log();

    if (issues.length > 0) {
      console.log(this.colorize('⚠️  ISSUES DETECTED:', 'yellow'));
      issues.forEach(issue => console.log('   ' + issue));
    } else {
      console.log(this.colorize('✅ No issues detected - rate limiting is healthy!', 'green'));
    }

    console.log();
    console.log(this.colorize('📊 QUICK STATS:', 'blue'));
    console.log(`   Rate Limit Frequency: ${stats.rateLimitRate}%`);
    console.log(`   Whitelist Size: ${stats.whitelistSize} IPs`);
    console.log(`   Active Connections: ${stats.activeConnections}`);
    console.log(`   Total Requests: ${stats.totalRequests.toLocaleString()}`);
  }
}

// CLI Interface
async function main() {
  const dashboard = new RateLimitDashboard();
  const args = process.argv.slice(2);

  if (args.includes('--stats')) {
    await dashboard.showDetailedStats();
  } else if (args.includes('--patterns')) {
    await dashboard.analyzePatterns();
  } else if (args.includes('--health')) {
    await dashboard.runHealthCheck();
  } else {
    await dashboard.showInteractiveDashboard();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Dashboard Error:', error.message);
    process.exit(1);
  });
}

module.exports = RateLimitDashboard;