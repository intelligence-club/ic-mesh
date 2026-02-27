#!/usr/bin/env node
/**
 * Deep Node Retention Pattern Analysis
 * Identifies why nodes disconnect and provides actionable insights
 */

const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('data/mesh.db');

function analyzeRetentionPatterns() {
    console.log('🔍 Deep Node Retention Analysis');
    console.log('===============================');

    // Get comprehensive node data
    const nodes = db.prepare(`
        SELECT 
            nodeId,
            name,
            ip,
            capabilities,
            cpuCores,
            ramMB,
            ramFreeMB,
            cpuIdle,
            owner,
            region,
            registeredAt,
            lastSeen,
            jobsCompleted,
            computeMinutes,
            CASE 
                WHEN lastSeen > (unixepoch() * 1000 - 300000) THEN 'active'
                ELSE 'offline'
            END as status
        FROM nodes 
        ORDER BY registeredAt ASC
    `).all();

    console.log(`\n📊 Analysis of ${nodes.length} nodes:\n`);

    // Session duration analysis
    const sessions = nodes.map(node => {
        const registeredTime = node.registeredAt;
        const lastSeenTime = node.lastSeen;
        const sessionDurationMs = lastSeenTime - registeredTime;
        const sessionHours = sessionDurationMs / (1000 * 60 * 60);
        
        return {
            ...node,
            sessionDurationMs,
            sessionHours: Math.round(sessionHours * 100) / 100,
            isLongSession: sessionHours > 10,
            productivity: node.jobsCompleted / Math.max(sessionHours, 0.1) // jobs per hour
        };
    });

    // Categorize by session duration
    const shortSessions = sessions.filter(s => s.sessionHours < 1);
    const mediumSessions = sessions.filter(s => s.sessionHours >= 1 && s.sessionHours < 24);
    const longSessions = sessions.filter(s => s.sessionHours >= 24);

    console.log('⏱️  Session Duration Patterns:');
    console.log(`  Short (<1h): ${shortSessions.length} nodes - ${Math.round(shortSessions.length/nodes.length*100)}%`);
    console.log(`  Medium (1-24h): ${mediumSessions.length} nodes - ${Math.round(mediumSessions.length/nodes.length*100)}%`);
    console.log(`  Long (24h+): ${longSessions.length} nodes - ${Math.round(longSessions.length/nodes.length*100)}%`);

    // Analyze short sessions (potential onboarding issues)
    if (shortSessions.length > 0) {
        console.log('\n⚠️  Short Session Analysis (Potential Onboarding Issues):');
        shortSessions.forEach(node => {
            console.log(`  ${node.name} (${node.nodeId.substring(0, 8)}): ${Math.round(node.sessionHours * 60)}min, ${node.jobsCompleted} jobs`);
        });
    }

    // Productivity analysis
    const productiveNodes = sessions.filter(s => s.jobsCompleted > 0);
    const idleNodes = sessions.filter(s => s.jobsCompleted === 0);

    console.log('\n📈 Productivity Analysis:');
    console.log(`  Productive nodes: ${productiveNodes.length}/${nodes.length} (${Math.round(productiveNodes.length/nodes.length*100)}%)`);
    console.log(`  Idle nodes: ${idleNodes.length}/${nodes.length} (${Math.round(idleNodes.length/nodes.length*100)}%)`);

    if (productiveNodes.length > 0) {
        const avgProductivity = productiveNodes.reduce((sum, n) => sum + n.productivity, 0) / productiveNodes.length;
        console.log(`  Average productivity: ${Math.round(avgProductivity * 100) / 100} jobs/hour`);
        
        console.log('\n🌟 Top Productive Nodes:');
        productiveNodes
            .sort((a, b) => b.productivity - a.productivity)
            .slice(0, 3)
            .forEach(node => {
                console.log(`  ${node.name}: ${node.jobsCompleted} jobs in ${node.sessionHours}h (${Math.round(node.productivity * 100)/100} jobs/h)`);
            });
    }

    // Regional analysis
    const regionMap = {};
    nodes.forEach(node => {
        regionMap[node.region || 'unknown'] = (regionMap[node.region || 'unknown'] || []);
        regionMap[node.region || 'unknown'].push(node);
    });

    console.log('\n🌍 Regional Distribution:');
    Object.entries(regionMap).forEach(([region, nodeList]) => {
        const activeCount = nodeList.filter(n => n.status === 'active').length;
        console.log(`  ${region}: ${nodeList.length} nodes (${activeCount} active)`);
    });

    // Hardware correlation analysis
    const hardwareSegments = {
        highEnd: sessions.filter(s => s.cpuCores >= 8 && s.ramMB >= 16000),
        midRange: sessions.filter(s => s.cpuCores >= 4 && s.cpuCores < 8),
        lowEnd: sessions.filter(s => s.cpuCores < 4)
    };

    console.log('\n💻 Hardware vs Retention:');
    Object.entries(hardwareSegments).forEach(([segment, nodes]) => {
        if (nodes.length > 0) {
            const avgSession = nodes.reduce((sum, n) => sum + n.sessionHours, 0) / nodes.length;
            const retentionRate = nodes.filter(n => n.status === 'active').length / nodes.length * 100;
            console.log(`  ${segment}: ${nodes.length} nodes, avg ${Math.round(avgSession)}h sessions, ${Math.round(retentionRate)}% active`);
        }
    });

    // Generate actionable recommendations
    generateRecommendations(sessions, regionMap, hardwareSegments);
}

function generateRecommendations(sessions, regionMap, hardwareSegments) {
    console.log('\n🎯 Actionable Recommendations:');
    console.log('==============================');

    const activeNodes = sessions.filter(s => s.status === 'active');
    const offlineNodes = sessions.filter(s => s.status === 'offline');
    const shortOfflineNodes = offlineNodes.filter(s => s.sessionHours < 1);
    
    // Onboarding issue detection
    if (shortOfflineNodes.length >= 2) {
        console.log('\n1️⃣  ONBOARDING ISSUE DETECTED');
        console.log(`   ${shortOfflineNodes.length} nodes disconnected within 1 hour`);
        console.log('   Recommendation: Add onboarding health checks and troubleshooting guide');
        console.log('   Action: Create auto-diagnosis tool for new node connections');
    }

    // Retention strategy
    if (offlineNodes.length > activeNodes.length) {
        console.log('\n2️⃣  RETENTION STRATEGY NEEDED');
        console.log('   More nodes offline than active - need retention initiatives');
        console.log('   Recommendation: Implement keepalive checks and reconnection incentives');
        console.log('   Action: Add node health monitoring and automated recovery');
    }

    // Hardware-specific insights
    const highEndActive = hardwareSegments.highEnd.filter(s => s.status === 'active').length;
    const highEndTotal = hardwareSegments.highEnd.length;
    
    if (highEndTotal > 0) {
        const highEndRetention = highEndActive / highEndTotal * 100;
        console.log(`\n3️⃣  HIGH-END HARDWARE RETENTION: ${Math.round(highEndRetention)}%`);
        if (highEndRetention < 50) {
            console.log('   High-end nodes leaving - investigate resource allocation issues');
            console.log('   Action: Review job distribution and ensure premium nodes get priority');
        } else {
            console.log('   High-end hardware showing good retention - scale recruitment');
        }
    }

    // Success pattern identification
    const longActiveNodes = sessions.filter(s => s.status === 'active' && s.sessionHours > 10);
    if (longActiveNodes.length > 0) {
        console.log('\n4️⃣  SUCCESS PATTERN IDENTIFIED');
        console.log('   Nodes that survive >10 hours tend to stay active');
        console.log('   Recommendation: Focus on getting nodes past the 10-hour threshold');
        console.log('   Action: Add 10-hour milestone rewards or engagement triggers');
    }
}

// Run analysis
try {
    analyzeRetentionPatterns();
} catch (error) {
    console.error('Error analyzing retention patterns:', error);
    process.exit(1);
}

db.close();