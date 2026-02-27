#!/usr/bin/env node
/**
 * Node Retention Strategy Analysis
 * Analyzes node connection patterns and provides actionable recovery strategies
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/mesh.db');

function analyzeNodeRetention() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                reject(`Database connection error: ${err.message}`);
                return;
            }
        });

        // Get node information with their capabilities and performance
        db.all(`
            SELECT 
                nodeId,
                owner,
                capabilities,
                lastSeen,
                jobsCompleted,
                (strftime('%s', 'now') - lastSeen) / 60 as minutesOffline,
                CASE 
                    WHEN lastSeen > 0 THEN 
                        ROUND((strftime('%s', 'now') - lastSeen) / 86400.0, 1)
                    ELSE NULL 
                END as daysOffline
            FROM nodes
            ORDER BY jobsCompleted DESC
        `, (err, nodes) => {
            if (err) {
                reject(`Nodes query error: ${err.message}`);
                return;
            }

            // Get capability gaps by checking what jobs need vs what nodes provide
            db.all(`
                SELECT 
                    j.type,
                    COUNT(*) as pending_jobs,
                    j.requirements
                FROM jobs j
                WHERE j.status = 'pending'
                GROUP BY j.type, j.requirements
                ORDER BY pending_jobs DESC
            `, (err, jobRequirements) => {
                if (err) {
                    reject(`Job requirements query error: ${err.message}`);
                    return;
                }

                // Get completed job statistics by node
                db.all(`
                    SELECT 
                        j.claimedBy as nodeId,
                        n.owner,
                        COUNT(*) as jobs_completed,
                        AVG(j.computeMs) as avg_compute_ms,
                        MIN(j.completedAt) as first_job,
                        MAX(j.completedAt) as last_job
                    FROM jobs j
                    JOIN nodes n ON j.claimedBy = n.nodeId
                    WHERE j.status = 'completed'
                    GROUP BY j.claimedBy, n.owner
                    ORDER BY jobs_completed DESC
                `, (err, nodePerformance) => {
                    if (err) {
                        reject(`Node performance query error: ${err.message}`);
                        return;
                    }

                    db.close();
                    resolve({ nodes, jobRequirements, nodePerformance });
                });
            });
        });
    });
}

function parseCapabilities(capStr) {
    try {
        return JSON.parse(capStr || '[]');
    } catch {
        return [];
    }
}

function parseRequirements(reqStr) {
    try {
        const req = JSON.parse(reqStr || '{}');
        return req.capabilities || [];
    } catch {
        return [];
    }
}

function formatResults(data) {
    console.log('🔗 IC Mesh Node Retention Analysis');
    console.log('=====================================\n');

    // Node status summary
    const totalNodes = data.nodes.length;
    const activeNodes = data.nodes.filter(n => n.minutesOffline < 5).length;
    const recentNodes = data.nodes.filter(n => n.minutesOffline < 60).length;
    const longOfflineNodes = data.nodes.filter(n => n.daysOffline && n.daysOffline > 1).length;

    console.log('📊 Network Overview:');
    console.log(`   Total registered nodes: ${totalNodes}`);
    console.log(`   Currently active (<5min): ${activeNodes}`);
    console.log(`   Recently active (<1hr): ${recentNodes}`);
    console.log(`   Long-term offline (>1 day): ${longOfflineNodes}`);
    console.log(`   Retention rate: ${Math.round((activeNodes / totalNodes) * 100)}%\n`);

    // Node details
    console.log('🖥️  Node Status Details:');
    data.nodes.forEach(node => {
        const caps = parseCapabilities(node.capabilities);
        const status = node.minutesOffline < 5 ? '🟢' : 
                      node.minutesOffline < 60 ? '🟡' : '🔴';
        
        let timeDesc = '';
        if (node.minutesOffline < 1) timeDesc = 'Active now';
        else if (node.minutesOffline < 60) timeDesc = `${Math.round(node.minutesOffline)}m ago`;
        else if (node.daysOffline) timeDesc = `${node.daysOffline} days ago`;
        else timeDesc = 'Never connected';

        console.log(`   ${status} ${node.nodeId.substring(0, 8)}... (${node.owner})`);
        console.log(`      Last seen: ${timeDesc}`);
        console.log(`      Jobs completed: ${node.jobsCompleted || 0}`);
        console.log(`      Capabilities: ${caps.length > 0 ? caps.join(', ') : 'none'}`);
        console.log();
    });

    // Build capability inventory for gap analysis
    const availableCapabilities = new Set();
    data.nodes.forEach(node => {
        if (node.minutesOffline < 60) { // Only count recently active nodes
            parseCapabilities(node.capabilities).forEach(cap => 
                availableCapabilities.add(cap)
            );
        }
    });

    // Capability gaps analysis
    if (data.jobRequirements.length > 0) {
        console.log('🔍 Capability Gap Analysis:');

        data.jobRequirements.forEach(job => {
            const requiredCaps = parseRequirements(job.requirements);
            const missingCaps = requiredCaps.filter(cap => !availableCapabilities.has(cap));
            
            if (missingCaps.length > 0) {
                console.log(`   ❌ ${job.type}: ${job.pending_jobs} jobs blocked`);
                console.log(`      Missing: ${missingCaps.join(', ')}`);
            } else {
                console.log(`   ⏳ ${job.type}: ${job.pending_jobs} jobs waiting for nodes`);
                console.log(`      Required: ${requiredCaps.join(', ')}`);
            }
        });
        console.log();
    }

    // Node performance analysis
    if (data.nodePerformance.length > 0) {
        console.log('⚡ Node Performance History:');
        data.nodePerformance.forEach(perf => {
            const firstDate = new Date(perf.first_job * 1000).toISOString().slice(0, 10);
            const lastDate = new Date(perf.last_job * 1000).toISOString().slice(0, 10);
            const avgSeconds = Math.round(perf.avg_compute_ms / 1000);
            
            console.log(`   🏆 ${perf.nodeId.substring(0, 8)}... (${perf.owner})`);
            console.log(`      Jobs: ${perf.jobs_completed}, Avg time: ${avgSeconds}s`);
            console.log(`      Active: ${firstDate} → ${lastDate}`);
        });
        console.log();
    }

    // Recovery recommendations
    console.log('💡 Recovery Strategy:');
    
    // Identify high-value offline nodes
    const highValueOffline = data.nodes.filter(node => 
        node.jobsCompleted > 10 && node.minutesOffline > 60
    );
    
    if (highValueOffline.length > 0) {
        console.log('   🎯 High-Priority Node Recovery:');
        highValueOffline.forEach(node => {
            const caps = parseCapabilities(node.capabilities);
            console.log(`      • Contact ${node.owner} to restore ${node.nodeId.substring(0, 8)}...`);
            console.log(`        Value: ${node.jobsCompleted} jobs completed, ${caps.join(', ')}`);
        });
        console.log();
    }

    // Check for critical capability gaps
    const criticalCaps = ['tesseract', 'transcribe', 'whisper', 'stable-diffusion'];
    const missingCriticalCaps = criticalCaps.filter(cap => !availableCapabilities.has(cap));
    
    if (missingCriticalCaps.length > 0) {
        console.log('   🚨 Critical Capability Gaps:');
        missingCriticalCaps.forEach(cap => {
            const offlineNodesWithCap = data.nodes.filter(node => 
                parseCapabilities(node.capabilities).includes(cap)
            );
            
            if (offlineNodesWithCap.length > 0) {
                console.log(`      • ${cap}: ${offlineNodesWithCap.length} offline nodes have this`);
                offlineNodesWithCap.forEach(node => {
                    console.log(`        - ${node.owner}: ${node.nodeId.substring(0, 8)}... (${node.daysOffline} days)`);
                });
            } else {
                console.log(`      • ${cap}: Need to recruit new nodes with this capability`);
            }
        });
        console.log();
    }

    // Immediate actions
    console.log('🔧 Immediate Actions Required:');
    if (activeNodes === 0) {
        console.log('   ⚠️  CRITICAL: No active nodes - service completely offline');
        console.log('   📞 Contact node owners immediately for emergency restoration');
    } else if (activeNodes < 3) {
        console.log('   ⚠️  WARNING: Very low node count - service at risk');
        console.log('   📈 Focus on node recruitment and retention');
    }
    
    if (data.jobRequirements.length > 0) {
        const blockedJobs = data.jobRequirements.reduce((sum, job) => sum + job.pending_jobs, 0);
        console.log(`   📋 ${blockedJobs} jobs waiting for processing`);
        console.log('   🏃 Contact Drake for miniclaw/frigg node restoration');
    }

    console.log('   📊 Run this analysis daily to track retention trends');
}

// Run the analysis
if (require.main === module) {
    analyzeNodeRetention()
        .then(formatResults)
        .catch(error => {
            console.error('❌ Analysis failed:', error);
            process.exit(1);
        });
}

module.exports = { analyzeNodeRetention };