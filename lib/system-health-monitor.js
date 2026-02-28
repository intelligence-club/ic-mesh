/**
 * Enhanced System Health Monitor
 * 
 * Provides comprehensive monitoring of system health metrics with trending analysis
 * and predictive alerting for early detection of potential issues.
 */

const fs = require('fs');
const path = require('path');

class SystemHealthMonitor {
  constructor(options = {}) {
    this.dataDir = options.dataDir || './data';
    this.metricsFile = path.join(this.dataDir, 'health-metrics.jsonl');
    this.alertThresholds = {
      cpuUsage: 85,
      memoryUsage: 90,
      errorRate: 5,
      responseTime: 5000,
      activeNodes: 1,
      jobFailureRate: 10
    };
    this.healthHistory = [];
    this.maxHistorySize = 1000;
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * Record a health metric sample
   */
  recordMetric(metricData) {
    const timestamp = Date.now();
    const enrichedMetric = {
      timestamp,
      iso: new Date(timestamp).toISOString(),
      ...metricData
    };

    // Add to memory history
    this.healthHistory.push(enrichedMetric);
    
    // Trim history to prevent memory growth
    if (this.healthHistory.length > this.maxHistorySize) {
      this.healthHistory = this.healthHistory.slice(-this.maxHistorySize);
    }

    // Persist to file
    this.persistMetric(enrichedMetric);
    
    return this.analyzeHealth(enrichedMetric);
  }

  /**
   * Persist metric to JSONL file for historical analysis
   */
  persistMetric(metric) {
    try {
      const line = JSON.stringify(metric) + '\n';
      fs.appendFileSync(this.metricsFile, line);
    } catch (error) {
      console.error('Failed to persist health metric:', error.message);
    }
  }

  /**
   * Analyze current health status and detect anomalies
   */
  analyzeHealth(currentMetric) {
    const alerts = [];
    const trends = this.calculateTrends();
    
    // Threshold-based alerts
    if (currentMetric.cpuUsage > this.alertThresholds.cpuUsage) {
      alerts.push({
        level: 'warning',
        type: 'cpu_high',
        message: `CPU usage ${currentMetric.cpuUsage}% exceeds threshold ${this.alertThresholds.cpuUsage}%`,
        metric: currentMetric.cpuUsage,
        threshold: this.alertThresholds.cpuUsage
      });
    }

    if (currentMetric.memoryUsage > this.alertThresholds.memoryUsage) {
      alerts.push({
        level: 'critical',
        type: 'memory_high',
        message: `Memory usage ${currentMetric.memoryUsage}% exceeds threshold ${this.alertThresholds.memoryUsage}%`,
        metric: currentMetric.memoryUsage,
        threshold: this.alertThresholds.memoryUsage
      });
    }

    if (currentMetric.activeNodes < this.alertThresholds.activeNodes) {
      alerts.push({
        level: 'critical',
        type: 'node_shortage',
        message: `Only ${currentMetric.activeNodes} active nodes, below minimum ${this.alertThresholds.activeNodes}`,
        metric: currentMetric.activeNodes,
        threshold: this.alertThresholds.activeNodes
      });
    }

    // Trend-based alerts
    if (trends.errorRateIncreasing && currentMetric.errorRate > 2) {
      alerts.push({
        level: 'warning',
        type: 'error_rate_trending',
        message: `Error rate trending upward: ${currentMetric.errorRate}% (trend: ${trends.errorRateTrend.toFixed(2)})`,
        metric: currentMetric.errorRate,
        trend: trends.errorRateTrend
      });
    }

    if (trends.responseTimeIncreasing && currentMetric.avgResponseTime > 1000) {
      alerts.push({
        level: 'warning',
        type: 'response_time_trending',
        message: `Response time trending upward: ${currentMetric.avgResponseTime}ms (trend: ${trends.responseTimeTrend.toFixed(2)})`,
        metric: currentMetric.avgResponseTime,
        trend: trends.responseTimeTrend
      });
    }

    return {
      status: alerts.length === 0 ? 'healthy' : 'degraded',
      alerts,
      trends,
      metric: currentMetric
    };
  }

  /**
   * Calculate health trends from recent history
   */
  calculateTrends() {
    if (this.healthHistory.length < 5) {
      return { insufficient_data: true };
    }

    const recent = this.healthHistory.slice(-10);
    const trends = {};

    // Calculate trends for key metrics
    ['cpuUsage', 'memoryUsage', 'errorRate', 'avgResponseTime', 'activeNodes'].forEach(metric => {
      const values = recent.map(r => r[metric]).filter(v => typeof v === 'number');
      if (values.length >= 3) {
        trends[`${metric}Trend`] = this.calculateLinearTrend(values);
        trends[`${metric}Increasing`] = trends[`${metric}Trend`] > 0;
      }
    });

    return trends;
  }

  /**
   * Calculate simple linear trend (slope) for a series of values
   */
  calculateLinearTrend(values) {
    const n = values.length;
    if (n < 2) return 0;

    const sumX = values.reduce((sum, _, i) => sum + i, 0);
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = values.reduce((sum, val, i) => sum + (i * val), 0);
    const sumXX = values.reduce((sum, _, i) => sum + (i * i), 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return slope || 0;
  }

  /**
   * Get system health summary
   */
  getHealthSummary() {
    if (this.healthHistory.length === 0) {
      return { status: 'unknown', message: 'No health data available' };
    }

    const latest = this.healthHistory[this.healthHistory.length - 1];
    const trends = this.calculateTrends();
    const analysis = this.analyzeHealth(latest);

    return {
      status: analysis.status,
      timestamp: latest.timestamp,
      metrics: latest,
      alerts: analysis.alerts,
      trends: trends,
      dataPoints: this.healthHistory.length
    };
  }

  /**
   * Load historical metrics from file
   */
  loadHistoricalMetrics() {
    try {
      if (fs.existsSync(this.metricsFile)) {
        const data = fs.readFileSync(this.metricsFile, 'utf8');
        const lines = data.trim().split('\n').filter(line => line.trim());
        
        this.healthHistory = lines.slice(-this.maxHistorySize).map(line => {
          try {
            return JSON.parse(line);
          } catch (e) {
            return null;
          }
        }).filter(Boolean);

        return this.healthHistory.length;
      }
    } catch (error) {
      console.error('Failed to load historical metrics:', error.message);
    }
    return 0;
  }

  /**
   * Clean up old metrics data (keep last 30 days)
   */
  cleanupOldMetrics() {
    const cutoffTime = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days ago
    
    try {
      if (fs.existsSync(this.metricsFile)) {
        const data = fs.readFileSync(this.metricsFile, 'utf8');
        const lines = data.trim().split('\n');
        
        const recentLines = lines.filter(line => {
          try {
            const metric = JSON.parse(line);
            return metric.timestamp > cutoffTime;
          } catch (e) {
            return false;
          }
        });

        fs.writeFileSync(this.metricsFile, recentLines.join('\n') + '\n');
        return lines.length - recentLines.length; // Return number of deleted entries
      }
    } catch (error) {
      console.error('Failed to cleanup old metrics:', error.message);
    }
    return 0;
  }
}

module.exports = SystemHealthMonitor;