#!/usr/bin/env node

/**
 * Transcription Service Monitor
 * Real-time monitoring and optimization for IC Mesh transcription capacity
 * 
 * Features:
 * - Real-time job queue analysis
 * - Node performance tracking  
 * - Processing rate optimization
 * - Capacity bottleneck detection
 * - Automated health scoring
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

class TranscriptionServiceMonitor {
    constructor() {
        this.db = new sqlite3.Database('data/mesh.db');
        this.healthScore = 0;
        this.issues = [];
        this.recommendations = [];
    }

    async analyze() {
        console.log('🎙️ TRANSCRIPTION SERVICE MONITOR');
        console.log('================================\n');
        
        await this.checkJobQueue();
        await this.checkNodeCapacity();
        await this.checkProcessingRate();
        await this.checkBottlenecks();
        await this.generateHealthScore();
        await this.generateRecommendations();
        
        this.displaySummary();
        this.db.close();
    }

    checkJobQueue() {
        return new Promise((resolve) => {
            // Pending transcription jobs
            this.db.all(`
                SELECT COUNT(*) as pending, 
                       MIN(createdAt) as oldest_job,
                       AVG(createdAt) as avg_age
                FROM jobs 
                WHERE type = 'transcribe' AND status = 'pending'
            `, (err, result) => {
                if (err) { console.error('Error:', err); resolve(); return; }
                
                const pending = result[0].pending;
                const oldestAge = result[0].oldest_job ? 
                    Math.round((Date.now() - result[0].oldest_job) / 1000 / 60) : 0;
                
                console.log('📋 JOB QUEUE ANALYSIS');
                console.log(`   Pending Jobs: ${pending}`);
                console.log(`   Oldest Job: ${oldestAge}m ago`);
                
                if (pending > 20) {
                    this.issues.push(`High queue backlog (${pending} jobs)`);
                    this.healthScore -= 30;
                } else if (pending > 10) {
                    this.issues.push(`Moderate queue backlog (${pending} jobs)`);
                    this.healthScore -= 15;
                } else if (pending > 0) {
                    console.log('   ✅ Normal queue level');
                }
                
                if (oldestAge > 60) {
                    this.issues.push(`Old pending jobs (${oldestAge}m wait time)`);
                    this.healthScore -= 20;
                }
                
                // Check claimed jobs (processing)
                this.db.all(`
                    SELECT COUNT(*) as claimed,
                           AVG(${Date.now()} - claimedAt) as avg_processing_time
                    FROM jobs 
                    WHERE type = 'transcribe' AND status = 'claimed'
                `, (err, claimed) => {
                    if (err) { console.error('Error:', err); resolve(); return; }
                    if (!claimed || claimed.length === 0) { resolve(); return; }
                    
                    const processing = claimed[0].claimed;
                    const avgTime = claimed[0].avg_processing_time ? 
                        Math.round(claimed[0].avg_processing_time / 1000 / 60) : 0;
                    
                    console.log(`   Processing Jobs: ${processing}`);
                    if (avgTime > 0) {
                        console.log(`   Avg Processing Time: ${avgTime}m`);
                        if (avgTime > 10) {
                            this.issues.push(`Slow job processing (${avgTime}m average)`);
                            this.healthScore -= 15;
                        }
                    }
                    
                    resolve();
                });
            });
        });
    }

    checkNodeCapacity() {
        return new Promise((resolve) => {
            // Active transcription nodes
            const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
            
            this.db.all(`
                SELECT nodeId, capabilities, lastSeen, jobsCompleted, 
                       computeMinutes, cpuCores, ramMB
                FROM nodes 
                WHERE lastSeen > ? 
                ORDER BY lastSeen DESC
            `, [fiveMinutesAgo], (err, nodes) => {
                if (err) { console.error('Error:', err); resolve(); return; }
                
                console.log('\n🟢 NODE CAPACITY ANALYSIS');
                
                const transcriptionNodes = nodes.filter(node => {
                    const caps = JSON.parse(node.capabilities || '[]');
                    return caps.includes('transcription');
                });
                
                console.log(`   Active Transcription Nodes: ${transcriptionNodes.length}/${nodes.length} total`);
                
                if (transcriptionNodes.length === 0) {
                    this.issues.push('CRITICAL: No active transcription nodes');
                    this.healthScore -= 50;
                } else if (transcriptionNodes.length === 1) {
                    this.issues.push('Single point of failure (only 1 transcription node)');
                    this.healthScore -= 25;
                } else {
                    console.log('   ✅ Multiple transcription nodes available');
                    this.healthScore += 10;
                }
                
                // Analyze individual node performance
                transcriptionNodes.forEach(node => {
                    const lastSeen = Math.round((Date.now() - node.lastSeen) / 1000 / 60);
                    const efficiency = node.jobsCompleted / Math.max(node.computeMinutes / 60, 1);
                    
                    console.log(`   - ${node.nodeId.substring(0,8)}... (${lastSeen}m ago)`);
                    console.log(`     Jobs: ${node.jobsCompleted}, Efficiency: ${efficiency.toFixed(1)} jobs/hr`);
                    console.log(`     Resources: ${node.cpuCores} cores, ${Math.round(node.ramMB/1024)}GB RAM`);
                    
                    if (efficiency > 10) {
                        console.log('     ⚡ High performance node');
                        this.healthScore += 5;
                    } else if (efficiency < 2) {
                        this.issues.push(`Low efficiency node (${efficiency.toFixed(1)} jobs/hr)`);
                        this.healthScore -= 10;
                    }
                });
                
                resolve();
            });
        });
    }

    checkProcessingRate() {
        return new Promise((resolve) => {
            // Processing rate analysis
            const intervals = [
                { name: '1 hour', ms: 3600000 },
                { name: '6 hours', ms: 6 * 3600000 },
                { name: '24 hours', ms: 24 * 3600000 }
            ];
            
            console.log('\n⚡ PROCESSING RATE ANALYSIS');
            
            let completed = 0;
            
            intervals.forEach((interval, index) => {
                this.db.all(`
                    SELECT COUNT(*) as count 
                    FROM jobs 
                    WHERE type = 'transcribe' 
                    AND status = 'completed' 
                    AND completedAt > ?
                `, [Date.now() - interval.ms], (err, result) => {
                    if (err) { console.error('Error:', err); return; }
                    
                    const count = result[0].count;
                    const rate = count / (interval.ms / 3600000);
                    
                    console.log(`   ${interval.name}: ${count} jobs (${rate.toFixed(1)}/hr)`);
                    
                    if (index === 0) { // 1 hour rate
                        completed = count;
                        if (rate < 1 && count > 0) {
                            this.issues.push(`Low processing rate (${rate.toFixed(1)}/hr)`);
                            this.healthScore -= 15;
                        } else if (rate > 5) {
                            console.log('   ✅ Good processing rate');
                            this.healthScore += 10;
                        }
                    }
                    
                    if (index === intervals.length - 1) resolve();
                });
            });
        });
    }

    checkBottlenecks() {
        return new Promise((resolve) => {
            console.log('\n🔍 BOTTLENECK ANALYSIS');
            
            // Check for stuck jobs
            this.db.all(`
                SELECT COUNT(*) as count, claimedBy 
                FROM jobs 
                WHERE type = 'transcribe' 
                AND status = 'claimed' 
                AND claimedAt < ?
                GROUP BY claimedBy
            `, [Date.now() - (10 * 60 * 1000)], (err, stuckJobs) => {
                if (err) { console.error('Error:', err); resolve(); return; }
                
                if (stuckJobs.length > 0) {
                    stuckJobs.forEach(stuck => {
                        console.log(`   ⚠️ Node ${stuck.claimedBy?.substring(0,8)}... has ${stuck.count} jobs stuck >10m`);
                        this.issues.push(`Stuck jobs detected (${stuck.count} jobs)`);
                        this.healthScore -= 20;
                    });
                } else {
                    console.log('   ✅ No stuck jobs detected');
                }
                
                // Check failure rate
                this.db.all(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
                    FROM jobs 
                    WHERE type = 'transcribe' 
                    AND completedAt > ?
                `, [Date.now() - (24 * 3600000)], (err, failures) => {
                    if (err) { console.error('Error:', err); resolve(); return; }
                    
                    const total = failures[0].total;
                    const failed = failures[0].failed;
                    const failureRate = total > 0 ? (failed / total) * 100 : 0;
                    
                    console.log(`   Failure Rate (24h): ${failed}/${total} (${failureRate.toFixed(1)}%)`);
                    
                    if (failureRate > 10) {
                        this.issues.push(`High failure rate (${failureRate.toFixed(1)}%)`);
                        this.healthScore -= 25;
                    } else if (failureRate > 5) {
                        this.issues.push(`Moderate failure rate (${failureRate.toFixed(1)}%)`);
                        this.healthScore -= 10;
                    } else if (total > 0) {
                        console.log('   ✅ Low failure rate');
                        this.healthScore += 5;
                    }
                    
                    resolve();
                });
            });
        });
    }

    async generateHealthScore() {
        // Base score starts at 50
        this.healthScore += 50;
        
        // Cap between 0-100
        this.healthScore = Math.max(0, Math.min(100, this.healthScore));
        
        console.log('\n📊 HEALTH SCORE');
        console.log(`   Overall Health: ${this.healthScore}/100`);
        
        if (this.healthScore >= 80) {
            console.log('   Status: 🟢 EXCELLENT');
        } else if (this.healthScore >= 60) {
            console.log('   Status: 🟡 GOOD');
        } else if (this.healthScore >= 40) {
            console.log('   Status: 🟠 DEGRADED');
        } else if (this.healthScore >= 20) {
            console.log('   Status: 🔴 POOR');
        } else {
            console.log('   Status: 💀 CRITICAL');
        }
    }

    generateRecommendations() {
        return new Promise((resolve) => {
            console.log('\n💡 OPTIMIZATION RECOMMENDATIONS');
            
            if (this.healthScore < 60) {
                this.recommendations.push('🚨 URGENT: Service health below acceptable threshold');
            }
            
            // Job queue recommendations
            this.db.all('SELECT COUNT(*) as pending FROM jobs WHERE type = "transcribe" AND status = "pending"', (err, result) => {
                if (err) { console.error('Error:', err); resolve(); return; }
                if (!result || result.length === 0) { resolve(); return; }
                
                const pending = result[0].pending;
                
                if (pending > 20) {
                    this.recommendations.push('📢 Alert operators to add more transcription nodes');
                    this.recommendations.push('🔄 Consider implementing job prioritization');
                }
                
                if (pending > 0) {
                    this.recommendations.push('📊 Monitor queue trends and processing rates');
                }
                
                // Node capacity recommendations
                this.db.all('SELECT COUNT(*) as total FROM nodes WHERE lastSeen > ?', [Date.now() - (5 * 60 * 1000)], (err, nodes) => {
                    if (err) { console.error('Error:', err); resolve(); return; }
                    if (!nodes || nodes.length === 0) { resolve(); return; }
                    
                    const activeNodes = nodes[0].total;
                    
                    if (activeNodes < 2) {
                        this.recommendations.push('🔗 Recruit additional transcription node operators');
                        this.recommendations.push('📱 Implement node operator retention programs');
                    }
                    
                    if (this.issues.length === 0) {
                        this.recommendations.push('✅ System operating normally - continue monitoring');
                    }
                    
                    this.recommendations.forEach(rec => console.log(`   ${rec}`));
                    resolve();
                });
            });
        });
    }

    displaySummary() {
        console.log('\n' + '='.repeat(50));
        console.log('📋 SUMMARY REPORT');
        console.log('='.repeat(50));
        
        if (this.issues.length > 0) {
            console.log('\n❌ ISSUES DETECTED:');
            this.issues.forEach(issue => console.log(`   • ${issue}`));
        }
        
        console.log(`\n📈 Health Score: ${this.healthScore}/100`);
        console.log(`⏰ Generated: ${new Date().toISOString()}`);
        
        // Save report
        const report = {
            timestamp: new Date().toISOString(),
            healthScore: this.healthScore,
            issues: this.issues,
            recommendations: this.recommendations
        };
        
        fs.writeFileSync('transcription-service-report.json', JSON.stringify(report, null, 2));
        console.log('\n💾 Report saved to: transcription-service-report.json');
    }
}

// Run if called directly
if (require.main === module) {
    const monitor = new TranscriptionServiceMonitor();
    monitor.analyze().catch(console.error);
}

module.exports = TranscriptionServiceMonitor;