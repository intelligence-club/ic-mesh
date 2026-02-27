#!/usr/bin/env node
/**
 * Enhanced IC Mesh System Monitor
 * 
 * Comprehensive monitoring dashboard with intelligent alerts,
 * performance analytics, and operational recommendations.
 * 
 * Features:
 * - Real-time system health scoring
 * - Intelligent alert prioritization  
 * - Performance trend analysis
 * - Capacity planning insights
 * - Automated issue detection
 * - Operational recommendations
 * 
 * Usage: node enhanced-system-monitor.js [--watch] [--alerts] [--json]
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Configuration
const DB_PATH = process.env.DB_PATH || './mesh.db';
const ALERT_THRESHOLDS = {
  nodeRetention: 0.6,      // 60% minimum retention rate
  jobSuccess: 0.7,         // 70% minimum success rate
  avgResponseTime: 30000,  // 30s maximum average response time
  pendingJobs: 50,         // 50 maximum pending jobs
  criticalFailures: 5,     // 5 max critical failures in 1h
  diskUsage: 0.8,          // 80% maximum disk usage
  memoryUsage: 0.9         // 90% maximum memory usage
};

const HEALTH_WEIGHTS = {
  nodeAvailability: 0.25,
  jobPerformance: 0.25,
  systemStability: 0.20,
  resourceUtilization: 0.15,
  errorRate: 0.15
};

class EnhancedSystemMonitor {
  constructor() {
    this.db = new Database(DB_PATH, { readonly: true });
    this.currentTime = Date.now();
    this.alerts = [];
    this.recommendations = [];
  }

  /**
   * Generate comprehensive system health report
   */
  async generateReport(options = {}) {
    console.log(this.formatHeader('🔍 IC MESH ENHANCED SYSTEM MONITOR'));
    console.log(`📅 Report Generated: ${new Date().toISOString()}`);
    console.log(`🗄️  Database: ${DB_PATH}`);
    console.log();

    try {
      // Collect all metrics
      const metrics = {
        overview: this.getSystemOverview(),
        nodes: this.getNodeAnalytics(),
        jobs: this.getJobAnalytics(),
        performance: this.getPerformanceMetrics(),
        capacity: this.getCapacityAnalysis(),
        trends: this.getTrendAnalysis(),
        health: this.calculateHealthScore()
      };

      // Generate alerts and recommendations
      this.analyzeForAlerts(metrics);
      this.generateRecommendations(metrics);

      // Display report sections
      this.displayOverview(metrics.overview);
      this.displayHealthScore(metrics.health);
      this.displayNodeAnalytics(metrics.nodes);
      this.displayJobAnalytics(metrics.jobs);
      this.displayPerformanceMetrics(metrics.performance);
      this.displayCapacityAnalysis(metrics.capacity);
      this.displayTrendAnalysis(metrics.trends);
      this.displayAlertsAndRecommendations();

      if (options.json) {
        return {
          timestamp: new Date().toISOString(),
          metrics,
          alerts: this.alerts,
          recommendations: this.recommendations
        };
      }

    } catch (error) {
      console.error('❌ Error generating report:', error.message);
      process.exit(1);
    }
  }

  /**
   * System overview metrics
   */
  getSystemOverview() {
    const nodes = this.db.prepare('SELECT COUNT(*) as total FROM nodes').get();
    const activeNodes = this.db.prepare(
      'SELECT COUNT(*) as active FROM nodes WHERE lastHeartbeat > ?'
    ).get(this.currentTime - 300000); // 5 min

    const jobs = this.db.prepare('SELECT COUNT(*) as total FROM jobs').get();
    const recentJobs = this.db.prepare(
      'SELECT COUNT(*) as recent FROM jobs WHERE createdAt > ?'
    ).get(this.currentTime - 86400000); // 24h

    const pendingJobs = this.db.prepare(
      'SELECT COUNT(*) as pending FROM jobs WHERE status = ?'
    ).get('pending');

    return {
      totalNodes: nodes.total,
      activeNodes: activeNodes.active,
      nodeRetentionRate: nodes.total > 0 ? (activeNodes.active / nodes.total) : 0,
      totalJobs: jobs.total,
      recentJobs: recentJobs.recent,
      pendingJobs: pendingJobs.pending,
      systemUptime: this.getSystemUptime()
    };
  }

  /**
   * Node analytics and performance
   */
  getNodeAnalytics() {
    // Node status distribution
    const nodeStats = this.db.prepare(`
      SELECT 
        nodeId,
        name,
        capabilities,
        lastHeartbeat,
        ? - lastHeartbeat as offlineMs,
        CASE 
          WHEN lastHeartbeat > ? THEN 'online'
          WHEN lastHeartbeat > ? THEN 'stale'
          ELSE 'offline'
        END as status
      FROM nodes
      ORDER BY lastHeartbeat DESC
    `).all(this.currentTime, this.currentTime - 300000, this.currentTime - 600000);

    // Node performance metrics
    const nodePerformance = this.db.prepare(`
      SELECT 
        claimedBy as nodeId,
        COUNT(*) as totalJobs,
        AVG(computeMinutes) as avgComputeTime,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
      FROM jobs 
      WHERE claimedBy IS NOT NULL AND createdAt > ?
      GROUP BY claimedBy
    `).all(this.currentTime - 86400000);

    // Calculate node efficiency scores
    const nodeEfficiency = {};
    nodePerformance.forEach(node => {
      const successRate = node.totalJobs > 0 ? (node.completed / node.totalJobs) : 0;
      const speedScore = node.avgComputeTime ? Math.max(0, 1 - (node.avgComputeTime / 60000)) : 0;
      nodeEfficiency[node.nodeId] = {
        successRate,
        speedScore,
        efficiency: (successRate * 0.7 + speedScore * 0.3)
      };
    });

    return {
      nodes: nodeStats,
      performance: nodePerformance,
      efficiency: nodeEfficiency,
      summary: {
        online: nodeStats.filter(n => n.status === 'online').length,
        stale: nodeStats.filter(n => n.status === 'stale').length,
        offline: nodeStats.filter(n => n.status === 'offline').length,
        avgEfficiency: Object.values(nodeEfficiency).length > 0 
          ? Object.values(nodeEfficiency).reduce((sum, n) => sum + n.efficiency, 0) / Object.values(nodeEfficiency).length 
          : 0
      }
    };
  }

  /**
   * Job analytics and success metrics
   */
  getJobAnalytics() {
    // Job status distribution
    const statusDist = this.db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM jobs 
      WHERE createdAt > ?
      GROUP BY status
    `).all(this.currentTime - 86400000);

    // Job type performance
    const typePerformance = this.db.prepare(`
      SELECT 
        type,
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        AVG(computeMinutes) as avgTime,
        AVG(CASE WHEN status = 'completed' THEN computeMinutes END) as avgSuccessTime
      FROM jobs 
      WHERE createdAt > ?
      GROUP BY type
    `).all(this.currentTime - 86400000);

    // Recent failure analysis
    const recentFailures = this.db.prepare(`
      SELECT 
        jobId,
        type,
        claimedBy,
        error,
        createdAt,
        claimedAt,
        completedAt
      FROM jobs 
      WHERE status = 'failed' AND createdAt > ?
      ORDER BY createdAt DESC
      LIMIT 10
    `).all(this.currentTime - 3600000); // 1 hour

    const totalJobs = statusDist.reduce((sum, s) => sum + s.count, 0);
    const completedJobs = statusDist.find(s => s.status === 'completed')?.count || 0;
    const successRate = totalJobs > 0 ? (completedJobs / totalJobs) : 0;

    return {
      statusDistribution: statusDist,
      typePerformance: typePerformance,
      recentFailures: recentFailures,
      summary: {
        totalJobs24h: totalJobs,
        successRate: successRate,
        avgProcessingTime: this.getAverageProcessingTime(),
        failureRate: totalJobs > 0 ? ((totalJobs - completedJobs) / totalJobs) : 0
      }
    };
  }

  /**
   * Performance metrics and response times
   */
  getPerformanceMetrics() {
    // Response time analysis
    const responseTimes = this.db.prepare(`
      SELECT 
        claimedAt - createdAt as queueTime,
        completedAt - claimedAt as processTime,
        completedAt - createdAt as totalTime,
        type
      FROM jobs 
      WHERE status = 'completed' AND createdAt > ?
      ORDER BY createdAt DESC
      LIMIT 100
    `).all(this.currentTime - 86400000);

    // Throughput analysis
    const throughput = this.db.prepare(`
      SELECT 
        strftime('%H', datetime(completedAt/1000, 'unixepoch')) as hour,
        COUNT(*) as completedJobs
      FROM jobs 
      WHERE status = 'completed' AND completedAt > ?
      GROUP BY hour
      ORDER BY hour
    `).all(this.currentTime - 86400000);

    // Resource utilization
    const resourceUsage = this.calculateResourceUtilization();

    return {
      responseTimes: responseTimes,
      throughput: throughput,
      resourceUsage: resourceUsage,
      averages: {
        queueTime: responseTimes.length > 0 ? responseTimes.reduce((sum, r) => sum + (r.queueTime || 0), 0) / responseTimes.length : 0,
        processTime: responseTimes.length > 0 ? responseTimes.reduce((sum, r) => sum + (r.processTime || 0), 0) / responseTimes.length : 0,
        totalTime: responseTimes.length > 0 ? responseTimes.reduce((sum, r) => sum + (r.totalTime || 0), 0) / responseTimes.length : 0
      }
    };
  }

  /**
   * Capacity planning analysis
   */
  getCapacityAnalysis() {
    // Current capacity utilization
    const activeNodes = this.db.prepare(
      'SELECT COUNT(*) as count FROM nodes WHERE lastHeartbeat > ?'
    ).get(this.currentTime - 300000).count;

    const claimedJobs = this.db.prepare(
      'SELECT COUNT(*) as count FROM jobs WHERE status = ?'
    ).get('claimed').count;

    const pendingJobs = this.db.prepare(
      'SELECT COUNT(*) as count FROM jobs WHERE status = ?'
    ).get('pending').count;

    // Peak load analysis
    const peakLoads = this.db.prepare(`
      SELECT 
        strftime('%Y-%m-%d %H:00', datetime(createdAt/1000, 'unixepoch')) as hour,
        COUNT(*) as jobsCreated
      FROM jobs 
      WHERE createdAt > ?
      GROUP BY hour
      ORDER BY jobsCreated DESC
      LIMIT 5
    `).all(this.currentTime - 604800000); // 7 days

    // Projected growth
    const growthRate = this.calculateGrowthRate();

    return {
      currentUtilization: activeNodes > 0 ? (claimedJobs / activeNodes) : 0,
      queueDepth: pendingJobs,
      peakLoads: peakLoads,
      growthRate: growthRate,
      recommendations: this.generateCapacityRecommendations(activeNodes, claimedJobs, pendingJobs, growthRate)
    };
  }

  /**
   * Trend analysis over time
   */
  getTrendAnalysis() {
    // Daily trends for the last 7 days
    const dailyTrends = this.db.prepare(`
      SELECT 
        DATE(datetime(createdAt/1000, 'unixepoch')) as date,
        COUNT(*) as totalJobs,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        AVG(CASE WHEN status = 'completed' THEN computeMinutes END) as avgProcessTime
      FROM jobs 
      WHERE createdAt > ?
      GROUP BY date
      ORDER BY date DESC
      LIMIT 7
    `).all(this.currentTime - 604800000);

    // Node retention trends
    const nodeRetention = this.db.prepare(`
      SELECT 
        DATE(datetime(lastHeartbeat/1000, 'unixepoch')) as date,
        COUNT(DISTINCT nodeId) as uniqueNodes
      FROM nodes 
      GROUP BY date
      ORDER BY date DESC
      LIMIT 7
    `).all();

    return {
      dailyTrends: dailyTrends,
      nodeRetention: nodeRetention,
      trends: {
        jobVelocity: this.calculateTrendDirection(dailyTrends, 'totalJobs'),
        successRate: this.calculateTrendDirection(dailyTrends, 'completed'),
        nodeGrowth: this.calculateTrendDirection(nodeRetention, 'uniqueNodes')
      }
    };
  }

  /**
   * Calculate overall system health score
   */
  calculateHealthScore() {
    const overview = this.getSystemOverview();
    const nodes = this.getNodeAnalytics();
    const jobs = this.getJobAnalytics();
    const performance = this.getPerformanceMetrics();

    // Individual health components (0-100)
    const nodeHealth = Math.min(100, (overview.nodeRetentionRate * 100));
    const jobHealth = Math.min(100, (jobs.summary.successRate * 100));
    const performanceHealth = Math.min(100, 100 - (performance.averages.totalTime / 600)); // Based on 10min max
    const capacityHealth = overview.pendingJobs < 10 ? 100 : Math.max(0, 100 - (overview.pendingJobs / 2));
    const errorHealth = Math.max(0, 100 - (jobs.summary.failureRate * 200));

    // Weighted overall score
    const overallHealth = 
      (nodeHealth * HEALTH_WEIGHTS.nodeAvailability) +
      (jobHealth * HEALTH_WEIGHTS.jobPerformance) +
      (performanceHealth * HEALTH_WEIGHTS.systemStability) +
      (capacityHealth * HEALTH_WEIGHTS.resourceUtilization) +
      (errorHealth * HEALTH_WEIGHTS.errorRate);

    return {
      overall: Math.round(overallHealth),
      components: {
        nodeHealth: Math.round(nodeHealth),
        jobHealth: Math.round(jobHealth),
        performanceHealth: Math.round(performanceHealth),
        capacityHealth: Math.round(capacityHealth),
        errorHealth: Math.round(errorHealth)
      },
      grade: this.getHealthGrade(overallHealth)
    };
  }

  /**
   * Analyze metrics for alerts
   */
  analyzeForAlerts(metrics) {
    // Node retention alert
    if (metrics.overview.nodeRetentionRate < ALERT_THRESHOLDS.nodeRetention) {
      this.alerts.push({
        level: 'warning',
        category: 'nodes',
        message: `Low node retention rate: ${(metrics.overview.nodeRetentionRate * 100).toFixed(1)}%`,
        threshold: `${(ALERT_THRESHOLDS.nodeRetention * 100)}%`,
        impact: 'Reduced network capacity and reliability'
      });
    }

    // Job success rate alert
    if (metrics.jobs.summary.successRate < ALERT_THRESHOLDS.jobSuccess) {
      this.alerts.push({
        level: 'critical',
        category: 'jobs',
        message: `Low job success rate: ${(metrics.jobs.summary.successRate * 100).toFixed(1)}%`,
        threshold: `${(ALERT_THRESHOLDS.jobSuccess * 100)}%`,
        impact: 'Customer experience degradation, potential revenue loss'
      });
    }

    // Pending jobs alert
    if (metrics.overview.pendingJobs > ALERT_THRESHOLDS.pendingJobs) {
      this.alerts.push({
        level: 'warning',
        category: 'capacity',
        message: `High pending job queue: ${metrics.overview.pendingJobs} jobs`,
        threshold: `${ALERT_THRESHOLDS.pendingJobs} jobs`,
        impact: 'Increased customer wait times'
      });
    }

    // Critical failures alert
    if (metrics.jobs.recentFailures.length > ALERT_THRESHOLDS.criticalFailures) {
      this.alerts.push({
        level: 'critical',
        category: 'stability',
        message: `High failure rate: ${metrics.jobs.recentFailures.length} failures in last hour`,
        threshold: `${ALERT_THRESHOLDS.criticalFailures} failures/hour`,
        impact: 'System instability, investigate immediately'
      });
    }

    // Performance alert
    if (metrics.performance.averages.totalTime > ALERT_THRESHOLDS.avgResponseTime) {
      this.alerts.push({
        level: 'warning',
        category: 'performance',
        message: `Slow response times: ${(metrics.performance.averages.totalTime / 1000).toFixed(1)}s average`,
        threshold: `${ALERT_THRESHOLDS.avgResponseTime / 1000}s`,
        impact: 'Poor customer experience'
      });
    }
  }

  /**
   * Generate operational recommendations
   */
  generateRecommendations(metrics) {
    // Node recommendations
    if (metrics.overview.nodeRetentionRate < 0.8) {
      this.recommendations.push({
        category: 'nodes',
        priority: 'high',
        action: 'Investigate node churn',
        details: 'Review node logs, check network stability, improve onboarding process'
      });
    }

    // Capacity recommendations  
    if (metrics.overview.pendingJobs > 20) {
      this.recommendations.push({
        category: 'capacity',
        priority: 'medium',
        action: 'Scale node capacity',
        details: 'Consider adding more nodes or optimizing job distribution'
      });
    }

    // Performance optimization
    if (metrics.performance.averages.totalTime > 15000) {
      this.recommendations.push({
        category: 'performance', 
        priority: 'medium',
        action: 'Optimize job processing',
        details: 'Review slow jobs, optimize algorithms, check node resources'
      });
    }

    // Quality improvements
    if (metrics.jobs.summary.successRate < 0.9) {
      this.recommendations.push({
        category: 'quality',
        priority: 'high',
        action: 'Improve job reliability',
        details: 'Analyze failure patterns, enhance error handling, add retry logic'
      });
    }
  }

  // Display methods for formatted output
  displayOverview(overview) {
    console.log(this.formatSectionHeader('📊 SYSTEM OVERVIEW'));
    console.log(`🖥️  Nodes: ${overview.activeNodes}/${overview.totalNodes} active (${(overview.nodeRetentionRate * 100).toFixed(1)}% retention)`);
    console.log(`⚙️  Jobs: ${overview.recentJobs} processed (24h), ${overview.pendingJobs} pending`);
    console.log(`⏱️  Uptime: ${this.formatDuration(overview.systemUptime)}`);
    console.log();
  }

  displayHealthScore(health) {
    console.log(this.formatSectionHeader(`💚 SYSTEM HEALTH: ${health.overall}/100 (${health.grade})`));
    console.log(`📡 Node Availability: ${health.components.nodeHealth}/100`);
    console.log(`🎯 Job Performance: ${health.components.jobHealth}/100`);  
    console.log(`⚡ System Stability: ${health.components.performanceHealth}/100`);
    console.log(`📈 Capacity Utilization: ${health.components.capacityHealth}/100`);
    console.log(`🚨 Error Rate: ${health.components.errorHealth}/100`);
    console.log();
  }

  displayNodeAnalytics(nodes) {
    console.log(this.formatSectionHeader('🖥️  NODE ANALYTICS'));
    console.log(`Status: ${nodes.summary.online} online, ${nodes.summary.stale} stale, ${nodes.summary.offline} offline`);
    console.log(`Average Efficiency: ${(nodes.summary.avgEfficiency * 100).toFixed(1)}%`);
    
    if (nodes.nodes.length > 0) {
      console.log('\nTop Nodes:');
      nodes.nodes.slice(0, 5).forEach(node => {
        const status = this.formatNodeStatus(node.status);
        const offline = node.offlineMs > 0 ? ` (offline ${this.formatDuration(node.offlineMs)})` : '';
        console.log(`  ${status} ${node.name || node.nodeId.slice(0, 8)}${offline}`);
      });
    }
    console.log();
  }

  displayJobAnalytics(jobs) {
    console.log(this.formatSectionHeader('⚙️  JOB ANALYTICS'));
    console.log(`Success Rate: ${(jobs.summary.successRate * 100).toFixed(1)}%`);
    console.log(`Processing Time: ${this.formatDuration(jobs.summary.avgProcessingTime)}`);
    console.log(`24h Volume: ${jobs.summary.totalJobs24h} jobs`);
    
    if (jobs.recentFailures.length > 0) {
      console.log('\nRecent Failures:');
      jobs.recentFailures.slice(0, 3).forEach(job => {
        console.log(`  ❌ ${job.type} (${job.jobId.slice(0, 8)}) - ${job.error || 'No error message'}`);
      });
    }
    console.log();
  }

  displayPerformanceMetrics(performance) {
    console.log(this.formatSectionHeader('⚡ PERFORMANCE METRICS'));
    console.log(`Queue Time: ${this.formatDuration(performance.averages.queueTime)}`);
    console.log(`Process Time: ${this.formatDuration(performance.averages.processTime)}`);
    console.log(`Total Response: ${this.formatDuration(performance.averages.totalTime)}`);
    console.log();
  }

  displayCapacityAnalysis(capacity) {
    console.log(this.formatSectionHeader('📈 CAPACITY ANALYSIS'));
    console.log(`Current Utilization: ${(capacity.currentUtilization * 100).toFixed(1)}%`);
    console.log(`Queue Depth: ${capacity.queueDepth} jobs`);
    console.log(`Growth Rate: ${(capacity.growthRate * 100).toFixed(1)}% per day`);
    
    if (capacity.peakLoads.length > 0) {
      console.log('\nPeak Load Hours:');
      capacity.peakLoads.slice(0, 3).forEach(peak => {
        console.log(`  📊 ${peak.hour}: ${peak.jobsCreated} jobs`);
      });
    }
    console.log();
  }

  displayTrendAnalysis(trends) {
    console.log(this.formatSectionHeader('📈 TREND ANALYSIS'));
    console.log(`Job Velocity: ${this.formatTrend(trends.trends.jobVelocity)}`);
    console.log(`Success Rate: ${this.formatTrend(trends.trends.successRate)}`);
    console.log(`Node Growth: ${this.formatTrend(trends.trends.nodeGrowth)}`);
    console.log();
  }

  displayAlertsAndRecommendations() {
    if (this.alerts.length > 0) {
      console.log(this.formatSectionHeader('🚨 ALERTS'));
      this.alerts.forEach(alert => {
        const icon = alert.level === 'critical' ? '🔴' : '🟡';
        console.log(`${icon} ${alert.message}`);
        console.log(`   Impact: ${alert.impact}`);
      });
      console.log();
    }

    if (this.recommendations.length > 0) {
      console.log(this.formatSectionHeader('💡 RECOMMENDATIONS'));
      this.recommendations.forEach(rec => {
        const priority = rec.priority === 'high' ? '🔥' : '📝';
        console.log(`${priority} ${rec.action}`);
        console.log(`   ${rec.details}`);
      });
      console.log();
    }
  }

  // Utility methods
  getSystemUptime() {
    try {
      const stats = fs.statSync(DB_PATH);
      return Date.now() - stats.mtime.getTime();
    } catch {
      return 0;
    }
  }

  getAverageProcessingTime() {
    const result = this.db.prepare(`
      SELECT AVG(computeMinutes) as avg 
      FROM jobs 
      WHERE status = 'completed' AND createdAt > ?
    `).get(this.currentTime - 86400000);
    return result.avg || 0;
  }

  calculateResourceUtilization() {
    // Simplified resource calculation - could be enhanced with actual metrics
    return {
      cpu: Math.random() * 0.3 + 0.2, // Simulated for now
      memory: Math.random() * 0.4 + 0.3,
      disk: Math.random() * 0.2 + 0.1
    };
  }

  calculateGrowthRate() {
    const weekAgo = this.db.prepare(`
      SELECT COUNT(*) as count FROM jobs WHERE createdAt BETWEEN ? AND ?
    `).get(this.currentTime - 604800000, this.currentTime - 86400000);
    
    const today = this.db.prepare(`
      SELECT COUNT(*) as count FROM jobs WHERE createdAt > ?
    `).get(this.currentTime - 86400000);

    return weekAgo.count > 0 ? ((today.count - (weekAgo.count / 7)) / weekAgo.count * 7) : 0;
  }

  generateCapacityRecommendations(activeNodes, claimedJobs, pendingJobs, growthRate) {
    const recommendations = [];
    
    if (pendingJobs > activeNodes * 2) {
      recommendations.push('Scale up: Add more nodes to handle pending jobs');
    }
    
    if (growthRate > 0.5) {
      recommendations.push('Growth planning: Prepare for 50%+ daily growth');
    }
    
    return recommendations;
  }

  calculateTrendDirection(data, field) {
    if (data.length < 2) return 'unknown';
    const recent = data.slice(0, 3).reduce((sum, d) => sum + (d[field] || 0), 0) / Math.min(3, data.length);
    const older = data.slice(-3).reduce((sum, d) => sum + (d[field] || 0), 0) / Math.min(3, data.length);
    
    if (recent > older * 1.1) return 'improving';
    if (recent < older * 0.9) return 'declining'; 
    return 'stable';
  }

  getHealthGrade(score) {
    if (score >= 90) return 'Excellent';
    if (score >= 80) return 'Good';
    if (score >= 70) return 'Fair';
    if (score >= 60) return 'Poor';
    return 'Critical';
  }

  formatHeader(text) {
    return `\n${'═'.repeat(60)}\n${text.padStart((60 + text.length) / 2)}\n${'═'.repeat(60)}`;
  }

  formatSectionHeader(text) {
    return `\n${text}\n${'─'.repeat(40)}`;
  }

  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  }

  formatNodeStatus(status) {
    const icons = {
      'online': '🟢',
      'stale': '🟡', 
      'offline': '🔴'
    };
    return icons[status] || '⚪';
  }

  formatTrend(trend) {
    const icons = {
      'improving': '📈',
      'declining': '📉',
      'stable': '➡️',
      'unknown': '❓'
    };
    return `${icons[trend]} ${trend}`;
  }

  close() {
    this.db.close();
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const options = {
    watch: args.includes('--watch'),
    alerts: args.includes('--alerts'),
    json: args.includes('--json')
  };

  const monitor = new EnhancedSystemMonitor();

  try {
    if (options.watch) {
      console.log('🔄 Starting continuous monitoring (press Ctrl+C to stop)...\n');
      
      const runMonitoring = async () => {
        console.clear();
        await monitor.generateReport(options);
        console.log('\n⏱️  Next update in 30 seconds...');
      };

      await runMonitoring();
      setInterval(runMonitoring, 30000);
      
      // Keep process alive
      process.on('SIGINT', () => {
        console.log('\n👋 Monitoring stopped.');
        monitor.close();
        process.exit(0);
      });

    } else {
      const result = await monitor.generateReport(options);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      }
      monitor.close();
    }

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    monitor.close();
    process.exit(1);
  }
}

// Export for programmatic use
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { EnhancedSystemMonitor };