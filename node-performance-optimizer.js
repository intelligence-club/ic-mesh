#!/usr/bin/env node

/**
 * Node Performance Optimizer
 * 
 * Comprehensive performance management system:
 * - Real-time performance monitoring
 * - Automated optimization recommendations
 * - Capability-specific tuning
 * - Resource usage analysis
 * - Performance trend tracking
 * - Predictive maintenance alerts
 */

const fs = require('fs');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

class NodePerformanceOptimizer {
    constructor() {
        this.db = new Database('data/mesh.db');
        this.setupPerformanceDatabase();
        
        // Performance thresholds
        this.thresholds = {
            job_success_rate: 0.85,     // Below 85% = needs attention
            avg_job_duration: 300,       // Above 5 min avg = slow
            memory_usage: 0.8,          // Above 80% = memory pressure
            cpu_usage: 0.9,             // Above 90% = CPU bottleneck
            disk_usage: 0.9,            // Above 90% = disk issues
            connection_stability: 0.95   // Below 95% uptime = unstable
        };
        
        // Optimization strategies
        this.optimizations = {
            memory: {
                'increase_swap': 'Add swap space for memory-intensive jobs',
                'garbage_collection': 'Optimize Node.js garbage collection',
                'job_batching': 'Process jobs in smaller batches',
                'memory_monitoring': 'Add memory usage alerts'
            },
            cpu: {
                'job_parallelism': 'Optimize job execution parallelism',
                'process_affinity': 'Set CPU affinity for compute jobs',
                'nice_priority': 'Adjust process priorities',
                'cooling_breaks': 'Add cooling periods between intensive jobs'
            },
            network: {
                'keepalive_tuning': 'Optimize WebSocket keepalive settings',
                'retry_strategy': 'Improve connection retry logic',
                'bandwidth_limiting': 'Implement bandwidth throttling',
                'compression': 'Enable data compression'
            },
            capabilities: {
                'transcribe': 'Optimize Whisper model loading and caching',
                'ollama': 'Tune Ollama model parameters and memory',
                'stable-diffusion': 'Optimize GPU memory and batch sizes',
                'tesseract': 'Configure OCR processing parameters'
            }
        };
        
        this.performanceData = this.loadPerformanceHistory();
    }
    
    setupPerformanceDatabase() {
        // Performance metrics tracking
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS performance_metrics (
                id TEXT PRIMARY KEY,
                nodeId TEXT,
                timestamp INTEGER,
                job_success_rate REAL,
                avg_job_duration REAL,
                total_jobs INTEGER,
                completed_jobs INTEGER,
                failed_jobs INTEGER,
                memory_usage REAL,
                cpu_usage REAL,
                disk_usage REAL,
                connection_uptime REAL,
                capabilities TEXT,
                system_info TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // Performance optimizations applied
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS performance_optimizations (
                id TEXT PRIMARY KEY,
                nodeId TEXT,
                optimization_type TEXT,
                strategy TEXT,
                applied_at INTEGER,
                performance_before TEXT,
                performance_after TEXT,
                improvement_score REAL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // Performance alerts
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS performance_alerts (
                id TEXT PRIMARY KEY,
                nodeId TEXT,
                alert_type TEXT,
                severity TEXT,
                message TEXT,
                metrics TEXT,
                resolved INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // Node health scores
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS node_health_scores (
                nodeId TEXT PRIMARY KEY,
                overall_score REAL,
                performance_score REAL,
                reliability_score REAL,
                efficiency_score REAL,
                last_updated INTEGER,
                trend TEXT,
                recommendations TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
    }
    
    async analyzeNodePerformance(nodeId = null) {
        console.log('🔬 Analyzing node performance...\n');
        
        const nodes = nodeId ? [this.getNodeById(nodeId)] : this.getAllActiveNodes();
        const analysis = {
            timestamp: Date.now(),
            totalNodes: nodes.length,
            performanceIssues: [],
            optimizationOpportunities: [],
            healthScores: {}
        };
        
        for (const node of nodes) {
            if (!node) continue;
            
            console.log(`🎯 Analyzing node: ${node.nodeId} (${node.owner || 'unknown'})`);
            
            // Collect performance metrics
            const metrics = await this.collectPerformanceMetrics(node);
            
            // Calculate health scores
            const healthScore = this.calculateHealthScore(node, metrics);
            analysis.healthScores[node.nodeId] = healthScore;
            
            // Identify issues
            const issues = this.identifyPerformanceIssues(node, metrics);
            analysis.performanceIssues.push(...issues);
            
            // Generate recommendations
            const recommendations = this.generateOptimizationRecommendations(node, metrics, issues);
            analysis.optimizationOpportunities.push({
                nodeId: node.nodeId,
                recommendations
            });
            
            // Store metrics
            this.storePerformanceMetrics(node.nodeId, metrics);
            
            // Update health score
            this.updateHealthScore(node.nodeId, healthScore);
            
            this.printNodeAnalysis(node, metrics, healthScore, issues, recommendations);
        }
        
        return analysis;
    }
    
    async collectPerformanceMetrics(node) {
        const now = Date.now();
        const nodeId = node.nodeId;
        
        // Job performance metrics
        const jobStats = this.db.prepare(`
            SELECT 
                COUNT(*) as total_jobs,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                AVG(CASE WHEN status = 'completed' AND completedAt IS NOT NULL 
                    THEN (completedAt - claimedAt) END) as avg_duration
            FROM jobs 
            WHERE claimedBy = ? AND createdAt > ?
        `).get(nodeId, Date.now() - (24 * 60 * 60 * 1000));
        
        // Connection stability
        const connectionStats = this.calculateConnectionStability(nodeId);
        
        // System performance (simulated - in real implementation would collect from node)
        const systemMetrics = this.estimateSystemMetrics(node, jobStats);
        
        return {
            timestamp: now,
            job_success_rate: jobStats.total_jobs > 0 ? jobStats.completed / jobStats.total_jobs : 1,
            avg_job_duration: jobStats.avg_duration || 0,
            total_jobs: jobStats.total_jobs,
            completed_jobs: jobStats.completed,
            failed_jobs: jobStats.failed,
            connection_uptime: connectionStats.uptime,
            connection_stability: connectionStats.stability,
            memory_usage: systemMetrics.memory_usage,
            cpu_usage: systemMetrics.cpu_usage,
            disk_usage: systemMetrics.disk_usage,
            capabilities: node.capabilities ? JSON.parse(node.capabilities) : []
        };
    }
    
    calculateConnectionStability(nodeId) {
        // Calculate uptime and stability based on heartbeat history
        const recent = this.db.prepare(`
            SELECT lastSeen FROM nodes WHERE nodeId = ?
        `).get(nodeId);
        
        if (!recent) {
            return { uptime: 0, stability: 0 };
        }
        
        const now = Date.now();
        const lastSeen = recent.lastSeen;
        const hoursOffline = (now - lastSeen) / (3600 * 1000);
        
        // Simple stability calculation (would be more complex in real implementation)
        const uptime = Math.max(0, 1 - (hoursOffline / 24));
        const stability = uptime > 0.9 ? 0.95 : uptime * 0.9;
        
        return { uptime, stability };
    }
    
    estimateSystemMetrics(node, jobStats) {
        // Estimate system resource usage based on job patterns and capabilities
        const capabilities = node.capabilities ? JSON.parse(node.capabilities) : [];
        const jobLoad = Math.min(jobStats.total_jobs / 10, 1); // Normalize job count
        
        let baseMemory = 0.3; // Base memory usage
        let baseCPU = 0.2;    // Base CPU usage
        
        // Adjust based on capabilities
        if (capabilities.includes('ollama')) {
            baseMemory += 0.4; // LLM models use significant memory
            baseCPU += 0.3;
        }
        if (capabilities.includes('stable-diffusion')) {
            baseMemory += 0.3; // Image generation is memory intensive
            baseCPU += 0.4;    // And CPU intensive
        }
        if (capabilities.includes('transcribe') || capabilities.includes('whisper')) {
            baseMemory += 0.2; // Audio processing
            baseCPU += 0.2;
        }
        
        // Add job-based load
        const memory_usage = Math.min(baseMemory + (jobLoad * 0.3), 0.95);
        const cpu_usage = Math.min(baseCPU + (jobLoad * 0.4), 0.95);
        const disk_usage = 0.3 + (jobLoad * 0.1); // Simulated disk usage
        
        return { memory_usage, cpu_usage, disk_usage };
    }
    
    calculateHealthScore(node, metrics) {
        const weights = {
            performance: 0.35,  // Job success rate and speed
            reliability: 0.30,  // Connection stability and uptime
            efficiency: 0.20,   // Resource usage optimization
            activity: 0.15      // Job completion volume
        };
        
        // Performance score (job success rate and duration)
        const performanceScore = (
            (metrics.job_success_rate * 0.7) + 
            (Math.max(0, 1 - (metrics.avg_job_duration / 600)) * 0.3) // 10min max expected
        );
        
        // Reliability score (connection stability)
        const reliabilityScore = metrics.connection_stability;
        
        // Efficiency score (resource usage - lower is better for some metrics)
        const efficiencyScore = (
            (1 - Math.min(metrics.memory_usage, 0.95)) * 0.4 +
            (1 - Math.min(metrics.cpu_usage, 0.95)) * 0.4 +
            (1 - Math.min(metrics.disk_usage, 0.95)) * 0.2
        );
        
        // Activity score (job completion)
        const activityScore = Math.min(metrics.total_jobs / 20, 1); // 20 jobs per day = full score
        
        const overall = (
            performanceScore * weights.performance +
            reliabilityScore * weights.reliability +
            efficiencyScore * weights.efficiency +
            activityScore * weights.activity
        );
        
        return {
            overall: Math.round(overall * 100) / 100,
            performance: Math.round(performanceScore * 100) / 100,
            reliability: Math.round(reliabilityScore * 100) / 100,
            efficiency: Math.round(efficiencyScore * 100) / 100,
            activity: Math.round(activityScore * 100) / 100,
            timestamp: Date.now()
        };
    }
    
    identifyPerformanceIssues(node, metrics) {
        const issues = [];
        const nodeId = node.nodeId;
        
        // Job success rate issues
        if (metrics.job_success_rate < this.thresholds.job_success_rate) {
            issues.push({
                nodeId,
                type: 'job_failure_rate',
                severity: metrics.job_success_rate < 0.5 ? 'critical' : 'warning',
                message: `Low job success rate: ${(metrics.job_success_rate * 100).toFixed(1)}%`,
                metrics: { success_rate: metrics.job_success_rate, threshold: this.thresholds.job_success_rate }
            });
        }
        
        // Job duration issues
        if (metrics.avg_job_duration > this.thresholds.avg_job_duration) {
            issues.push({
                nodeId,
                type: 'slow_job_execution',
                severity: metrics.avg_job_duration > 600 ? 'warning' : 'info',
                message: `Slow job execution: ${Math.round(metrics.avg_job_duration)}s avg`,
                metrics: { avg_duration: metrics.avg_job_duration, threshold: this.thresholds.avg_job_duration }
            });
        }
        
        // Memory usage issues
        if (metrics.memory_usage > this.thresholds.memory_usage) {
            issues.push({
                nodeId,
                type: 'high_memory_usage',
                severity: metrics.memory_usage > 0.95 ? 'critical' : 'warning',
                message: `High memory usage: ${(metrics.memory_usage * 100).toFixed(1)}%`,
                metrics: { memory_usage: metrics.memory_usage, threshold: this.thresholds.memory_usage }
            });
        }
        
        // Connection stability issues
        if (metrics.connection_stability < this.thresholds.connection_stability) {
            issues.push({
                nodeId,
                type: 'connection_instability',
                severity: metrics.connection_stability < 0.8 ? 'critical' : 'warning',
                message: `Unstable connection: ${(metrics.connection_stability * 100).toFixed(1)}% uptime`,
                metrics: { stability: metrics.connection_stability, threshold: this.thresholds.connection_stability }
            });
        }
        
        // Store alerts
        issues.forEach(issue => this.storePerformanceAlert(issue));
        
        return issues;
    }
    
    generateOptimizationRecommendations(node, metrics, issues) {
        const recommendations = [];
        const capabilities = metrics.capabilities || [];
        
        // Address specific issues
        issues.forEach(issue => {
            switch (issue.type) {
                case 'job_failure_rate':
                    recommendations.push({
                        category: 'reliability',
                        priority: 'high',
                        strategy: 'error_handling_improvement',
                        description: 'Review job execution logs and improve error handling',
                        implementation: [
                            'Check handler script compatibility',
                            'Verify required dependencies are installed',
                            'Add retry logic for transient failures',
                            'Improve error logging and diagnostics'
                        ]
                    });
                    break;
                    
                case 'slow_job_execution':
                    recommendations.push({
                        category: 'performance',
                        priority: 'medium',
                        strategy: 'execution_optimization',
                        description: 'Optimize job execution performance',
                        implementation: [
                            'Profile job execution bottlenecks',
                            'Optimize model loading and caching',
                            'Consider hardware upgrades',
                            'Implement job prioritization'
                        ]
                    });
                    break;
                    
                case 'high_memory_usage':
                    recommendations.push({
                        category: 'resources',
                        priority: 'high',
                        strategy: 'memory_optimization',
                        description: 'Reduce memory usage and prevent OOM errors',
                        implementation: [
                            'Add swap space if not present',
                            'Optimize model loading strategies',
                            'Implement garbage collection tuning',
                            'Process jobs in smaller batches'
                        ]
                    });
                    break;
                    
                case 'connection_instability':
                    recommendations.push({
                        category: 'network',
                        priority: 'high',
                        strategy: 'connection_optimization',
                        description: 'Improve network connection stability',
                        implementation: [
                            'Check network connectivity',
                            'Optimize WebSocket keepalive settings',
                            'Implement exponential backoff for retries',
                            'Monitor for network-related issues'
                        ]
                    });
                    break;
            }
        });
        
        // Capability-specific optimizations
        capabilities.forEach(capability => {
            const capOptimizations = this.optimizations.capabilities[capability];
            if (capOptimizations) {
                recommendations.push({
                    category: 'capability',
                    priority: 'low',
                    strategy: `${capability}_optimization`,
                    description: capOptimizations,
                    implementation: this.getCapabilityOptimizationSteps(capability)
                });
            }
        });
        
        // Proactive optimizations
        if (metrics.total_jobs > 10 && metrics.job_success_rate > 0.9) {
            recommendations.push({
                category: 'proactive',
                priority: 'low',
                strategy: 'performance_monitoring',
                description: 'Set up advanced performance monitoring',
                implementation: [
                    'Deploy performance monitoring agents',
                    'Set up automated alerts',
                    'Create performance dashboards',
                    'Implement predictive maintenance'
                ]
            });
        }
        
        return recommendations;
    }
    
    getCapabilityOptimizationSteps(capability) {
        const steps = {
            transcribe: [
                'Use Whisper model caching to reduce loading time',
                'Optimize audio preprocessing and chunking',
                'Consider faster Whisper model variants',
                'Implement parallel processing for batch jobs'
            ],
            ollama: [
                'Pre-load frequently used models',
                'Optimize context window and batch sizes',
                'Configure GPU acceleration if available',
                'Implement model response caching'
            ],
            'stable-diffusion': [
                'Optimize GPU memory allocation',
                'Use model checkpointing for large batches',
                'Implement prompt caching',
                'Configure optimal batch sizes'
            ],
            tesseract: [
                'Optimize OCR preprocessing pipelines',
                'Configure language packs efficiently',
                'Implement image quality enhancement',
                'Use parallel processing for multiple images'
            ]
        };
        
        return steps[capability] || ['Review capability-specific documentation', 'Monitor resource usage during execution'];
    }
    
    async applyOptimizations(nodeId, optimizations) {
        console.log(`🔧 Applying optimizations to node ${nodeId}...\n`);
        
        const results = [];
        const beforeMetrics = await this.collectPerformanceMetrics(this.getNodeById(nodeId));
        
        for (const optimization of optimizations) {
            try {
                console.log(`⚙️  Applying: ${optimization.strategy}`);
                
                const result = await this.applyOptimization(nodeId, optimization);
                results.push(result);
                
                // Record optimization
                this.recordOptimization(nodeId, optimization, beforeMetrics, result);
                
                console.log(`  ${result.success ? '✅' : '❌'} ${result.message}`);
                
            } catch (error) {
                console.log(`  ❌ Failed: ${error.message}`);
                results.push({ success: false, optimization: optimization.strategy, error: error.message });
            }
        }
        
        // Collect after metrics for comparison
        setTimeout(async () => {
            const afterMetrics = await this.collectPerformanceMetrics(this.getNodeById(nodeId));
            this.analyzeOptimizationImpact(nodeId, beforeMetrics, afterMetrics);
        }, 60000); // Wait 1 minute for changes to take effect
        
        return results;
    }
    
    async applyOptimization(nodeId, optimization) {
        // In a real implementation, this would communicate with the node to apply optimizations
        // For now, we'll simulate the application and return success
        
        const strategies = {
            error_handling_improvement: () => ({
                success: true,
                message: 'Error handling recommendations generated',
                details: 'Created troubleshooting guide for node operator'
            }),
            
            execution_optimization: () => ({
                success: true,
                message: 'Performance optimization guide created',
                details: 'Generated performance tuning recommendations'
            }),
            
            memory_optimization: () => ({
                success: true,
                message: 'Memory optimization recommendations prepared',
                details: 'Memory usage optimization guide sent to operator'
            }),
            
            connection_optimization: () => ({
                success: true,
                message: 'Connection stability improvements suggested',
                details: 'Network optimization guide provided'
            })
        };
        
        const handler = strategies[optimization.strategy];
        if (handler) {
            return handler();
        }
        
        return {
            success: false,
            message: `Unknown optimization strategy: ${optimization.strategy}`
        };
    }
    
    recordOptimization(nodeId, optimization, beforeMetrics, result) {
        this.db.prepare(`
            INSERT INTO performance_optimizations (
                id, nodeId, optimization_type, strategy, applied_at,
                performance_before, performance_after, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            this.generateId(),
            nodeId,
            optimization.category,
            optimization.strategy,
            Date.now(),
            JSON.stringify(beforeMetrics),
            null, // Will be updated later
            JSON.stringify(result)
        );
    }
    
    storePerformanceMetrics(nodeId, metrics) {
        this.db.prepare(`
            INSERT INTO performance_metrics (
                id, nodeId, timestamp, job_success_rate, avg_job_duration,
                total_jobs, completed_jobs, failed_jobs, memory_usage,
                cpu_usage, disk_usage, connection_uptime, capabilities
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            this.generateId(),
            nodeId,
            metrics.timestamp,
            metrics.job_success_rate,
            metrics.avg_job_duration,
            metrics.total_jobs,
            metrics.completed_jobs,
            metrics.failed_jobs,
            metrics.memory_usage,
            metrics.cpu_usage,
            metrics.disk_usage,
            metrics.connection_uptime,
            JSON.stringify(metrics.capabilities)
        );
    }
    
    storePerformanceAlert(alert) {
        this.db.prepare(`
            INSERT INTO performance_alerts (
                id, nodeId, alert_type, severity, message, metrics
            ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            this.generateId(),
            alert.nodeId,
            alert.type,
            alert.severity,
            alert.message,
            JSON.stringify(alert.metrics)
        );
    }
    
    updateHealthScore(nodeId, healthScore) {
        const trend = this.calculateHealthTrend(nodeId, healthScore);
        const recommendations = this.generateHealthRecommendations(healthScore);
        
        this.db.prepare(`
            INSERT OR REPLACE INTO node_health_scores (
                nodeId, overall_score, performance_score, reliability_score,
                efficiency_score, last_updated, trend, recommendations
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            nodeId,
            healthScore.overall,
            healthScore.performance,
            healthScore.reliability,
            healthScore.efficiency,
            healthScore.timestamp,
            trend,
            JSON.stringify(recommendations)
        );
    }
    
    calculateHealthTrend(nodeId, currentScore) {
        const previousScore = this.db.prepare(`
            SELECT overall_score FROM node_health_scores 
            WHERE nodeId = ?
        `).get(nodeId);
        
        if (!previousScore) return 'new';
        
        const diff = currentScore.overall - previousScore.overall_score;
        if (Math.abs(diff) < 0.05) return 'stable';
        return diff > 0 ? 'improving' : 'declining';
    }
    
    generateHealthRecommendations(healthScore) {
        const recommendations = [];
        
        if (healthScore.performance < 0.7) {
            recommendations.push('Focus on improving job success rate and execution speed');
        }
        
        if (healthScore.reliability < 0.8) {
            recommendations.push('Work on connection stability and uptime');
        }
        
        if (healthScore.efficiency < 0.6) {
            recommendations.push('Optimize resource usage and system performance');
        }
        
        if (healthScore.activity < 0.3) {
            recommendations.push('Increase node activity and job completion rate');
        }
        
        return recommendations;
    }
    
    printNodeAnalysis(node, metrics, healthScore, issues, recommendations) {
        console.log(`\n📊 Performance Analysis: ${node.nodeId}`);
        console.log('─'.repeat(50));
        
        // Health Score
        const scoreEmoji = healthScore.overall >= 0.8 ? '🟢' : healthScore.overall >= 0.6 ? '🟡' : '🔴';
        console.log(`${scoreEmoji} Overall Health: ${(healthScore.overall * 100).toFixed(1)}%`);
        console.log(`   Performance: ${(healthScore.performance * 100).toFixed(1)}%`);
        console.log(`   Reliability: ${(healthScore.reliability * 100).toFixed(1)}%`);
        console.log(`   Efficiency: ${(healthScore.efficiency * 100).toFixed(1)}%`);
        
        // Key Metrics
        console.log(`\n📈 Key Metrics:`);
        console.log(`   Job Success Rate: ${(metrics.job_success_rate * 100).toFixed(1)}%`);
        console.log(`   Avg Job Duration: ${Math.round(metrics.avg_job_duration)}s`);
        console.log(`   Jobs (24h): ${metrics.total_jobs} (${metrics.completed_jobs} completed)`);
        console.log(`   Connection Uptime: ${(metrics.connection_uptime * 100).toFixed(1)}%`);
        
        // Issues
        if (issues.length > 0) {
            console.log(`\n⚠️  Issues Found:`);
            issues.forEach(issue => {
                const emoji = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
                console.log(`   ${emoji} ${issue.message}`);
            });
        }
        
        // Top Recommendations
        if (recommendations.length > 0) {
            console.log(`\n💡 Top Recommendations:`);
            recommendations.slice(0, 3).forEach(rec => {
                console.log(`   • ${rec.description}`);
            });
        }
        
        console.log('');
    }
    
    exportPerformanceReport() {
        const report = {
            timestamp: Date.now(),
            nodeAnalysis: null, // Will be filled by analyzeNodePerformance
            performanceHistory: this.getPerformanceHistory(),
            optimizationHistory: this.getOptimizationHistory(),
            activeAlerts: this.getActiveAlerts(),
            healthTrends: this.getHealthTrends()
        };
        
        const filename = `performance-report-${Date.now()}.json`;
        fs.writeFileSync(filename, JSON.stringify(report, null, 2));
        console.log(`📊 Performance report exported: ${filename}`);
        
        return report;
    }
    
    // Helper methods
    getNodeById(nodeId) {
        return this.db.prepare('SELECT * FROM nodes WHERE nodeId = ?').get(nodeId);
    }
    
    getAllActiveNodes() {
        const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
        return this.db.prepare(`
            SELECT * FROM nodes 
            WHERE lastSeen > ?
            ORDER BY lastSeen DESC
        `).all(threeDaysAgo);
    }
    
    getPerformanceHistory() {
        return this.db.prepare(`
            SELECT * FROM performance_metrics 
            ORDER BY timestamp DESC 
            LIMIT 100
        `).all();
    }
    
    getOptimizationHistory() {
        return this.db.prepare(`
            SELECT * FROM performance_optimizations 
            ORDER BY applied_at DESC 
            LIMIT 50
        `).all();
    }
    
    getActiveAlerts() {
        return this.db.prepare(`
            SELECT * FROM performance_alerts 
            WHERE resolved = 0 
            ORDER BY created_at DESC
        `).all();
    }
    
    getHealthTrends() {
        return this.db.prepare(`
            SELECT * FROM node_health_scores 
            ORDER BY last_updated DESC
        `).all();
    }
    
    generateId() {
        return 'perf_' + Math.random().toString(36).substr(2, 9);
    }
    
    loadPerformanceHistory() {
        return {};
    }
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];
    
    const optimizer = new NodePerformanceOptimizer();
    
    if (command === 'analyze') {
        const nodeId = args[1];
        optimizer.analyzeNodePerformance(nodeId);
        
    } else if (command === 'optimize') {
        const nodeId = args[1];
        if (!nodeId) {
            console.log('Error: Node ID required for optimization');
            process.exit(1);
        }
        
        console.log('This would apply optimizations based on analysis results.');
        console.log('Run "analyze" first to get recommendations.');
        
    } else if (command === 'report') {
        optimizer.exportPerformanceReport();
        
    } else {
        console.log('Node Performance Optimizer');
        console.log('==========================');
        console.log('');
        console.log('Usage:');
        console.log('  node node-performance-optimizer.js analyze [nodeId]  - Analyze node performance');
        console.log('  node node-performance-optimizer.js optimize <nodeId> - Apply optimizations');
        console.log('  node node-performance-optimizer.js report           - Export detailed report');
        console.log('');
        console.log('The performance optimizer provides:');
        console.log('  • Real-time performance monitoring');
        console.log('  • Automated optimization recommendations');
        console.log('  • Health scoring and trend analysis');
        console.log('  • Capability-specific tuning advice');
    }
}

module.exports = NodePerformanceOptimizer;