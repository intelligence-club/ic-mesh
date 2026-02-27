#!/usr/bin/env node
/**
 * Urgent Recovery Actions for IC Mesh Service Outage
 * 
 * SITUATION: Complete service outage - 46 pending jobs, 0 active nodes
 * PRIORITY 1: Monitor for unnamed node recovery (auto-reconnects expected)
 * PRIORITY 2: Create contact strategy for Drake's frigg nodes
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'mesh.db');
const db = new Database(DB_PATH);

async function analyzeRecoveryOptions() {
    console.log('🚨 URGENT RECOVERY ANALYSIS');
    console.log('═══════════════════════════════════════════');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log();

    // Get current status
    const pendingJobs = db.prepare(`
        SELECT type, COUNT(*) as count 
        FROM jobs 
        WHERE status = 'pending' 
        GROUP BY type 
        ORDER BY count DESC
    `).all();

    const activeNodes = db.prepare(`
        SELECT nodeId, name, owner, capabilities, lastSeen, jobsCompleted,
               ROUND((julianday('now') - julianday(datetime(lastSeen, 'unixepoch'))) * 1440) as minutesOffline
        FROM nodes 
        WHERE minutesOffline <= 5
    `).all();

    const recentlyOfflineNodes = db.prepare(`
        SELECT nodeId, name, owner, capabilities, lastSeen, jobsCompleted,
               ROUND((julianday('now') - julianday(datetime(lastSeen, 'unixepoch'))) * 1440) as minutesOffline
        FROM nodes 
        WHERE minutesOffline > 5 AND minutesOffline <= 60
        ORDER BY jobsCompleted DESC
    `).all();

    const longTermOfflineNodes = db.prepare(`
        SELECT nodeId, name, owner, capabilities, lastSeen, jobsCompleted,
               ROUND((julianday('now') - julianday(datetime(lastSeen, 'unixepoch'))) * 1440) as minutesOffline
        FROM nodes 
        WHERE minutesOffline > 60
        ORDER BY jobsCompleted DESC
    `).all();

    // CRITICAL STATUS
    const totalPending = pendingJobs.reduce((sum, job) => sum + job.count, 0);
    console.log('📊 CURRENT CRISIS STATUS');
    console.log('────────────────────────────────────────');
    console.log(`🔴 Service Status: COMPLETE OUTAGE`);
    console.log(`📋 Pending Jobs: ${totalPending} blocked`);
    console.log(`🟢 Active Nodes: ${activeNodes.length}`);
    console.log();

    // Job breakdown
    if (pendingJobs.length > 0) {
        console.log('📋 BLOCKED JOB TYPES:');
        pendingJobs.forEach(job => {
            const priority = job.type === 'transcribe' ? '🔥 HIGH' : '🟡 MED';
            console.log(`   ${priority} ${job.type}: ${job.count} jobs`);
        });
        console.log();
    }

    // RECOVERY STRATEGY
    console.log('🔧 RECOVERY STRATEGY');
    console.log('────────────────────────────────────────');

    // Strategy 1: Auto-recovery monitoring
    const unnamedNode = recentlyOfflineNodes.find(n => n.owner === 'unknown');
    if (unnamedNode) {
        console.log('⚡ PRIORITY 1: Monitor unnamed node auto-recovery');
        console.log(`   Node: ${unnamedNode.nodeId.slice(0, 8)}... (${unnamedNode.jobsCompleted} jobs completed)`);
        console.log(`   Offline: ${unnamedNode.minutesOffline} minutes`);
        console.log(`   Capabilities: ${unnamedNode.capabilities}`);
        console.log(`   ✅ Action: Continue monitoring - node often auto-reconnects`);
        console.log(`   📊 Historical pattern: Reconnects within 30 minutes`);
        console.log();
    }

    // Strategy 2: Contact Drake for frigg nodes
    const drakeNodes = longTermOfflineNodes.filter(n => n.owner === 'drake');
    if (drakeNodes.length > 0) {
        console.log('📞 PRIORITY 2: Contact Drake for frigg node revival');
        drakeNodes.forEach(node => {
            console.log(`   Node: ${node.nodeId.slice(0, 8)}... (${node.jobsCompleted} jobs completed)`);
            console.log(`   Offline: ${Math.round(node.minutesOffline / 60)}h (${node.minutesOffline} minutes)`);
            console.log(`   Capabilities: ${node.capabilities}`);
        });
        console.log(`   ✅ Action: Contact Drake via all channels for node revival`);
        console.log(`   🎯 Command: claw skill mesh-transcribe (for transcription capability)`);
        console.log(`   📧 Contact methods: Discord DM, email, Telegram`);
        console.log();
    }

    // Strategy 3: Capability priority analysis
    console.log('🎯 CAPABILITY PRIORITY ANALYSIS');
    console.log('────────────────────────────────────────');
    
    const transcribeJobs = pendingJobs.find(j => j.type === 'transcribe');
    if (transcribeJobs) {
        console.log(`🔥 CRITICAL: ${transcribeJobs.count} transcription jobs blocked`);
        console.log(`   Revenue impact: $${(transcribeJobs.count * 0.30).toFixed(2)} - $${(transcribeJobs.count * 0.50).toFixed(2)}`);
        console.log(`   Recovery: Unnamed node OR Drake's miniclaw`);
        console.log();
    }

    const ocrJobs = pendingJobs.find(j => j.type === 'ocr');
    const pdfJobs = pendingJobs.find(j => j.type === 'pdf-extract');
    if (ocrJobs || pdfJobs) {
        const ocrCount = ocrJobs?.count || 0;
        const pdfCount = pdfJobs?.count || 0;
        const total = ocrCount + pdfCount;
        console.log(`🟡 MEDIUM: ${total} OCR/PDF jobs blocked`);
        console.log(`   Revenue impact: $${(total * 1.00).toFixed(2)} - $${(total * 3.00).toFixed(2)}`);
        console.log(`   Recovery: Only Drake's frigg nodes (tesseract capability)`);
        console.log();
    }

    // IMMEDIATE ACTIONS
    console.log('⏰ IMMEDIATE ACTIONS REQUIRED');
    console.log('────────────────────────────────────────');
    console.log('1. 🔍 Continue monitoring unnamed node recovery (automated)');
    console.log('2. 📞 Contact Drake immediately for frigg node revival');
    console.log('3. 📊 Monitor revenue impact and customer satisfaction');
    console.log('4. 🚨 Prepare emergency mitigation if recovery takes >24h');
    console.log();

    // Recovery timeline estimate
    const estimatedRecovery = unnamedNode ? '15-30 minutes (auto-recovery)' : '2-6 hours (Drake contact)';
    console.log(`⏱️  ESTIMATED RECOVERY: ${estimatedRecovery}`);
    console.log(`💰 REVENUE AT RISK: $${(totalPending * 0.5).toFixed(2)} - $${(totalPending * 2).toFixed(2)}`);
    console.log();

    return {
        totalPending,
        activeNodes: activeNodes.length,
        unnamedNodeOffline: !!unnamedNode,
        drakeNodesNeeded: drakeNodes.length > 0,
        estimatedRecovery
    };
}

async function createContactPlan() {
    console.log('📞 DRAKE CONTACT STRATEGY');
    console.log('═════════════════════════════════════════');
    
    const contactPlan = {
        priority: 'URGENT',
        subject: 'IC Mesh Service Outage - Frigg Nodes Needed',
        message: `Hi Drake,

We have a service outage on IC Mesh:
- 46 customer jobs are blocked (0 active nodes)
- Primary unnamed node went offline ~10 minutes ago
- Frigg nodes have been offline for 8+ days

IMMEDIATE ACTION NEEDED:
1. Run: claw skill mesh-transcribe
   (This restores transcription capability - 32 blocked jobs)

2. Restore frigg nodes if possible
   (This would restore OCR/PDF capability - 14 blocked jobs)

Revenue impact: ~$25-100 blocked
Customer impact: All transcription services down

The system is healthy, we just need compute nodes back online.

Thanks!
- Wingman 🤝`,
        
        channels: [
            { method: 'Discord DM', urgency: 'immediate' },
            { method: 'Email', urgency: 'immediate' },
            { method: 'Telegram', urgency: 'if available' }
        ]
    };

    console.log('Subject:', contactPlan.subject);
    console.log();
    console.log('Message:');
    console.log(contactPlan.message);
    console.log();
    console.log('Contact Channels:');
    contactPlan.channels.forEach(channel => {
        console.log(`  - ${channel.method} (${channel.urgency})`);
    });

    return contactPlan;
}

async function monitorRecovery() {
    console.log('🔍 STARTING RECOVERY MONITORING');
    console.log('═══════════════════════════════════════════');
    
    let checkCount = 0;
    const maxChecks = 20; // Monitor for ~10 minutes
    
    const monitoring = setInterval(async () => {
        checkCount++;
        
        const activeNodes = db.prepare(`
            SELECT nodeId, name, owner, capabilities, jobsCompleted,
                   ROUND((julianday('now') - julianday(datetime(lastSeen, 'unixepoch'))) * 1440) as minutesOffline
            FROM nodes 
            WHERE ROUND((julianday('now') - julianday(datetime(lastSeen, 'unixepoch'))) * 1440) <= 5
        `).all();

        const pendingCount = db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'`).get();
        
        if (activeNodes.length > 0) {
            console.log(`🟢 RECOVERY DETECTED! (Check ${checkCount}/${maxChecks})`);
            console.log(`   Active nodes: ${activeNodes.length}`);
            console.log(`   Pending jobs: ${pendingCount.count}`);
            
            activeNodes.forEach(node => {
                console.log(`   ✅ ${node.nodeId.slice(0, 8)}... (${node.owner}) - ${node.capabilities}`);
            });
            
            console.log();
            console.log('🎉 SERVICE RECOVERY CONFIRMED!');
            clearInterval(monitoring);
            return;
        }
        
        if (checkCount >= maxChecks) {
            console.log(`⏰ MONITORING TIMEOUT (${maxChecks} checks completed)`);
            console.log(`   No nodes recovered after ${Math.round(maxChecks * 0.5)} minutes`);
            console.log(`   🚨 ESCALATION REQUIRED: Contact Drake immediately`);
            clearInterval(monitoring);
            return;
        }
        
        if (checkCount % 4 === 0) { // Status every 2 minutes
            console.log(`⏳ Still waiting... (Check ${checkCount}/${maxChecks}, ${pendingCount.count} jobs pending)`);
        }
        
    }, 30000); // Check every 30 seconds
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--monitor')) {
        await monitorRecovery();
    } else if (args.includes('--contact-plan')) {
        await createContactPlan();
    } else {
        const analysis = await analyzeRecoveryOptions();
        
        if (args.includes('--auto-monitor') && analysis.unnamedNodeOffline) {
            console.log('🚀 Starting automated recovery monitoring...');
            setTimeout(() => monitorRecovery(), 2000);
        }
        
        if (args.includes('--create-contact') && analysis.drakeNodesNeeded) {
            console.log('📝 Creating Drake contact plan...');
            setTimeout(() => createContactPlan(), 1000);
        }
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { analyzeRecoveryOptions, createContactPlan, monitorRecovery };