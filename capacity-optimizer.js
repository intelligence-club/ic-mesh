#!/usr/bin/env node

/**
 * Capacity Optimizer
 * Investigates and fixes transcription capacity bottlenecks
 * 
 * Focus areas:
 * - Job claiming logic issues
 * - Node connectivity problems  
 * - Resource allocation optimization
 * - Processing pipeline fixes
 */

const sqlite3 = require('sqlite3').verbose();
const http = require('http');

class CapacityOptimizer {
    constructor() {
        this.db = new sqlite3.Database('data/mesh.db');
        this.issues = [];
        this.fixes = [];
    }

    async optimize() {
        console.log('⚡ CAPACITY OPTIMIZER');
        console.log('====================\n');
        
        await this.diagnoseJobClaiming();
        await this.checkNodeConnectivity(); 
        await this.analyzeResourceUtilization();
        await this.checkCapabilityMatching();
        await this.attemptOptimizations();
        
        this.displayResults();
        this.db.close();
    }

    diagnoseJobClaiming() {
        return new Promise((resolve) => {
            console.log('🔍 DIAGNOSING JOB CLAIMING ISSUES');
            
            // Check if nodes can see available jobs
            this.db.all(`
                SELECT COUNT(*) as available_jobs
                FROM jobs 
                WHERE type = 'transcribe' 
                AND status = 'pending' 
                AND (requirements = '' OR requirements IS NULL OR requirements = '{}')
            `, (err, jobs) => {
                if (err) { console.error('Error:', err); resolve(); return; }
                
                const available = jobs[0]?.available_jobs || 0;
                console.log(`   Available Jobs (no requirements): ${available}`);
                
                // Check if there are active nodes that could claim
                this.db.all(`
                    SELECT nodeId, capabilities, lastSeen
                    FROM nodes 
                    WHERE lastSeen > ?
                    ORDER BY lastSeen DESC
                `, [Date.now() - (5 * 60 * 1000)], (err, nodes) => {
                    if (err) { console.error('Error:', err); resolve(); return; }
                    
                    console.log(`   Active Nodes: ${nodes.length}`);
                    
                    const transcriptionNodes = nodes.filter(node => {
                        const caps = JSON.parse(node.capabilities || '[]');
                        return caps.includes('transcription');
                    });
                    
                    console.log(`   Nodes with Transcription Capability: ${transcriptionNodes.length}`);
                    
                    if (available > 0 && transcriptionNodes.length > 0) {
                        this.issues.push('Jobs available but not being claimed');
                        console.log('   🚨 ISSUE: Jobs available but not being claimed');
                        
                        // Check server status
                        this.checkServerHealth();
                    } else if (transcriptionNodes.length === 0) {
                        this.issues.push('No transcription-capable nodes active');
                        console.log('   ❌ No transcription-capable nodes active');
                    }
                    
                    resolve();
                });
            });
        });
    }

    checkServerHealth() {
        console.log('\n🏥 CHECKING SERVER HEALTH');
        
        // Test if server is responding to API calls
        const req = http.request({
            hostname: 'localhost',
            port: 8333,
            path: '/jobs/available',
            method: 'GET',
            timeout: 5000
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const jobs = JSON.parse(data);
                    console.log(`   Server Response: ${jobs.length} jobs available via API`);
                    if (jobs.length === 0) {
                        this.issues.push('Server not returning available jobs via API');
                    }
                } catch (e) {
                    console.log(`   ❌ Server returned invalid JSON: ${data.substring(0,100)}...`);
                    this.issues.push('Server API returning invalid responses');
                }
            });
        });
        
        req.on('error', (err) => {
            console.log(`   ❌ Server unreachable: ${err.message}`);
            this.issues.push('Mesh server not responding');
        });
        
        req.on('timeout', () => {
            console.log('   ❌ Server response timeout');
            this.issues.push('Server response timeout');
        });
        
        req.end();
    }

    checkNodeConnectivity() {
        return new Promise((resolve) => {
            console.log('\n🔗 CHECKING NODE CONNECTIVITY');
            
            // Check node heartbeat patterns
            this.db.all(`
                SELECT nodeId, lastSeen, 
                       (${Date.now()} - lastSeen) / 1000 / 60 as minutes_ago
                FROM nodes 
                WHERE lastSeen > ?
                ORDER BY lastSeen DESC
            `, [Date.now() - (30 * 60 * 1000)], (err, nodes) => {
                if (err) { console.error('Error:', err); resolve(); return; }
                
                console.log('   Recent Node Activity (last 30m):');
                nodes.forEach(node => {
                    const minsAgo = Math.round(node.minutes_ago);
                    const status = minsAgo < 2 ? '🟢 Active' : 
                                  minsAgo < 5 ? '🟡 Recent' : '🔴 Stale';
                    console.log(`     ${node.nodeId.substring(0,8)}... ${status} (${minsAgo}m ago)`);
                    
                    if (minsAgo > 5) {
                        this.issues.push(`Stale node connection (${minsAgo}m ago)`);
                    }
                });
                
                resolve();
            });
        });
    }

    analyzeResourceUtilization() {
        return new Promise((resolve) => {
            console.log('\n💻 ANALYZING RESOURCE UTILIZATION');
            
            this.db.all(`
                SELECT nodeId, cpuCores, ramMB, cpuIdle, ramFreeMB,
                       jobsCompleted, computeMinutes
                FROM nodes 
                WHERE lastSeen > ?
            `, [Date.now() - (10 * 60 * 1000)], (err, nodes) => {
                if (err) { console.error('Error:', err); resolve(); return; }
                
                nodes.forEach(node => {
                    const efficiency = node.jobsCompleted / Math.max(node.computeMinutes / 60, 1);
                    const ramUsagePercent = node.ramMB > 0 ? 
                        Math.round(((node.ramMB - node.ramFreeMB) / node.ramMB) * 100) : 0;
                    
                    console.log(`   Node ${node.nodeId.substring(0,8)}...:`);
                    console.log(`     CPU: ${node.cpuCores} cores, ${node.cpuIdle}% idle`);
                    console.log(`     RAM: ${Math.round(node.ramMB/1024)}GB total, ${ramUsagePercent}% used`);
                    console.log(`     Efficiency: ${efficiency.toFixed(1)} jobs/hour`);
                    
                    // Identify resource constraints
                    if (node.cpuIdle < 20) {
                        this.issues.push(`High CPU usage on node ${node.nodeId.substring(0,8)}`);
                    }
                    if (ramUsagePercent > 90) {
                        this.issues.push(`High RAM usage on node ${node.nodeId.substring(0,8)}`);
                    }
                    if (efficiency < 1) {
                        this.issues.push(`Low efficiency on node ${node.nodeId.substring(0,8)}`);
                    }
                });
                
                resolve();
            });
        });
    }

    checkCapabilityMatching() {
        return new Promise((resolve) => {
            console.log('\n🎯 CHECKING CAPABILITY MATCHING');
            
            // Check job requirements vs node capabilities
            this.db.all(`
                SELECT DISTINCT requirements
                FROM jobs 
                WHERE type = 'transcribe' AND status = 'pending'
            `, (err, jobReqs) => {
                if (err) { console.error('Error:', err); resolve(); return; }
                
                this.db.all(`
                    SELECT DISTINCT capabilities
                    FROM nodes 
                    WHERE lastSeen > ?
                `, [Date.now() - (5 * 60 * 1000)], (err, nodeCaps) => {
                    if (err) { console.error('Error:', err); resolve(); return; }
                    
                    console.log('   Job Requirements:');
                    jobReqs.forEach(req => {
                        const reqs = req.requirements || '{}';
                        console.log(`     ${reqs === '{}' ? 'No requirements' : reqs}`);
                    });
                    
                    console.log('   Node Capabilities:');
                    nodeCaps.forEach(cap => {
                        const caps = JSON.parse(cap.capabilities || '[]');
                        console.log(`     [${caps.join(', ')}]`);
                    });
                    
                    // Check for capability mismatches
                    const hasTranscription = nodeCaps.some(cap => {
                        const caps = JSON.parse(cap.capabilities || '[]');
                        return caps.includes('transcription') || caps.includes('whisper');
                    });
                    
                    if (!hasTranscription) {
                        this.issues.push('No nodes with transcription/whisper capability');
                    }
                    
                    resolve();
                });
            });
        });
    }

    attemptOptimizations() {
        return new Promise((resolve) => {
            console.log('\n🔧 ATTEMPTING OPTIMIZATIONS');
            
            // Reset any stuck jobs older than 10 minutes
            this.db.run(`
                UPDATE jobs 
                SET status = 'pending', claimedBy = NULL, claimedAt = NULL
                WHERE type = 'transcribe' 
                AND status = 'claimed' 
                AND claimedAt < ?
            `, [Date.now() - (10 * 60 * 1000)], function(err) {
                if (err) {
                    console.error('   Error resetting stuck jobs:', err);
                } else if (this.changes > 0) {
                    console.log(`   ✅ Reset ${this.changes} stuck jobs to pending`);
                    this.fixes.push(`Reset ${this.changes} stuck jobs`);
                } else {
                    console.log('   ✅ No stuck jobs to reset');
                }
                resolve();
            });
        });
    }

    displayResults() {
        console.log('\n' + '='.repeat(40));
        console.log('📊 OPTIMIZATION RESULTS');
        console.log('='.repeat(40));
        
        if (this.issues.length > 0) {
            console.log('\n❌ ISSUES IDENTIFIED:');
            this.issues.forEach(issue => console.log(`   • ${issue}`));
        }
        
        if (this.fixes.length > 0) {
            console.log('\n✅ OPTIMIZATIONS APPLIED:');
            this.fixes.forEach(fix => console.log(`   • ${fix}`));
        }
        
        console.log('\n💡 NEXT STEPS:');
        console.log('   1. Check if job claiming resumes after stuck job reset');
        console.log('   2. Monitor processing rate over next 5-10 minutes'); 
        console.log('   3. Contact node operators if connectivity issues persist');
        console.log('   4. Consider manual job queue cleanup if needed');
        
        console.log(`\n⏰ Optimization completed: ${new Date().toISOString()}`);
    }
}

// Run if called directly
if (require.main === module) {
    const optimizer = new CapacityOptimizer();
    optimizer.optimize().catch(console.error);
}

module.exports = CapacityOptimizer;