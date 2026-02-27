# Monitoring Inconsistency Fix — 2026-02-27

## Problem Identified

During a perceived service outage on 2026-02-27 06:28-06:47 UTC, multiple monitoring tools provided contradictory information:

- `real-time-capacity-monitor.js`: Reported 0/5 active nodes (CRITICAL)
- `health:realtime`: Reported 100/100 health score (EXCELLENT)
- `job-queue-fixer.js`: Reported 2/5 active nodes (DEGRADED)
- `curl /status`: Reported 2/5 active nodes (OPERATIONAL)

## Root Cause

Different monitoring tools used **inconsistent criteria** for determining node status:

1. **Different time windows:** Some used 5-minute activity, others used different periods
2. **Database inconsistencies:** Tools had varying timestamp handling (Unix ms vs seconds)
3. **Connection issues:** Some tools had SQLite database connection problems
4. **Logic variations:** Each tool calculated "active" nodes differently

## False Crisis Impact

The inconsistent monitoring created a **false crisis alarm**:
- Crisis documentation created for "complete service outage"
- Human escalation prepared unnecessarily
- Work pulse cycles focused on non-existent emergency
- Real status: 2 active nodes, processing resuming normally

## Solution Implemented

### 1. Unified Status Monitor

Created `unified-status-monitor.js` as the **single source of truth** for IC Mesh status:

```bash
npm run status:unified     # One-time status check
npm run status:watch       # Continuous monitoring  
npm run status:json        # JSON output for scripts
```

### 2. Consistent Criteria

Standardized "active node" definition:
- **Active:** Node seen within last 5 minutes
- **Time calculation:** Proper Unix millisecond handling
- **Severity levels:** Standardized critical/high/medium/low/normal

### 3. Comprehensive Status

Single tool provides:
- Node activity status (with consistent timing)
- Job queue breakdown by type and status  
- Capability availability assessment
- Processing rate analysis
- Unified severity assessment

## Usage Going Forward

**Primary status command:**
```bash
cd ic-mesh && npm run status:unified
```

**Continuous monitoring during operations:**
```bash
cd ic-mesh && npm run status:watch
```

**For scripts/automation:**
```bash
cd ic-mesh && npm run status:json
```

## Prevention

1. **Always use unified status** for operational decisions
2. **Cross-verify** with multiple tools only during debugging
3. **Question contradictory data** before escalating crises
4. **Test monitoring tools** regularly against known database states

## Key Lesson

**Infrastructure monitoring must be consistent and reliable** — false alarms waste critical response time and diminish trust in actual alerts.

The unified status monitor prevents this class of monitoring inconsistency going forward.