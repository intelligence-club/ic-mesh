#!/usr/bin/env node
/**
 * Node Onboarding Health Checker
 * 
 * Analyzes why nodes disconnect quickly and provides actionable diagnostics
 * to improve retention rates from current 17% long-term to target 50%+
 */

const Database = require('better-sqlite3');
const fs = require('fs');

function analyzeOnboardingHealth() {
    const db = new Database('data/mesh.db');
    
    console.log('🔍 Node Onboarding Health Analysis');
    console.log('=====================================');
    
    // Get all nodes with registration and last seen times
    const nodes = db.prepare(`
        SELECT nodeId, name, capabilities, lastSeen, registeredAt, 
               jobsCompleted, computeMinutes, flags, owner, region,
               cpuCores, ramMB, diskFreeGB
        FROM nodes 
        ORDER BY registeredAt DESC
    `).all();
    
    const now = Date.now();
    const recentNodes = nodes.filter(node => {
        const sessionDuration = node.lastSeen - node.registeredAt;
        return sessionDuration < (60 * 60 * 1000); // Less than 1 hour
    });
    
    console.log(`\n📊 Quick Disconnect Analysis:`);
    console.log(`   Recent nodes: ${recentNodes.length}/${nodes.length} (${Math.round(recentNodes.length/nodes.length*100)}%)`);
    console.log(`   Quick disconnects: ${recentNodes.length} nodes left within 1 hour`);
    
    // Analyze quick disconnect patterns
    const disconnectPatterns = {
        immediate: [], // <5 minutes
        earlyExit: [], // 5-30 minutes  
        shortSession: [] // 30-60 minutes
    };
    
    recentNodes.forEach(node => {
        const sessionDuration = node.lastSeen - node.registeredAt;
        const durationMinutes = sessionDuration / (1000 * 60);
        
        if (durationMinutes < 5) {
            disconnectPatterns.immediate.push({...node, durationMinutes});
        } else if (durationMinutes < 30) {
            disconnectPatterns.earlyExit.push({...node, durationMinutes});
        } else {
            disconnectPatterns.shortSession.push({...node, durationMinutes});
        }
    });
    
    console.log(`\n🚨 Disconnect Pattern Analysis:`);
    console.log(`   Immediate disconnects (<5min): ${disconnectPatterns.immediate.length}`);
    console.log(`   Early exits (5-30min): ${disconnectPatterns.earlyExit.length}`);
    console.log(`   Short sessions (30-60min): ${disconnectPatterns.shortSession.length}`);
    
    // Analyze immediate disconnects (most critical)
    if (disconnectPatterns.immediate.length > 0) {
        console.log(`\n🔥 Immediate Disconnect Analysis (Critical Issue):`);
        disconnectPatterns.immediate.forEach(node => {
            console.log(`   ${node.name} (${node.nodeId.slice(0,8)}): ${Math.round(node.durationMinutes*60)}s session`);
            console.log(`     Capabilities: ${node.capabilities}`);
            console.log(`     Jobs completed: ${node.jobsCompleted}`);
            console.log(`     Flags: ${node.flags}`);
            
            // Diagnostic suggestions
            const capabilities = JSON.parse(node.capabilities || '[]');
            if (capabilities.length === 0) {
                console.log(`     ⚠️  ISSUE: No capabilities registered - likely setup problem`);
            }
            if (node.jobsCompleted === 0) {
                console.log(`     ⚠️  ISSUE: Never completed a job - possible handler/dependency problem`);
            }
            if (node.cpuCores === 0 && node.ramMB === 0) {
                console.log(`     ⚠️  ISSUE: No hardware info - likely client configuration problem`);
            }
        });
    }
    
    // Success patterns from longer-lived nodes  
    const successfulNodes = nodes.filter(node => {
        const sessionDuration = node.lastSeen - node.registeredAt;
        return sessionDuration >= (10 * 60 * 60 * 1000); // 10+ hours
    });
    
    if (successfulNodes.length > 0) {
        console.log(`\n✅ Success Pattern Analysis:`);
        console.log(`   Long-term nodes: ${successfulNodes.length} (${Math.round(successfulNodes.length/nodes.length*100)}%)`);
        
        successfulNodes.forEach(node => {
            const sessionDuration = node.lastSeen - node.registeredAt;
            const durationHours = sessionDuration / (1000 * 60 * 60);
            console.log(`   ${node.name}: ${Math.round(durationHours)}h session, ${node.jobsCompleted} jobs`);
            
            const capabilities = JSON.parse(node.capabilities || '[]');
            console.log(`     Success factors: ${capabilities.length} capabilities, ${node.computeMinutes}min compute`);
        });
    }
    
    // Generate action plan
    console.log(`\n🎯 Onboarding Health Action Plan:`);
    console.log(`================================`);
    
    if (disconnectPatterns.immediate.length > 0) {
        console.log(`1️⃣  CRITICAL: ${disconnectPatterns.immediate.length} nodes disconnect in <5min`);
        console.log(`   Action: Create pre-flight check system before node registration`);
        console.log(`   Fix: Add capability validation, dependency checks, test job flow`);
    }
    
    if (recentNodes.length / nodes.length > 0.5) {
        console.log(`2️⃣  HIGH PRIORITY: ${Math.round(recentNodes.length/nodes.length*100)}% quick disconnect rate`);
        console.log(`   Action: Add onboarding tutorial and health monitoring`);
        console.log(`   Fix: Implement 24-hour new node support protocol`);
    }
    
    if (successfulNodes.length === 0) {
        console.log(`3️⃣  URGENT: No long-term successful nodes identified`);
        console.log(`   Action: Create node operator success program`);
        console.log(`   Fix: Add retention incentives and engagement tracking`);
    }
    
    // Hardware correlation analysis
    const hardwareIssues = recentNodes.filter(node => 
        node.cpuCores === 0 || node.ramMB === 0 || node.diskFreeGB === 0
    );
    
    if (hardwareIssues.length > 0) {
        console.log(`4️⃣  SETUP ISSUE: ${hardwareIssues.length} nodes missing hardware info`);
        console.log(`   Action: Add hardware detection validation to client setup`);
        console.log(`   Fix: Create hardware diagnostic tool and setup verification`);
    }
    
    db.close();
    
    // Generate recommended fixes
    const fixes = {
        immediate: disconnectPatterns.immediate.length,
        earlyExit: disconnectPatterns.earlyExit.length,
        shortSession: disconnectPatterns.shortSession.length,
        totalQuickDisconnects: recentNodes.length,
        successRate: Math.round((nodes.length - recentNodes.length) / nodes.length * 100),
        recommendations: []
    };
    
    if (fixes.immediate > 0) {
        fixes.recommendations.push({
            priority: 'CRITICAL',
            issue: `${fixes.immediate} immediate disconnects`,
            action: 'Create node pre-flight checker',
            impact: 'Could improve retention by 20-30%'
        });
    }
    
    if (fixes.successRate < 30) {
        fixes.recommendations.push({
            priority: 'HIGH', 
            issue: `${fixes.successRate}% success rate`,
            action: 'Implement onboarding health monitoring',
            impact: 'Target 50%+ long-term retention'
        });
    }
    
    return fixes;
}

// Auto-generation of fixes based on analysis
function generateNodeHealthFixes(analysis) {
    console.log(`\n🛠️  Auto-Generated Health Fixes:`);
    console.log(`=================================`);
    
    if (analysis.immediate > 0) {
        console.log(`\n📋 Pre-Flight Checker (for ${analysis.immediate} immediate disconnects):`);
        console.log(`   1. Validate capabilities array not empty`);
        console.log(`   2. Test basic HTTP connectivity to mesh server`);
        console.log(`   3. Verify handler binaries exist and are executable`);
        console.log(`   4. Run test job completion flow before registration`);
        console.log(`   5. Check system resources (CPU, RAM, disk space)`);
    }
    
    if (analysis.earlyExit > 0) {
        console.log(`\n⏰ Early Exit Prevention (for ${analysis.earlyExit} early exits):`);
        console.log(`   1. Add 5-minute health check after registration`);
        console.log(`   2. Send welcome message with troubleshooting tips`);
        console.log(`   3. Monitor for failed job attempts and provide assistance`);
        console.log(`   4. Add node operator dashboard with real-time health`);
    }
    
    if (analysis.successRate < 50) {
        console.log(`\n🎯 Retention Improvement Program:`);
        console.log(`   Current success rate: ${analysis.successRate}%`);
        console.log(`   Target: 50%+ long-term retention`);
        console.log(`   1. Create 24-hour new operator support program`);
        console.log(`   2. Add milestone achievements (first job, first hour, first day)`);
        console.log(`   3. Implement proactive health monitoring and alerts`);
        console.log(`   4. Create operator success metrics dashboard`);
    }
}

if (require.main === module) {
    try {
        const analysis = analyzeOnboardingHealth();
        generateNodeHealthFixes(analysis);
        
        console.log(`\n✅ Analysis complete. See recommendations above.`);
        console.log(`   Run this tool regularly to monitor onboarding health improvements.`);
    } catch (error) {
        console.error('❌ Error analyzing onboarding health:', error.message);
        process.exit(1);
    }
}

module.exports = { analyzeOnboardingHealth, generateNodeHealthFixes };