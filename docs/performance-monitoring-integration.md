# Performance Monitoring Integration Guide

## Overview

This guide explains how to integrate comprehensive performance monitoring into the IC Mesh coordination server using the new performance monitoring module.

## Components

1. **PerformanceMonitor** (`lib/performance-monitor.js`) - Core monitoring module
2. **Performance Analysis Tool** (`scripts/performance-analysis.js`) - Analysis and reporting
3. **Integration Points** - How to add monitoring to existing server code

## Quick Start

### 1. Basic Integration

Add to `server.js`:

```javascript
const PerformanceMonitor = require('./lib/performance-monitor');

// Initialize performance monitor
const perfMonitor = new PerformanceMonitor({
  alertThresholds: {
    responseTime: 1000,  // Alert on requests > 1000ms
    memoryUsage: 0.8,    // Alert when memory > 80%
    dbQueryTime: 500     // Alert on DB queries > 500ms
  }
});

// Monitor HTTP requests
function trackRequest(req, res, next) {
  const startTime = Date.now();
  const originalEnd = res.end;
  
  res.end = function(...args) {
    const endTime = Date.now();
    const endpoint = `${req.method} ${req.url}`;
    perfMonitor.trackRequest(endpoint, startTime, endTime, res.statusCode);
    originalEnd.apply(this, args);
  };
  
  next();
}

// Add to request pipeline
app.use(trackRequest);
```

### 2. Database Query Monitoring

Wrap database operations:

```javascript
// Before
const result = stmts.getJob.get(jobId);

// After
const startTime = Date.now();
const result = stmts.getJob.get(jobId);
perfMonitor.trackDatabaseQuery('SELECT job', Date.now() - startTime);
```

### 3. WebSocket Monitoring

Track WebSocket metrics:

```javascript
wss.on('connection', (ws) => {
  wsConnections++;
  perfMonitor.updateWebSocketMetrics(wsConnections);
  
  ws.on('close', () => {
    wsConnections--;
    perfMonitor.updateWebSocketMetrics(wsConnections);
  });
});
```

### 4. Job Processing Monitoring

Track job performance:

```javascript
// When job starts
const jobStartTime = Date.now();

// When job completes
const processingTime = Date.now() - jobStartTime;
const queueSize = getPendingJobsCount();
perfMonitor.trackJobProcessing(jobId, processingTime, success, queueSize);
```

## Performance Analysis

### Command Line Usage

```bash
# Quick analysis (recommended for regular checks)
node scripts/performance-analysis.js

# Detailed analysis with load testing
node scripts/performance-analysis.js --detailed

# Continuous monitoring mode
node scripts/performance-analysis.js --monitor

# Generate JSON report only
node scripts/performance-analysis.js --report
```

### Integration with Monitoring Systems

The performance monitor can integrate with external monitoring:

```javascript
// Export metrics for Prometheus/Grafana
const metrics = perfMonitor.exportMetrics();

// Listen for alerts
perfMonitor.on('alert', (alert) => {
  // Send to alerting system
  sendToSlack(alert);
  logAlert(alert);
});

// Get comprehensive report
const report = perfMonitor.getPerformanceReport();
```

## Recommended Monitoring Strategy

### 1. Development Environment

```javascript
const perfMonitor = new PerformanceMonitor({
  alertThresholds: {
    responseTime: 500,   // Strict thresholds for development
    memoryUsage: 0.7,
    dbQueryTime: 250
  },
  collectInterval: 10000  // Every 10 seconds
});
```

### 2. Production Environment

```javascript
const perfMonitor = new PerformanceMonitor({
  alertThresholds: {
    responseTime: 2000,  // More lenient for production
    memoryUsage: 0.85,
    dbQueryTime: 1000
  },
  collectInterval: 60000  // Every minute
});

// Set up alert handling
perfMonitor.on('alert', (alert) => {
  if (alert.severity === 'error') {
    notifyOncall(alert);
  }
  logToFile(alert);
});
```

### 3. Regular Performance Analysis

Set up automated performance testing:

```bash
# Add to cron job (every hour)
0 * * * * cd /path/to/ic-mesh && node scripts/performance-analysis.js --report

# Weekly detailed analysis  
0 2 * * 0 cd /path/to/ic-mesh && node scripts/performance-analysis.js --detailed
```

## Metrics Collected

### Request Metrics
- Response time (avg, min, max, p95, p99)
- Request count per endpoint
- Error rates by endpoint
- Request size tracking

### Database Metrics
- Query execution times
- Slow query detection
- Query count tracking
- Database error monitoring

### System Metrics
- Memory usage (heap, RSS, external)
- CPU usage estimation
- Uptime tracking
- Load average (on Unix systems)

### WebSocket Metrics
- Active connection count
- Message throughput
- Connection error tracking

### Job Processing Metrics
- Processing time per job
- Job queue size
- Success/failure rates
- Jobs processed per minute

## Alert Types

### Performance Alerts
- **SLOW_REQUEST**: Request exceeded response time threshold
- **SLOW_QUERY**: Database query took too long
- **HIGH_MEMORY_USAGE**: Memory usage above threshold
- **HIGH_WS_CONNECTIONS**: Too many WebSocket connections
- **HIGH_ERROR_RATE**: Error rate above acceptable level

### System Alerts
- **UNCAUGHT_EXCEPTION**: Unhandled exceptions
- **UNHANDLED_REJECTION**: Unhandled promise rejections

## Health Score Calculation

The system calculates an overall health score (0-100) based on:

- **Response Time (30%)**: Penalty for slow requests
- **Memory Usage (25%)**: Penalty for high memory consumption  
- **Error Rate (25%)**: Penalty for high error rates
- **Database Performance (20%)**: Penalty for slow queries

## Best Practices

1. **Gradual Integration**: Start with basic request monitoring, then add database and WebSocket monitoring
2. **Threshold Tuning**: Adjust alert thresholds based on your performance requirements
3. **Regular Analysis**: Run performance analysis weekly to identify trends
4. **Alert Management**: Set up proper alert routing to avoid alert fatigue
5. **Metric Storage**: Consider storing metrics in a time-series database for historical analysis

## Troubleshooting

### High Memory Usage
- Check for memory leaks in request handlers
- Monitor WebSocket connection cleanup
- Review metric history retention settings

### Slow Requests
- Use database query monitoring to identify bottlenecks
- Check for inefficient loops or synchronous operations
- Consider adding caching for frequently requested data

### High Error Rates
- Review error logs for patterns
- Monitor specific endpoints with high failure rates
- Check for timeout issues or resource constraints

## Example Implementation

See `test/performance-monitoring-integration-test.js` for a complete example of integrating performance monitoring into an existing server.

## Monitoring Dashboard

The performance monitoring system includes built-in reporting. For advanced dashboards, consider integrating with:

- **Grafana**: Use the export metrics function to feed data
- **Prometheus**: Expose metrics in Prometheus format
- **Custom Dashboard**: Build using the comprehensive performance report

## Next Steps

1. Integrate basic request monitoring into server.js
2. Add database query monitoring to key operations
3. Set up automated performance analysis
4. Configure alerting for your team's communication channels
5. Create custom dashboards for your specific metrics needs

This monitoring system provides comprehensive insights into IC Mesh performance while being lightweight and easy to integrate.