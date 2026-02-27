#!/usr/bin/env node

/**
 * Unified Status Monitor - Single source of truth for IC Mesh status
 * Prevents monitoring inconsistencies that caused false crisis alarms
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'data/mesh.db'));

function getUnifiedStatus() {
    return new Promise((resolve, reject) => {
        const status = {
            timestamp: new Date().toISOString(),
            nodes: { active: 0, total: 0, details: [] },
            jobs: { pending: 0, claimed: 0, completed: 0, failed: 0, byType: {} },
            capabilities: { available: [], missing: [] },
            processing: { rate: '0 jobs/min', lastActivity: null },
            severity: 'unknown'
        };

        // Get node status with consistent criteria (last seen within 5 minutes)
        db.all(`
            SELECT nodeId, name, owner, capabilities, lastSeen,
                   ROUND((strftime('%s', 'now') * 1000 - lastSeen) / 60000.0, 1) as minutesAgo,
                   CASE WHEN (strftime('%s', 'now') * 1000 - lastSeen) / 60000.0 <= 5 THEN 1 ELSE 0 END as isActive
            FROM nodes 
            ORDER BY lastSeen DESC
        `, (err, nodes) => {
            if (err) return reject(err);
            
            status.nodes.total = nodes.length;
            status.nodes.active = nodes.filter(n => n.isActive).length;
            status.nodes.details = nodes.map(n => ({
                id: n.nodeId.slice(0, 8),
                name: n.name || 'unnamed',
                owner: n.owner || 'unknown', 
                capabilities: JSON.parse(n.capabilities || '[]'),
                minutesAgo: n.minutesAgo || 999,
                active: Boolean(n.isActive),
                lastSeen: n.lastSeen
            }));

            // Get active capabilities
            const activeNodes = nodes.filter(n => n.isActive);
            const activeCapabilities = new Set();
            activeNodes.forEach(node => {
                const caps = JSON.parse(node.capabilities || '[]');
                caps.forEach(cap => activeCapabilities.add(cap));
            });
            status.capabilities.available = Array.from(activeCapabilities);

            // Get job status
            db.all(`
                SELECT status, type, COUNT(*) as count 
                FROM jobs 
                GROUP BY status, type 
                ORDER BY status, type
            `, (err, jobStats) => {
                if (err) return reject(err);

                // Process job statistics
                jobStats.forEach(stat => {
                    status.jobs[stat.status] = (status.jobs[stat.status] || 0) + stat.count;
                    
                    if (!status.jobs.byType[stat.type]) {
                        status.jobs.byType[stat.type] = {};
                    }
                    status.jobs.byType[stat.type][stat.status] = stat.count;
                });

                // Check recent processing activity
                db.get(`
                    SELECT MAX(completedAt) as lastCompletion,
                           COUNT(*) as recentCompletions
                    FROM jobs 
                    WHERE status = 'completed' 
                    AND completedAt > (strftime('%s', 'now') - 300) * 1000
                `, (err, activity) => {
                    if (err) return reject(err);

                    if (activity.lastCompletion) {
                        status.processing.lastActivity = new Date(activity.lastCompletion).toISOString();
                        if (activity.recentCompletions > 0) {
                            status.processing.rate = `${activity.recentCompletions} jobs/5min`;
                        }
                    }

                    // Determine severity based on unified criteria
                    if (status.nodes.active === 0) {
                        status.severity = 'critical';
                        status.message = 'Complete service outage - no active nodes';
                    } else if (status.jobs.pending > 50 && status.nodes.active < 2) {
                        status.severity = 'high';
                        status.message = 'Capacity bottleneck - high job backlog';
                    } else if (status.jobs.pending > 20) {
                        status.severity = 'medium';  
                        status.message = 'Moderate job backlog';
                    } else if (status.capabilities.available.length < 3) {
                        status.severity = 'low';
                        status.message = 'Limited capabilities available';
                    } else {
                        status.severity = 'normal';
                        status.message = 'Service operational';
                    }

                    resolve(status);
                });
            });
        });
    });
}

function formatStatus(status) {
    const severityColors = {
        critical: '🔴',
        high: '🟠', 
        medium: '🟡',
        low: '🟡',
        normal: '🟢'
    };

    const color = severityColors[status.severity];
    console.log(`\n${color} IC MESH UNIFIED STATUS`);
    console.log(`════════════════════════════════════════`);
    console.log(`Time: ${status.timestamp.slice(11, 19)} UTC`);
    console.log(`Status: ${status.message}`);
    console.log(`Severity: ${status.severity.toUpperCase()}`);
    
    console.log(`\n📊 CAPACITY:`);
    console.log(`  Nodes: ${status.nodes.active}/${status.nodes.total} active`);
    console.log(`  Capabilities: [${status.capabilities.available.join(', ')}]`);
    
    console.log(`\n📋 QUEUE:`);
    console.log(`  Pending: ${status.jobs.pending || 0}`);
    console.log(`  Claimed: ${status.jobs.claimed || 0}`); 
    console.log(`  Processing: ${status.processing.rate}`);
    
    if (status.jobs.pending > 0) {
        console.log(`\n📈 PENDING BY TYPE:`);
        Object.entries(status.jobs.byType).forEach(([type, counts]) => {
            if (counts.pending > 0) {
                console.log(`  ${type}: ${counts.pending} jobs`);
            }
        });
    }

    if (status.nodes.details.length > 0) {
        console.log(`\n🖥️  NODE DETAILS:`);
        status.nodes.details.forEach(node => {
            const statusIcon = node.active ? '🟢' : '🔴';
            const capabilities = node.capabilities.join(', ') || 'none';
            console.log(`  ${statusIcon} ${node.name} (${node.id}) - ${capabilities} (${node.minutesAgo}m ago)`);
        });
    }
}

// Command line interface
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
IC Mesh Unified Status Monitor

Usage: node unified-status-monitor.js [options]

Options:
  --json     Output raw JSON instead of formatted display
  --once     Run once and exit (default)
  --watch    Run continuously every 30 seconds
  --help     Show this help message

This tool provides a single source of truth for IC Mesh status,
preventing monitoring inconsistencies.
        `);
        process.exit(0);
    }

    const outputJson = args.includes('--json');
    const continuous = args.includes('--watch');

    function runCheck() {
        getUnifiedStatus()
            .then(status => {
                if (outputJson) {
                    console.log(JSON.stringify(status, null, 2));
                } else {
                    formatStatus(status);
                }
            })
            .catch(err => {
                console.error('Status check failed:', err.message);
                process.exit(1);
            })
            .finally(() => {
                if (!continuous) {
                    db.close();
                    process.exit(0);
                }
            });
    }

    if (continuous) {
        console.log('🔍 Starting continuous monitoring (30s intervals)');
        console.log('Press Ctrl+C to stop\n');
        
        runCheck(); // Run immediately
        const interval = setInterval(runCheck, 30000);
        
        process.on('SIGINT', () => {
            console.log('\n🔍 Monitoring stopped');
            clearInterval(interval);
            db.close();
            process.exit(0);
        });
    } else {
        runCheck();
    }
}