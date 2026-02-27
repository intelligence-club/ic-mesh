# Rate Limiting Management Guide

Complete guide to managing, monitoring, and optimizing rate limiting in IC Mesh.

## Overview

IC Mesh includes a comprehensive rate limiting system designed to protect against abuse while allowing legitimate traffic. This guide covers all the tools and best practices for managing rate limits effectively.

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Rate Limiter  │───▶│  Monitor Tools  │───▶│  Dashboard      │
│   (Core Engine) │    │                 │    │  (Analysis)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Whitelist     │    │   Logging       │    │  Optimizer      │
│   Management    │    │   System        │    │  (Auto-tune)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Quick Start

### 1. Check Current Status
```bash
# Basic status check
node scripts/rate-limit-monitor.js

# Detailed dashboard
node scripts/rate-limit-dashboard.js

# Health check
node scripts/rate-limit-dashboard.js --health
```

### 2. Monitor in Real-time
```bash
# Watch rate limiting activity
node scripts/rate-limit-monitor.js --watch

# View recent patterns
node scripts/rate-limit-monitor.js --history
```

### 3. Optimize Configuration
```bash
# Analyze and suggest optimizations
node scripts/rate-limit-optimizer.js

# Apply safe optimizations
node scripts/rate-limit-optimizer.js --safe

# Aggressive optimization (advanced users)
node scripts/rate-limit-optimizer.js --aggressive
```

## Core Components

### 1. Enhanced Rate Limiter (`lib/enhanced-rate-limit.js`)

The enhanced rate limiter extends the basic rate limiting with advanced features:

#### Features
- **IP Whitelist:** Bypass rate limiting for trusted IPs
- **Detailed Metrics:** Comprehensive statistics and analytics
- **Dynamic Limits:** Adjust limits without restarting
- **Rate Limit Headers:** Proper HTTP headers for client guidance
- **Logging:** Detailed event logging for analysis

#### Usage
```javascript
const EnhancedRateLimiter = require('./lib/enhanced-rate-limit');

const limiter = new EnhancedRateLimiter({
  limits: {
    upload: 10,
    'jobs-post': 30,
    health: 120,
    default: 60
  },
  whitelistFile: './config/rate-limit-whitelist.json',
  logFile: './logs/rate-limits.log'
});

// Check rate limit
const result = limiter.check(clientIp, 'upload');
if (!result.allowed) {
  // Return 429 with result.headers
  res.status(429).set(result.headers).json({
    error: 'Rate limit exceeded',
    retryAfter: result.retryAfter
  });
}
```

#### Migration from Basic Rate Limiter
The enhanced rate limiter is backward compatible:

```javascript
// Before
const result = rateLimiter.check(ip, group, limit);
if (!result.allowed) { /* handle rate limit */ }

// After - same interface, enhanced features
const result = enhancedLimiter.check(ip, group, limit);
if (!result.allowed) { 
  // Now includes headers and better metadata
  res.set(result.headers);
  /* handle rate limit */ 
}
```

### 2. Rate Limit Monitor (`scripts/rate-limit-monitor.js`)

Real-time monitoring and basic management tool.

#### Commands
```bash
# Current status
node scripts/rate-limit-monitor.js

# Continuous monitoring
node scripts/rate-limit-monitor.js --watch

# View history
node scripts/rate-limit-monitor.js --history

# Manage whitelist
node scripts/rate-limit-monitor.js --whitelist
node scripts/rate-limit-monitor.js --whitelist add 192.168.1.100
node scripts/rate-limit-monitor.js --whitelist remove 192.168.1.100

# Optimization suggestions
node scripts/rate-limit-monitor.js --optimize
```

#### Output Example
```
🔍 Rate Limit Monitor - Current Status

📊 Status: 200
✅ Not rate limited
📈 Remaining requests: 45/60
🔄 Reset time: 2026-02-25 10:45:30

🛡️  Whitelisted IPs: 3
    127.0.0.1, ::1, 192.168.1.100
```

### 3. Rate Limiting Dashboard (`scripts/rate-limit-dashboard.js`)

Comprehensive analysis and management interface.

#### Features
- **Real-time Statistics:** Live system metrics
- **Pattern Analysis:** Detailed traffic pattern analysis  
- **Health Monitoring:** System health scoring
- **Visual Interface:** Color-coded, easy-to-read output

#### Commands
```bash
# Interactive dashboard
node scripts/rate-limit-dashboard.js

# Detailed statistics
node scripts/rate-limit-dashboard.js --stats

# Pattern analysis
node scripts/rate-limit-dashboard.js --patterns

# Health check
node scripts/rate-limit-dashboard.js --health
```

#### Dashboard Output
```
📊 RATE LIMIT DASHBOARD
═══════════════════════

📈 SYSTEM STATISTICS
─────────────────────
⏱️  Uptime: 12.5 hours
📊 Total Requests: 15,432
🚫 Rate Limited: 23 (0.15%)
🛡️  Whitelisted: 1,245
⚡ Rate: 20.5 req/min
🔗 Active Connections: 12
🏥 Health: HEALTHY

📋 RECENT ACTIVITY
────────────────────
🔥 Top Rate Limited IPs:
   1. 203.0.113.1 (12 events)
   2. 198.51.100.5 (8 events)

📂 Top Rate Limited Endpoints:
   1. upload (15 events)  
   2. jobs-post (8 events)
```

### 4. Rate Limit Optimizer (`scripts/rate-limit-optimizer.js`)

Intelligent optimization engine that analyzes traffic patterns and suggests improvements.

#### Features
- **Pattern Analysis:** Machine learning-like traffic analysis
- **Smart Recommendations:** Data-driven limit suggestions
- **Multiple Modes:** Safe, aggressive, or suggest-only optimization
- **Configuration Management:** Automatic backup and restore

#### Usage Modes

**Suggest Mode (Default):**
```bash
node scripts/rate-limit-optimizer.js
```
Analyzes patterns and suggests optimizations without making changes.

**Safe Mode:**
```bash
node scripts/rate-limit-optimizer.js --safe
```
Applies only high-confidence optimizations that increase limits.

**Aggressive Mode:**
```bash
node scripts/rate-limit-optimizer.js --aggressive
```
Applies all recommendations including decreases for better security.

#### Example Output
```
💡 OPTIMIZATION RECOMMENDATIONS
================================

📈 UPLOAD
   Current: 10/min
   Recommended: 20/min
   Confidence: 🟢 high
   Reason: High violation rate (25.3%) - increase limit

📉 DEFAULT
   Current: 60/min
   Recommended: 45/min  
   Confidence: 🔴 low
   Reason: No violations detected - can decrease for better security
```

## Configuration

### Whitelist Management

The whitelist allows certain IPs to bypass rate limiting entirely.

#### File Location
```
config/rate-limit-whitelist.json
```

#### Format
```json
{
  "ips": ["127.0.0.1", "::1", "192.168.1.100"],
  "lastUpdated": "2026-02-25T10:30:00.000Z",
  "description": "Rate limit whitelist - IPs that bypass rate limiting"
}
```

#### Management Commands
```bash
# Add IP to whitelist
node scripts/rate-limit-monitor.js --whitelist add 203.0.113.1

# Remove IP from whitelist  
node scripts/rate-limit-monitor.js --whitelist remove 203.0.113.1

# View current whitelist
node scripts/rate-limit-monitor.js --whitelist
```

### Rate Limit Configuration

#### Default Limits
```javascript
{
  upload: 10,        // File uploads per minute
  'jobs-post': 30,   // Job submissions per minute  
  'nodes-register': 20, // Node registrations per minute
  health: 120,       // Health checks per minute
  status: 60,        // Status requests per minute
  default: 60        // All other endpoints per minute
}
```

#### Customizing Limits
```javascript
const limiter = new EnhancedRateLimiter({
  limits: {
    upload: 20,           // Increase upload limit
    'custom-endpoint': 50, // Add custom endpoint
    default: 100          // Increase default limit
  }
});
```

### Logging Configuration

#### Log Location
```
logs/rate-limits.log
```

#### Log Format
```json
{
  "timestamp": "2026-02-25T10:30:15.123Z",
  "event": "rate_limited",
  "ip": "203.0.113.1", 
  "group": "upload",
  "count": 11,
  "limit": 10,
  "retryAfter": 45
}
```

#### Event Types
- `rate_limited`: IP hit rate limit
- `whitelist_bypass`: Whitelisted IP bypassed rate limit
- `limits_updated`: Rate limits changed
- `cleanup`: Old entries cleaned up
- `shutdown`: Rate limiter stopped

## Best Practices

### 1. Monitoring
- **Regular Health Checks:** Run health checks daily
- **Pattern Analysis:** Analyze patterns weekly
- **Real-time Monitoring:** Use watch mode during high traffic

### 2. Whitelist Management
- **Conservative Approach:** Only whitelist known-good IPs
- **Regular Review:** Review whitelist monthly
- **Documentation:** Document why each IP is whitelisted

### 3. Optimization
- **Start Conservative:** Begin with suggest-only mode
- **Gradual Changes:** Apply optimizations incrementally
- **Monitor Results:** Check impact after each change

### 4. Security
- **Monitor Abuse:** Watch for distributed attacks
- **Block Persistent Offenders:** Consider IP blocking for severe abuse
- **Alert on Anomalies:** Set up alerts for unusual patterns

## Troubleshooting

### High Rate Limiting
**Symptom:** Many legitimate requests being rate limited

**Solutions:**
1. Check if rate limits are too restrictive:
   ```bash
   node scripts/rate-limit-optimizer.js
   ```

2. Add legitimate services to whitelist:
   ```bash
   node scripts/rate-limit-monitor.js --whitelist add <ip>
   ```

3. Increase limits for specific endpoints:
   ```javascript
   limiter.updateLimits({ 'problematic-endpoint': 100 });
   ```

### No Rate Limiting Data
**Symptom:** Monitor shows no data or errors

**Solutions:**
1. Verify server is running:
   ```bash
   curl http://localhost:8333/health
   ```

2. Check log file permissions:
   ```bash
   ls -la logs/rate-limits.log
   ```

3. Ensure logging is enabled in rate limiter configuration

### Rate Limit Not Working
**Symptom:** Abusive traffic not being limited

**Solutions:**
1. Verify rate limiter is configured in server
2. Check if problematic IPs are whitelisted
3. Review rate limit thresholds

## API Integration

### Express.js Middleware
```javascript
const EnhancedRateLimiter = require('./lib/enhanced-rate-limit');
const limiter = new EnhancedRateLimiter();

function rateLimitMiddleware(group) {
  return (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    const result = limiter.check(clientIp, group);
    
    // Add rate limit headers
    res.set(result.headers);
    
    if (!result.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        detail: `Too many requests from ${clientIp}`,
        retry_after: result.retryAfter,
        suggestion: `Wait ${result.retryAfter} seconds before retrying`
      });
    }
    
    next();
  };
}

// Usage
app.post('/upload', rateLimitMiddleware('upload'), uploadHandler);
app.post('/jobs', rateLimitMiddleware('jobs-post'), jobHandler);
```

### Rate Limit Headers

The enhanced rate limiter automatically adds standard rate limit headers:

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45  
X-RateLimit-Reset: 1708876800
X-RateLimit-Group: upload
X-RateLimit-Whitelisted: true
Retry-After: 30
```

## Monitoring and Alerts

### Setting Up Alerts
```bash
# Create monitoring script
cat > scripts/rate-limit-alert.sh << 'EOF'
#!/bin/bash
# Check if rate limiting is too high
HEALTH=$(node scripts/rate-limit-dashboard.js --health | grep "Health Score")
SCORE=$(echo $HEALTH | grep -oE '[0-9]+')

if [ $SCORE -lt 70 ]; then
  echo "ALERT: Rate limiting health score low: $SCORE/100"
  # Send alert (email, webhook, etc.)
fi
EOF

chmod +x scripts/rate-limit-alert.sh

# Add to crontab for regular checks
echo "*/15 * * * * /path/to/scripts/rate-limit-alert.sh" | crontab -
```

### Metrics Collection
```javascript
// Collect metrics for external monitoring
const stats = limiter.getStats();
console.log(JSON.stringify({
  timestamp: Date.now(),
  rate_limit_frequency: stats.rateLimitRate,
  requests_per_minute: stats.requestsPerMinute,
  whitelist_size: stats.whitelistSize,
  health_score: calculateHealthScore(stats)
}));
```

## Advanced Features

### Custom Rate Limit Logic
```javascript
class CustomRateLimiter extends EnhancedRateLimiter {
  check(ip, group, customLimit) {
    // Add custom logic before rate limiting
    if (this.isVipUser(ip)) {
      return { allowed: true, whitelisted: true };
    }
    
    // Apply time-based rate limiting
    if (this.isBusinessHours()) {
      customLimit = customLimit * 2; // Double limit during business hours
    }
    
    return super.check(ip, group, customLimit);
  }
  
  isVipUser(ip) {
    // Custom VIP user detection logic
    return this.vipList.includes(ip);
  }
  
  isBusinessHours() {
    const hour = new Date().getHours();
    return hour >= 9 && hour <= 17;
  }
}
```

### Integration with External Systems
```javascript
// Send rate limit events to external monitoring
limiter.on('rateLimited', (event) => {
  // Send to analytics service
  analytics.track('rate_limit_hit', {
    ip: event.ip,
    endpoint: event.group,
    count: event.count
  });
  
  // Alert on high-frequency violations
  if (event.count > event.limit * 2) {
    alerts.send(`Severe rate limit violation from ${event.ip}`);
  }
});
```

## Performance Considerations

### Memory Usage
- Rate limiter stores ~1KB per unique IP/endpoint combination
- Automatic cleanup removes expired entries every 60 seconds
- Whitelist size has minimal impact on performance

### CPU Usage
- Rate limit checks are O(1) operations
- Logging is asynchronous and non-blocking
- Pattern analysis runs separately from request handling

### Storage
- Log files rotate automatically (implement log rotation)
- Compressed logs for long-term storage
- Consider external log aggregation for high-traffic systems

## Security Notes

### Rate Limiting Bypass Protection
- Whitelist IPs are validated and sanitized
- Configuration files have restricted permissions
- Log files contain no sensitive information

### Attack Mitigation
- Distributed rate limiting for multi-server setups
- IP reputation integration possible
- Automatic temporary blocking for severe violations

---

## Support

For questions or issues with rate limiting:

1. Check logs: `tail -f logs/rate-limits.log`
2. Run health check: `node scripts/rate-limit-dashboard.js --health`
3. Analyze patterns: `node scripts/rate-limit-optimizer.js`
4. Review this documentation
5. Create support ticket with analysis results

**Remember:** Rate limiting balances security with usability. Monitor regularly and adjust based on real traffic patterns.