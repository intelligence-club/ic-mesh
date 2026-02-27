#!/usr/bin/env node
/**
 * Performance Monitor for IC Mesh
 * 
 * Provides comprehensive performance monitoring, metrics collection,
 * and health analysis for the IC Mesh coordination server.
 * 
 * Features:
 * - Real-time performance metrics collection
 * - Database query performance analysis
 * - Memory usage tracking
 * - WebSocket connection monitoring
 * - Job processing performance metrics
 * - System health scoring
 * - Performance trend analysis
 * - Alert generation for performance degradation
 * 
 * Usage:
 *   const PerfMonitor = require('./lib/performance-monitor');
 *   const monitor = new PerfMonitor();
 *   monitor.trackRequest('GET /status', startTime, endTime);
 *   const metrics = monitor.getMetrics();
 */

const EventEmitter = require('events');
const os = require('os');

class PerformanceMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxMetricsHistory: options.maxMetricsHistory || 1000,
      alertThresholds: {
        responseTime: options.responseTimeThreshold || 2000, // ms
        memoryUsage: options.memoryThreshold || 0.8, // 80%
        dbQueryTime: options.dbQueryThreshold || 500, // ms
        wsConnectionCount: options.wsConnectionThreshold || 1000,
        ...options.alertThresholds
      },
      collectInterval: options.collectInterval || 30000, // 30 seconds
      ...options
    };

    this.metrics = {
      requests: new Map(),
      database: {
        queries: [],
        totalTime: 0,
        queryCount: 0,
        slowQueries: []
      },
      websockets: {
        connections: 0,
        messagesPerSecond: 0,
        errors: 0
      },
      jobs: {
        processedPerMinute: 0,
        averageProcessingTime: 0,
        failureRate: 0,
        queueSize: 0
      },
      system: {
        memoryUsage: 0,
        cpuUsage: 0,
        uptime: 0,
        nodeVersion: process.version
      },
      alerts: [],
      history: []
    };

    this.startTime = Date.now();
    this.lastMetricsSnapshot = null;

    // Start automatic metrics collection
    this.collectionInterval = setInterval(() => {
      this.collectSystemMetrics();
      this.checkAlerts();
    }, this.options.collectInterval);

    // Track process metrics
    this.trackProcessMetrics();
  }

  /**
   * Track HTTP request performance
   */
  trackRequest(endpoint, startTime, endTime = Date.now(), statusCode = 200, size = 0) {
    const duration = endTime - startTime;
    const key = `${endpoint}_${statusCode}`;

    if (!this.metrics.requests.has(key)) {
      this.metrics.requests.set(key, {
        endpoint,
        statusCode,
        count: 0,
        totalTime: 0,
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        lastRequest: 0,
        errors: 0,
        totalSize: 0
      });
    }

    const metric = this.metrics.requests.get(key);
    metric.count++;
    metric.totalTime += duration;
    metric.avgTime = metric.totalTime / metric.count;
    metric.minTime = Math.min(metric.minTime, duration);
    metric.maxTime = Math.max(metric.maxTime, duration);
    metric.lastRequest = endTime;
    metric.totalSize += size;

    if (statusCode >= 400) {
      metric.errors++;
    }

    // Check for slow requests
    if (duration > this.options.alertThresholds.responseTime) {
      this.generateAlert('SLOW_REQUEST', {
        endpoint,
        duration,
        threshold: this.options.alertThresholds.responseTime,
        statusCode
      });
    }

    this.emit('request', { endpoint, duration, statusCode, size });
  }

  /**
   * Track database query performance
   */
  trackDatabaseQuery(query, duration, error = null) {
    this.metrics.database.queryCount++;
    this.metrics.database.totalTime += duration;

    const queryMetric = {
      query: query.substring(0, 100), // Truncate for storage
      duration,
      timestamp: Date.now(),
      error: error ? error.message : null
    };

    this.metrics.database.queries.push(queryMetric);

    // Keep only recent queries
    if (this.metrics.database.queries.length > this.options.maxMetricsHistory) {
      this.metrics.database.queries = this.metrics.database.queries.slice(-this.options.maxMetricsHistory / 2);
    }

    // Track slow queries
    if (duration > this.options.alertThresholds.dbQueryTime) {
      this.metrics.database.slowQueries.push(queryMetric);
      this.generateAlert('SLOW_QUERY', {
        query: queryMetric.query,
        duration,
        threshold: this.options.alertThresholds.dbQueryTime
      });
    }

    this.emit('database_query', queryMetric);
  }

  /**
   * Track WebSocket metrics
   */
  updateWebSocketMetrics(connections, messagesPerSecond = 0, errors = 0) {
    this.metrics.websockets.connections = connections;
    this.metrics.websockets.messagesPerSecond = messagesPerSecond;
    this.metrics.websockets.errors = errors;

    if (connections > this.options.alertThresholds.wsConnectionCount) {
      this.generateAlert('HIGH_WS_CONNECTIONS', {
        connections,
        threshold: this.options.alertThresholds.wsConnectionCount
      });
    }

    this.emit('websocket_update', this.metrics.websockets);
  }

  /**
   * Track job processing metrics
   */
  trackJobProcessing(jobId, duration, success = true, queueSize = 0) {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Update job metrics
    this.metrics.jobs.queueSize = queueSize;
    
    // Calculate processed per minute (simple approximation)
    this.metrics.jobs.processedPerMinute = this.calculateJobRate();
    
    // Update average processing time
    const currentAvg = this.metrics.jobs.averageProcessingTime;
    this.metrics.jobs.averageProcessingTime = (currentAvg + duration) / 2;

    // Update failure rate
    if (!success) {
      this.metrics.jobs.failureRate = this.calculateFailureRate();
    }

    this.emit('job_processed', { jobId, duration, success, queueSize });
  }

  /**
   * Collect system-level metrics
   */
  collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    
    this.metrics.system = {
      memoryUsage: memUsage.rss / totalMem,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      cpuUsage: this.getCPUUsage(),
      uptime: Date.now() - this.startTime,
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      loadAverage: os.loadavg(),
      freeMem: os.freemem(),
      totalMem: totalMem
    };

    // Check memory usage
    if (this.metrics.system.memoryUsage > this.options.alertThresholds.memoryUsage) {
      this.generateAlert('HIGH_MEMORY_USAGE', {
        usage: this.metrics.system.memoryUsage,
        threshold: this.options.alertThresholds.memoryUsage
      });
    }

    this.emit('system_metrics', this.metrics.system);
  }

  /**
   * Get comprehensive performance report
   */
  getPerformanceReport() {
    const now = Date.now();
    const requestMetrics = Array.from(this.metrics.requests.values());
    
    return {
      timestamp: now,
      uptime: now - this.startTime,
      
      // Request performance summary
      requests: {
        total: requestMetrics.reduce((sum, m) => sum + m.count, 0),
        averageResponseTime: this.calculateOverallAvgResponseTime(),
        slowRequests: requestMetrics.filter(m => m.maxTime > this.options.alertThresholds.responseTime).length,
        errorRate: this.calculateErrorRate(),
        endpoints: requestMetrics.map(m => ({
          endpoint: m.endpoint,
          statusCode: m.statusCode,
          count: m.count,
          avgTime: Math.round(m.avgTime),
          maxTime: Math.round(m.maxTime),
          errorRate: m.count > 0 ? (m.errors / m.count) : 0
        })).sort((a, b) => b.count - a.count)
      },

      // Database performance
      database: {
        totalQueries: this.metrics.database.queryCount,
        averageQueryTime: this.metrics.database.queryCount > 0 
          ? this.metrics.database.totalTime / this.metrics.database.queryCount 
          : 0,
        slowQueries: this.metrics.database.slowQueries.length,
        recentSlowQueries: this.metrics.database.slowQueries.slice(-5).map(q => ({
          query: q.query,
          duration: Math.round(q.duration),
          timestamp: q.timestamp
        }))
      },

      // WebSocket performance
      websockets: this.metrics.websockets,

      // Job processing performance
      jobs: this.metrics.jobs,

      // System metrics
      system: {
        ...this.metrics.system,
        memoryUsagePercent: Math.round(this.metrics.system.memoryUsage * 100),
        uptimeHours: Math.round((now - this.startTime) / 3600000 * 10) / 10
      },

      // Recent alerts
      alerts: this.metrics.alerts.slice(-10),

      // Health score (0-100)
      healthScore: this.calculateHealthScore()
    };
  }

  /**
   * Calculate overall health score
   */
  calculateHealthScore() {
    let score = 100;
    const weights = {
      responseTime: 0.3,
      memoryUsage: 0.25,
      errorRate: 0.25,
      dbPerformance: 0.2
    };

    // Response time penalty
    const avgResponseTime = this.calculateOverallAvgResponseTime();
    if (avgResponseTime > this.options.alertThresholds.responseTime) {
      score -= weights.responseTime * 50;
    } else if (avgResponseTime > this.options.alertThresholds.responseTime * 0.5) {
      score -= weights.responseTime * 25;
    }

    // Memory usage penalty
    if (this.metrics.system.memoryUsage > this.options.alertThresholds.memoryUsage) {
      score -= weights.memoryUsage * 50;
    } else if (this.metrics.system.memoryUsage > this.options.alertThresholds.memoryUsage * 0.8) {
      score -= weights.memoryUsage * 25;
    }

    // Error rate penalty
    const errorRate = this.calculateErrorRate();
    if (errorRate > 0.1) {
      score -= weights.errorRate * 50;
    } else if (errorRate > 0.05) {
      score -= weights.errorRate * 25;
    }

    // Database performance penalty
    const avgDbTime = this.metrics.database.queryCount > 0 
      ? this.metrics.database.totalTime / this.metrics.database.queryCount 
      : 0;
    if (avgDbTime > this.options.alertThresholds.dbQueryTime) {
      score -= weights.dbPerformance * 50;
    } else if (avgDbTime > this.options.alertThresholds.dbQueryTime * 0.5) {
      score -= weights.dbPerformance * 25;
    }

    return Math.max(0, Math.round(score));
  }

  /**
   * Generate performance alert
   */
  generateAlert(type, data) {
    const alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      severity: this.getAlertSeverity(type),
      message: this.formatAlertMessage(type, data),
      data,
      timestamp: Date.now(),
      resolved: false
    };

    this.metrics.alerts.push(alert);

    // Keep only recent alerts
    if (this.metrics.alerts.length > this.options.maxMetricsHistory) {
      this.metrics.alerts = this.metrics.alerts.slice(-this.options.maxMetricsHistory / 2);
    }

    this.emit('alert', alert);
    return alert;
  }

  /**
   * Helper methods
   */
  calculateOverallAvgResponseTime() {
    const requestMetrics = Array.from(this.metrics.requests.values());
    if (requestMetrics.length === 0) return 0;
    
    const totalTime = requestMetrics.reduce((sum, m) => sum + m.totalTime, 0);
    const totalCount = requestMetrics.reduce((sum, m) => sum + m.count, 0);
    
    return totalCount > 0 ? totalTime / totalCount : 0;
  }

  calculateErrorRate() {
    const requestMetrics = Array.from(this.metrics.requests.values());
    if (requestMetrics.length === 0) return 0;
    
    const totalErrors = requestMetrics.reduce((sum, m) => sum + m.errors, 0);
    const totalRequests = requestMetrics.reduce((sum, m) => sum + m.count, 0);
    
    return totalRequests > 0 ? totalErrors / totalRequests : 0;
  }

  calculateJobRate() {
    // Simplified calculation - in production would track timestamps
    return this.metrics.jobs.processedPerMinute || 0;
  }

  calculateFailureRate() {
    // Simplified calculation - in production would track actual failures
    return this.metrics.jobs.failureRate || 0;
  }

  getCPUUsage() {
    // Simplified CPU usage - could use more sophisticated monitoring
    const load = os.loadavg()[0];
    const cores = os.cpus().length;
    return load / cores;
  }

  getAlertSeverity(type) {
    const severityMap = {
      'SLOW_REQUEST': 'warning',
      'SLOW_QUERY': 'warning',
      'HIGH_MEMORY_USAGE': 'error',
      'HIGH_WS_CONNECTIONS': 'warning',
      'HIGH_ERROR_RATE': 'error'
    };
    return severityMap[type] || 'info';
  }

  formatAlertMessage(type, data) {
    const formatters = {
      'SLOW_REQUEST': (d) => `Slow request detected: ${d.endpoint} took ${d.duration}ms (threshold: ${d.threshold}ms)`,
      'SLOW_QUERY': (d) => `Slow database query: "${d.query}" took ${d.duration}ms (threshold: ${d.threshold}ms)`,
      'HIGH_MEMORY_USAGE': (d) => `High memory usage: ${Math.round(d.usage * 100)}% (threshold: ${Math.round(d.threshold * 100)}%)`,
      'HIGH_WS_CONNECTIONS': (d) => `High WebSocket connections: ${d.connections} (threshold: ${d.threshold})`,
      'HIGH_ERROR_RATE': (d) => `High error rate detected: ${Math.round(d.rate * 100)}% (threshold: ${Math.round(d.threshold * 100)}%)`
    };
    
    return formatters[type] ? formatters[type](data) : `Alert: ${type}`;
  }

  trackProcessMetrics() {
    // Track uncaught exceptions and rejections
    process.on('uncaughtException', (error) => {
      this.generateAlert('UNCAUGHT_EXCEPTION', {
        message: error.message,
        stack: error.stack
      });
    });

    process.on('unhandledRejection', (reason) => {
      this.generateAlert('UNHANDLED_REJECTION', {
        reason: reason.toString()
      });
    });
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }
    this.removeAllListeners();
  }

  /**
   * Export metrics for external monitoring
   */
  exportMetrics() {
    return {
      timestamp: Date.now(),
      requests: Object.fromEntries(this.metrics.requests),
      database: this.metrics.database,
      websockets: this.metrics.websockets,
      jobs: this.metrics.jobs,
      system: this.metrics.system,
      alerts: this.metrics.alerts
    };
  }
}

module.exports = PerformanceMonitor;