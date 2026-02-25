#!/usr/bin/env node

/**
 * Intelligent Job Queue Optimizer
 * 
 * Optimizes job distribution, identifies bottlenecks, and improves processing efficiency
 * Addresses pending job backlog and enhances node utilization
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class IntelligentQueueOptimizer {
    constructor(dbPath = './mesh.db') {
        try {
            this.db = new Database(dbPath, { readonly: false });
            this.loadOptimizationStrategies();
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            process.exit(1);
        }
    }

    loadOptimizationStrategies() {
        // Job type priority matrix based on business value and processing time
        this.jobPriorities = {
            'transcribe': { priority: 10, avgTime: 30, businessValue: 'high' },
            'transcription': { priority: 10, avgTime: 30, businessValue: 'high' },
            'ocr': { priority: 8, avgTime: 20, businessValue: 'medium' },
            'pdf-extract': { priority: 7, avgTime: 15, businessValue: 'medium' },
            'inference': { priority: 6, avgTime: 45, businessValue: 'medium' },
            'generate-image': { priority: 5, avgTime: 60, businessValue: 'low' },
            'ffmpeg': { priority: 4, avgTime: 120, businessValue: 'low' },
            'test': { priority: 1, avgTime: 5, businessValue: 'none' }
        };

        // Node capability scoring
        this.nodeCapabilities = {
            // Higher scores = better suited for job type
            'transcribe': { 
                requiredRAM: 4096, 
                preferredCores: 4, 
                gpuAccelerated: true,
                reliability: 'critical' 
            },
            'ocr': { 
                requiredRAM: 2048, 
                preferredCores: 2, 
                gpuAccelerated: false,
                reliability: 'medium' 
            },
            'inference': { 
                requiredRAM: 8192, 
                preferredCores: 6, 
                gpuAccelerated: true,
                reliability: 'high' 
            },
            'generate-image': { 
                requiredRAM: 8192, 
                preferredCores: 4, 
                gpuAccelerated: true,
                reliability: 'low' 
            }
        };

        // Optimization thresholds
        this.thresholds = {
            maxPendingTime: 300, // 5 minutes before escalation
            maxQueueSize: 50, // Per node
            minNodeEfficiency: 0.7, // 70% success rate minimum
            loadBalanceRatio: 0.3, // 30% variance acceptable
            staleJobAge: 3600 // 1 hour = stale job
        };
    }

    async analyzeQueueHealth() {
        console.log('🔍 Analyzing Job Queue Health...\n');

        // Get current queue statistics
        const queueStats = this.db.prepare(`
            SELECT 
                type,
                status,
                COUNT(*) as count,
                AVG(julianday('now') - julianday(createdAt)) * 24 * 60 as avg_age_minutes,
                MIN(julianday('now') - julianday(createdAt)) * 24 * 60 as min_age_minutes,
                MAX(julianday('now') - julianday(createdAt)) * 24 * 60 as max_age_minutes
            FROM jobs 
            WHERE createdAt > datetime('now', '-24 hours')
            GROUP BY type, status
            ORDER BY status, count DESC
        `).all();

        console.log('📊 Queue Health Analysis:');
        console.log('========================\n');

        const statusGroups = {};
        queueStats.forEach(stat => {
            if (!statusGroups[stat.status]) statusGroups[stat.status] = [];
            statusGroups[stat.status].push(stat);
        });

        Object.entries(statusGroups).forEach(([status, stats]) => {
            const emoji = status === 'pending' ? '⏳' : 
                         status === 'failed' ? '❌' : 
                         status === 'completed' ? '✅' : '🔄';
            
            console.log(`${emoji} ${status.toUpperCase()} Jobs:`);
            stats.forEach(stat => {
                const ageColor = stat.avg_age_minutes > this.thresholds.maxPendingTime ? '🔴' : 
                                stat.avg_age_minutes > this.thresholds.maxPendingTime / 2 ? '🟡' : '🟢';
                console.log(`  • ${stat.type}: ${stat.count} jobs (avg age: ${ageColor} ${stat.avg_age_minutes.toFixed(1)} min)`);
            });
            console.log('');
        });

        return this.identifyBottlenecks(statusGroups);
    }

    identifyBottlenecks(statusGroups) {
        const bottlenecks = [];
        const pendingJobs = statusGroups.pending || [];
        
        // Identify stale jobs
        pendingJobs.forEach(stat => {
            if (stat.avg_age_minutes > this.thresholds.maxPendingTime) {
                bottlenecks.push({
                    type: 'stale_jobs',
                    severity: stat.avg_age_minutes > this.thresholds.staleJobAge / 60 ? 'critical' : 'high',
                    description: `${stat.type} jobs averaging ${stat.avg_age_minutes.toFixed(1)} minutes pending`,
                    jobType: stat.type,
                    count: stat.count,
                    recommendation: 'Priority assignment needed'
                });
            }
        });

        // Identify high-failure job types
        const failedJobs = statusGroups.failed || [];
        failedJobs.forEach(stat => {
            const total = (statusGroups.completed || []).find(c => c.type === stat.type)?.count || 0;
            const failureRate = stat.count / (stat.count + total);
            
            if (failureRate > 0.3) { // >30% failure rate
                bottlenecks.push({
                    type: 'high_failure_rate',
                    severity: failureRate > 0.5 ? 'critical' : 'high',
                    description: `${stat.type} jobs have ${(failureRate * 100).toFixed(1)}% failure rate`,
                    jobType: stat.type,
                    count: stat.count,
                    recommendation: 'Node capability analysis needed'
                });
            }
        });

        console.log('🚨 Bottlenecks Identified:');
        if (bottlenecks.length === 0) {
            console.log('✅ No critical bottlenecks detected');
        } else {
            bottlenecks.forEach((bottleneck, index) => {
                const severityEmoji = bottleneck.severity === 'critical' ? '🔴' : '🟠';
                console.log(`${index + 1}. ${severityEmoji} ${bottleneck.description}`);
                console.log(`   Recommendation: ${bottleneck.recommendation}`);
            });
        }
        console.log('');

        return bottlenecks;
    }

    async optimizeJobDistribution() {
        console.log('🎯 Optimizing Job Distribution...\n');

        // Get active nodes with capabilities
        const activeNodes = this.db.prepare(`
            SELECT 
                nodeId,
                name,
                cpuCores,
                ramMB,
                capabilities,
                lastHeartbeat,
                (julianday('now') - julianday(lastHeartbeat)) * 24 * 60 as minutes_since_heartbeat
            FROM nodes 
            WHERE (julianday('now') - julianday(lastHeartbeat)) * 24 * 60 < 10
            ORDER BY cpuCores DESC, ramMB DESC
        `).all();

        console.log(`🖥️ Active Nodes: ${activeNodes.length}`);
        activeNodes.forEach(node => {
            const capabilities = node.capabilities ? JSON.parse(node.capabilities) : [];
            console.log(`  • ${node.name || node.nodeId.substring(0, 8)}: ${node.cpuCores} cores, ${(node.ramMB / 1024).toFixed(1)}GB RAM`);
            console.log(`    Capabilities: ${capabilities.length > 0 ? capabilities.join(', ') : 'none specified'}`);
        });

        // Get pending jobs
        const pendingJobs = this.db.prepare(`
            SELECT jobId, type, createdAt, nodeId,
                   (julianday('now') - julianday(createdAt)) * 24 * 60 as age_minutes
            FROM jobs 
            WHERE status = 'pending'
            ORDER BY createdAt ASC
        `).all();

        console.log(`\n⏳ Pending Jobs: ${pendingJobs.length}`);
        
        if (pendingJobs.length === 0) {
            console.log('✅ No pending jobs to optimize');
            return;
        }

        // Create optimization plan
        const optimizationPlan = this.createOptimizationPlan(activeNodes, pendingJobs);
        
        console.log('\n📋 Optimization Plan:');
        optimizationPlan.forEach((plan, index) => {
            console.log(`${index + 1}. Assign ${plan.jobType} jobs to ${plan.nodeName} (${plan.count} jobs)`);
            console.log(`   Reason: ${plan.reason}`);
        });

        return optimizationPlan;
    }

    createOptimizationPlan(activeNodes, pendingJobs) {
        const plan = [];
        
        // Group jobs by type
        const jobsByType = {};
        pendingJobs.forEach(job => {
            if (!jobsByType[job.type]) jobsByType[job.type] = [];
            jobsByType[job.type].push(job);
        });

        // Score nodes for each job type
        Object.entries(jobsByType).forEach(([jobType, jobs]) => {
            const nodeScores = this.scoreNodesForJobType(activeNodes, jobType);
            
            if (nodeScores.length > 0) {
                const bestNode = nodeScores[0];
                plan.push({
                    jobType,
                    nodeName: bestNode.name || bestNode.nodeId.substring(0, 8),
                    nodeId: bestNode.nodeId,
                    count: jobs.length,
                    reason: bestNode.reason,
                    priority: this.jobPriorities[jobType]?.priority || 5
                });
            }
        });

        // Sort by priority (higher priority first)
        return plan.sort((a, b) => b.priority - a.priority);
    }

    scoreNodesForJobType(nodes, jobType) {
        const jobReqs = this.nodeCapabilities[jobType];
        if (!jobReqs) {
            // Default scoring for unknown job types
            return nodes.map(node => ({
                ...node,
                score: node.cpuCores + (node.ramMB / 1024),
                reason: 'General purpose assignment'
            })).sort((a, b) => b.score - a.score);
        }

        return nodes.map(node => {
            let score = 0;
            let reasons = [];

            // RAM score
            const ramScore = Math.min(node.ramMB / jobReqs.requiredRAM, 2); // Cap at 2x
            score += ramScore * 3;
            if (node.ramMB >= jobReqs.requiredRAM) {
                reasons.push('sufficient RAM');
            }

            // CPU score
            const cpuScore = Math.min(node.cpuCores / jobReqs.preferredCores, 2);
            score += cpuScore * 2;
            if (node.cpuCores >= jobReqs.preferredCores) {
                reasons.push('adequate CPU');
            }

            // Capability match
            const capabilities = node.capabilities ? JSON.parse(node.capabilities) : [];
            if (capabilities.includes(jobType)) {
                score += 5;
                reasons.push('supports job type');
            }

            // Historical performance (if available)
            const nodePerf = this.getNodePerformance(node.nodeId, jobType);
            if (nodePerf.successRate > this.thresholds.minNodeEfficiency) {
                score += 3;
                reasons.push(`${(nodePerf.successRate * 100).toFixed(0)}% success rate`);
            }

            return {
                ...node,
                score,
                reason: reasons.length > 0 ? reasons.join(', ') : 'available node'
            };
        }).filter(node => node.score > 0)
          .sort((a, b) => b.score - a.score);
    }

    getNodePerformance(nodeId, jobType = null) {
        const query = jobType 
            ? `SELECT 
                COUNT(*) as total_jobs,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_jobs,
                AVG(CASE WHEN status = 'completed' THEN processingTime ELSE NULL END) as avg_processing_time
               FROM jobs 
               WHERE nodeId = ? AND type = ? AND createdAt > datetime('now', '-7 days')`
            : `SELECT 
                COUNT(*) as total_jobs,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_jobs,
                AVG(CASE WHEN status = 'completed' THEN processingTime ELSE NULL END) as avg_processing_time
               FROM jobs 
               WHERE nodeId = ? AND createdAt > datetime('now', '-7 days')`;

        const params = jobType ? [nodeId, jobType] : [nodeId];
        const result = this.db.prepare(query).get(...params);

        return {
            successRate: result.total_jobs > 0 ? result.completed_jobs / result.total_jobs : 0,
            avgProcessingTime: result.avg_processing_time || 0,
            totalJobs: result.total_jobs || 0
        };
    }

    async detectAbandonedJobs() {
        console.log('🔍 Detecting Abandoned Jobs...\n');

        // Find jobs that are claimed but not progressing
        const abandonedJobs = this.db.prepare(`
            SELECT 
                j.jobId,
                j.type,
                j.nodeId,
                j.createdAt,
                j.claimedAt,
                (julianday('now') - julianday(j.claimedAt)) * 24 * 60 as minutes_claimed,
                n.name as nodeName,
                (julianday('now') - julianday(n.lastHeartbeat)) * 24 * 60 as node_offline_minutes
            FROM jobs j
            LEFT JOIN nodes n ON j.nodeId = n.nodeId
            WHERE j.status = 'claimed' 
                AND (julianday('now') - julianday(j.claimedAt)) * 24 * 60 > 30
            ORDER BY j.claimedAt ASC
        `).all();

        console.log(`🔍 Abandoned Jobs Analysis: ${abandonedJobs.length} jobs`);

        if (abandonedJobs.length === 0) {
            console.log('✅ No abandoned jobs detected');
            return [];
        }

        const cleanupActions = [];
        
        abandonedJobs.forEach(job => {
            const isNodeOffline = job.node_offline_minutes > 10;
            const jobAge = job.minutes_claimed;
            
            console.log(`⚠️  Job ${job.jobId} (${job.type}): claimed ${jobAge.toFixed(1)} min ago`);
            console.log(`    Node: ${job.nodeName || job.nodeId?.substring(0, 8) || 'unknown'} (${isNodeOffline ? 'OFFLINE' : 'online'})`);
            
            if (isNodeOffline || jobAge > this.thresholds.staleJobAge / 60) {
                cleanupActions.push({
                    jobId: job.jobId,
                    action: 'release',
                    reason: isNodeOffline ? 'node offline' : 'timeout exceeded'
                });
            }
        });

        if (cleanupActions.length > 0) {
            console.log(`\n🔧 Cleanup Actions Needed: ${cleanupActions.length} jobs`);
            cleanupActions.forEach((action, index) => {
                console.log(`${index + 1}. Release job ${action.jobId} (${action.reason})`);
            });
        }

        return cleanupActions;
    }

    async releaseAbandonedJobs(dryRun = true) {
        const cleanupActions = await this.detectAbandonedJobs();
        
        if (cleanupActions.length === 0) return;

        console.log(`\n${dryRun ? '🧪 DRY RUN:' : '🔧 EXECUTING:'} Job Cleanup`);
        
        if (dryRun) {
            console.log('Would release the following jobs:');
            cleanupActions.forEach(action => {
                console.log(`  • Job ${action.jobId} (${action.reason})`);
            });
            console.log('\nUse --execute to actually perform cleanup');
            return;
        }

        // Actually release jobs
        let released = 0;
        const releaseStmt = this.db.prepare(`
            UPDATE jobs 
            SET status = 'pending', nodeId = NULL, claimedAt = NULL 
            WHERE jobId = ?
        `);

        cleanupActions.forEach(action => {
            try {
                releaseStmt.run(action.jobId);
                console.log(`✅ Released job ${action.jobId}`);
                released++;
            } catch (error) {
                console.error(`❌ Failed to release job ${action.jobId}:`, error.message);
            }
        });

        console.log(`\n📊 Cleanup Complete: ${released}/${cleanupActions.length} jobs released`);
    }

    async generateLoadBalanceReport() {
        console.log('📊 Load Balance Analysis\n');
        console.log('======================\n');

        // Node workload distribution
        const nodeWorkloads = this.db.prepare(`
            SELECT 
                n.nodeId,
                n.name,
                n.cpuCores,
                n.ramMB,
                COUNT(j.jobId) as total_jobs,
                SUM(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END) as completed_jobs,
                SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) as failed_jobs,
                SUM(CASE WHEN j.status = 'pending' THEN 1 ELSE 0 END) as pending_jobs,
                AVG(j.processingTime) as avg_processing_time,
                (julianday('now') - julianday(n.lastHeartbeat)) * 24 * 60 as minutes_offline
            FROM nodes n
            LEFT JOIN jobs j ON n.nodeId = j.nodeId 
                AND j.createdAt > datetime('now', '-24 hours')
            GROUP BY n.nodeId, n.name
            ORDER BY total_jobs DESC
        `).all();

        console.log('🖥️ Node Performance Summary:');
        nodeWorkloads.forEach(node => {
            const status = node.minutes_offline < 10 ? '🟢 ONLINE' : '🔴 OFFLINE';
            const successRate = node.total_jobs > 0 ? (node.completed_jobs / node.total_jobs * 100).toFixed(1) : 'N/A';
            const utilization = node.cpuCores > 0 ? (node.total_jobs / node.cpuCores).toFixed(1) : 'N/A';
            
            console.log(`\n${status} ${node.name || node.nodeId.substring(0, 8)}`);
            console.log(`  Resources: ${node.cpuCores} cores, ${(node.ramMB / 1024).toFixed(1)}GB RAM`);
            console.log(`  Workload: ${node.total_jobs} jobs (${node.completed_jobs}✅ ${node.failed_jobs}❌ ${node.pending_jobs}⏳)`);
            console.log(`  Performance: ${successRate}% success, ${utilization} jobs/core`);
            if (node.avg_processing_time) {
                console.log(`  Avg processing: ${node.avg_processing_time.toFixed(1)}s`);
            }
        });

        // Load balance recommendations
        console.log('\n💡 Load Balance Recommendations:');
        
        const activeNodes = nodeWorkloads.filter(n => n.minutes_offline < 10);
        if (activeNodes.length === 0) {
            console.log('❌ No active nodes available');
            return;
        }

        const avgJobsPerNode = activeNodes.reduce((sum, n) => sum + n.total_jobs, 0) / activeNodes.length;
        const jobVariance = Math.max(...activeNodes.map(n => Math.abs(n.total_jobs - avgJobsPerNode)));
        const balanceRatio = avgJobsPerNode > 0 ? jobVariance / avgJobsPerNode : 0;

        if (balanceRatio > this.thresholds.loadBalanceRatio) {
            console.log(`⚠️ Load imbalance detected (${(balanceRatio * 100).toFixed(1)}% variance)`);
            
            const overloaded = activeNodes.filter(n => n.total_jobs > avgJobsPerNode * 1.3);
            const underutilized = activeNodes.filter(n => n.total_jobs < avgJobsPerNode * 0.7);
            
            if (overloaded.length > 0) {
                console.log('  Overloaded nodes:');
                overloaded.forEach(node => {
                    console.log(`    • ${node.name}: ${node.total_jobs} jobs (${((node.total_jobs / avgJobsPerNode - 1) * 100).toFixed(1)}% above average)`);
                });
            }
            
            if (underutilized.length > 0) {
                console.log('  Underutilized nodes:');
                underutilized.forEach(node => {
                    console.log(`    • ${node.name}: ${node.total_jobs} jobs (${((1 - node.total_jobs / avgJobsPerNode) * 100).toFixed(1)}% below average)`);
                });
            }
        } else {
            console.log('✅ Good load distribution across active nodes');
        }
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
    const execute = args.includes('--execute');
    
    const optimizer = new IntelligentQueueOptimizer();

    async function main() {
        try {
            switch (command) {
                case 'analyze':
                    const bottlenecks = await optimizer.analyzeQueueHealth();
                    await optimizer.optimizeJobDistribution();
                    break;
                    
                case 'cleanup':
                    await optimizer.releaseAbandonedJobs(!execute);
                    break;
                    
                case 'balance':
                    await optimizer.generateLoadBalanceReport();
                    break;
                    
                case 'optimize':
                    await optimizer.analyzeQueueHealth();
                    await optimizer.optimizeJobDistribution();
                    await optimizer.detectAbandonedJobs();
                    await optimizer.generateLoadBalanceReport();
                    break;
                    
                case '--help':
                case 'help':
                    console.log(`
🎯 Intelligent Job Queue Optimizer

Usage:
  node intelligent-queue-optimizer.js [command] [--execute]

Commands:
  analyze      Analyze queue health and suggest optimizations (default)
  cleanup      Identify and release abandoned jobs (dry run unless --execute)
  balance      Generate load balance analysis and recommendations
  optimize     Run full optimization analysis
  help         Show this help message

Options:
  --execute    Actually perform cleanup actions (default is dry run)

Examples:
  node intelligent-queue-optimizer.js analyze    # Analyze current state
  node intelligent-queue-optimizer.js cleanup    # Preview abandoned jobs
  node intelligent-queue-optimizer.js cleanup --execute  # Release abandoned jobs
  node intelligent-queue-optimizer.js balance    # Check load distribution

Features:
  ✅ Queue health analysis and bottleneck detection
  ✅ Intelligent job distribution based on node capabilities
  ✅ Abandoned job detection and cleanup
  ✅ Load balance monitoring and recommendations
  ✅ Priority-based job scheduling
  ✅ Node performance scoring
  ✅ Real-time optimization suggestions
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
            optimizer.close();
        }
    }

    main();
}

module.exports = IntelligentQueueOptimizer;