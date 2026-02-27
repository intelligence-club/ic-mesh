#!/usr/bin/env node
/**
 * Capacity Optimizer - Helps manage high job loads
 * - Identifies processing bottlenecks
 * - Suggests capacity improvements
 * - Provides performance recommendations
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/mesh.db');

try {
  const db = new Database(dbPath);
  
  console.log('🚀 IC Mesh Capacity Optimizer\n');

  // Current capacity analysis
  const activeNodes = db.prepare('SELECT * FROM nodes WHERE lastSeen > ?').all(Date.now() - 300000);
  const pending = db.prepare('SELECT type, COUNT(*) as count FROM jobs WHERE status = ? GROUP BY type').all('pending');
  const processing = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('claimed');
  
  console.log('📊 Current Load:');
  console.log(`  Active nodes: ${activeNodes.length}`);
  console.log(`  Jobs processing: ${processing.count}`);
  
  if (pending.length > 0) {
    console.log('  Jobs pending:');
    pending.forEach(p => console.log(`    • ${p.type}: ${p.count} jobs`));
  }
  
  // Processing rate analysis
  const recentCompleted = db.prepare(`
    SELECT type, COUNT(*) as completed, 
           AVG(completedAt - claimedAt) as avgTime,
           MIN(completedAt - claimedAt) as minTime,
           MAX(completedAt - claimedAt) as maxTime
    FROM jobs 
    WHERE status = 'completed' AND completedAt > ? 
    GROUP BY type
  `).all(Date.now() - 3600000); // Last hour
  
  console.log('\n⚡ Performance (last hour):');
  if (recentCompleted.length > 0) {
    recentCompleted.forEach(rc => {
      const avgSeconds = Math.round(rc.avgTime / 1000);
      const throughput = rc.completed;
      console.log(`  • ${rc.type}: ${rc.completed} completed, avg ${avgSeconds}s/job`);
    });
  } else {
    console.log('  No completed jobs in last hour');
  }
  
  // Capacity recommendations
  console.log('\n💡 Capacity Analysis:');
  
  const totalPending = pending.reduce((sum, p) => sum + p.count, 0);
  
  if (totalPending === 0) {
    console.log('  ✅ No backlog - capacity is sufficient');
  } else {
    // Analyze by capability requirements
    const transcribePending = pending.find(p => p.type === 'transcribe')?.count || 0;
    const ocrPending = pending.find(p => p.type === 'ocr')?.count || 0;
    const pdfPending = pending.find(p => p.type === 'pdf-extract')?.count || 0;
    
    const transcribeNodes = activeNodes.filter(n => {
      const caps = JSON.parse(n.capabilities || '[]');
      return caps.includes('transcription') || caps.includes('whisper');
    }).length;
    
    const tesseractNodes = activeNodes.filter(n => {
      const caps = JSON.parse(n.capabilities || '[]');
      return caps.includes('tesseract');
    }).length;
    
    console.log('  Capability gaps:');
    if (transcribePending > 0) {
      console.log(`    📝 Transcription: ${transcribePending} jobs, ${transcribeNodes} nodes`);
      if (transcribeNodes === 0) {
        console.log('      🔴 CRITICAL: No transcription nodes available');
      } else if (transcribePending > transcribeNodes * 10) {
        console.log('      🟡 HIGH LOAD: Consider adding transcription nodes');
      }
    }
    
    if (ocrPending + pdfPending > 0) {
      console.log(`    🔍 OCR/PDF: ${ocrPending + pdfPending} jobs, ${tesseractNodes} nodes`);
      if (tesseractNodes === 0) {
        console.log('      🔴 CRITICAL: No tesseract nodes available');
      }
    }
    
    // Processing rate recommendations
    const processingRate = recentCompleted.reduce((sum, rc) => sum + rc.completed, 0);
    if (processingRate > 0) {
      const hoursToComplete = totalPending / processingRate;
      if (hoursToComplete > 2) {
        console.log(`    ⏰ ETA: ~${Math.round(hoursToComplete)}h to clear current backlog`);
        console.log('      💭 Consider: recruiting additional nodes');
      }
    }
  }
  
  // Node efficiency analysis
  if (activeNodes.length > 0) {
    console.log('\n🖥️  Node Performance:');
    activeNodes.forEach(node => {
      const caps = JSON.parse(node.capabilities || '[]');
      const completed = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE claimedBy = ? AND status = ?').get(node.nodeId, 'completed');
      const minutesActive = Math.round((Date.now() - node.registeredAt) / 60000);
      const jobsPerHour = minutesActive > 0 ? Math.round((completed.count / minutesActive) * 60) : 0;
      
      console.log(`  • ${node.name}: ${completed.count} jobs, ${jobsPerHour}/hour rate`);
      console.log(`    Capabilities: [${caps.join(', ')}]`);
    });
  }
  
  db.close();
  
} catch (error) {
  console.error('❌ Error:', error.message);
}