#!/usr/bin/env node
/**
 * Node Retention Investigator
 * 
 * Deep-dive analysis tool for understanding why nodes disconnect
 * and developing strategies to improve retention rates.
 * 
 * Capabilities:
 * - Historical connection pattern analysis
 * - Disconnection root cause investigation 
 * - Retention trend tracking and prediction
 * - Node lifecycle analysis
 * - Performance correlation with retention
 * - Actionable retention improvement recommendations
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class NodeRetentionInvestigator {
    constructor(dbPath = './mesh.db') {
        this.db = new Database(dbPath);
        this.now = Date.now();
        this.analysis = {};
    }

    async investigate() {
        console.log('🔍 NODE RETENTION DEEP DIVE INVESTIGATION');
        console.log('==========================================');

        this.analyzeCurrentState();
        this.analyzeHistoricalPatterns();
        this.investigateDisconnectionCauses();
        this.analyzeCapabilityRetention();
        this.generateRetentionInsights();
        this.createActionableRecommendations();
        this.saveReport();

        this.db.close();
        return this.analysis;
    }

    analyzeCurrentState() {
        console.log('\\n📊 CURRENT STATE ANALYSIS');
        
        // Get all nodes
        const nodes = this.db.prepare('SELECT * FROM nodes ORDER BY lastHeartbeat DESC').all();
        
        this.analysis.totalNodes = nodes.length;
        this.analysis.currentState = {
            total: nodes.length,
            active: 0,
            recent: 0,
            today: 0,
            week: 0,
            dormant: 0
        };

        if (nodes.length === 0) {
            console.log('⚠️  CRITICAL: No nodes found in database!');
            console.log('   This suggests either:');
            console.log('   - Database was recently cleaned/reset');
            console.log('   - All nodes disconnected simultaneously');
            console.log('   - Database connectivity issues');
            
            this.analysis.criticalAlert = 'ZERO_NODES_DETECTED';
            this.analysis.retentionRates = {
                immediate: 0,
                daily: 0,
                weekly: 0
            };
            this.analysis.nodePerformance = [];
            return;
        }

        // Time thresholds
        const thresholds = {
            active: 5 * 60 * 1000,      // 5 minutes
            recent: 60 * 60 * 1000,     // 1 hour
            today: 24 * 60 * 60 * 1000, // 24 hours
            week: 7 * 24 * 60 * 60 * 1000 // 7 days
        };

        nodes.forEach(node => {
            const timeAgo = this.now - node.lastHeartbeat;
            
            if (timeAgo < thresholds.active) {
                this.analysis.currentState.active++;
            } else if (timeAgo < thresholds.recent) {
                this.analysis.currentState.recent++;
            } else if (timeAgo < thresholds.today) {
                this.analysis.currentState.today++;
            } else if (timeAgo < thresholds.week) {
                this.analysis.currentState.week++;
            } else {
                this.analysis.currentState.dormant++;
            }
        });

        console.log(`   Total nodes registered: ${this.analysis.currentState.total}`);
        console.log(`   Active (< 5min): ${this.analysis.currentState.active}`);
        console.log(`   Recent (< 1hr): ${this.analysis.currentState.recent}`);
        console.log(`   Today (< 24hr): ${this.analysis.currentState.today}`);
        console.log(`   This week (< 7d): ${this.analysis.currentState.week}`);
        console.log(`   Dormant (> 7d): ${this.analysis.currentState.dormant}`);

        // Calculate retention rates
        const recentTotal = this.analysis.currentState.active + this.analysis.currentState.recent;
        this.analysis.retentionRates = {
            immediate: recentTotal > 0 ? (this.analysis.currentState.active / recentTotal * 100) : 0,
            daily: this.analysis.currentState.total > 0 ? ((this.analysis.currentState.active + this.analysis.currentState.recent + this.analysis.currentState.today) / this.analysis.currentState.total * 100) : 0,
            weekly: this.analysis.currentState.total > 0 ? ((this.analysis.currentState.total - this.analysis.currentState.dormant) / this.analysis.currentState.total * 100) : 0
        };

        console.log(`\\n📈 RETENTION RATES:`);
        console.log(`   Immediate (active/recent): ${this.analysis.retentionRates.immediate.toFixed(1)}%`);
        console.log(`   Daily retention: ${this.analysis.retentionRates.daily.toFixed(1)}%`);
        console.log(`   Weekly retention: ${this.analysis.retentionRates.weekly.toFixed(1)}%`);
    }

    analyzeHistoricalPatterns() {
        console.log('\\n📈 HISTORICAL PATTERN ANALYSIS');

        // Analyze job history to understand node activity patterns
        const jobs = this.db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC LIMIT 1000').all();
        
        this.analysis.jobHistory = {
            total: jobs.length,
            completed: jobs.filter(j => j.status === 'completed').length,
            failed: jobs.filter(j => j.status === 'failed').length,
            pending: jobs.filter(j => j.status === 'pending').length
        };

        console.log(`   Recent jobs analyzed: ${this.analysis.jobHistory.total}`);
        console.log(`   Completed: ${this.analysis.jobHistory.completed}`);
        console.log(`   Failed: ${this.analysis.jobHistory.failed}`);
        console.log(`   Pending: ${this.analysis.jobHistory.pending}`);

        if (jobs.length === 0) {
            console.log('⚠️  No job history found - network appears unused');
            this.analysis.networkActivity = 'UNUSED';
        } else {
            // Calculate success rate
            const totalProcessed = this.analysis.jobHistory.completed + this.analysis.jobHistory.failed;
            this.analysis.successRate = totalProcessed > 0 ? (this.analysis.jobHistory.completed / totalProcessed * 100) : 0;
            console.log(`   Success rate: ${this.analysis.successRate.toFixed(1)}%`);
            
            this.analysis.networkActivity = this.analysis.successRate > 80 ? 'HEALTHY' : 
                                          this.analysis.successRate > 50 ? 'DEGRADED' : 'FAILING';
        }

        // Analyze node performance correlation
        const nodeJobs = this.db.prepare(`
            SELECT claimedBy as nodeId, COUNT(*) as jobCount, 
                   SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
            FROM jobs 
            WHERE claimedBy IS NOT NULL 
            GROUP BY claimedBy
        `).all();

        this.analysis.nodePerformance = nodeJobs.map(nj => ({
            nodeId: nj.nodeId,
            jobCount: nj.jobCount,
            successRate: nj.jobCount > 0 ? (nj.completed / nj.jobCount * 100) : 0
        }));

        if (this.analysis.nodePerformance.length > 0) {
            console.log(`\\n⚡ TOP PERFORMING NODES:`);
            this.analysis.nodePerformance
                .sort((a, b) => b.successRate - a.successRate)
                .slice(0, 5)
                .forEach(node => {
                    console.log(`   - ${node.nodeId.substring(0, 8)}: ${node.successRate.toFixed(1)}% (${node.jobCount} jobs)`);
                });
        }
    }

    investigateDisconnectionCauses() {
        console.log('\\n🔍 DISCONNECTION ROOT CAUSE INVESTIGATION');

        // Check for common disconnection patterns
        this.analysis.disconnectionPatterns = {
            simultaneousDisconnects: 0,
            gradualChurn: 0,
            performanceRelated: 0,
            timeBasedPatterns: {}
        };

        // Analyze if nodes disconnected around the same time (infrastructure issues)
        const nodes = this.db.prepare('SELECT * FROM nodes ORDER BY lastHeartbeat DESC').all();
        
        if (nodes.length > 1) {
            const heartbeatTimes = nodes.map(n => n.lastHeartbeat).sort((a, b) => b - a);
            const timeSpread = heartbeatTimes[0] - heartbeatTimes[heartbeatTimes.length - 1];
            
            if (timeSpread < 10 * 60 * 1000) { // All disconnected within 10 minutes
                this.analysis.disconnectionPatterns.simultaneousDisconnects = nodes.length;
                console.log(`   ⚠️  SIMULTANEOUS DISCONNECT: ${nodes.length} nodes disconnected within 10min`);
                console.log('      Possible causes: Server restart, network issues, infrastructure problems');
            }
        }

        // Check for performance-related disconnections
        const lowPerformers = this.analysis.nodePerformance.filter(n => n.successRate < 50);
        this.analysis.disconnectionPatterns.performanceRelated = lowPerformers.length;
        
        if (lowPerformers.length > 0) {
            console.log(`   📉 PERFORMANCE-RELATED: ${lowPerformers.length} nodes with <50% success rate`);
            lowPerformers.forEach(node => {
                console.log(`      - ${node.nodeId.substring(0, 8)}: ${node.successRate.toFixed(1)}% success`);
            });
        }

        // Time-based pattern analysis
        const hoursOfDay = {};
        nodes.forEach(node => {
            const hour = new Date(node.lastHeartbeat).getHours();
            hoursOfDay[hour] = (hoursOfDay[hour] || 0) + 1;
        });

        this.analysis.disconnectionPatterns.timeBasedPatterns = hoursOfDay;
        
        if (Object.keys(hoursOfDay).length > 0) {
            const peakDisconnectHour = Object.keys(hoursOfDay).reduce((a, b) => 
                hoursOfDay[a] > hoursOfDay[b] ? a : b
            );
            console.log(`   🕐 TIME PATTERN: Most disconnections at hour ${peakDisconnectHour}:00 UTC`);
        } else {
            console.log(`   🕐 TIME PATTERN: No historical disconnection data available`);
        }
    }

    analyzeCapabilityRetention() {
        console.log('\\n🛠️  CAPABILITY RETENTION ANALYSIS');

        const nodes = this.db.prepare('SELECT * FROM nodes').all();
        const capabilityStats = {};
        let totalCapabilities = 0;

        nodes.forEach(node => {
            try {
                const capabilities = JSON.parse(node.capabilities || '[]');
                capabilities.forEach(cap => {
                    if (!capabilityStats[cap]) {
                        capabilityStats[cap] = { total: 0, active: 0, recent: 0 };
                    }
                    capabilityStats[cap].total++;
                    totalCapabilities++;
                    
                    const timeAgo = this.now - node.lastHeartbeat;
                    if (timeAgo < 5 * 60 * 1000) {
                        capabilityStats[cap].active++;
                    } else if (timeAgo < 60 * 60 * 1000) {
                        capabilityStats[cap].recent++;
                    }
                });
            } catch (e) {
                // Invalid JSON capabilities
            }
        });

        this.analysis.capabilityRetention = capabilityStats;

        console.log('   Capability availability:');
        Object.entries(capabilityStats).forEach(([cap, stats]) => {
            const activeRate = stats.total > 0 ? (stats.active / stats.total * 100) : 0;
            console.log(`   - ${cap}: ${stats.active}/${stats.total} active (${activeRate.toFixed(1)}%)`);
        });

        if (totalCapabilities === 0) {
            console.log('   ⚠️  No capabilities detected in network');
            this.analysis.networkCapability = 'ZERO';
        }
    }

    generateRetentionInsights() {
        console.log('\\n💡 RETENTION INSIGHTS & DIAGNOSIS');

        this.analysis.insights = [];

        // Critical alerts
        if (this.analysis.currentState.active === 0) {
            this.analysis.insights.push({
                type: 'CRITICAL',
                issue: 'Zero active nodes',
                impact: 'Network cannot process any jobs',
                priority: 1
            });
        }

        if (this.analysis.retentionRates.daily < 25) {
            this.analysis.insights.push({
                type: 'CRITICAL', 
                issue: 'Very low daily retention (<25%)',
                impact: 'Unsustainable network operation',
                priority: 1
            });
        }

        // Warning level issues
        if (this.analysis.successRate < 70) {
            this.analysis.insights.push({
                type: 'WARNING',
                issue: `Low job success rate (${this.analysis.successRate.toFixed(1)}%)`,
                impact: 'Poor customer experience driving churn',
                priority: 2
            });
        }

        if (this.analysis.disconnectionPatterns.simultaneousDisconnects > 2) {
            this.analysis.insights.push({
                type: 'WARNING',
                issue: 'Simultaneous disconnections detected',
                impact: 'Infrastructure reliability concerns',
                priority: 2
            });
        }

        // Info level observations
        if (Object.keys(this.analysis.capabilityRetention).length < 3) {
            this.analysis.insights.push({
                type: 'INFO',
                issue: 'Limited capability diversity',
                impact: 'Reduced network utility and earning potential',
                priority: 3
            });
        }

        this.analysis.insights.forEach(insight => {
            const emoji = insight.type === 'CRITICAL' ? '🚨' : insight.type === 'WARNING' ? '⚠️' : 'ℹ️';
            console.log(`   ${emoji} ${insight.issue}`);
            console.log(`      Impact: ${insight.impact}`);
        });
    }

    createActionableRecommendations() {
        console.log('\\n🎯 ACTIONABLE RECOMMENDATIONS');

        this.analysis.recommendations = [];

        // Critical actions
        if (this.analysis.currentState.active === 0) {
            this.analysis.recommendations.push({
                action: 'Emergency node recruitment',
                steps: [
                    'Contact previous operators via outreach campaign',
                    'Offer incentives for immediate reconnection',
                    'Debug infrastructure issues preventing connections',
                    'Deploy monitoring to detect future mass disconnections'
                ],
                priority: 1,
                timeframe: 'IMMEDIATE'
            });
        }

        if (this.analysis.disconnectionPatterns.simultaneousDisconnects > 0) {
            this.analysis.recommendations.push({
                action: 'Infrastructure stability investigation',
                steps: [
                    'Check server logs around disconnection time',
                    'Implement graceful shutdown handling',
                    'Add connection persistence mechanisms',
                    'Set up proactive monitoring alerts'
                ],
                priority: 1,
                timeframe: '24 hours'
            });
        }

        // Performance improvements
        if (this.analysis.successRate < 80) {
            this.analysis.recommendations.push({
                action: 'Job success rate improvement',
                steps: [
                    'Identify and quarantine problematic nodes',
                    'Improve error handling and retries',
                    'Add job validation and pre-checks',
                    'Implement performance-based routing'
                ],
                priority: 2,
                timeframe: '1 week'
            });
        }

        // Long-term retention strategies
        this.analysis.recommendations.push({
            action: 'Node retention program',
            steps: [
                'Create operator dashboard with earnings tracking',
                'Implement loyalty rewards for consistent uptime',
                'Add automated health checks and alerts',
                'Build community features for operator engagement'
            ],
            priority: 3,
            timeframe: '1 month'
        });

        this.analysis.recommendations.forEach((rec, i) => {
            console.log(`\\n   ${i + 1}. ${rec.action} (${rec.timeframe})`);
            rec.steps.forEach(step => {
                console.log(`      • ${step}`);
            });
        });
    }

    saveReport() {
        const timestamp = new Date().toISOString().split('T')[0];
        const reportPath = `./reports/node-retention-investigation-${timestamp}.json`;
        
        // Ensure reports directory exists
        if (!fs.existsSync('./reports')) {
            fs.mkdirSync('./reports');
        }

        const report = {
            timestamp: new Date().toISOString(),
            analysis: this.analysis,
            summary: {
                totalNodes: this.analysis.currentState.total,
                activeNodes: this.analysis.currentState.active,
                retentionRate: this.analysis.retentionRates.daily,
                networkHealth: this.analysis.networkActivity,
                criticalIssues: this.analysis.insights.filter(i => i.type === 'CRITICAL').length,
                recommendations: this.analysis.recommendations.length
            }
        };

        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\\n📄 INVESTIGATION REPORT SAVED: ${reportPath}`);
    }
}

// CLI execution
if (require.main === module) {
    const investigator = new NodeRetentionInvestigator();
    investigator.investigate().then(analysis => {
        console.log('\\n✅ Investigation complete!');
        console.log(`   Analyzed ${analysis.currentState.total} nodes`);
        console.log(`   Found ${analysis.insights.filter(i => i.type === 'CRITICAL').length} critical issues`);
        console.log(`   Generated ${analysis.recommendations.length} recommendations`);
        process.exit(0);
    }).catch(error => {
        console.error('❌ Investigation failed:', error.message);
        process.exit(1);
    });
}

module.exports = NodeRetentionInvestigator;