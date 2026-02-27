#!/usr/bin/env node

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'mesh.db');
const ALERT_STATE_FILE = path.join(__dirname, '..', 'data', 'capacity-alerts.json');

class CapacityAlertMonitor {
    constructor() {
        this.db = new Database(DB_PATH);
        this.alertState = this.loadAlertState();
        
        this.statements = {
            getCapacityGaps: this.db.prepare(`
                WITH required_caps AS (
                    SELECT 
                        JSON_EXTRACT(requirements, '$.capability') as capability,
                        COUNT(*) as pending_jobs,
                        MIN(createdAt) as oldest_job
                    FROM jobs 
                    WHERE status = 'pending' 
                    GROUP BY JSON_EXTRACT(requirements, '$.capability')
                ),
                available_caps AS (
                    SELECT DISTINCT 
                        REPLACE(REPLACE(value, '[', ''), ']', '') as capability
                    FROM nodes n,
                    JSON_EACH(n.capabilities) 
                    WHERE (strftime('%s', 'now') * 1000 - n.lastSeen) < 300000  -- Active in last 5min
                )
                SELECT 
                    rc.capability,
                    rc.pending_jobs,
                    ROUND((? - rc.oldest_job) / 1000 / 60, 1) as oldest_pending_minutes,
                    CASE WHEN ac.capability IS NOT NULL THEN 'Available' ELSE 'MISSING' END as status
                FROM required_caps rc
                LEFT JOIN available_caps ac ON rc.capability = ac.capability
                WHERE rc.capability != 'TEST_MODE'
                ORDER BY rc.pending_jobs DESC
            `),
            
            getActiveNodes: this.db.prepare(`
                SELECT COUNT(*) as active_count 
                FROM nodes 
                WHERE (strftime('%s', 'now') * 1000 - lastSeen) < 300000
            `),
            
            getStuckJobs: this.db.prepare(`
                SELECT COUNT(*) as stuck_count
                FROM jobs 
                WHERE status = 'claimed' 
                AND (strftime('%s', 'now') * 1000 - claimedAt) > 600000  -- Claimed >10min ago
            `)
        };
    }

    loadAlertState() {
        try {
            if (fs.existsSync(ALERT_STATE_FILE)) {
                const data = fs.readFileSync(ALERT_STATE_FILE, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Warning: Could not load alert state:', error.message);
        }
        return {
            lastAlerts: {},
            alertCounts: {}
        };
    }

    saveAlertState() {
        try {
            fs.writeFileSync(ALERT_STATE_FILE, JSON.stringify(this.alertState, null, 2));
        } catch (error) {
            console.error('Warning: Could not save alert state:', error.message);
        }
    }

    shouldAlert(alertKey, threshold, currentValue) {
        const lastAlert = this.alertState.lastAlerts[alertKey];
        const alertCount = this.alertState.alertCounts[alertKey] || 0;
        const now = Date.now();
        
        // Alert immediately if threshold exceeded for first time
        if (!lastAlert && currentValue >= threshold) {
            return true;
        }
        
        // Alert again after cooldown period (exponential backoff based on alert count)
        if (lastAlert && currentValue >= threshold) {
            const cooldownMinutes = Math.min(60, Math.pow(2, alertCount) * 5); // 5, 10, 20, 40, 60 minutes max
            const cooldownMs = cooldownMinutes * 60 * 1000;
            return (now - lastAlert) > cooldownMs;
        }
        
        return false;
    }

    recordAlert(alertKey) {
        this.alertState.lastAlerts[alertKey] = Date.now();
        this.alertState.alertCounts[alertKey] = (this.alertState.alertCounts[alertKey] || 0) + 1;
        this.saveAlertState();
    }

    clearAlert(alertKey) {
        delete this.alertState.lastAlerts[alertKey];
        delete this.alertState.alertCounts[alertKey];
        this.saveAlertState();
    }

    async checkCapacityAlerts(options = {}) {
        const { verbose = true, alertsOnly = false } = options;
        const now = Date.now();
        
        // Get current capacity state
        const capacityGaps = this.statements.getCapacityGaps.all(now);
        const activeNodes = this.statements.getActiveNodes.get();
        const stuckJobs = this.statements.getStuckJobs.get();
        
        const alerts = [];
        
        // Check for missing capabilities blocking many jobs
        for (const gap of capacityGaps) {
            if (gap.status === 'MISSING' && gap.pending_jobs >= 5) {
                const alertKey = `missing_capability_${gap.capability}`;
                if (this.shouldAlert(alertKey, 5, gap.pending_jobs)) {
                    alerts.push({
                        type: 'MISSING_CAPABILITY',
                        severity: gap.pending_jobs >= 20 ? 'CRITICAL' : 'WARNING',
                        message: `${gap.pending_jobs} jobs blocked by missing '${gap.capability}' capability (oldest: ${gap.oldest_pending_minutes}m)`,
                        capability: gap.capability,
                        jobsBlocked: gap.pending_jobs,
                        oldestMinutes: gap.oldest_pending_minutes
                    });
                    this.recordAlert(alertKey);
                }
            } else if (gap.status === 'Available') {
                // Clear alert if capability is now available
                const alertKey = `missing_capability_${gap.capability}`;
                this.clearAlert(alertKey);
            }
        }
        
        // Check for service outages (no active nodes)
        if (activeNodes.active_count === 0) {
            const alertKey = 'service_outage';
            if (this.shouldAlert(alertKey, 1, 1)) {
                alerts.push({
                    type: 'SERVICE_OUTAGE',
                    severity: 'CRITICAL',
                    message: 'Complete service outage - no active nodes',
                    activeNodes: 0
                });
                this.recordAlert(alertKey);
            }
        } else {
            // Clear outage alert if nodes are active
            this.clearAlert('service_outage');
        }
        
        // Check for stuck jobs
        if (stuckJobs.stuck_count > 0) {
            const alertKey = 'stuck_jobs';
            if (this.shouldAlert(alertKey, 1, stuckJobs.stuck_count)) {
                alerts.push({
                    type: 'STUCK_JOBS',
                    severity: 'WARNING',
                    message: `${stuckJobs.stuck_count} jobs stuck in 'claimed' status for >10 minutes`,
                    stuckJobs: stuckJobs.stuck_count
                });
                this.recordAlert(alertKey);
            }
        } else {
            this.clearAlert('stuck_jobs');
        }
        
        // Check for single point of failure
        if (activeNodes.active_count === 1) {
            const alertKey = 'single_node';
            if (this.shouldAlert(alertKey, 1, 1)) {
                alerts.push({
                    type: 'SINGLE_NODE_RISK',
                    severity: 'INFO',
                    message: 'Single active node - service at risk if node disconnects',
                    activeNodes: 1
                });
                this.recordAlert(alertKey);
            }
        } else if (activeNodes.active_count > 1) {
            this.clearAlert('single_node');
        }
        
        if (verbose && !alertsOnly) {
            console.log('🚨 IC Mesh Capacity Alert Monitor');
            console.log('═'.repeat(50));
            console.log(`📅 Check time: ${new Date().toISOString()}`);
            console.log('');
            
            console.log('📊 Current Status:');
            console.log(`   Active nodes: ${activeNodes.active_count}`);
            console.log(`   Stuck jobs: ${stuckJobs.stuck_count}`);
            console.log('');
            
            if (capacityGaps.length > 0) {
                console.log('🔧 Capability Status:');
                for (const gap of capacityGaps) {
                    const statusIcon = gap.status === 'Available' ? '✅' : '❌';
                    console.log(`   ${statusIcon} ${gap.capability.padEnd(15)} ${String(gap.pending_jobs).padStart(2)} jobs ${gap.status.toLowerCase()}`);
                }
                console.log('');
            }
        }
        
        if (alerts.length > 0) {
            if (verbose) {
                console.log('🚨 ACTIVE ALERTS:');
                for (const alert of alerts) {
                    const severityIcon = alert.severity === 'CRITICAL' ? '🔴' : 
                                        alert.severity === 'WARNING' ? '🟡' : '🔵';
                    console.log(`   ${severityIcon} ${alert.severity}: ${alert.message}`);
                }
                console.log('');
                
                // Generate action suggestions
                console.log('💡 Recommended Actions:');
                for (const alert of alerts) {
                    if (alert.type === 'MISSING_CAPABILITY') {
                        console.log(`   📞 Contact operators to deploy nodes with '${alert.capability}' capability`);
                    } else if (alert.type === 'SERVICE_OUTAGE') {
                        console.log('   🔌 Check node connectivity and restart mesh client processes');
                    } else if (alert.type === 'STUCK_JOBS') {
                        console.log('   🔄 Consider resetting stuck jobs or restarting node processes');
                    } else if (alert.type === 'SINGLE_NODE_RISK') {
                        console.log('   📈 Deploy additional nodes for redundancy');
                    }
                }
                console.log('');
            }
        } else if (verbose && !alertsOnly) {
            console.log('✅ No active alerts - system operating normally');
            console.log('');
        }
        
        this.db.close();
        return alerts;
    }
}

// CLI mode
if (require.main === module) {
    const args = process.argv.slice(2);
    const quiet = args.includes('--quiet') || args.includes('-q');
    const alertsOnly = args.includes('--alerts-only') || args.includes('-a');
    
    const monitor = new CapacityAlertMonitor();
    
    monitor.checkCapacityAlerts({ verbose: !quiet, alertsOnly })
        .then(alerts => {
            if (alertsOnly && alerts.length > 0) {
                for (const alert of alerts) {
                    console.log(`${alert.severity}: ${alert.message}`);
                }
                process.exit(1);
            } else if (alerts.length > 0) {
                process.exit(1); // Exit with error code if there are alerts
            } else {
                process.exit(0);
            }
        })
        .catch(err => {
            console.error('❌ Alert check failed:', err);
            process.exit(1);
        });
}

module.exports = CapacityAlertMonitor;