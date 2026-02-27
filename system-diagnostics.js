#!/usr/bin/env node

/**
 * System Diagnostics
 * Comprehensive diagnosis of mesh network health and connectivity
 */

const sqlite3 = require('sqlite3').verbose();
const http = require('http');

class SystemDiagnostics {
    constructor() {
        this.db = new sqlite3.Database('data/mesh.db');
        this.issues = [];
        this.recommendations = [];
    }

    async diagnose() {
        console.log('🏥 SYSTEM DIAGNOSTICS');
        console.log('=====================\n');
        
        await this.checkServerHealth();
        await this.analyzeNodeRetention();
        await this.checkJobQueue();
        await this.identifyBottlenecks();
        await this.generateActionPlan();
        
        this.displayResults();
        this.db.close();
    }

    checkServerHealth() {
        return new Promise((resolve) => {
            console.log('🖥️ SERVER HEALTH CHECK');
            
            const req = http.request({
                hostname: 'localhost',
                port: 8333,
                path: '/status',
                method: 'GET',
                timeout: 5000
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const status = JSON.parse(data);
                        console.log('   ✅ Server responding to HTTP requests');
                        console.log(`   Active Nodes: ${status.nodes?.active || 0}/${status.nodes?.total || 0}`);
                        console.log(`   Server Uptime: ${Math.round(status.uptime / 60)} minutes`);
                        console.log(`   WebSocket Connections: ${status.websocket?.connected || 0}`);
                        
                        if (status.nodes?.active === 0) {
                            this.issues.push('No active nodes connected to server');
                        }
                        if (status.websocket?.connected === 0) {
                            this.issues.push('No WebSocket connections (nodes may be using HTTP polling)');
                        }
                        
                    } catch (e) {
                        console.log('   ❌ Server returned invalid JSON');
                        this.issues.push('Server API returning malformed responses');
                    }
                    resolve();
                });
            });
            
            req.on('error', (err) => {
                console.log(`   ❌ Server unreachable: ${err.message}`);
                this.issues.push('Mesh server not responding to HTTP requests');
                resolve();
            });
            
            req.on('timeout', () => {
                console.log('   ❌ Server response timeout');
                this.issues.push('Server response timeout (performance issue)');
                resolve();
            });
            
            req.end();
        });
    }

    analyzeNodeRetention() {
        return new Promise((resolve) => {
            console.log('\n📊 NODE RETENTION ANALYSIS');
            
            // Check all registered nodes and their activity patterns
            this.db.all(`
                SELECT nodeId, lastSeen, registeredAt, jobsCompleted,
                       (${Date.now()} - lastSeen) / 1000 / 60 as minutes_offline,
                       (lastSeen - registeredAt) / 1000 / 60 as session_duration_minutes
                FROM nodes 
                ORDER BY lastSeen DESC
            `, (err, nodes) => {
                if (err) { console.error('Error:', err); resolve(); return; }
                
                console.log(`   Total Registered Nodes: ${nodes.length}`);
                
                const now = Date.now();
                const active = nodes.filter(n => (now - n.lastSeen) < 5 * 60 * 1000); // 5 min
                const recent = nodes.filter(n => (now - n.lastSeen) < 60 * 60 * 1000); // 1 hour
                const today = nodes.filter(n => (now - n.lastSeen) < 24 * 60 * 60 * 1000); // 24 hours
                
                console.log(`   Active (last 5m): ${active.length}`);
                console.log(`   Recent (last 1h): ${recent.length}`);
                console.log(`   Today (last 24h): ${today.length}`);
                
                if (nodes.length > 0) {
                    console.log('\n   Node Activity History:');
                    nodes.slice(0, 5).forEach(node => {
                        const minsOffline = Math.round(node.minutes_offline);
                        const sessionMins = Math.round(node.session_duration_minutes);
                        const efficiency = sessionMins > 0 ? (node.jobsCompleted / (sessionMins / 60)).toFixed(1) : '0';
                        
                        let status = '🔴 Offline';
                        if (minsOffline < 5) status = '🟢 Active';
                        else if (minsOffline < 60) status = '🟡 Recent';
                        
                        console.log(`     ${node.nodeId.substring(0,8)}... ${status}`);
                        console.log(`       Last seen: ${minsOffline}m ago`);
                        console.log(`       Session duration: ${sessionMins}m`); 
                        console.log(`       Jobs completed: ${node.jobsCompleted} (${efficiency}/hr efficiency)`);
                    });
                }
                
                // Identify retention issues
                const retentionRate = nodes.length > 0 ? (active.length / nodes.length) * 100 : 0;
                console.log(`\n   Node Retention Rate: ${retentionRate.toFixed(1)}%`);
                
                if (retentionRate < 20) {
                    this.issues.push(`Critical retention rate (${retentionRate.toFixed(1)}%)`);
                } else if (retentionRate < 50) {
                    this.issues.push(`Poor retention rate (${retentionRate.toFixed(1)}%)`);
                }
                
                resolve();
            });
        });
    }

    checkJobQueue() {
        return new Promise((resolve) => {
            console.log('\n📋 JOB QUEUE ANALYSIS');
            
            // Check job status distribution
            this.db.all(`
                SELECT status, COUNT(*) as count
                FROM jobs 
                WHERE type = 'transcribe'
                GROUP BY status
            `, (err, statuses) => {
                if (err) { console.error('Error:', err); resolve(); return; }
                
                console.log('   Job Status Distribution:');
                let totalJobs = 0;
                statuses.forEach(s => {
                    console.log(`     ${s.status}: ${s.count}`);
                    totalJobs += s.count;
                });
                
                // Check for job age issues
                this.db.all(`
                    SELECT COUNT(*) as old_jobs,
                           MIN(createdAt) as oldest_job
                    FROM jobs 
                    WHERE type = 'transcribe' 
                    AND status = 'pending'
                    AND createdAt < ?
                `, [Date.now() - (30 * 60 * 1000)], (err, oldJobs) => {
                    if (err) { console.error('Error:', err); resolve(); return; }
                    
                    const oldCount = oldJobs[0]?.old_jobs || 0;
                    const oldestAge = oldJobs[0]?.oldest_job ? 
                        Math.round((Date.now() - oldJobs[0].oldest_job) / 1000 / 60) : 0;
                    
                    if (oldCount > 0) {
                        console.log(`   ⚠️ Old pending jobs: ${oldCount} (oldest: ${oldestAge}m)`);
                        this.issues.push(`${oldCount} jobs pending over 30 minutes`);
                    }
                    
                    resolve();
                });
            });
        });
    }

    identifyBottlenecks() {
        return new Promise((resolve) => {
            console.log('\n🔍 BOTTLENECK IDENTIFICATION');
            
            // Check for the most likely root causes
            this.db.all(`
                SELECT 
                    (SELECT COUNT(*) FROM jobs WHERE type = 'transcribe' AND status = 'pending') as pending,
                    (SELECT COUNT(*) FROM nodes WHERE lastSeen > ?) as active_nodes,
                    (SELECT COUNT(*) FROM nodes WHERE lastSeen > ? AND capabilities LIKE '%transcription%') as transcription_nodes
            `, [Date.now() - (5 * 60 * 1000), Date.now() - (5 * 60 * 1000)], (err, analysis) => {
                if (err) { console.error('Error:', err); resolve(); return; }
                
                const data = analysis[0];
                const pending = data.pending;
                const activeNodes = data.active_nodes;  
                const transcriptionNodes = data.transcription_nodes;
                
                console.log('   Current Situation:');
                console.log(`     Pending Jobs: ${pending}`);
                console.log(`     Active Nodes: ${activeNodes}`);
                console.log(`     Transcription Nodes: ${transcriptionNodes}`);
                
                // Identify primary bottleneck
                if (pending > 0 && transcriptionNodes === 0) {
                    console.log('\n   🚨 PRIMARY BOTTLENECK: No transcription-capable nodes');
                    this.issues.push('CRITICAL: Zero transcription capacity');
                    this.recommendations.push('Contact node operators to restart transcription services');
                } else if (pending > 0 && activeNodes === 0) {
                    console.log('\n   🚨 PRIMARY BOTTLENECK: Complete node disconnection');
                    this.issues.push('CRITICAL: All nodes offline');
                    this.recommendations.push('Investigate mesh server connectivity and node operator communication');
                } else if (pending > 10 && transcriptionNodes < 2) {
                    console.log('\n   ⚠️ PRIMARY BOTTLENECK: Insufficient capacity');
                    this.issues.push('Capacity constraint with high demand');
                    this.recommendations.push('Recruit additional transcription node operators');
                }
                
                resolve();
            });
        });
    }

    generateActionPlan() {
        return new Promise((resolve) => {
            console.log('\n🎯 ACTION PLAN GENERATION');
            
            // Generate prioritized recommendations
            if (this.issues.some(i => i.includes('CRITICAL'))) {
                this.recommendations.unshift('🚨 IMMEDIATE: Contact node operators via all channels');
                this.recommendations.push('🔄 Monitor for node reconnections every 5-10 minutes');
                this.recommendations.push('📱 Consider alternative communication channels (Discord, email)');
            }
            
            this.recommendations.push('📊 Run diagnostics again in 15-30 minutes');
            this.recommendations.push('🛠️ Consider implementing node auto-restart mechanisms');
            this.recommendations.push('📈 Set up monitoring alerts for node disconnections');
            
            console.log('   Priority Actions:');
            this.recommendations.forEach((rec, i) => {
                console.log(`     ${i+1}. ${rec}`);
            });
            
            resolve();
        });
    }

    displayResults() {
        console.log('\n' + '='.repeat(50));
        console.log('📊 SYSTEM DIAGNOSTIC SUMMARY');
        console.log('='.repeat(50));
        
        if (this.issues.length > 0) {
            console.log('\n❌ ISSUES IDENTIFIED:');
            this.issues.forEach(issue => console.log(`   • ${issue}`));
        } else {
            console.log('\n✅ No critical issues detected');
        }
        
        console.log('\n🎯 RECOMMENDED ACTIONS:');
        this.recommendations.forEach(rec => console.log(`   • ${rec}`));
        
        // Determine overall system status
        const criticalIssues = this.issues.filter(i => i.includes('CRITICAL')).length;
        const totalIssues = this.issues.length;
        
        let status = '🟢 HEALTHY';
        if (criticalIssues > 0) status = '💀 CRITICAL';
        else if (totalIssues > 3) status = '🔴 POOR';
        else if (totalIssues > 1) status = '🟡 DEGRADED';
        
        console.log(`\n📈 Overall Status: ${status}`);
        console.log(`⏰ Diagnosis completed: ${new Date().toISOString()}`);
    }
}

// Run if called directly
if (require.main === module) {
    const diagnostics = new SystemDiagnostics();
    diagnostics.diagnose().catch(console.error);
}

module.exports = SystemDiagnostics;