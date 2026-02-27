#!/usr/bin/env node

/**
 * Node Retention Monitor
 * 
 * Advanced monitoring system to track node connection patterns,
 * identify churn risks, and provide early warning for operators
 * and network administrators.
 * 
 * Features:
 * - Connection pattern analysis
 * - Churn prediction
 * - Performance correlation
 * - Operator engagement tracking
 * - Automated alerts
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class NodeRetentionMonitor {
    constructor() {
        this.db = new sqlite3.Database('./data/mesh.db');
        this.alertThresholds = {
            disconnectTime: 30 * 60 * 1000, // 30 minutes
            lowPerformance: 0.7, // 70% success rate
            churnRisk: 3, // 3 disconnections in window
            newNodeWindow: 24 * 60 * 60 * 1000 // 24 hours
        };
    }

    async generateRetentionReport() {
        console.log('\n📊 IC Mesh Node Retention Analysis');
        console.log('====================================\n');

        const nodes = await this.getAllNodes();
        const retentionMetrics = await this.calculateRetentionMetrics(nodes);
        
        // Overall retention summary
        this.displayOverallMetrics(retentionMetrics);
        
        // Individual node analysis
        await this.displayNodeAnalysis(nodes);
        
        // Churn risk assessment
        await this.displayChurnRiskAnalysis(nodes);
        
        // Recommendations
        this.displayRecommendations(retentionMetrics);
        
        // Generate alerts
        await this.generateAlerts(nodes);
    }

    async getAllNodes() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    nodeId, 
                    name, 
                    owner, 
                    capabilities, 
                    lastSeen, 
                    registeredAt as createdAt,
                    jobsCompleted,
                    (SELECT COUNT(*) FROM jobs WHERE nodeId = n.nodeId) as totalJobs,
                    (SELECT COUNT(*) FROM jobs WHERE nodeId = n.nodeId AND status = 'completed') as completedJobs,
                    (SELECT COUNT(*) FROM jobs WHERE nodeId = n.nodeId AND status = 'failed') as failedJobs
                FROM nodes n
                ORDER BY lastSeen DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async calculateRetentionMetrics(nodes) {
        const now = Date.now();
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
        
        const metrics = {
            totalNodes: nodes.length,
            activeNodes: nodes.filter(n => now - n.lastSeen < 5 * 60 * 1000).length,
            recentNodes: nodes.filter(n => now - n.lastSeen < 60 * 60 * 1000).length,
            dailyActive: nodes.filter(n => now - n.lastSeen < 24 * 60 * 60 * 1000).length,
            weeklyActive: nodes.filter(n => now - n.lastSeen < 7 * 24 * 60 * 60 * 1000).length,
            newNodes24h: nodes.filter(n => now - n.createdAt < 24 * 60 * 60 * 1000).length,
            newNodes7d: nodes.filter(n => now - n.createdAt < 7 * 24 * 60 * 60 * 1000).length,
        };

        metrics.retentionRate1d = metrics.totalNodes > 0 ? (metrics.dailyActive / metrics.totalNodes) * 100 : 0;
        metrics.retentionRate7d = metrics.totalNodes > 0 ? (metrics.weeklyActive / metrics.totalNodes) * 100 : 0;
        metrics.churnRate = 100 - metrics.retentionRate7d;

        return metrics;
    }

    displayOverallMetrics(metrics) {
        console.log('🎯 Overall Network Retention:');
        console.log(`   Total Registered Nodes: ${metrics.totalNodes}`);
        console.log(`   Currently Online (5min): ${metrics.activeNodes} (${(metrics.activeNodes/metrics.totalNodes*100).toFixed(1)}%)`);
        console.log(`   Recently Active (1hour): ${metrics.recentNodes} (${(metrics.recentNodes/metrics.totalNodes*100).toFixed(1)}%)`);
        console.log(`   Daily Retention: ${metrics.dailyActive}/${metrics.totalNodes} (${metrics.retentionRate1d.toFixed(1)}%)`);
        console.log(`   Weekly Retention: ${metrics.weeklyActive}/${metrics.totalNodes} (${metrics.retentionRate7d.toFixed(1)}%)`);
        console.log(`   Churn Rate: ${metrics.churnRate.toFixed(1)}%`);
        console.log(`   New Nodes (24h): ${metrics.newNodes24h}`);
        console.log(`   New Nodes (7d): ${metrics.newNodes7d}`);
        
        // Health assessment
        if (metrics.retentionRate7d >= 75) {
            console.log('   🟢 Network Health: EXCELLENT');
        } else if (metrics.retentionRate7d >= 50) {
            console.log('   🟡 Network Health: GOOD');
        } else if (metrics.retentionRate7d >= 25) {
            console.log('   🟠 Network Health: NEEDS ATTENTION');
        } else {
            console.log('   🔴 Network Health: CRITICAL - HIGH CHURN');
        }
        console.log('');
    }

    async displayNodeAnalysis(nodes) {
        console.log('👥 Individual Node Analysis:');
        
        const now = Date.now();
        
        for (const node of nodes.slice(0, 10)) { // Show top 10 by recency
            const minutesAgo = Math.floor((now - node.lastSeen) / (60 * 1000));
            const daysOld = Math.floor((now - node.createdAt) / (24 * 60 * 60 * 1000));
            const successRate = node.totalJobs > 0 ? (node.completedJobs / node.totalJobs * 100) : 0;
            
            let status = '🔴 OFFLINE';
            if (minutesAgo < 5) status = '🟢 ONLINE';
            else if (minutesAgo < 60) status = '🟡 RECENT';
            
            let performance = '📊 N/A';
            if (node.totalJobs > 0) {
                if (successRate >= 90) performance = '🌟 EXCELLENT';
                else if (successRate >= 70) performance = '👍 GOOD';
                else if (successRate >= 50) performance = '⚠️  POOR';
                else performance = '🔴 FAILING';
            }
            
            console.log(`   ${status} ${node.name || 'unnamed'} (${node.nodeId.substring(0, 8)})`);
            console.log(`     Owner: ${node.owner || 'unknown'}`);
            console.log(`     Last seen: ${minutesAgo < 60 ? minutesAgo + 'min' : Math.floor(minutesAgo/60) + 'h'} ago`);
            console.log(`     Age: ${daysOld} days`);
            console.log(`     Jobs: ${node.completedJobs}/${node.totalJobs} ${performance}`);
            console.log(`     Capabilities: ${node.capabilities || 'none'}`);
            console.log('');
        }
    }

    async displayChurnRiskAnalysis(nodes) {
        console.log('⚠️  Churn Risk Assessment:');
        
        const now = Date.now();
        const riskNodes = [];
        
        for (const node of nodes) {
            const risk = this.calculateChurnRisk(node, now);
            if (risk.score > 0) {
                riskNodes.push({ node, risk });
            }
        }
        
        riskNodes.sort((a, b) => b.risk.score - a.risk.score);
        
        if (riskNodes.length === 0) {
            console.log('   🎉 No nodes at immediate churn risk!');
        } else {
            console.log(`   Found ${riskNodes.length} nodes with churn risk:\n`);
            
            riskNodes.slice(0, 5).forEach(({ node, risk }) => {
                console.log(`   🚨 ${risk.level} RISK: ${node.name || 'unnamed'} (${node.nodeId.substring(0, 8)})`);
                console.log(`      Score: ${risk.score}/10`);
                risk.factors.forEach(factor => {
                    console.log(`      • ${factor}`);
                });
                console.log('');
            });
        }
    }

    calculateChurnRisk(node, now) {
        const risk = { score: 0, factors: [], level: 'LOW' };
        
        const minutesOffline = (now - node.lastSeen) / (60 * 1000);
        const successRate = node.totalJobs > 0 ? node.completedJobs / node.totalJobs : 1;
        const nodeAge = (now - node.createdAt) / (24 * 60 * 60 * 1000);
        
        // Long disconnection
        if (minutesOffline > 60) {
            risk.score += 2;
            risk.factors.push(`Offline for ${Math.floor(minutesOffline/60)}h ${Math.floor(minutesOffline%60)}min`);
        }
        
        // Poor performance
        if (node.totalJobs > 0 && successRate < 0.5) {
            risk.score += 3;
            risk.factors.push(`Low success rate: ${(successRate * 100).toFixed(1)}%`);
        }
        
        // New node with immediate issues
        if (nodeAge < 1 && node.totalJobs > 0 && successRate < 0.8) {
            risk.score += 2;
            risk.factors.push('New node with early performance issues');
        }
        
        // No job activity despite being registered
        if (nodeAge > 1 && node.totalJobs === 0) {
            risk.score += 1;
            risk.factors.push('No job activity despite age');
        }
        
        // Determine risk level
        if (risk.score >= 7) risk.level = 'CRITICAL';
        else if (risk.score >= 4) risk.level = 'HIGH';
        else if (risk.score >= 2) risk.level = 'MEDIUM';
        
        return risk;
    }

    displayRecommendations(metrics) {
        console.log('💡 Retention Improvement Recommendations:');
        
        if (metrics.churnRate > 50) {
            console.log('   🔴 URGENT: High churn rate detected');
            console.log('     • Review onboarding documentation and process');
            console.log('     • Add proactive operator support and troubleshooting');
            console.log('     • Consider incentives for long-term operators');
            console.log('     • Investigate common disconnection causes');
        } else if (metrics.churnRate > 25) {
            console.log('   🟡 MEDIUM: Moderate churn needs attention');
            console.log('     • Improve node reconnection tools and scripts');
            console.log('     • Monitor for network or server issues');
            console.log('     • Enhance operator communication and support');
        } else {
            console.log('   🟢 GOOD: Churn rate is acceptable');
            console.log('     • Continue monitoring for early warning signs');
            console.log('     • Maintain quality operator experience');
        }
        
        if (metrics.newNodes7d === 0) {
            console.log('   📈 GROWTH: No new nodes recently');
            console.log('     • Consider marketing and outreach efforts');
            console.log('     • Review onboarding barriers');
            console.log('     • Expand operator recruitment channels');
        }
        
        if (metrics.activeNodes / metrics.totalNodes < 0.2) {
            console.log('   ⚡ CAPACITY: Low active node ratio');
            console.log('     • Focus on keeping existing nodes online');
            console.log('     • Provide better monitoring tools to operators');
            console.log('     • Address common technical issues');
        }
        
        console.log('');
    }

    async generateAlerts(nodes) {
        const alerts = [];
        const now = Date.now();
        
        // Check for critical nodes offline
        nodes.forEach(node => {
            const minutesOffline = (now - node.lastSeen) / (60 * 1000);
            const successRate = node.totalJobs > 0 ? node.completedJobs / node.totalJobs : 1;
            
            if (node.totalJobs >= 10 && successRate >= 0.9 && minutesOffline > 60) {
                alerts.push({
                    type: 'HIGH_PERFORMER_OFFLINE',
                    node: node.name || 'unnamed',
                    message: `High-performing node offline for ${Math.floor(minutesOffline/60)}h (${node.completedJobs} jobs, ${(successRate*100).toFixed(1)}% success)`
                });
            }
            
            if (minutesOffline > 24 * 60) {
                alerts.push({
                    type: 'LONG_OFFLINE',
                    node: node.name || 'unnamed',
                    message: `Node offline for ${Math.floor(minutesOffline/(60*24))} days - consider reaching out to operator`
                });
            }
        });
        
        if (alerts.length > 0) {
            console.log('🚨 Active Alerts:');
            alerts.forEach(alert => {
                console.log(`   ${alert.type}: ${alert.node}`);
                console.log(`     ${alert.message}`);
            });
            console.log('');
            
            // Save alerts to file for external processing
            fs.writeFileSync('retention-alerts.json', JSON.stringify(alerts, null, 2));
            console.log('💾 Alerts saved to retention-alerts.json');
        } else {
            console.log('✅ No active retention alerts');
        }
    }

    async generateHistoricalTrends() {
        console.log('\n📈 Historical Retention Trends:');
        console.log('===============================');
        
        // This would require additional tracking tables
        // For now, provide framework for future implementation
        console.log('   ℹ️  Historical trend analysis requires additional data collection');
        console.log('   📋 Recommendations for future tracking:');
        console.log('     • Daily node count snapshots');
        console.log('     • Connection/disconnection event logging');
        console.log('     • Performance trend tracking');
        console.log('     • Operator engagement metrics');
    }

    close() {
        this.db.close();
    }
}

// Enhanced operator engagement tools
class OperatorEngagementTracker {
    constructor(retentionMonitor) {
        this.retentionMonitor = retentionMonitor;
    }

    async generateOperatorReport() {
        console.log('\n👤 Operator Engagement Report:');
        console.log('===============================');
        
        const operators = await this.getOperatorStats();
        
        operators.forEach(op => {
            console.log(`\n📧 ${op.owner || 'Anonymous'}`);
            console.log(`   Nodes: ${op.nodeCount}`);
            console.log(`   Total Jobs: ${op.totalJobs}`);
            console.log(`   Success Rate: ${(op.successRate * 100).toFixed(1)}%`);
            console.log(`   Avg Uptime: ${op.avgUptime.toFixed(1)} hours`);
            console.log(`   Engagement: ${this.calculateEngagementLevel(op)}`);
        });
    }

    async getOperatorStats() {
        // This would aggregate by operator
        return new Promise((resolve, reject) => {
            this.retentionMonitor.db.all(`
                SELECT 
                    owner,
                    COUNT(*) as nodeCount,
                    SUM((SELECT COUNT(*) FROM jobs WHERE nodeId = n.nodeId)) as totalJobs,
                    AVG(CASE 
                        WHEN (SELECT COUNT(*) FROM jobs WHERE nodeId = n.nodeId) > 0 
                        THEN (SELECT COUNT(*) FROM jobs WHERE nodeId = n.nodeId AND status = 'completed') * 1.0 / (SELECT COUNT(*) FROM jobs WHERE nodeId = n.nodeId)
                        ELSE 1 
                    END) as successRate,
                    AVG((lastSeen - registeredAt) / (1000 * 60 * 60)) as avgUptime
                FROM nodes n
                WHERE owner IS NOT NULL
                GROUP BY owner
                ORDER BY totalJobs DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    calculateEngagementLevel(operator) {
        let score = 0;
        
        if (operator.nodeCount > 1) score += 2;
        if (operator.totalJobs > 10) score += 3;
        if (operator.successRate > 0.9) score += 3;
        if (operator.avgUptime > 24) score += 2;
        
        if (score >= 8) return '🌟 CHAMPION';
        if (score >= 6) return '🔥 HIGH';
        if (score >= 4) return '👍 GOOD';
        if (score >= 2) return '🌱 GROWING';
        return '📧 NEW';
    }
}

// CLI Interface
async function main() {
    const monitor = new NodeRetentionMonitor();
    
    try {
        if (process.argv.includes('--help')) {
            console.log('IC Mesh Node Retention Monitor');
            console.log('Usage:');
            console.log('  node node-retention-monitor.js                Run retention analysis');
            console.log('  node node-retention-monitor.js --operators    Include operator engagement report');
            console.log('  node node-retention-monitor.js --trends       Show historical trends (placeholder)');
            console.log('  node node-retention-monitor.js --alerts-only  Only show alerts');
            return;
        }
        
        if (process.argv.includes('--alerts-only')) {
            const nodes = await monitor.getAllNodes();
            await monitor.generateAlerts(nodes);
            return;
        }
        
        await monitor.generateRetentionReport();
        
        if (process.argv.includes('--operators')) {
            const engagementTracker = new OperatorEngagementTracker(monitor);
            await engagementTracker.generateOperatorReport();
        }
        
        if (process.argv.includes('--trends')) {
            await monitor.generateHistoricalTrends();
        }
        
    } finally {
        monitor.close();
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { NodeRetentionMonitor, OperatorEngagementTracker };