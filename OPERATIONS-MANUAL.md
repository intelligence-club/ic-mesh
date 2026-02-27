# IC Mesh Operations Manual

**Complete guide for IC Mesh operators, administrators, and developers**

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Control Center](#control-center)
3. [Monitoring & Health](#monitoring--health)
4. [Job Management](#job-management)
5. [Node Management](#node-management)
6. [Performance & Optimization](#performance--optimization)
7. [Security & Rate Limiting](#security--rate-limiting)
8. [Troubleshooting](#troubleshooting)
9. [Development Tools](#development-tools)
10. [Emergency Procedures](#emergency-procedures)
11. [Tool Reference](#tool-reference)

---

## Quick Start

### Essential Commands
```bash
# Check system status (fastest overview)
node scripts/ic-mesh-control-center.js --status

# Full operational dashboard
node scripts/ic-mesh-control-center.js

# Live monitoring
node scripts/ic-mesh-control-center.js --watch
```

### First-Time Setup Checklist
1. ✅ Verify server is running: `curl localhost:8333/status`
2. ✅ Check database health: `node scripts/health-check.js`
3. ✅ Configure rate limiting: `node scripts/integrate-enhanced-rate-limiting.js --setup`
4. ✅ Review security settings: `cat config/rate-limit-whitelist.json`

---

## Control Center

**Your primary operational interface**

The IC Mesh Control Center provides a unified view of your entire deployment.

### Basic Usage
```bash
# Quick status check (recommended for regular monitoring)
node scripts/ic-mesh-control-center.js --status

# Full dashboard with detailed metrics
node scripts/ic-mesh-control-center.js

# Live monitoring (updates every 10 seconds)
node scripts/ic-mesh-control-center.js --watch

# Disable colors for scripting
node scripts/ic-mesh-control-center.js --no-color
```

### Dashboard Sections
- **🏥 System Health**: CPU, memory, uptime, platform info
- **🌐 IC Mesh Status**: Server status, database health, version
- **🔗 Network Status**: Node counts, health percentage
- **📋 Job Queue**: Pending, processing, completed, success rates
- **🛡️ Rate Limiting**: Configuration, whitelist, recent blocks
- **⚡ Performance**: Response times, resource usage
- **🤖 Active Nodes**: Live node status and capabilities

### Integration Examples
```bash
# Check if system is healthy (for scripts)
if node scripts/ic-mesh-control-center.js --status | grep -q "OPERATIONAL"; then
    echo "System is healthy"
else
    echo "System needs attention"
fi

# Get just the node count
node scripts/ic-mesh-control-center.js --status | grep "nodes online" | awk '{print $1}'
```

---

## Monitoring & Health

### Health Monitoring Stack

#### Real-Time Health Monitor
```bash
# Continuous health monitoring with intelligent alerting
node scripts/real-time-health-monitor.js

# One-time health check
node scripts/real-time-health-monitor.js --once

# Quiet mode (minimal output)
node scripts/real-time-health-monitor.js --quiet
```

Features:
- 🟢🟡🔴 Color-coded health indicators
- 📈📉 Trend analysis with visual indicators
- 🔔 Automated issue detection and suggestions
- 📊 Performance metrics tracking

#### Health Check Scripts
```bash
# Basic health verification
node scripts/health-check.js

# Comprehensive system health report
node scripts/health-monitor.js

# System dashboard view
node scripts/system-dashboard.js

# Daily status summary
bash scripts/daily-status.sh
```

#### Monitoring Best Practices
1. **Regular Checks**: Use control center `--status` every few hours
2. **Continuous Monitoring**: Deploy real-time monitor for production
3. **Trend Analysis**: Review performance metrics weekly
4. **Alert Setup**: Configure monitoring alerts for critical thresholds

### Health Indicators

| Indicator | Meaning | Action Required |
|-----------|---------|----------------|
| 🟢 Green | Optimal performance | None |
| 🟡 Yellow | Minor issues | Monitor closely |
| 🔴 Red | Critical issues | Immediate attention |
| 📈 Rising | Improving trend | Good |
| 📉 Declining | Degrading trend | Investigate |
| ➡️ Stable | No change | Continue monitoring |

---

## Job Management

### Job Queue Operations

#### Job Analysis
```bash
# Job queue status and analytics
node scripts/analyze-jobs.js

# Enhanced job analytics
node scripts/job-queue-analyzer.js

# Job performance metrics
node scripts/job-performance-tracker.js
```

#### Job Cleanup & Management
```bash
# Clean failed jobs
node scripts/cleanup-failed-jobs.js

# Reset stuck jobs
node scripts/reset-stuck-jobs.js

# Job history analysis
node scripts/job-history-analyzer.js

# Clear test job pollution
node scripts/test-cleanup.js
```

#### Job Troubleshooting
```bash
# Debug job issues
node scripts/debug-jobs.js

# Test job workflows
node scripts/test-enhanced.js

# Job error analysis
node scripts/test-error-handling.js
```

### Job Lifecycle Management

1. **Monitoring**: Use control center to track job queues
2. **Analysis**: Regular job analytics to identify patterns
3. **Cleanup**: Periodic cleanup of failed/stuck jobs
4. **Optimization**: Performance tuning based on job metrics

---

## Node Management

### Node Operations

#### Node Health & Monitoring
```bash
# Node health analysis with failure pattern detection
node scripts/node-health-analyzer.js

# Node retention monitoring and analytics
node scripts/node-retention-monitor.js

# Node capacity management
node scripts/capacity-quarantine.js
```

#### Node Troubleshooting
```bash
# Diagnose transcribe handler issues
bash scripts/diagnose-transcribe-handler.sh

# Auto-recovery for unhealthy nodes
node scripts/node-health-auto-recovery.js

# Node performance optimization
node scripts/node-performance-optimizer.js
```

#### Node Management Tasks
```bash
# Flag/quarantine problematic nodes
node scripts/manage-problematic-nodes.js

# Cleanup jobs from disconnected nodes
node scripts/cleanup-abandoned-jobs.js

# Node status and capabilities
node scripts/node-status-tracker.js
```

### Node Health Matrix

| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| Success Rate | >95% | 80-95% | <80% |
| Response Time | <5s | 5-15s | >15s |
| Uptime | >95% | 80-95% | <80% |
| Connection | Active | Intermittent | Offline |

### Node Lifecycle
1. **Registration**: Nodes self-register with capabilities
2. **Health Monitoring**: Continuous performance tracking
3. **Quarantine**: Automatic isolation of problematic nodes
4. **Recovery**: Diagnostic tools and auto-recovery
5. **Removal**: Cleanup of persistently failing nodes

---

## Performance & Optimization

### Performance Analysis

#### Performance Optimizer
```bash
# Analyze current performance
node scripts/performance-optimizer.js analyze

# Apply safe optimizations
node scripts/performance-optimizer.js optimize

# Run performance benchmarks
node scripts/performance-optimizer.js benchmark

# Generate performance report
node scripts/performance-optimizer.js report
```

#### Monitoring Tools
```bash
# Performance monitoring dashboard
node scripts/performance-monitor.js

# Database performance analysis
node scripts/database-analytics.js

# System resource monitoring
node scripts/monitoring-dashboard.js
```

#### Load Testing
```bash
# Load testing framework
node scripts/load-testing.js

# API load testing
node scripts/load-test.js

# Performance stress testing
node scripts/api-testing-framework.js
```

### Optimization Checklist

#### Database Optimization
- [ ] Run `VACUUM` if fragmentation >25%
- [ ] Update performance settings (WAL mode)
- [ ] Monitor query response times
- [ ] Implement data retention policies

#### Memory Optimization
- [ ] Monitor heap usage trends
- [ ] Restart server periodically to clear leaks
- [ ] Optimize data structures
- [ ] Configure appropriate memory limits

#### Network Optimization
- [ ] Monitor node retention rates
- [ ] Optimize job distribution
- [ ] Review network connectivity
- [ ] Balance load across healthy nodes

---

## Security & Rate Limiting

### Enhanced Rate Limiting

#### Setup & Configuration
```bash
# Check current rate limiting setup
node scripts/integrate-enhanced-rate-limiting.js --check

# Complete enhanced rate limiting setup
node scripts/integrate-enhanced-rate-limiting.js --setup

# Apply migration from basic to enhanced
node scripts/integrate-enhanced-rate-limiting.js --migrate

# Validate integration
node scripts/integrate-enhanced-rate-limiting.js --validate
```

#### Rate Limit Monitoring
```bash
# Current rate limiting status
node scripts/rate-limit-monitor.js

# Rate limiting dashboard
node scripts/rate-limit-dashboard.js

# Rate limiting analytics
node scripts/rate-limit-optimizer.js

# Live rate limit monitoring
node scripts/rate-limit-monitor.js --watch
```

#### Whitelist Management
```bash
# Add IP to whitelist
node scripts/rate-limit-monitor.js --whitelist add 192.168.1.100

# Remove IP from whitelist
node scripts/rate-limit-monitor.js --whitelist remove 192.168.1.100

# View current whitelist
cat config/rate-limit-whitelist.json
```

### Security Configuration

#### Default Rate Limits
```json
{
  "upload": "10/min",
  "jobs-post": "30/min", 
  "nodes-register": "20/min",
  "health": "120/min",
  "status": "60/min",
  "default": "60/min"
}
```

#### Security Best Practices
1. **Rate Limiting**: Enhanced rate limiting enabled with monitoring
2. **IP Whitelisting**: Configure known monitoring/admin IPs
3. **Access Control**: Restrict administrative endpoints
4. **Logging**: Enable comprehensive rate limit logging
5. **Monitoring**: Regular security audits and monitoring

---

## Troubleshooting

### Common Issues & Solutions

#### Server Issues
**Problem**: Server not responding
```bash
# Diagnosis
curl -s localhost:8333/status
netstat -tlpn | grep :8333

# Solutions
npm start                    # Start server
pm2 restart ic-mesh         # Restart with PM2
sudo systemctl restart ic-mesh  # Restart service
```

**Problem**: Database issues
```bash
# Diagnosis
node scripts/health-check.js
echo "PRAGMA integrity_check;" | sqlite3 data/mesh.db

# Solutions
node scripts/performance-optimizer.js optimize  # Fix fragmentation
cp data/mesh.db data/mesh.db.backup            # Backup before fixes
```

#### Network Issues
**Problem**: No active nodes
```bash
# Diagnosis
node scripts/ic-mesh-control-center.js --status
node scripts/node-health-analyzer.js

# Solutions
node scripts/manage-problematic-nodes.js       # Check quarantined nodes
node scripts/node-health-auto-recovery.js     # Attempt auto-recovery
```

**Problem**: High job failure rate
```bash
# Diagnosis
node scripts/analyze-jobs.js
node scripts/debug-jobs.js

# Solutions
node scripts/cleanup-failed-jobs.js           # Clean failed jobs
node scripts/reset-stuck-jobs.js             # Reset stuck jobs
```

#### Performance Issues
**Problem**: Slow response times
```bash
# Diagnosis
node scripts/performance-optimizer.js analyze
node scripts/database-analytics.js

# Solutions
node scripts/performance-optimizer.js optimize
# Restart server to apply optimizations
```

### Emergency Procedures

#### System Recovery
1. **Assess**: Use control center for rapid assessment
2. **Isolate**: Quarantine problematic components
3. **Restore**: Apply targeted fixes
4. **Monitor**: Verify recovery with continuous monitoring

#### Critical Issue Response
1. **Immediate**: Use control center `--status` for quick assessment
2. **Investigate**: Deploy appropriate diagnostic tools
3. **Fix**: Apply targeted solutions from troubleshooting guide
4. **Verify**: Confirm resolution with monitoring tools

---

## Development Tools

### Development Environment

#### Setup & Configuration
```bash
# Development environment setup
node scripts/dev-setup.js

# Development workflow tools
node scripts/dev-workflow.js

# Code optimization tools
node scripts/optimize-code.js
```

#### Testing Framework
```bash
# Enhanced testing suite
node scripts/test-enhanced.js

# Integration testing
node scripts/integration-test-suite.js

# Error handling tests
node scripts/test-error-handling.js

# API testing framework
node scripts/api-testing-framework.js
```

#### Development Utilities
```bash
# Debug toolkit
node scripts/debug-toolkit.js

# Test error reporting
node scripts/test-error-reporter.js

# PDF handler testing
node scripts/test-pdf-handler.js

# OCR handler testing
node scripts/test-ocr-handler.js
```

### Development Best Practices

1. **Testing**: Comprehensive test coverage for all components
2. **Monitoring**: Integrated monitoring in development
3. **Documentation**: Keep documentation updated with changes
4. **Performance**: Regular performance testing and optimization
5. **Security**: Security considerations in all development

---

## Emergency Procedures

### Crisis Response Playbook

#### Immediate Response (0-5 minutes)
1. **Assess Situation**
   ```bash
   node scripts/ic-mesh-control-center.js --status
   ```

2. **Check Critical Services**
   ```bash
   curl -s localhost:8333/status  # Server health
   node scripts/health-check.js  # System health
   ```

3. **Identify Scope**
   - Single node issue? → Node troubleshooting
   - Database issue? → Database recovery
   - Network-wide? → System-wide recovery

#### Short-term Stabilization (5-30 minutes)
1. **Isolate Problems**
   ```bash
   node scripts/manage-problematic-nodes.js  # Quarantine bad nodes
   node scripts/cleanup-failed-jobs.js       # Clear job queue
   ```

2. **Apply Quick Fixes**
   ```bash
   node scripts/performance-optimizer.js optimize  # Database optimization
   # Restart server if needed
   ```

3. **Monitor Recovery**
   ```bash
   node scripts/ic-mesh-control-center.js --watch  # Live monitoring
   ```

#### Long-term Recovery (30+ minutes)
1. **Root Cause Analysis**
   - Use diagnostic tools to identify underlying causes
   - Review logs and performance metrics
   - Document findings

2. **Implement Preventive Measures**
   - Update monitoring thresholds
   - Improve alerting
   - Update procedures

3. **Validate System Health**
   - Full system testing
   - Performance verification
   - Documentation updates

### Contact Information

**Emergency Contacts**
- System Administrator: [Contact Info]
- Network Operations: [Contact Info]
- Development Team: [Contact Info]

**Escalation Procedures**
1. Level 1: Automated monitoring and self-recovery
2. Level 2: On-call operator intervention
3. Level 3: Development team engagement
4. Level 4: Full system recovery mode

---

## Tool Reference

### Complete Tool Inventory

#### Monitoring & Health (13 tools)
```bash
# Primary monitoring
scripts/ic-mesh-control-center.js           # ⭐ Main operational dashboard
scripts/real-time-health-monitor.js         # ⭐ Continuous monitoring
scripts/health-check.js                     # Basic health verification
scripts/health-monitor.js                   # Comprehensive health report
scripts/system-dashboard.js                 # System overview
scripts/daily-status.sh                     # Daily summary

# Performance monitoring
scripts/performance-monitor.js              # Performance dashboard
scripts/performance-optimizer.js            # ⭐ Performance analysis & optimization
scripts/monitoring-dashboard.js             # Resource monitoring
scripts/regenerative-health-monitor.js      # Advanced health tracking
scripts/database-analytics.js               # Database performance
scripts/status.js                          # Simple status check
scripts/launch-monitor.sh                   # Launch monitoring
```

#### Job Management (10 tools)
```bash
# Job analysis
scripts/analyze-jobs.js                     # Job queue analytics
scripts/job-queue-analyzer.js               # Enhanced job analytics
scripts/job-performance-tracker.js          # Performance metrics
scripts/job-history-analyzer.js             # Historical analysis
scripts/debug-jobs.js                       # Job debugging

# Job operations
scripts/cleanup-failed-jobs.js              # Clean failed jobs
scripts/reset-stuck-jobs.js                 # Reset stuck jobs
scripts/test-cleanup.js                     # Remove test pollution
scripts/cleanup-abandoned-jobs.js           # Cleanup from offline nodes
scripts/test-enhanced.js                    # Enhanced testing
```

#### Node Management (8 tools)
```bash
# Node health
scripts/node-health-analyzer.js             # ⭐ Node performance analysis
scripts/node-retention-monitor.js           # Retention analytics
scripts/node-health-auto-recovery.js        # Auto-recovery system
scripts/node-performance-optimizer.js       # Node optimization
scripts/node-status-tracker.js              # Status tracking

# Node operations
scripts/manage-problematic-nodes.js         # ⭐ Node quarantine management
scripts/capacity-quarantine.js              # Capacity management
scripts/diagnose-transcribe-handler.sh      # Handler diagnostics
```

#### Security & Rate Limiting (6 tools)
```bash
# Rate limiting
scripts/integrate-enhanced-rate-limiting.js # ⭐ Enhanced rate limit setup
scripts/rate-limit-monitor.js               # Rate limit monitoring
scripts/rate-limit-dashboard.js             # Rate limit dashboard
scripts/rate-limit-optimizer.js             # Optimization suggestions

# Security
scripts/security-audit.js                   # Security analysis
scripts/network-security-monitor.js         # Network security
```

#### Development & Testing (12 tools)
```bash
# Development environment
scripts/dev-setup.js                        # Dev environment setup
scripts/dev-workflow.js                     # Development workflow
scripts/debug-toolkit.js                    # Debug tools
scripts/optimize-code.js                    # Code optimization

# Testing framework
scripts/api-testing-framework.js            # API testing
scripts/integration-test-suite.js           # Integration tests
scripts/test-error-handling.js              # Error handling tests
scripts/test-error-reporter.js              # Error reporting
scripts/load-testing.js                     # Load testing
scripts/load-test.js                        # Performance testing
scripts/test-pdf-handler.js                 # PDF handler testing
scripts/test-ocr-handler.js                 # OCR handler testing
```

### Tool Categories by Use Case

#### Daily Operations
- `scripts/ic-mesh-control-center.js --status` (Primary check)
- `scripts/real-time-health-monitor.js --once` (Health verification)
- `scripts/daily-status.sh` (Summary report)

#### Issue Investigation
- `scripts/ic-mesh-control-center.js` (Full dashboard)
- `scripts/debug-jobs.js` (Job issues)
- `scripts/node-health-analyzer.js` (Node problems)
- `scripts/performance-optimizer.js analyze` (Performance issues)

#### Maintenance Tasks
- `scripts/cleanup-failed-jobs.js` (Weekly cleanup)
- `scripts/performance-optimizer.js optimize` (Monthly optimization)
- `scripts/node-retention-monitor.js` (Node retention review)

#### Emergency Response
- `scripts/ic-mesh-control-center.js --status` (Rapid assessment)
- `scripts/manage-problematic-nodes.js` (Quarantine bad actors)
- `scripts/reset-stuck-jobs.js` (Clear stuck jobs)
- `scripts/ic-mesh-control-center.js --watch` (Live monitoring)

---

**Last Updated**: 2026-02-25  
**Version**: 1.0  
**Maintained By**: Wingman (Autonomous Agent)

For the most current tool documentation, see individual script help:
```bash
node scripts/[tool-name].js --help
```

---

*This manual is a living document. Update it as tools and procedures evolve.*