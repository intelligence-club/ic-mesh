#!/usr/bin/env node

/**
 * Node Reliability and Performance Tracker
 * 
 * Monitors node health, tracks performance metrics, and predicts reliability issues
 * Addresses node retention problems and improves network stability
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class NodeReliabilityTracker {
    constructor(dbPath = './mesh.db') {
        try {
            this.db = new Database(dbPath, { readonly: false });
            this.setupReliabilitySchema();
            this.loadReliabilityMetrics();
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            process.exit(1);
        }
    }

    setupReliabilitySchema() {
        // Create node_reliability_metrics table if it doesn't exist
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS node_reliability_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nodeId TEXT NOT NULL,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                uptime_minutes REAL,
                success_rate REAL,
                avg_response_time REAL,
                jobs_completed INTEGER DEFAULT 0,
                jobs_failed INTEGER DEFAULT 0,
                error_patterns TEXT,
                reliability_score REAL,
                trend_direction TEXT, -- 'improving', 'declining', 'stable'
                prediction_confidence REAL,
                recommended_actions TEXT,
                FOREIGN KEY (nodeId) REFERENCES nodes(nodeId)
            )
        `);

        // Create indexes for better performance
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reliability_node_time ON node_reliability_metrics(nodeId, recorded_at)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reliability_score ON node_reliability_metrics(reliability_score DESC)`);
    }

    loadReliabilityMetrics() {
        // Reliability scoring weights
        this.scoringWeights = {
            uptime: 0.25,           // 25% - Consistent availability
            successRate: 0.30,     // 30% - Job completion success
            responseTime: 0.20,    // 20% - Performance speed
            stability: 0.15,       // 15% - Consistent performance
            longevity: 0.10        // 10% - Long-term reliability
        };

        // Performance thresholds
        this.thresholds = {
            excellent: { uptime: 0.98, successRate: 0.95, responseTime: 30 },
            good: { uptime: 0.90, successRate: 0.85, responseTime: 60 },
            fair: { uptime: 0.80, successRate: 0.70, responseTime: 120 },
            poor: { uptime: 0.60, successRate: 0.50, responseTime: 300 }
        };

        // Error pattern analysis
        this.errorPatterns = {
            'connection_issues': {
                patterns: [/timeout/i, /connection.*refused/i, /network.*error/i],
                severity: 'high',
                category: 'connectivity'
            },
            'resource_exhaustion': {
                patterns: [/memory.*error/i, /cpu.*limit/i, /disk.*full/i],
                severity: 'critical',
                category: 'resources'
            },
            'handler_errors': {
                patterns: [/handler.*not.*found/i, /missing.*handler/i, /invalid.*handler/i],
                severity: 'medium',
                category: 'configuration'
            },
            'processing_failures': {
                patterns: [/transcription.*failed/i, /inference.*error/i, /processing.*timeout/i],
                severity: 'medium',
                category: 'processing'
            },
            'authentication_issues': {
                patterns: [/auth.*failed/i, /invalid.*token/i, /permission.*denied/i],
                severity: 'high',
                category: 'security'
            }
        };

        // Trend prediction models
        this.trendModels = {
            declining: {
                indicators: ['decreasing_success_rate', 'increasing_response_time', 'frequent_disconnections'],
                actions: ['investigate_resources', 'check_configuration', 'consider_replacement']
            },
            unstable: {
                indicators: ['high_variability', 'intermittent_errors', 'inconsistent_performance'],
                actions: ['stabilize_environment', 'update_handlers', 'monitor_closely']
            },
            improving: {
                indicators: ['increasing_success_rate', 'stable_uptime', 'decreasing_errors'],
                actions: ['maintain_current_setup', 'consider_increased_load']
            }
        };
    }

    async analyzeAllNodes() {
        console.log('🔍 Analyzing Node Reliability Across Network...\n');

        const nodes = this.db.prepare(`
            SELECT nodeId, name, cpuCores, ramMB, capabilities, 
                   createdAt, lastHeartbeat,
                   (julianday('now') - julianday(lastHeartbeat)) * 24 * 60 as minutes_offline
            FROM nodes 
            ORDER BY lastHeartbeat DESC
        `).all();

        console.log(`📊 Network Overview: ${nodes.length} total nodes registered`);
        
        const reliabilityResults = [];
        
        for (const node of nodes) {
            const analysis = await this.analyzeNodeReliability(node);
            reliabilityResults.push(analysis);
            
            // Record metrics in database
            await this.recordReliabilityMetrics(node.nodeId, analysis);
        }

        // Generate network summary
        this.generateNetworkReliabilitySummary(reliabilityResults);
        
        return reliabilityResults;
    }

    async analyzeNodeReliability(node) {
        const nodeId = node.nodeId;
        const timeWindow = 7; // days
        
        // Get job performance data
        const jobStats = this.db.prepare(`
            SELECT 
                COUNT(*) as total_jobs,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_jobs,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_jobs,
                AVG(CASE WHEN status = 'completed' THEN processingTime ELSE NULL END) as avg_processing_time,
                MIN(createdAt) as first_job,
                MAX(createdAt) as last_job
            FROM jobs 
            WHERE nodeId = ? AND createdAt > datetime('now', '-${timeWindow} days')
        `).get(nodeId);

        // Calculate uptime and availability
        const uptimeStats = this.calculateUptimeMetrics(node);
        
        // Analyze error patterns
        const errorAnalysis = await this.analyzeErrorPatterns(nodeId, timeWindow);
        
        // Calculate reliability score
        const reliabilityScore = this.calculateReliabilityScore({
            uptime: uptimeStats.uptimeRatio,
            successRate: jobStats.total_jobs > 0 ? jobStats.completed_jobs / jobStats.total_jobs : 0,
            responseTime: jobStats.avg_processing_time || 0,
            errorFrequency: errorAnalysis.totalErrors,
            stability: uptimeStats.stabilityScore
        });

        // Determine trend and predictions
        const trendAnalysis = await this.analyzeTrends(nodeId);
        
        // Generate recommendations
        const recommendations = this.generateRecommendations({
            node,
            jobStats,
            uptimeStats,
            errorAnalysis,
            reliabilityScore,
            trendAnalysis
        });

        return {
            nodeId,
            name: node.name || 'Unnamed',
            status: uptimeStats.currentStatus,
            reliabilityScore,
            uptime: uptimeStats,
            performance: {
                totalJobs: jobStats.total_jobs,
                successRate: jobStats.total_jobs > 0 ? jobStats.completed_jobs / jobStats.total_jobs : 0,
                avgProcessingTime: jobStats.avg_processing_time || 0,
                failureRate: jobStats.total_jobs > 0 ? jobStats.failed_jobs / jobStats.total_jobs : 0
            },
            errorAnalysis,
            trendAnalysis,
            recommendations
        };
    }

    calculateUptimeMetrics(node) {
        const now = new Date();
        const lastHeartbeat = new Date(node.lastHeartbeat);
        const minutesOffline = (now - lastHeartbeat) / (1000 * 60);
        
        // Get heartbeat history for better uptime calculation
        const heartbeatHistory = this.db.prepare(`
            SELECT lastHeartbeat,
                   LAG(lastHeartbeat) OVER (ORDER BY lastHeartbeat) as prev_heartbeat
            FROM (
                SELECT DISTINCT lastHeartbeat 
                FROM node_reliability_metrics 
                WHERE nodeId = ? 
                ORDER BY recorded_at DESC 
                LIMIT 100
            )
            ORDER BY lastHeartbeat
        `).all(node.nodeId);

        let totalUptime = 0;
        let totalTime = 0;
        let disconnections = 0;
        
        if (heartbeatHistory.length > 1) {
            for (let i = 1; i < heartbeatHistory.length; i++) {
                const current = new Date(heartbeatHistory[i].lastHeartbeat);
                const previous = new Date(heartbeatHistory[i].prev_heartbeat);
                const gap = (current - previous) / (1000 * 60); // minutes
                
                totalTime += gap;
                
                if (gap <= 10) { // Consider online if gap < 10 minutes
                    totalUptime += gap;
                } else {
                    disconnections++;
                }
            }
        }

        const uptimeRatio = totalTime > 0 ? totalUptime / totalTime : 0;
        const stabilityScore = disconnections > 0 ? Math.max(0, 1 - (disconnections / heartbeatHistory.length)) : 1;
        
        return {
            currentStatus: minutesOffline < 10 ? 'online' : 'offline',
            minutesOffline: Math.round(minutesOffline),
            uptimeRatio,
            stabilityScore,
            disconnections,
            totalMeasurements: heartbeatHistory.length
        };
    }

    async analyzeErrorPatterns(nodeId, timeWindow) {
        // Get failed jobs with error details
        const failedJobs = this.db.prepare(`
            SELECT errorMessage, type, createdAt, processingTime
            FROM jobs 
            WHERE nodeId = ? AND status = 'failed' 
                AND createdAt > datetime('now', '-${timeWindow} days')
            ORDER BY createdAt DESC
        `).all(nodeId);

        const errorAnalysis = {
            totalErrors: failedJobs.length,
            errorsByPattern: {},
            errorsByJobType: {},
            recentErrorTrend: 'stable'
        };

        // Categorize errors by pattern
        failedJobs.forEach(job => {
            const errorMsg = job.errorMessage || '';
            
            // Count by job type
            errorAnalysis.errorsByJobType[job.type] = (errorAnalysis.errorsByJobType[job.type] || 0) + 1;
            
            // Pattern matching
            let patternFound = false;
            for (const [patternName, patternInfo] of Object.entries(this.errorPatterns)) {
                for (const regex of patternInfo.patterns) {
                    if (regex.test(errorMsg)) {
                        errorAnalysis.errorsByPattern[patternName] = (errorAnalysis.errorsByPattern[patternName] || 0) + 1;
                        patternFound = true;
                        break;
                    }
                }
                if (patternFound) break;
            }
            
            if (!patternFound) {
                errorAnalysis.errorsByPattern['unknown'] = (errorAnalysis.errorsByPattern['unknown'] || 0) + 1;
            }
        });

        // Analyze error trend (last 3 days vs previous 4 days)
        const recentErrors = failedJobs.filter(job => {
            const jobDate = new Date(job.createdAt);
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
            return jobDate >= threeDaysAgo;
        }).length;

        const olderErrors = failedJobs.length - recentErrors;
        
        if (recentErrors > olderErrors * 1.5) {
            errorAnalysis.recentErrorTrend = 'increasing';
        } else if (recentErrors < olderErrors * 0.5) {
            errorAnalysis.recentErrorTrend = 'decreasing';
        }

        return errorAnalysis;
    }

    calculateReliabilityScore(metrics) {
        // Normalize metrics to 0-1 scale
        const normalizedUptime = Math.min(1, metrics.uptime);
        const normalizedSuccessRate = Math.min(1, metrics.successRate);
        
        // Response time score (lower is better, normalize to 0-1)
        const normalizedResponseTime = metrics.responseTime > 0 
            ? Math.max(0, 1 - (metrics.responseTime / 300)) // 300s = 0 score
            : 1;
        
        // Stability score based on consistent performance
        const stabilityScore = metrics.stability || 0;
        
        // Longevity bonus for nodes with longer track record
        const longevityScore = Math.min(1, (metrics.totalJobs || 0) / 100); // 100 jobs = full longevity score
        
        // Weighted calculation
        const score = 
            (normalizedUptime * this.scoringWeights.uptime) +
            (normalizedSuccessRate * this.scoringWeights.successRate) +
            (normalizedResponseTime * this.scoringWeights.responseTime) +
            (stabilityScore * this.scoringWeights.stability) +
            (longevityScore * this.scoringWeights.longevity);
            
        return Math.min(100, Math.max(0, score * 100)); // Convert to 0-100 scale
    }

    async analyzeTrends(nodeId) {
        // Get historical reliability metrics
        const historicalMetrics = this.db.prepare(`
            SELECT reliability_score, recorded_at, success_rate, avg_response_time
            FROM node_reliability_metrics 
            WHERE nodeId = ? 
            ORDER BY recorded_at DESC 
            LIMIT 30
        `).all(nodeId);

        if (historicalMetrics.length < 3) {
            return {
                direction: 'insufficient_data',
                confidence: 0,
                indicators: ['not_enough_history']
            };
        }

        // Calculate trends
        const recent = historicalMetrics.slice(0, 10);
        const older = historicalMetrics.slice(10, 20);
        
        const recentAvgScore = recent.reduce((sum, m) => sum + (m.reliability_score || 0), 0) / recent.length;
        const olderAvgScore = older.length > 0 
            ? older.reduce((sum, m) => sum + (m.reliability_score || 0), 0) / older.length
            : recentAvgScore;
        
        const scoreTrend = recentAvgScore - olderAvgScore;
        const confidence = Math.min(1, historicalMetrics.length / 20); // Higher confidence with more data
        
        // Determine trend direction
        let direction = 'stable';
        const indicators = [];
        
        if (scoreTrend > 5) {
            direction = 'improving';
            indicators.push('increasing_reliability_score');
        } else if (scoreTrend < -5) {
            direction = 'declining';
            indicators.push('decreasing_reliability_score');
        }
        
        // Additional indicators
        const recentSuccessRate = recent.reduce((sum, m) => sum + (m.success_rate || 0), 0) / recent.length;
        const olderSuccessRate = older.length > 0 
            ? older.reduce((sum, m) => sum + (m.success_rate || 0), 0) / older.length
            : recentSuccessRate;
            
        if (recentSuccessRate < olderSuccessRate - 0.1) {
            indicators.push('decreasing_success_rate');
        } else if (recentSuccessRate > olderSuccessRate + 0.1) {
            indicators.push('increasing_success_rate');
        }

        return {
            direction,
            confidence,
            indicators,
            scoreTrend: scoreTrend.toFixed(1),
            historicalDataPoints: historicalMetrics.length
        };
    }

    generateRecommendations(analysisData) {
        const recommendations = [];
        const { node, performance, errorAnalysis, reliabilityScore, trendAnalysis } = analysisData;
        
        // Score-based recommendations
        if (reliabilityScore < 30) {
            recommendations.push({
                priority: 'critical',
                category: 'reliability',
                action: 'Consider replacing or extensively troubleshooting this node',
                reason: `Very low reliability score (${reliabilityScore.toFixed(1)}/100)`
            });
        } else if (reliabilityScore < 60) {
            recommendations.push({
                priority: 'high',
                category: 'reliability',
                action: 'Investigate and address reliability issues',
                reason: `Below-average reliability score (${reliabilityScore.toFixed(1)}/100)`
            });
        }

        // Performance-based recommendations
        if (performance.successRate < 0.7 && performance.totalJobs > 10) {
            recommendations.push({
                priority: 'high',
                category: 'performance',
                action: 'Investigate job failure causes and improve success rate',
                reason: `Low success rate (${(performance.successRate * 100).toFixed(1)}%)`
            });
        }

        if (performance.avgProcessingTime > 120) {
            recommendations.push({
                priority: 'medium',
                category: 'performance',
                action: 'Optimize processing performance or allocate more resources',
                reason: `Slow processing time (${performance.avgProcessingTime.toFixed(1)}s average)`
            });
        }

        // Error pattern recommendations
        Object.entries(errorAnalysis.errorsByPattern).forEach(([pattern, count]) => {
            if (count > 5) {
                const patternInfo = this.errorPatterns[pattern];
                if (patternInfo) {
                    recommendations.push({
                        priority: patternInfo.severity === 'critical' ? 'critical' : 
                                 patternInfo.severity === 'high' ? 'high' : 'medium',
                        category: 'errors',
                        action: this.getPatternRecommendation(pattern),
                        reason: `Recurring ${pattern.replace(/_/g, ' ')} errors (${count} instances)`
                    });
                }
            }
        });

        // Trend-based recommendations
        if (trendAnalysis.direction === 'declining' && trendAnalysis.confidence > 0.5) {
            recommendations.push({
                priority: 'high',
                category: 'trend',
                action: 'Proactive maintenance required - declining performance detected',
                reason: `Reliability trending downward (${trendAnalysis.confidence * 100}% confidence)`
            });
        }

        // Sort by priority
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    }

    getPatternRecommendation(pattern) {
        const recommendations = {
            'connection_issues': 'Check network connectivity, firewall settings, and DNS resolution',
            'resource_exhaustion': 'Increase allocated memory/CPU or optimize resource usage',
            'handler_errors': 'Update node configuration and verify handler installations',
            'processing_failures': 'Check handler compatibility and processing capabilities',
            'authentication_issues': 'Verify API keys, certificates, and authentication configuration'
        };
        
        return recommendations[pattern] || 'Investigate error pattern and implement appropriate fixes';
    }

    async recordReliabilityMetrics(nodeId, analysis) {
        const stmt = this.db.prepare(`
            INSERT INTO node_reliability_metrics (
                nodeId, uptime_minutes, success_rate, avg_response_time, 
                jobs_completed, jobs_failed, error_patterns, reliability_score, 
                trend_direction, prediction_confidence, recommended_actions
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        try {
            stmt.run(
                nodeId,
                analysis.uptime.uptimeRatio * 1440, // Convert to minutes per day
                analysis.performance.successRate,
                analysis.performance.avgProcessingTime,
                analysis.performance.totalJobs - (analysis.performance.totalJobs * analysis.performance.failureRate),
                analysis.performance.totalJobs * analysis.performance.failureRate,
                JSON.stringify(analysis.errorAnalysis.errorsByPattern),
                analysis.reliabilityScore,
                analysis.trendAnalysis.direction,
                analysis.trendAnalysis.confidence,
                JSON.stringify(analysis.recommendations.slice(0, 3)) // Top 3 recommendations
            );
        } catch (error) {
            console.warn(`⚠️ Could not record metrics for node ${nodeId}:`, error.message);
        }
    }

    generateNetworkReliabilitySummary(results) {
        console.log('\n📊 Network Reliability Summary');
        console.log('==============================\n');

        const online = results.filter(r => r.status === 'online');
        const offline = results.filter(r => r.status === 'offline');
        
        console.log(`🌐 Network Status: ${online.length}/${results.length} nodes online (${((online.length/results.length)*100).toFixed(1)}%)`);
        
        if (online.length > 0) {
            const avgReliability = online.reduce((sum, r) => sum + r.reliabilityScore, 0) / online.length;
            const avgSuccessRate = online.reduce((sum, r) => sum + r.performance.successRate, 0) / online.length;
            
            console.log(`📈 Online Nodes Average: ${avgReliability.toFixed(1)}/100 reliability, ${(avgSuccessRate * 100).toFixed(1)}% success rate`);
            
            // Top performers
            const topPerformers = online.sort((a, b) => b.reliabilityScore - a.reliabilityScore).slice(0, 3);
            console.log('\n🏆 Top Performing Nodes:');
            topPerformers.forEach((node, index) => {
                console.log(`${index + 1}. ${node.name} (${node.nodeId.substring(0, 8)}): ${node.reliabilityScore.toFixed(1)}/100`);
            });
            
            // Nodes needing attention
            const needsAttention = results.filter(r => r.reliabilityScore < 60 || r.recommendations.some(rec => rec.priority === 'critical'));
            if (needsAttention.length > 0) {
                console.log('\n⚠️ Nodes Requiring Attention:');
                needsAttention.forEach(node => {
                    const criticalIssues = node.recommendations.filter(rec => rec.priority === 'critical');
                    console.log(`• ${node.name}: ${node.reliabilityScore.toFixed(1)}/100 reliability`);
                    if (criticalIssues.length > 0) {
                        console.log(`  Critical: ${criticalIssues[0].action}`);
                    }
                });
            }
        }

        if (offline.length > 0) {
            console.log(`\n🔴 Offline Nodes: ${offline.length}`);
            offline.slice(0, 5).forEach(node => {
                console.log(`• ${node.name}: offline for ${node.uptime.minutesOffline} minutes`);
            });
        }

        // Network health score
        const networkHealthScore = results.length > 0 
            ? results.reduce((sum, r) => sum + r.reliabilityScore, 0) / results.length
            : 0;
            
        const healthEmoji = networkHealthScore >= 80 ? '🟢' : 
                           networkHealthScore >= 60 ? '🟡' : '🔴';
        
        console.log(`\n${healthEmoji} Overall Network Health: ${networkHealthScore.toFixed(1)}/100`);
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// CLI Interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0] || 'analyze';
    const nodeId = args[1];
    
    const tracker = new NodeReliabilityTracker();

    async function main() {
        try {
            switch (command) {
                case 'analyze':
                    if (nodeId) {
                        console.log(`🔍 Analyzing specific node: ${nodeId}\n`);
                        const node = tracker.db.prepare('SELECT * FROM nodes WHERE nodeId = ?').get(nodeId);
                        if (!node) {
                            console.error(`❌ Node not found: ${nodeId}`);
                            process.exit(1);
                        }
                        const analysis = await tracker.analyzeNodeReliability(node);
                        console.log(`📊 Analysis for ${analysis.name}:`);
                        console.log(`• Reliability Score: ${analysis.reliabilityScore.toFixed(1)}/100`);
                        console.log(`• Status: ${analysis.status}`);
                        console.log(`• Success Rate: ${(analysis.performance.successRate * 100).toFixed(1)}%`);
                        console.log(`• Jobs Completed: ${analysis.performance.totalJobs}`);
                        if (analysis.recommendations.length > 0) {
                            console.log(`\n💡 Recommendations:`);
                            analysis.recommendations.slice(0, 3).forEach((rec, i) => {
                                console.log(`${i + 1}. [${rec.priority.toUpperCase()}] ${rec.action}`);
                            });
                        }
                    } else {
                        await tracker.analyzeAllNodes();
                    }
                    break;
                    
                case '--help':
                case 'help':
                    console.log(`
🔍 Node Reliability and Performance Tracker

Usage:
  node node-reliability-tracker.js [command] [nodeId]

Commands:
  analyze [nodeId]  Analyze all nodes or specific node (default)
  help              Show this help message

Examples:
  node node-reliability-tracker.js analyze           # Analyze all nodes
  node node-reliability-tracker.js analyze abc123    # Analyze specific node

Features:
  ✅ Comprehensive reliability scoring (0-100 scale)
  ✅ Uptime and availability tracking
  ✅ Performance trend analysis
  ✅ Error pattern recognition and categorization
  ✅ Predictive reliability modeling
  ✅ Automated recommendations for improvement
  ✅ Network health summary and insights
  ✅ Historical metrics tracking
                    `);
                    break;
                    
                default:
                    console.error(`❌ Unknown command: ${command}`);
                    console.log('Use "help" to see available commands');
                    process.exit(1);
            }
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        } finally {
            tracker.close();
        }
    }

    main();
}

module.exports = NodeReliabilityTracker;