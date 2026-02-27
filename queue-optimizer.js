#!/usr/bin/env node

/**
 * IC Mesh Queue Optimizer
 * 
 * Intelligent job queue management and optimization tool for IC Mesh.
 * Analyzes job patterns, optimizes processing order, and identifies
 * opportunities for improved throughput and resource utilization.
 * 
 * Features:
 * - Job priority optimization based on various factors
 * - Queue bottleneck identification and resolution
 * - Resource allocation recommendations
 * - Processing time prediction and optimization
 * - Duplicate job detection and consolidation
 * - Job retry management and dead letter queue handling
 * - Performance analytics and optimization suggestions
 * 
 * Usage:
 *   node queue-optimizer.js                    # Full queue analysis
 *   node queue-optimizer.js --analyze          # Queue bottleneck analysis
 *   node queue-optimizer.js --optimize         # Apply optimizations
 *   node queue-optimizer.js --priorities       # Reorder by priority
 *   node queue-optimizer.js --cleanup          # Remove stale/duplicate jobs
 *   node queue-optimizer.js --predict          # Processing time predictions
 *   node queue-optimizer.js --recommendations  # Optimization recommendations
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class QueueOptimizer {
    constructor() {
        this.dbPath = './data/mesh.db';
        this.optimizationLogPath = './data/queue-optimizations.json';
        this.configPath = './config/queue-config.json';
        
        // Default optimization configuration
        this.defaultConfig = {
            priorities: {
                'transcribe': 100,     // High priority - fast processing
                'ocr': 80,            // Medium-high priority  
                'pdf-extract': 80,    // Medium-high priority
                'generate': 60,       // Medium priority - resource intensive
                'stable-diffusion': 40 // Lower priority - very resource intensive
            },
            optimizations: {
                enableDuplicateDetection: true,
                enableJobConsolidation: false,
                enableRetryOptimization: true,
                maxRetries: 3,
                retryDelayMinutes: 5,
                staleJobHours: 48,
                duplicateThresholdMs: 30000
            },
            processing: {
                batchSize: 10,
                preferSmallJobs: true,
                balanceByCapability: true,
                predictProcessingTime: true
            }
        };
        
        this.loadConfig();
        this.loadOptimizationLog();
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                this.config = this.mergeDeep(this.defaultConfig, config);
            } else {
                this.config = this.defaultConfig;
                this.saveConfig();
            }
        } catch (error) {
            console.error('Failed to load config, using defaults:', error.message);
            this.config = this.defaultConfig;
        }
    }

    saveConfig() {
        try {
            const configDir = path.dirname(this.configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (error) {
            console.error('Failed to save config:', error.message);
        }
    }

    loadOptimizationLog() {
        try {
            if (fs.existsSync(this.optimizationLogPath)) {
                this.optimizationLog = JSON.parse(fs.readFileSync(this.optimizationLogPath, 'utf8'));
            } else {
                this.optimizationLog = {
                    sessions: [],
                    totalOptimizations: 0,
                    lastOptimization: null
                };
            }
        } catch (error) {
            console.error('Failed to load optimization log:', error.message);
            this.optimizationLog = { sessions: [], totalOptimizations: 0, lastOptimization: null };
        }
    }

    saveOptimizationLog() {
        try {
            const logDir = path.dirname(this.optimizationLogPath);
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            fs.writeFileSync(this.optimizationLogPath, JSON.stringify(this.optimizationLog, null, 2));
        } catch (error) {
            console.error('Failed to save optimization log:', error.message);
        }
    }

    mergeDeep(target, source) {
        const output = Object.assign({}, target);
        if (typeof target === 'object' && typeof source === 'object') {
            Object.keys(source).forEach(key => {
                if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
                    if (!(key in target)) {
                        output[key] = source[key];
                    } else {
                        output[key] = this.mergeDeep(target[key], source[key]);
                    }
                } else {
                    output[key] = source[key];
                }
            });
        }
        return output;
    }

    async analyzeQueue() {
        console.log('🔍 ANALYZING JOB QUEUE');
        console.log('======================');

        const analysis = {
            timestamp: new Date().toISOString(),
            queueStats: {},
            bottlenecks: [],
            opportunities: [],
            recommendations: []
        };

        try {
            // Get overall queue statistics
            analysis.queueStats = await this.getQueueStatistics();
            
            // Identify bottlenecks
            analysis.bottlenecks = await this.identifyBottlenecks();
            
            // Find optimization opportunities
            analysis.opportunities = await this.findOptimizationOpportunities();
            
            // Generate recommendations
            analysis.recommendations = await this.generateRecommendations(analysis);

            this.displayAnalysis(analysis);
            return analysis;
            
        } catch (error) {
            console.error('Queue analysis failed:', error.message);
            analysis.error = error.message;
            return analysis;
        }
    }

    async getQueueStatistics() {
        const stats = {};

        // Job counts by status
        const statusCounts = await this.queryDatabase(`
            SELECT status, COUNT(*) as count, 
                   AVG(CASE WHEN computeMs > 0 THEN computeMs ELSE NULL END) as avgComputeMs,
                   SUM(creditAmount) as totalCredits
            FROM jobs 
            GROUP BY status
        `);

        stats.byStatus = {};
        statusCounts.forEach(row => {
            stats.byStatus[row.status] = {
                count: row.count,
                avgComputeMs: row.avgComputeMs || 0,
                totalCredits: row.totalCredits || 0
            };
        });

        // Job counts by type
        const typeCounts = await this.queryDatabase(`
            SELECT type, 
                   COUNT(*) as total,
                   SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                   SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                   SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                   AVG(CASE WHEN computeMs > 0 THEN computeMs ELSE NULL END) as avgProcessingTime
            FROM jobs 
            GROUP BY type
        `);

        stats.byType = {};
        typeCounts.forEach(row => {
            stats.byType[row.type] = {
                total: row.total,
                pending: row.pending,
                completed: row.completed,
                failed: row.failed,
                avgProcessingTime: row.avgProcessingTime || 0,
                successRate: row.total > 0 ? (row.completed / row.total) * 100 : 0
            };
        });

        // Queue age analysis
        const ageAnalysis = await this.queryDatabase(`
            SELECT 
                AVG(strftime('%s', 'now') - createdAt) as avgAgeSeconds,
                MIN(strftime('%s', 'now') - createdAt) as minAgeSeconds,
                MAX(strftime('%s', 'now') - createdAt) as maxAgeSeconds,
                COUNT(*) as totalPending
            FROM jobs 
            WHERE status = 'pending'
        `);

        if (ageAnalysis.length > 0 && ageAnalysis[0].totalPending > 0) {
            stats.queueAge = {
                avgAgeMinutes: (ageAnalysis[0].avgAgeSeconds || 0) / 60,
                minAgeMinutes: (ageAnalysis[0].minAgeSeconds || 0) / 60,
                maxAgeMinutes: (ageAnalysis[0].maxAgeSeconds || 0) / 60,
                totalPending: ageAnalysis[0].totalPending
            };
        }

        return stats;
    }

    async identifyBottlenecks() {
        const bottlenecks = [];

        // Check for capability bottlenecks
        const capabilityBottlenecks = await this.analyzeCapabilityBottlenecks();
        bottlenecks.push(...capabilityBottlenecks);

        // Check for processing time bottlenecks
        const processingBottlenecks = await this.analyzeProcessingTimeBottlenecks();
        bottlenecks.push(...processingBottlenecks);

        // Check for age bottlenecks
        const ageBottlenecks = await this.analyzeAgeBottlenecks();
        bottlenecks.push(...ageBottlenecks);

        return bottlenecks;
    }

    async analyzeCapabilityBottlenecks() {
        const bottlenecks = [];

        // Get active capabilities
        const activeCapabilities = await this.queryDatabase(`
            SELECT capabilities 
            FROM nodes 
            WHERE (strftime('%s', 'now') - lastSeen) < 300
            AND capabilities != '[]'
        `);

        const capabilitySet = new Set();
        activeCapabilities.forEach(node => {
            try {
                const caps = JSON.parse(node.capabilities || '[]');
                caps.forEach(cap => capabilitySet.add(cap));
            } catch (e) {
                // Skip invalid JSON
            }
        });

        // Check pending jobs against capabilities
        const pendingJobs = await this.queryDatabase(`
            SELECT type, COUNT(*) as count 
            FROM jobs 
            WHERE status = 'pending' 
            GROUP BY type
        `);

        pendingJobs.forEach(job => {
            const hasCapability = capabilitySet.has(job.type) || 
                                 capabilitySet.has(this.getCapabilityAlias(job.type));
            
            if (!hasCapability && job.count > 0) {
                bottlenecks.push({
                    type: 'CAPABILITY_MISSING',
                    severity: job.count > 20 ? 'CRITICAL' : job.count > 5 ? 'HIGH' : 'MEDIUM',
                    description: `${job.count} ${job.type} jobs blocked - no active nodes with capability`,
                    jobType: job.type,
                    blockedJobs: job.count,
                    action: 'Contact node operators to restore capability or recruit new nodes'
                });
            }
        });

        return bottlenecks;
    }

    async analyzeProcessingTimeBottlenecks() {
        const bottlenecks = [];

        const slowJobs = await this.queryDatabase(`
            SELECT type, 
                   AVG(computeMs) as avgTime,
                   COUNT(*) as count,
                   MAX(computeMs) as maxTime
            FROM jobs 
            WHERE status = 'completed' AND computeMs > 0
            GROUP BY type
            HAVING avgTime > 30000
            ORDER BY avgTime DESC
        `);

        slowJobs.forEach(job => {
            bottlenecks.push({
                type: 'SLOW_PROCESSING',
                severity: job.avgTime > 120000 ? 'HIGH' : 'MEDIUM',
                description: `${job.type} jobs averaging ${(job.avgTime / 1000).toFixed(1)}s processing time`,
                jobType: job.type,
                avgTimeMs: job.avgTime,
                maxTimeMs: job.maxTime,
                action: 'Investigate processing efficiency or upgrade hardware'
            });
        });

        return bottlenecks;
    }

    async analyzeAgeBottlenecks() {
        const bottlenecks = [];

        const oldJobs = await this.queryDatabase(`
            SELECT type,
                   COUNT(*) as count,
                   AVG(strftime('%s', 'now') - createdAt) as avgAgeSeconds,
                   MAX(strftime('%s', 'now') - createdAt) as maxAgeSeconds
            FROM jobs 
            WHERE status = 'pending' 
            GROUP BY type
            HAVING avgAgeSeconds > 1800
            ORDER BY avgAgeSeconds DESC
        `);

        oldJobs.forEach(job => {
            const avgAgeMinutes = job.avgAgeSeconds / 60;
            const maxAgeMinutes = job.maxAgeSeconds / 60;
            
            bottlenecks.push({
                type: 'STALE_JOBS',
                severity: avgAgeMinutes > 120 ? 'HIGH' : 'MEDIUM',
                description: `${job.count} ${job.type} jobs averaging ${avgAgeMinutes.toFixed(1)} min old (max: ${maxAgeMinutes.toFixed(1)} min)`,
                jobType: job.type,
                avgAgeMinutes,
                maxAgeMinutes,
                count: job.count,
                action: 'Prioritize processing or investigate queue blockage'
            });
        });

        return bottlenecks;
    }

    async findOptimizationOpportunities() {
        const opportunities = [];

        // Duplicate job detection
        if (this.config.optimizations.enableDuplicateDetection) {
            const duplicates = await this.findDuplicateJobs();
            if (duplicates.length > 0) {
                opportunities.push({
                    type: 'DUPLICATE_REMOVAL',
                    impact: 'HIGH',
                    description: `${duplicates.length} potential duplicate jobs found`,
                    savings: `${duplicates.reduce((sum, dup) => sum + dup.count - 1, 0)} jobs could be removed`,
                    action: 'Run duplicate cleanup',
                    details: duplicates
                });
            }
        }

        // Job priority reordering
        const priorityOpportunities = await this.analyzePriorityOptimization();
        if (priorityOpportunities.length > 0) {
            opportunities.push(...priorityOpportunities);
        }

        // Batch processing opportunities
        const batchOpportunities = await this.analyzeBatchingOpportunities();
        if (batchOpportunities.length > 0) {
            opportunities.push(...batchOpportunities);
        }

        return opportunities;
    }

    async findDuplicateJobs() {
        const duplicates = [];
        const threshold = this.config.optimizations.duplicateThresholdMs;

        // Find jobs with identical payloads created within threshold time
        const potentialDuplicates = await this.queryDatabase(`
            SELECT payload, type, COUNT(*) as count,
                   MIN(createdAt) as firstCreated,
                   MAX(createdAt) as lastCreated,
                   GROUP_CONCAT(jobId) as jobIds
            FROM jobs 
            WHERE status = 'pending'
            AND payload != '{}'
            GROUP BY payload, type
            HAVING count > 1 
            AND (lastCreated - firstCreated) * 1000 < ${threshold}
        `);

        potentialDuplicates.forEach(dup => {
            const timeSpanMs = (dup.lastCreated - dup.firstCreated) * 1000;
            duplicates.push({
                type: dup.type,
                count: dup.count,
                timeSpanMs,
                jobIds: dup.jobIds.split(','),
                payload: dup.payload.substring(0, 100) + '...' // First 100 chars for preview
            });
        });

        return duplicates;
    }

    async analyzePriorityOptimization() {
        const opportunities = [];

        // Check if current queue order matches priority configuration
        const queueOrder = await this.queryDatabase(`
            SELECT jobId, type, createdAt
            FROM jobs 
            WHERE status = 'pending'
            ORDER BY createdAt ASC
            LIMIT 20
        `);

        if (queueOrder.length > 0) {
            const suboptimal = queueOrder.filter((job, index) => {
                const jobPriority = this.config.priorities[job.type] || 50;
                const nextJobs = queueOrder.slice(index + 1, index + 5);
                const hasHigherPriorityWaiting = nextJobs.some(nextJob => {
                    const nextPriority = this.config.priorities[nextJob.type] || 50;
                    return nextPriority > jobPriority;
                });
                return hasHigherPriorityWaiting;
            });

            if (suboptimal.length > 0) {
                opportunities.push({
                    type: 'PRIORITY_REORDER',
                    impact: 'MEDIUM',
                    description: `${suboptimal.length} jobs could be reordered by priority`,
                    savings: 'Improved processing order for higher priority jobs',
                    action: 'Apply priority-based queue reordering'
                });
            }
        }

        return opportunities;
    }

    async analyzeBatchingOpportunities() {
        const opportunities = [];

        // Look for jobs of the same type that could be batched
        const batchCandidates = await this.queryDatabase(`
            SELECT type, COUNT(*) as count,
                   AVG(LENGTH(payload)) as avgPayloadSize
            FROM jobs 
            WHERE status = 'pending'
            GROUP BY type
            HAVING count >= 5
        `);

        batchCandidates.forEach(candidate => {
            if (candidate.count >= 10 && this.supportsBatching(candidate.type)) {
                opportunities.push({
                    type: 'BATCH_PROCESSING',
                    impact: 'MEDIUM',
                    description: `${candidate.count} ${candidate.type} jobs could be batch processed`,
                    savings: 'Reduced overhead and improved throughput',
                    action: 'Implement batch processing for this job type',
                    jobType: candidate.type,
                    batchSize: Math.min(candidate.count, this.config.processing.batchSize)
                });
            }
        });

        return opportunities;
    }

    supportsBatching(jobType) {
        // Define which job types support batch processing
        const batchableTypes = ['transcribe', 'ocr'];
        return batchableTypes.includes(jobType);
    }

    async generateRecommendations(analysis) {
        const recommendations = [];

        // Capability recommendations
        analysis.bottlenecks.forEach(bottleneck => {
            if (bottleneck.type === 'CAPABILITY_MISSING') {
                recommendations.push({
                    priority: bottleneck.severity,
                    category: 'CAPACITY',
                    title: `Restore ${bottleneck.jobType} capability`,
                    description: bottleneck.description,
                    action: bottleneck.action,
                    impact: `Unblocks ${bottleneck.blockedJobs} jobs`
                });
            }
        });

        // Performance recommendations
        const slowBottlenecks = analysis.bottlenecks.filter(b => b.type === 'SLOW_PROCESSING');
        if (slowBottlenecks.length > 0) {
            recommendations.push({
                priority: 'MEDIUM',
                category: 'PERFORMANCE',
                title: 'Optimize processing times',
                description: `${slowBottlenecks.length} job types have slow processing times`,
                action: 'Profile and optimize slow handlers or upgrade hardware',
                impact: 'Improved throughput and reduced queue times'
            });
        }

        // Queue optimization recommendations
        analysis.opportunities.forEach(opportunity => {
            recommendations.push({
                priority: opportunity.impact === 'HIGH' ? 'HIGH' : 'MEDIUM',
                category: 'OPTIMIZATION',
                title: opportunity.type.replace('_', ' ').toLowerCase(),
                description: opportunity.description,
                action: opportunity.action,
                impact: opportunity.savings
            });
        });

        return recommendations;
    }

    async optimizeQueue() {
        console.log('⚡ OPTIMIZING JOB QUEUE');
        console.log('=======================');

        const optimizations = [];
        let optimizationCount = 0;

        try {
            // Remove duplicates if enabled
            if (this.config.optimizations.enableDuplicateDetection) {
                const duplicateCount = await this.removeDuplicateJobs();
                if (duplicateCount > 0) {
                    optimizations.push(`Removed ${duplicateCount} duplicate jobs`);
                    optimizationCount += duplicateCount;
                }
            }

            // Clean up stale jobs
            const staleCount = await this.cleanupStaleJobs();
            if (staleCount > 0) {
                optimizations.push(`Cleaned up ${staleCount} stale jobs`);
                optimizationCount += staleCount;
            }

            // Reorder by priority if enabled
            const reorderCount = await this.reorderByPriority();
            if (reorderCount > 0) {
                optimizations.push(`Reordered ${reorderCount} jobs by priority`);
                optimizationCount++;
            }

            // Log optimization session
            this.logOptimizationSession(optimizations, optimizationCount);

            if (optimizations.length > 0) {
                console.log('\n✅ OPTIMIZATIONS APPLIED:');
                optimizations.forEach(opt => console.log(`  • ${opt}`));
                console.log(`\n📊 Total optimizations: ${optimizationCount}`);
            } else {
                console.log('✅ Queue is already optimized - no changes needed');
            }

            return { optimizations, count: optimizationCount };

        } catch (error) {
            console.error('Queue optimization failed:', error.message);
            return { error: error.message, optimizations: [], count: 0 };
        }
    }

    async removeDuplicateJobs() {
        const duplicates = await this.findDuplicateJobs();
        let removedCount = 0;

        for (const duplicate of duplicates) {
            const jobIds = duplicate.jobIds;
            // Keep the first job, remove the rest
            const toRemove = jobIds.slice(1);
            
            for (const jobId of toRemove) {
                await this.executeDatabase('DELETE FROM jobs WHERE jobId = ?', [jobId]);
                removedCount++;
            }
        }

        return removedCount;
    }

    async cleanupStaleJobs() {
        const staleHours = this.config.optimizations.staleJobHours;
        const cutoffTimestamp = Date.now() / 1000 - (staleHours * 3600);

        const result = await this.executeDatabase(
            'DELETE FROM jobs WHERE status = ? AND createdAt < ?',
            ['pending', cutoffTimestamp]
        );

        return result.changes || 0;
    }

    async reorderByPriority() {
        // This is a simplified version - in a real implementation, you might need
        // to use job queuing systems that support priority ordering
        const pendingJobs = await this.queryDatabase(`
            SELECT jobId, type, createdAt
            FROM jobs 
            WHERE status = 'pending'
            ORDER BY createdAt ASC
        `);

        // Sort by priority (higher number = higher priority)
        const sortedJobs = pendingJobs.sort((a, b) => {
            const priorityA = this.config.priorities[a.type] || 50;
            const priorityB = this.config.priorities[b.type] || 50;
            return priorityB - priorityA; // Descending order
        });

        // Update creation timestamps to reflect new order
        let currentTime = Date.now() / 1000;
        let reorderedCount = 0;

        for (let i = 0; i < sortedJobs.length; i++) {
            const job = sortedJobs[i];
            const newTimestamp = currentTime + i; // Sequential timestamps
            
            if (Math.abs(job.createdAt - newTimestamp) > 1) { // Only update if meaningful change
                await this.executeDatabase(
                    'UPDATE jobs SET createdAt = ? WHERE jobId = ?',
                    [newTimestamp, job.jobId]
                );
                reorderedCount++;
            }
        }

        return reorderedCount;
    }

    logOptimizationSession(optimizations, count) {
        const session = {
            timestamp: new Date().toISOString(),
            optimizations,
            count,
            totalOptimizations: this.optimizationLog.totalOptimizations + count
        };

        this.optimizationLog.sessions.push(session);
        this.optimizationLog.totalOptimizations += count;
        this.optimizationLog.lastOptimization = session.timestamp;

        // Keep only last 50 sessions
        if (this.optimizationLog.sessions.length > 50) {
            this.optimizationLog.sessions = this.optimizationLog.sessions.slice(-50);
        }

        this.saveOptimizationLog();
    }

    async predictProcessingTimes() {
        console.log('🔮 PROCESSING TIME PREDICTIONS');
        console.log('==============================');

        const predictions = await this.queryDatabase(`
            SELECT 
                j.type,
                COUNT(*) as pendingCount,
                AVG(h.computeMs) as avgProcessingTime,
                MIN(h.computeMs) as minProcessingTime,
                MAX(h.computeMs) as maxProcessingTime
            FROM jobs j
            LEFT JOIN jobs h ON h.type = j.type AND h.status = 'completed' AND h.computeMs > 0
            WHERE j.status = 'pending'
            GROUP BY j.type
        `);

        predictions.forEach(pred => {
            const avgTimeSeconds = (pred.avgProcessingTime || 0) / 1000;
            const totalTimeMinutes = (pred.pendingCount * avgTimeSeconds) / 60;
            const minTimeMinutes = (pred.pendingCount * (pred.minProcessingTime || 0)) / (1000 * 60);
            const maxTimeMinutes = (pred.pendingCount * (pred.maxProcessingTime || 0)) / (1000 * 60);

            console.log(`\n📋 ${pred.type.toUpperCase()}`);
            console.log(`   Pending jobs: ${pred.pendingCount}`);
            if (pred.avgProcessingTime) {
                console.log(`   Avg time per job: ${avgTimeSeconds.toFixed(1)}s`);
                console.log(`   Estimated total time: ${totalTimeMinutes.toFixed(1)} min`);
                console.log(`   Range: ${minTimeMinutes.toFixed(1)} - ${maxTimeMinutes.toFixed(1)} min`);
            } else {
                console.log(`   No historical data for processing time estimates`);
            }
        });

        return predictions;
    }

    displayAnalysis(analysis) {
        console.log(`📅 Analysis Time: ${new Date(analysis.timestamp).toLocaleString()}\n`);

        // Queue Statistics
        console.log('📊 QUEUE STATISTICS');
        console.log('------------------');
        Object.entries(analysis.queueStats.byStatus || {}).forEach(([status, stats]) => {
            const icon = status === 'completed' ? '✅' : status === 'failed' ? '❌' : '⏳';
            console.log(`${icon} ${status}: ${stats.count} jobs (avg: ${(stats.avgComputeMs / 1000).toFixed(1)}s)`);
        });

        console.log('\n📋 BY JOB TYPE');
        console.log('--------------');
        Object.entries(analysis.queueStats.byType || {}).forEach(([type, stats]) => {
            console.log(`${type}: ${stats.pending} pending, ${stats.completed} completed (${stats.successRate.toFixed(1)}% success)`);
        });

        if (analysis.queueStats.queueAge) {
            console.log('\n⏰ QUEUE AGE');
            console.log('-----------');
            const age = analysis.queueStats.queueAge;
            console.log(`Average age: ${age.avgAgeMinutes.toFixed(1)} min`);
            console.log(`Oldest job: ${age.maxAgeMinutes.toFixed(1)} min`);
        }

        // Bottlenecks
        if (analysis.bottlenecks.length > 0) {
            console.log('\n🚫 BOTTLENECKS IDENTIFIED');
            console.log('-----------------------');
            analysis.bottlenecks.forEach(bottleneck => {
                const icon = bottleneck.severity === 'CRITICAL' ? '🔥' : bottleneck.severity === 'HIGH' ? '⚠️' : '⚡';
                console.log(`${icon} ${bottleneck.severity}: ${bottleneck.description}`);
                console.log(`   Action: ${bottleneck.action}`);
            });
        }

        // Opportunities
        if (analysis.opportunities.length > 0) {
            console.log('\n💡 OPTIMIZATION OPPORTUNITIES');
            console.log('-----------------------------');
            analysis.opportunities.forEach(opp => {
                const icon = opp.impact === 'HIGH' ? '🎯' : '💡';
                console.log(`${icon} ${opp.type}: ${opp.description}`);
                console.log(`   Savings: ${opp.savings}`);
            });
        }

        // Recommendations
        if (analysis.recommendations.length > 0) {
            console.log('\n🎯 RECOMMENDATIONS');
            console.log('------------------');
            analysis.recommendations.forEach(rec => {
                const icon = rec.priority === 'CRITICAL' ? '🔥' : rec.priority === 'HIGH' ? '⚠️' : '💡';
                console.log(`${icon} ${rec.title} (${rec.category})`);
                console.log(`   ${rec.description}`);
                console.log(`   Impact: ${rec.impact}`);
            });
        }
    }

    getCapabilityAlias(jobType) {
        const aliases = {
            'transcribe': 'transcription',
            'transcription': 'whisper',
            'ocr': 'tesseract'
        };
        return aliases[jobType] || jobType;
    }

    async queryDatabase(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async executeDatabase(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ changes: this.changes, lastID: this.lastID });
                }
            });
        });
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// Command line interface
async function main() {
    const optimizer = new QueueOptimizer();
    
    try {
        await optimizer.init();
        
        const args = process.argv.slice(2);
        const command = args[0];

        switch (command) {
            case '--analyze':
                await optimizer.analyzeQueue();
                break;
                
            case '--optimize':
                await optimizer.optimizeQueue();
                break;
                
            case '--priorities':
                await optimizer.reorderByPriority();
                console.log('✅ Queue reordered by priority');
                break;
                
            case '--cleanup':
                const removedDuplicates = await optimizer.removeDuplicateJobs();
                const removedStale = await optimizer.cleanupStaleJobs();
                console.log(`✅ Cleanup complete: ${removedDuplicates} duplicates, ${removedStale} stale jobs removed`);
                break;
                
            case '--predict':
                await optimizer.predictProcessingTimes();
                break;
                
            case '--recommendations':
                const analysis = await optimizer.analyzeQueue();
                if (analysis.recommendations.length > 0) {
                    console.log('🎯 OPTIMIZATION RECOMMENDATIONS');
                    console.log('===============================');
                    analysis.recommendations.forEach(rec => {
                        const icon = rec.priority === 'CRITICAL' ? '🔥' : rec.priority === 'HIGH' ? '⚠️' : '💡';
                        console.log(`${icon} ${rec.title}`);
                        console.log(`   ${rec.description}`);
                        console.log(`   Impact: ${rec.impact}\n`);
                    });
                } else {
                    console.log('✅ No optimization recommendations at this time');
                }
                break;
                
            default:
                // Full analysis
                await optimizer.analyzeQueue();
                break;
        }
    } catch (error) {
        console.error('Queue optimizer failed:', error.message);
        process.exit(1);
    } finally {
        optimizer.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = QueueOptimizer;