# IC Mesh Operational Scripts

This directory contains operational and maintenance scripts for the IC Mesh network. These tools help operators monitor, optimize, and maintain their mesh nodes and the overall network health.

## Quick Start

**Most Important Scripts:**
- `./health-check.js` — Verify your node is healthy
- `./node-diagnostics.js` — Diagnose node issues
- `./operator-setup.js` — Initial operator setup
- `./status.js` — Quick network status check

## Script Categories

### 🏥 Health & Diagnostics
| Script | Purpose | Usage |
|--------|---------|-------|
| `health-check.js` | Comprehensive health monitoring | `./health-check.js --full` |
| `node-diagnostics.js` | Diagnose specific node issues | `./node-diagnostics.js [nodeId]` |
| `regenerative-health-monitor.js` | Long-term health tracking | `./regenerative-health-monitor.js monitor` |
| `test-error-handling.js` | Test error handling robustness | `./test-error-handling.js` |
| `test-error-reporter.js` | Test error reporting systems | `./test-error-reporter.js` |

### 📊 Performance & Optimization
| Script | Purpose | Usage |
|--------|---------|-------|
| `performance-optimizer.js` | Analyze and optimize performance | `./performance-optimizer.js analyze` |
| `performance-monitor.js` | Real-time performance monitoring | `./performance-monitor.js --continuous` |
| `optimize-code.js` | Code optimization recommendations | `./optimize-code.js` |
| `database-analytics.js` | Database performance analysis | `./database-analytics.js --report` |

### 🛠️ Setup & Deployment
| Script | Purpose | Usage |
|--------|---------|-------|
| `operator-setup.js` | Setup new operators | `./operator-setup.js init` |
| `dev-setup.js` | Development environment setup | `./dev-setup.js --full` |
| `deploy.js` | Automated deployment | `./deploy.js --target production` |
| `deployment-automation.js` | Advanced deployment workflows | `./deployment-automation.js` |
| `env-check.js` | Environment validation | `./env-check.js` |

### 🔍 Analysis & Monitoring
| Script | Purpose | Usage |
|--------|---------|-------|
| `log-analyzer.js` | Analyze system logs | `./log-analyzer.js --last 24h` |
| `network-visualizer.js` | Visualize network topology | `./network-visualizer.js --output network.html` |
| `status.js` | Quick status overview | `./status.js` |

### 🧪 Testing & Quality
| Script | Purpose | Usage |
|--------|---------|-------|
| `api-testing-framework.js` | Comprehensive API testing | `./api-testing-framework.js --suite full` |
| `test-ocr-handler.js` | Test OCR functionality | `./test-ocr-handler.js` |
| `test-pdf-handler.js` | Test PDF processing | `./test-pdf-handler.js` |

### 💾 Backup & Recovery
| Script | Purpose | Usage |
|--------|---------|-------|
| `backup-system.js` | Automated backup management | `./backup-system.js --create` |

## Common Workflows

### New Operator Setup
```bash
# 1. Environment validation
./env-check.js

# 2. Operator setup
./operator-setup.js init

# 3. Health check
./health-check.js --full

# 4. Performance baseline
./performance-optimizer.js benchmark
```

### Daily Maintenance
```bash
# Morning health check
./health-check.js

# Performance monitoring (run in background)
./performance-monitor.js --continuous &

# Check logs for issues
./log-analyzer.js --last 24h --errors-only
```

### Troubleshooting Issues
```bash
# 1. Node diagnostics
./node-diagnostics.js [your-node-id]

# 2. Error analysis
./test-error-reporter.js

# 3. Performance analysis
./performance-optimizer.js analyze

# 4. Network visualization
./network-visualizer.js --output debug.html
```

### Performance Optimization
```bash
# 1. Analyze current performance
./performance-optimizer.js analyze

# 2. Apply safe optimizations
./performance-optimizer.js optimize

# 3. Database optimization
./database-analytics.js --optimize

# 4. Verify improvements
./performance-optimizer.js benchmark
```

## Environment Requirements

### Basic Requirements
- Node.js 18+ 
- SQLite3 database access
- Network connectivity to mesh

### Optional Dependencies
- `better-sqlite3` — Database operations
- `ws` — WebSocket connections  
- `axios` — HTTP requests

## Configuration

### Environment Variables
Most scripts respect these environment variables:

```bash
# Database
export DATABASE_PATH="/path/to/mesh.db"
export DATA_DIR="/path/to/data"

# Network
export MESH_URL="http://localhost:8333"
export NODE_ID="your-node-id"

# Monitoring
export LOG_LEVEL="info"  # debug, info, warn, error
export MONITORING_INTERVAL="30000"  # milliseconds
```

### Configuration Files
- `node-config.json` — Node-specific settings
- `.env` — Environment variables
- `data/performance.log` — Performance history

## Script Output Formats

### Standard Output
- ✅ Success indicators
- ❌ Error indicators  
- 🔍 Information
- ⚠️ Warnings
- 📊 Statistics

### JSON Output
Many scripts support `--json` flag for programmatic use:
```bash
./status.js --json > network-status.json
./health-check.js --json | jq '.health.overall'
```

### Logs and Reports
Scripts generate logs in `data/logs/`:
- `health-{date}.log` — Health check results
- `performance-{date}.log` — Performance metrics
- `diagnostics-{date}.log` — Diagnostic results

## Integration Examples

### Monitoring Dashboard
```bash
#!/bin/bash
# Simple monitoring dashboard
while true; do
  clear
  echo "=== IC Mesh Status ==="
  ./status.js --brief
  echo "=== Health Status ==="  
  ./health-check.js --brief
  echo "=== Performance ==="
  ./performance-monitor.js --snapshot
  sleep 30
done
```

### Automated Maintenance
```bash
#!/bin/bash
# Daily maintenance script
LOG_FILE="maintenance-$(date +%Y%m%d).log"

{
  echo "=== Daily Maintenance $(date) ==="
  
  # Health check
  ./health-check.js --full
  
  # Performance analysis
  ./performance-optimizer.js analyze
  
  # Log analysis  
  ./log-analyzer.js --last 24h --summary
  
  # Backup
  ./backup-system.js --create --cleanup
  
  echo "=== Maintenance Complete ==="
} | tee "$LOG_FILE"
```

### CI/CD Integration
```yaml
# Example GitHub Actions integration
- name: Network Health Check
  run: |
    cd ic-mesh/scripts
    ./health-check.js --json > health-report.json
    ./api-testing-framework.js --suite smoke

- name: Performance Regression Check
  run: |
    cd ic-mesh/scripts  
    ./performance-optimizer.js benchmark --baseline
```

## Security Considerations

### Safe Scripts (Read-only)
These scripts only read data and are safe to run anytime:
- `status.js`
- `health-check.js` 
- `node-diagnostics.js`
- `log-analyzer.js`
- `network-visualizer.js`

### Modifying Scripts (Use with caution)
These scripts can modify system state:
- `performance-optimizer.js optimize`
- `backup-system.js`
- `operator-setup.js`
- `deploy.js`

**Always review changes before applying optimizations!**

## Troubleshooting Scripts

### Common Issues

**"Database locked" errors:**
```bash
# Check for locked processes
./node-diagnostics.js --database-locks
```

**"Permission denied" errors:**
```bash
# Fix script permissions
chmod +x scripts/*.js
```

**"Module not found" errors:**
```bash
# Install dependencies
npm install
# Or check environment
./env-check.js
```

### Getting Help

**Script-specific help:**
```bash
./script-name.js --help
./script-name.js -h
```

**Verbose output:**
```bash
./script-name.js --verbose
./script-name.js --debug
```

## Best Practices

### Regular Maintenance Schedule
- **Daily:** `health-check.js`, `log-analyzer.js`
- **Weekly:** `performance-optimizer.js analyze`, `backup-system.js`
- **Monthly:** `database-analytics.js --cleanup`, full performance audit

### Resource Management
- Run intensive scripts during low-traffic periods
- Monitor script resource usage with `performance-monitor.js`
- Use `--brief` flags for frequent automated checks

### Data Retention
- Performance logs: 30 days (configurable)
- Health check logs: 90 days
- Backup retention: per backup policy
- Use `log-analyzer.js --cleanup` to manage disk space

## Contributing

### Adding New Scripts
1. Follow the naming convention: `category-purpose.js`
2. Include usage help with `--help` flag
3. Add JSON output option with `--json` flag
4. Include error handling and logging
5. Update this README with the new script

### Script Template
```javascript
#!/usr/bin/env node
/**
 * Script Title
 * 
 * Description of what this script does.
 * 
 * Usage:
 *   node script-name.js [options]
 */

// Standard requires
const fs = require('fs');
const path = require('path');

// Script logic here...

// Export for testing
if (require.main === module) {
  // CLI execution
} else {
  // Module export
  module.exports = { /* exports */ };
}
```

---

**Need help?** Check the main [IC Mesh documentation](../README.md) or run any script with `--help`.

**Found a bug?** Report it in the IC Mesh repository issues.

**Want to contribute?** See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.