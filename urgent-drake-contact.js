#!/usr/bin/env node

/**
 * Urgent Drake Contact Assistant
 * 
 * Generates immediate contact message for Drake about frigg node crisis
 * Provides copy-pasteable messages for Discord/email
 */

const Database = require('better-sqlite3');
const fs = require('fs');

function generateUrgentMessage() {
    const dbPath = './data/mesh.db';
    const db = new Database(dbPath, { readonly: true });
    
    // Get current crisis stats
    const pendingOcr = db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE status='pending' AND type='ocr'`).get().count;
    const pendingPdf = db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE status='pending' AND type='pdf-extract'`).get().count;
    const pendingTranscribe = db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE status='pending' AND type='transcribe'`).get().count;
    const totalBlocked = pendingOcr + pendingPdf + pendingTranscribe;
    
    // Get frigg node offline duration  
    const friggNodes = db.prepare(`
        SELECT nodeId, lastSeen 
        FROM nodes 
        WHERE owner = 'drake' AND nodeId LIKE '%fcecb481%'
    `).get();
    
    const hoursOffline = friggNodes ? Math.floor((Date.now() - friggNodes.lastSeen) / (1000 * 60 * 60)) : 0;
    const daysOffline = Math.floor(hoursOffline / 24);
    
    // Calculate revenue impact
    const revenueMin = Math.floor(totalBlocked * 0.3);
    const revenueMax = Math.floor(totalBlocked * 0.5);
    
    db.close();
    
    console.log('🚨 URGENT DRAKE CONTACT MESSAGES');
    console.log('══════════════════════════════════════════════════════');
    console.log(`Generated: ${new Date().toISOString()}\n`);
    
    // Discord message
    console.log('📱 DISCORD MESSAGE (copy & paste):');
    console.log('─────────────────────────────────');
    console.log(`🚨 @drake URGENT: Frigg nodes offline ${daysOffline} days`);
    console.log(`📊 Impact: ${totalBlocked} customer jobs blocked (${pendingOcr} OCR, ${pendingPdf} PDF, ${pendingTranscribe} transcribe)`);
    console.log(`💰 Revenue: ~$${revenueMin}-${revenueMax} blocked`);
    console.log(`🔧 Action needed: SSH + restart mesh connection`);
    console.log(`⏰ ETA needed: How soon can you check frigg servers?`);
    console.log('');
    
    // Email subject and body
    console.log('📧 EMAIL (send to drakew@gmail.com):');
    console.log('─────────────────────────────────');
    console.log('Subject: URGENT: IC Mesh Frigg Nodes Offline - Customer Jobs Blocked');
    console.log('');
    console.log('Drake,');
    console.log('');
    console.log(`Critical situation with IC Mesh:`);
    console.log(`• Frigg nodes offline: ${daysOffline} days`);
    console.log(`• Customer jobs blocked: ${totalBlocked} total`);
    console.log(`  - OCR jobs: ${pendingOcr}`);
    console.log(`  - PDF extract: ${pendingPdf}`);
    console.log(`  - Transcription: ${pendingTranscribe}`);
    console.log(`• Revenue impact: $${revenueMin}-${revenueMax} blocked`);
    console.log('');
    console.log('Need immediate frigg node revival:');
    console.log('1. SSH into frigg servers');
    console.log('2. Restart: claw skill mesh-transcribe');
    console.log('3. Verify tesseract/ollama capabilities');
    console.log('');
    console.log('How quickly can you check this? Customers are waiting.');
    console.log('');
    console.log('Thanks,');
    console.log('Primary');
    console.log('');
    
    // Signal message
    console.log('📲 SIGNAL MESSAGE (if available):');
    console.log('─────────────────────────────────');
    console.log(`🚨 Drake - frigg nodes down ${daysOffline}d, ${totalBlocked} jobs blocked, ~$${revenueMin}-${revenueMax}. Need restart ASAP. SSH + "claw skill mesh-transcribe". ETA?`);
    console.log('');
    
    // Follow-up commands
    console.log('🔍 MONITORING COMMANDS:');
    console.log('─────────────────────────────────');
    console.log('# Start recovery monitor:');
    console.log('node monitor-frigg-recovery.js');
    console.log('');
    console.log('# Check current status:');
    console.log('node scripts/quick-queue-analysis.js');
    console.log('');
    console.log('# Verify nodes online:');
    console.log('node scripts/accurate-node-status.js');
    console.log('');
    
    return {
        totalBlocked,
        daysOffline,
        revenueImpact: { min: revenueMin, max: revenueMax }
    };
}

// Run the urgent contact generator
const crisis = generateUrgentMessage();

console.log('🎯 ACTION CHECKLIST:');
console.log('─────────────────────────────────');
console.log('□ Copy Discord message → Send to @drake');
console.log('□ Copy email → Send to drakew@gmail.com'); 
console.log('□ Try Signal if available');
console.log('□ Start monitor: node monitor-frigg-recovery.js');
console.log('□ Document contact attempt in work log');
console.log('');
console.log(`Crisis summary: ${crisis.totalBlocked} jobs blocked, ${crisis.daysOffline}d offline, $${crisis.revenueImpact.min}-${crisis.revenueImpact.max} impact`);