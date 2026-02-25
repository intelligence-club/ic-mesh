# Utility Scripts Reference

**Comprehensive reference for IC Mesh maintenance and analysis tools.**

This document catalogues all utility scripts available in the IC Mesh project, organized by purpose. These tools are built for system administrators, operators, and developers to maintain, monitor, and troubleshoot the network.

---

## 🔍 Analysis & Monitoring

### `node-retention-toolkit.js` ⭐ **NEW**
**Purpose:** Comprehensive node retention analysis and intervention system  
**Usage:** 
- `./node-retention-toolkit.js analyze` - Analyze retention patterns and churn reasons
- `./node-retention-toolkit.js onboard` - Enhanced onboarding wizard
- `./node-retention-toolkit.js intervene` - Identify and help at-risk nodes
- `./node-retention-toolkit.js dashboard` - Real-time retention dashboard

**Key Features:**
- Identifies churn patterns and success factors
- Proactive intervention for at-risk nodes
- Real-time retention metrics and monitoring
- Addresses the 75% node churn rate challenge

### `auto-onboard.js` ⭐ **NEW**
**Purpose:** Automated onboarding system for new node operators  
**Usage:**
- `./auto-onboard.js new` - Complete onboarding wizard
- `./auto-onboard.js validate` - Check existing setup
- `./auto-onboard.js monitor` - Performance monitoring
- `./auto-onboard.js optimize` - Configuration optimization

**Key Features:**
- Automatic system capability detection
- Optimal configuration generation
- Earnings projections and optimization tips
- Dependency installation and validation

### `retention-suite.js` ⭐ **NEW**
**Purpose:** Integrated retention workflow management  
**Usage:**
- `./retention-suite.js setup` - Complete new operator setup
- `./retention-suite.js health` - Network retention health check
- `./retention-suite.js intervention` - Automated intervention workflow
- `./retention-suite.js insights` - Generate retention insights report

**Key Features:**
- Unified interface to all retention tools
- Automated workflows for maximum node success
- Comprehensive reporting and diagnostics
- End-to-end retention solution

### `analyze-jobs.js`
**Purpose:** Job queue analysis and health monitoring  
**Usage:** `node analyze-jobs.js`

**Output:**
- Pending jobs by type (transcribe, ocr, pdf-extract)
- Job creation patterns (recent activity)
- Claimed but incomplete jobs
- Sample of recent pending jobs
- Active node count

**Use cases:**
- Daily health checks
- Capacity planning
- Queue bottleneck identification
- Job processing verification

### `analyze-nodes.js`
**Purpose:** Basic node network overview  
**Usage:** `node analyze-nodes.js`

**Output:**
- Total registered nodes
- Active vs offline nodes
- Node capabilities overview

### `analyze-retention-patterns.js`
**Purpose:** Node retention and churn analysis  
**Usage:** `./analyze-retention-patterns.js`

**Output:**
- Connection/disconnection patterns
- Retention rates by time period
- Churn analysis with recommendations
- Node lifetime statistics

**Use cases:**
- Understanding operator engagement
- Optimizing onboarding experience
- Identifying network stability patterns

### `node-health-analyzer.js`
**Purpose:** Comprehensive node performance analysis  
**Usage:** `node node-health-analyzer.js`

**Output:**
- Performance summary for each node
- Success rates and failure analysis
- Problematic node identification
- Failure pattern categorization
- Actionable recommendations

**Features:**
- Categorizes nodes as healthy, problematic, or offline
- Analyzes specific failure types (timeouts, missing handlers)
- Provides network health metrics
- Suggests remediation actions

---

## 🛠️ Node Management

### `manage-problematic-nodes.js`
**Purpose:** Node health management and quarantine system  
**Usage:** `node manage-problematic-nodes.js [action] [nodeId]`

**Actions:**
- `list` - Show all flagged nodes
- `flag [nodeId]` - Flag node as problematic
- `quarantine [nodeId]` - Quarantine node (block job claiming)
- `remove [nodeId]` - Remove node from network

**Features:**
- Automated problematic node detection
- Quarantine enforcement
- Node removal with cleanup
- Audit logging

**Use cases:**
- Response to performance degradation
- Network security (compromised nodes)
- Capacity management

### `check-schema.js`
**Purpose:** Database schema verification  
**Usage:** `./check-schema.js`

**Output:**
- Table schema validation
- Missing columns detection
- Database integrity verification

---

## 🧹 Cleanup & Maintenance

### `cleanup-jobs.js`
**Purpose:** Basic job cleanup utility  
**Usage:** `node cleanup-jobs.js`

**Function:** Removes old or invalid jobs from the database

### `cleanup-failed-jobs.js`
**Purpose:** Failed job cleanup with analysis  
**Usage:** `node cleanup-failed-jobs.js`

**Features:**
- Identifies failed job patterns
- Safe deletion of failed jobs
- Preserves recent failures for analysis

### `cleanup-bulk-jobs.js`
**Purpose:** Bulk job removal by criteria  
**Usage:** `node cleanup-bulk-jobs.js`

**Use cases:**
- Remove test jobs after development
- Clean up spam or bulk uploads
- Database maintenance

### `cleanup-direct.js`
**Purpose:** Direct database cleanup operations  
**Usage:** `node cleanup-direct.js`

**Function:** Low-level cleanup operations for database maintenance

### `cleanup-abandoned-jobs.js`
**Purpose:** Cleanup jobs from disconnected nodes  
**Usage:** `node cleanup-abandoned-jobs.js`

**Function:**
- Identifies jobs claimed by offline nodes
- Releases abandoned jobs back to queue
- Prevents job starvation

---

## 🎯 Specialized Tools

### `fix-node-timestamps.js`
**Purpose:** Database timestamp repair utility  
**Usage:** `node fix-node-timestamps.js`

**Function:**
- Fixes corrupted timestamp data
- Handles year overflow issues
- Maintains data integrity during timestamp repairs

**Background:** Created to address timestamp corruption issues where node timestamps showed impossible dates (year 58123+)

### `automated-support-triage.js`
**Purpose:** Advanced support ticket analysis and automation  
**Usage:** `node automated-support-triage.js`

**Features:**
- Intelligent ticket categorization
- Automated response generation
- Priority scoring based on content analysis
- Sentiment analysis
- Technical issue detection

**Use cases:**
- Support queue management
- First-line response automation
- Issue trend analysis

### `daily-status.sh`
**Purpose:** Quick operational health overview  
**Usage:** `./daily-status.sh`

**Output:**
- Server uptime and PID
- Test suite status
- Network health summary
- Job statistics
- Git repository status

**Use cases:**
- Daily operational checks
- Health monitoring automation
- Quick system status verification

---

## 📊 Performance & Metrics

### `node-retention-monitor.js`
**Purpose:** Comprehensive node retention analytics  
**Usage:** `node node-retention-monitor.js`

**Output:**
- Detailed retention patterns
- Connection duration analysis
- Churn rate calculations
- Performance impact of retention

**Features:**
- Historical retention trends
- Operator engagement metrics
- Network stability indicators

---

## 🔧 Development & Testing

### `test-enhanced.js`
**Purpose:** Enhanced test isolation system  
**Usage:** `node test-enhanced.js`

**Features:**
- TEST_MODE capability isolation
- Live system protection during tests
- Enhanced test coverage
- Job claiming workflow validation

### `debug-jobs.js`
**Purpose:** Job system debugging utility  
**Usage:** `node debug-jobs.js`

**Function:**
- Deep dive job analysis
- State validation
- Workflow debugging

### `test-cleanup.js`
**Purpose:** Test environment cleanup  
**Usage:** `node test-cleanup.js`

**Function:**
- Removes test job pollution
- Cleans test data from production database
- Maintains test isolation

---

## 🚀 Usage Patterns

### Daily Operations
```bash
# Morning health check
node analyze-jobs.js && node node-health-analyzer.js

# Cleanup maintenance
node cleanup-abandoned-jobs.js
node cleanup-failed-jobs.js

# Performance monitoring
./daily-status.sh
```

### Weekly Maintenance
```bash
# Retention analysis
node analyze-retention-patterns.js

# Database cleanup
node cleanup-bulk-jobs.js

# Schema verification
./check-schema.js
```

### Incident Response
```bash
# Investigate job failures
node analyze-jobs.js
node node-health-analyzer.js

# Quarantine problematic nodes
node manage-problematic-nodes.js quarantine [nodeId]

# Clean up aftermath
node cleanup-failed-jobs.js
```

### Performance Optimization
```bash
# Identify bottlenecks
node analyze-jobs.js
node node-health-analyzer.js

# Clean up obstacles
node cleanup-abandoned-jobs.js

# Monitor improvements
./daily-status.sh
```

---

## 🏗️ Script Development Guidelines

### Naming Convention
- **Purpose-action.js** (e.g., `analyze-jobs.js`, `cleanup-failed-jobs.js`)
- **Action-target.js** (e.g., `manage-problematic-nodes.js`, `fix-node-timestamps.js`)

### Standard Features
- Clear output formatting with emoji indicators
- Error handling with graceful degradation
- Database connection management
- Progress indicators for long operations
- Help text and usage examples

### Output Standards
- 🔍 Analysis operations (investigate, examine)
- 🛠️ Management operations (modify, configure)
- 🧹 Cleanup operations (remove, clean)
- 📊 Reporting operations (metrics, summaries)
- ⚠️ Warning indicators
- ✅ Success indicators
- ❌ Error indicators

---

## 📚 Related Documentation

- **[OPERATIONS.md](./OPERATIONS.md)** - Main operations guide
- **[README.md](../README.md)** - Project overview and API reference
- **[TROUBLESHOOTING-GUIDE.md](./TROUBLESHOOTING-GUIDE.md)** - Problem resolution procedures

---

**Last updated:** 2026-02-25  
**Purpose:** Comprehensive utility documentation for IC Mesh operators and developers

*This reference should be updated when new utility scripts are added or existing ones are modified.*