#!/usr/bin/env node

/**
 * Frigg Node Recovery Monitor
 * 
 * Monitors for frigg node reconnection and job processing recovery
 * Runs continuously and alerts when nodes come back online
 */

const Database = require('better-sqlite3');
const fs = require('fs');

let previousState = {
    offlineNodes: [],
    pendingJobs: 0,
    lastCheck: Date.now()
};

function checkFriggRecovery() {
    const dbPath = './data/mesh.db';
    if (!fs.existsSync(dbPath)) {
        console.error('❌ Database not found');
        return;
    }

    const db = new Database(dbPath, { readonly: true });
    
    // Check frigg nodes status
    const friggNodes = db.prepare(`
        SELECT nodeId, owner, capabilities, lastSeen, jobsCompleted
        FROM nodes 
        WHERE owner = 'drake'
        ORDER BY lastSeen DESC
    `).all();

    // Check pending jobs that need frigg capabilities
    const pendingOcr = db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE status='pending' AND type='ocr'`).get().count;
    const pendingPdf = db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE status='pending' AND type='pdf-extract'`).get().count;
    const pendingTranscribe = db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE status='pending' AND type='transcribe'`).get().count;
    
    const totalPendingCritical = pendingOcr + pendingPdf + pendingTranscribe;

    // Determine which nodes are currently offline (>5min)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    const currentlyOffline = friggNodes
        .filter(node => node.lastSeen < fiveMinutesAgo)
        .map(node => node.nodeId.substring(0, 8));
    
    // Determine which nodes are currently online
    const currentlyOnline = friggNodes
        .filter(node => node.lastSeen >= fiveMinutesAgo)
        .map(node => ({
            id: node.nodeId.substring(0, 8),
            capabilities: JSON.parse(node.capabilities),
            jobsCompleted: node.jobsCompleted
        }));

    const timestamp = new Date().toISOString();
    
    // Check for newly recovered nodes
    const newlyOnline = currentlyOnline.filter(node => 
        previousState.offlineNodes.includes(node.id)
    );
    
    // Check for newly offline nodes
    const newlyOffline = currentlyOffline.filter(nodeId => 
        !previousState.offlineNodes.includes(nodeId)
    );

    // Print status update
    console.log(`\n🔍 [${timestamp.substring(11, 19)}] Frigg Recovery Monitor`);
    console.log(`──────────────────────────────────────────────────────`);
    
    if (newlyOnline.length > 0) {
        console.log('🎉 NODES RECOVERED:');
        newlyOnline.forEach(node => {
            console.log(`   ✅ ${node.id}: ${node.capabilities.join(', ')} (${node.jobsCompleted} jobs completed)`);
        });
    }
    
    if (newlyOffline.length > 0) {
        console.log('⚠️  NODES WENT OFFLINE:');
        newlyOffline.forEach(nodeId => {
            console.log(`   🔴 ${nodeId}`);
        });
    }
    
    console.log(`📊 Status: ${currentlyOnline.length}/${friggNodes.length} nodes online`);
    
    if (currentlyOnline.length > 0) {
        console.log('🟢 Active nodes:');
        currentlyOnline.forEach(node => {
            console.log(`   • ${node.id}: ${node.capabilities.join(', ')}`);
        });
    }
    
    if (currentlyOffline.length > 0) {
        console.log('🔴 Offline nodes:', currentlyOffline.join(', '));
    }
    
    console.log(`📋 Critical jobs pending: ${totalPendingCritical} (OCR: ${pendingOcr}, PDF: ${pendingPdf}, transcribe: ${pendingTranscribe})`);
    
    // Check for significant job queue improvement
    const jobQueueImproved = (previousState.pendingJobs - totalPendingCritical) > 10;
    if (jobQueueImproved) {
        console.log(`📈 JOB QUEUE IMPROVED: ${previousState.pendingJobs} → ${totalPendingCritical} (-${previousState.pendingJobs - totalPendingCritical})`);
    }
    
    // Update state for next check
    previousState = {
        offlineNodes: currentlyOffline,
        pendingJobs: totalPendingCritical,
        lastCheck: Date.now()
    };
    
    db.close();
    
    // Return recovery status for external monitoring
    return {
        timestamp,
        nodesOnline: currentlyOnline.length,
        totalNodes: friggNodes.length,
        newlyRecovered: newlyOnline.length,
        criticalJobsPending: totalPendingCritical,
        fullyRecovered: currentlyOnline.length === friggNodes.length && totalPendingCritical < 10
    };
}

// If running as script, start continuous monitoring
if (require.main === module) {
    console.log('🔍 Starting Frigg Node Recovery Monitor...');
    console.log('   Checking every 30 seconds for node recovery');
    console.log('   Press Ctrl+C to stop\n');
    
    // Initial check
    checkFriggRecovery();
    
    // Set up continuous monitoring
    const interval = setInterval(() => {
        try {
            const status = checkFriggRecovery();
            
            // If fully recovered, celebrate and continue monitoring
            if (status.fullyRecovered) {
                console.log('\n🎊 FULL RECOVERY ACHIEVED! All nodes online, job queue clear.');
                console.log('   Continuing to monitor for stability...\n');
            }
        } catch (error) {
            console.error('❌ Monitor error:', error.message);
        }
    }, 30000); // Check every 30 seconds
    
    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n👋 Stopping monitor...');
        clearInterval(interval);
        process.exit(0);
    });
}

module.exports = { checkFriggRecovery };