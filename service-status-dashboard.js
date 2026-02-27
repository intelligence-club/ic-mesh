#!/usr/bin/env node

/**
 * Service Status Dashboard
 * Real-time service availability and performance monitoring
 */

const Database = require('better-sqlite3');

const db = new Database('./data/mesh.db', { readonly: true });

function displayServiceStatus() {
  console.clear();
  
  const now = new Date();
  console.log(`🖥️  IC Mesh Service Status Dashboard`);
  console.log(`📅 ${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]} UTC`);
  console.log('═'.repeat(60));
  
  // Service availability check
  const activeNodes = db.prepare("SELECT COUNT(*) as count FROM nodes WHERE lastSeen > ?").get(Date.now() - (5 * 60 * 1000)).count;
  const totalNodes = db.prepare("SELECT COUNT(*) as count FROM nodes").get().count;
  
  console.log(`\n🔄 SERVICE AVAILABILITY`);
  console.log('─'.repeat(30));
  
  // Check each service
  const services = [
    { name: 'Transcription', capability: 'transcription', priority: 'HIGH' },
    { name: 'OCR', capability: 'tesseract', priority: 'MEDIUM' },
    { name: 'PDF Extract', capability: 'tesseract', priority: 'MEDIUM' },
    { name: 'Whisper', capability: 'whisper', priority: 'LOW' },
    { name: 'Stable Diffusion', capability: 'stable-diffusion', priority: 'LOW' }
  ];
  
  services.forEach(service => {
    const capabilityNodes = db.prepare(`
      SELECT COUNT(*) as count 
      FROM nodes 
      WHERE lastSeen > ? 
      AND json_extract(capabilities, '$') LIKE ?
    `).get(Date.now() - (5 * 60 * 1000), `%${service.capability}%`).count;
    
    const pendingJobs = service.capability === 'tesseract' 
      ? db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending' AND (type = 'ocr' OR type = 'pdf-extract')").get().count
      : db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending' AND type = ?").get(service.name.toLowerCase().replace(' ', '-')).count;
    
    const status = capabilityNodes > 0 ? '🟢 ONLINE' : '🔴 OFFLINE';
    const priority = service.priority === 'HIGH' ? '🚨' : service.priority === 'MEDIUM' ? '⚠️' : '💡';
    
    console.log(`${priority} ${service.name.padEnd(15)} ${status} (${capabilityNodes} nodes, ${pendingJobs} jobs)`);
  });
  
  // Current processing activity
  const claimedJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'claimed'").get().count;
  const recentCompleted = db.prepare(`
    SELECT COUNT(*) as count 
    FROM jobs 
    WHERE status = 'completed' 
    AND completedAt > ?
  `).get(Date.now() - (5 * 60 * 1000)).count;
  
  console.log(`\n⚡ PROCESSING ACTIVITY`);
  console.log('─'.repeat(30));
  console.log(`🔄 Currently processing: ${claimedJobs} jobs`);
  console.log(`✅ Completed (5min): ${recentCompleted} jobs`);
  console.log(`🖥️  Active nodes: ${activeNodes}/${totalNodes}`);
  
  // Queue status
  const pendingByType = db.prepare(`
    SELECT type, COUNT(*) as count 
    FROM jobs 
    WHERE status = 'pending' 
    GROUP BY type 
    ORDER BY count DESC
  `).all();
  
  console.log(`\n📋 PENDING QUEUE`);
  console.log('─'.repeat(30));
  if (pendingByType.length === 0) {
    console.log(`✨ Queue empty - all caught up!`);
  } else {
    pendingByType.forEach(row => {
      console.log(`📦 ${row.type}: ${row.count} jobs`);
    });
  }
  
  // Performance metrics
  const totalJobs = db.prepare("SELECT COUNT(*) as count FROM jobs").get().count;
  const completedJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'").get().count;
  const failedJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'").get().count;
  
  const successRate = completedJobs + failedJobs > 0 ? Math.round(completedJobs/(completedJobs + failedJobs) * 100) : 0;
  
  console.log(`\n📊 PERFORMANCE METRICS`);
  console.log('─'.repeat(30));
  console.log(`🎯 Success rate: ${successRate}%`);
  console.log(`📈 Total processed: ${completedJobs}/${totalJobs}`);
  console.log(`🚫 Failed jobs: ${failedJobs}`);
  
  // Overall health assessment
  let healthScore = 0;
  
  // Critical services online
  const transcriptionOnline = db.prepare(`
    SELECT COUNT(*) as count 
    FROM nodes 
    WHERE lastSeen > ? 
    AND json_extract(capabilities, '$') LIKE '%transcription%'
  `).get(Date.now() - (5 * 60 * 1000)).count > 0;
  
  if (transcriptionOnline) healthScore += 50;
  if (activeNodes > 0) healthScore += 20;
  if (successRate > 90) healthScore += 20;
  if (claimedJobs > 0) healthScore += 10; // Processing activity
  
  console.log(`\n🏥 OVERALL HEALTH`);
  console.log('─'.repeat(30));
  console.log(`💚 Health score: ${healthScore}/100`);
  
  if (healthScore >= 80) {
    console.log(`🟢 Status: EXCELLENT - All systems operational`);
  } else if (healthScore >= 60) {
    console.log(`🟡 Status: GOOD - Minor service limitations`);
  } else if (healthScore >= 40) {
    console.log(`🟠 Status: DEGRADED - Significant service impact`);
  } else {
    console.log(`🔴 Status: CRITICAL - Major service outage`);
  }
  
  console.log(`\n🔄 Updated: ${now.toISOString()}`);
  console.log('═'.repeat(60));
  
  db.close();
}

// CLI options
const args = process.argv.slice(2);
if (args.includes('--watch') || args.includes('-w')) {
  // Watch mode - update every 10 seconds
  displayServiceStatus();
  setInterval(displayServiceStatus, 10000);
} else {
  // Single run
  displayServiceStatus();
}