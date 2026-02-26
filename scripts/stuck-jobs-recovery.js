#!/usr/bin/env node
/**
 * Stuck Jobs Recovery System - Handle jobs claimed but not completed
 * 
 * Identifies jobs that have been claimed by nodes but haven't been completed
 * within reasonable timeframes, and provides safe recovery options.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/mesh.db');

class StuckJobsRecovery {
    constructor() {
        this.db = new sqlite3.Database(dbPath);
        // Timeouts in minutes for different job types
        this.jobTimeouts = {
            'transcribe': 15,    // Audio transcription - moderate timeout
            'ocr': 10,           // OCR processing - should be fast
            'pdf-extract': 10,   // PDF text extraction - should be fast
            'generate': 30,      // AI generation - can take longer
            'default': 20        // Default timeout for unknown types
        };
    }

    async analyzeStuckJobs() {
        console.log('🔍 Stuck Jobs Recovery - Analysis Report\n');

        const stuckJobs = await this.getStuckJobs();
        const claimedJobs = await this.getClaimedJobs();

        console.log(`📊 Job Status Overview:`);
        console.log(`   Total claimed jobs: ${claimedJobs.length}`);
        console.log(`   Jobs exceeding timeout: ${stuckJobs.length}`);

        if (stuckJobs.length === 0 && claimedJobs.length === 0) {
            console.log('✅ No stuck or claimed jobs found - queue is healthy');
            this.close();
            return;
        }

        if (claimedJobs.length > 0) {
            console.log(`\n📋 Currently Claimed Jobs (${claimedJobs.length}):`);
            await this.analyzeClaimedJobs(claimedJobs);
        }

        if (stuckJobs.length > 0) {
            console.log(`\n🚨 Stuck Jobs Requiring Action (${stuckJobs.length}):`);
            await this.analyzeStuckJobsList(stuckJobs);

            console.log('\n🔧 Recovery Options:');
            await this.generateRecoveryOptions(stuckJobs);
        }
    }

    async getStuckJobs() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    jobId,
                    type,
                    status,
                    claimedBy,
                    claimedAt,
                    createdAt,
                    datetime(claimedAt/1000, 'unixepoch') as claimedTime,
                    (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - claimedAt) / 60000 as minutesClaimed
                FROM jobs 
                WHERE status = 'claimed' 
                AND claimedAt IS NOT NULL
                ORDER BY claimedAt ASC
            `, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                // Filter for jobs that exceed their timeout
                const stuck = rows.filter(job => {
                    const timeout = this.jobTimeouts[job.type] || this.jobTimeouts.default;
                    return job.minutesClaimed > timeout;
                });
                
                resolve(stuck);
            });
        });
    }

    async getClaimedJobs() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    jobId,
                    type,
                    status,
                    claimedBy,
                    claimedAt,
                    createdAt,
                    datetime(claimedAt/1000, 'unixepoch') as claimedTime,
                    (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - claimedAt) / 60000 as minutesClaimed
                FROM jobs 
                WHERE status = 'claimed' 
                AND claimedAt IS NOT NULL
                ORDER BY claimedAt ASC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    async analyzeClaimedJobs(claimedJobs) {
        const nodeStatus = {};
        
        // Get node status for each claiming node
        for (const job of claimedJobs) {
            if (!nodeStatus[job.claimedBy]) {
                nodeStatus[job.claimedBy] = await this.getNodeStatus(job.claimedBy);
            }
        }

        claimedJobs.forEach(job => {
            const timeout = this.jobTimeouts[job.type] || this.jobTimeouts.default;
            const isStuck = job.minutesClaimed > timeout;
            const node = nodeStatus[job.claimedBy];
            
            const status = isStuck ? '🔴' : (job.minutesClaimed > timeout * 0.7 ? '🟡' : '🟢');
            const nodeStatusIcon = node?.isActive ? '🟢' : '🔴';
            
            console.log(`   ${status} ${job.jobId.slice(0,8)} (${job.type})`);
            console.log(`      Claimed: ${job.claimedTime} (${Math.round(job.minutesClaimed)}m ago)`);
            console.log(`      Node: ${job.claimedBy.slice(0,8)} ${nodeStatusIcon} ${node?.status || 'unknown'}`);
            console.log(`      Timeout: ${timeout}m (${isStuck ? 'EXCEEDED' : 'within limit'})`);
            console.log('');
        });
    }

    async analyzeStuckJobsList(stuckJobs) {
        const nodeStatus = {};
        
        for (const job of stuckJobs) {
            if (!nodeStatus[job.claimedBy]) {
                nodeStatus[job.claimedBy] = await this.getNodeStatus(job.claimedBy);
            }
        }

        stuckJobs.forEach(job => {
            const timeout = this.jobTimeouts[job.type] || this.jobTimeouts.default;
            const node = nodeStatus[job.claimedBy];
            
            console.log(`   🚨 ${job.jobId.slice(0,8)} (${job.type})`);
            console.log(`      Claimed: ${job.claimedTime} (${Math.round(job.minutesClaimed)}m ago)`);
            console.log(`      Expected timeout: ${timeout}m`);
            console.log(`      Claiming node: ${job.claimedBy.slice(0,8)}`);
            console.log(`      Node status: ${node?.isActive ? '🟢 Active' : '🔴 Offline'}`);
            
            if (!node?.isActive) {
                console.log(`      🔧 Issue: Node offline - job likely abandoned`);
            } else {
                console.log(`      ⚠️  Issue: Node active but job overdue - possible hang`);
            }
            console.log('');
        });
    }

    async getNodeStatus(nodeId) {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT 
                    nodeId,
                    name,
                    lastSeen,
                    datetime(lastSeen/1000, 'unixepoch') as lastSeenTime,
                    (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - lastSeen) / 60000 as minutesAgo
                FROM nodes 
                WHERE nodeId = ?
            `, [nodeId], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                if (row) {
                    row.isActive = row.minutesAgo < 5; // Active if seen within 5 minutes
                    row.status = row.isActive ? 'Active' : `Offline ${Math.round(row.minutesAgo)}m`;
                }
                
                resolve(row);
            });
        });
    }

    async generateRecoveryOptions(stuckJobs) {
        const offlineNodes = new Set();
        const activeNodes = new Set();
        
        for (const job of stuckJobs) {
            const node = await this.getNodeStatus(job.claimedBy);
            if (node?.isActive) {
                activeNodes.add(job.claimedBy);
            } else {
                offlineNodes.add(job.claimedBy);
            }
        }

        if (offlineNodes.size > 0) {
            const offlineJobCount = stuckJobs.filter(job => offlineNodes.has(job.claimedBy)).length;
            console.log(`\n📱 Safe Recovery - Offline Node Jobs (${offlineJobCount} jobs):`);
            console.log(`   These jobs were claimed by offline nodes and can be safely reset`);
            console.log(`   Command: node scripts/stuck-jobs-recovery.js --reset-offline`);
            
            offlineNodes.forEach(nodeId => {
                const jobCount = stuckJobs.filter(job => job.claimedBy === nodeId).length;
                console.log(`   • ${nodeId.slice(0,8)}: ${jobCount} jobs`);
            });
        }

        if (activeNodes.size > 0) {
            const activeJobCount = stuckJobs.filter(job => activeNodes.has(job.claimedBy)).length;
            console.log(`\n⚠️  Careful Recovery - Active Node Jobs (${activeJobCount} jobs):`);
            console.log(`   These jobs are claimed by active nodes - may still be processing`);
            console.log(`   Command: node scripts/stuck-jobs-recovery.js --force-reset-all`);
            console.log(`   Warning: Only use if nodes are definitely hung`);
        }

        console.log(`\n🔍 Individual Job Management:`);
        console.log(`   View specific job: node scripts/stuck-jobs-recovery.js --job <jobId>`);
        console.log(`   Reset specific job: node scripts/stuck-jobs-recovery.js --reset-job <jobId>`);
    }

    async resetOfflineJobs() {
        console.log('🔄 Resetting jobs claimed by offline nodes...\n');
        
        const stuckJobs = await this.getStuckJobs();
        let resetCount = 0;
        
        for (const job of stuckJobs) {
            const node = await this.getNodeStatus(job.claimedBy);
            if (!node?.isActive) {
                await this.resetJob(job.jobId);
                console.log(`✅ Reset ${job.jobId.slice(0,8)} (${job.type}) - claimed by offline node ${job.claimedBy.slice(0,8)}`);
                resetCount++;
            }
        }
        
        console.log(`\n🎉 Recovery complete: Reset ${resetCount} jobs from offline nodes`);
        if (resetCount > 0) {
            console.log(`Jobs are now available for healthy nodes to claim`);
        }
    }

    async resetJob(jobId) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                UPDATE jobs 
                SET status = 'pending', claimedBy = NULL, claimedAt = NULL 
                WHERE jobId = ?
            `, [jobId], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    close() {
        this.db.close();
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    const recovery = new StuckJobsRecovery();

    try {
        if (args.includes('--reset-offline')) {
            await recovery.resetOfflineJobs();
        } else if (args.includes('--reset-job')) {
            const jobIdIndex = args.indexOf('--reset-job') + 1;
            const jobId = args[jobIdIndex];
            if (!jobId) {
                console.log('❌ Please provide a job ID');
                process.exit(1);
            }
            await recovery.resetJob(jobId);
            console.log(`✅ Reset job ${jobId}`);
        } else {
            await recovery.analyzeStuckJobs();
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        recovery.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = { StuckJobsRecovery };