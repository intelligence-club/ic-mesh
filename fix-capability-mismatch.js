#!/usr/bin/env node

/**
 * Fix capability matching issues that prevent job claiming
 * 
 * Issue: Jobs require "transcribe" but node has "transcription" capability
 * This script harmonizes capability names to enable proper job matching
 */

const Database = require('better-sqlite3');
const db = new Database('./data/mesh.db');

console.log('🔧 Fixing capability mismatches...\n');

try {
  // Check current state
  const nodes = db.prepare('SELECT nodeId, name, capabilities FROM nodes').all();
  console.log('📋 Current node capabilities:');
  nodes.forEach(node => {
    const caps = JSON.parse(node.capabilities);
    console.log(`  ${node.name}: ${caps.join(', ')}`);
  });
  console.log('');

  // Fix transcription -> transcribe capability mismatch
  let fixed = 0;
  nodes.forEach(node => {
    const caps = JSON.parse(node.capabilities);
    let modified = false;

    // If node has "transcription" but not "transcribe", add "transcribe"
    if (caps.includes('transcription') && !caps.includes('transcribe')) {
      caps.push('transcribe');
      modified = true;
      console.log(`✅ Added "transcribe" capability to ${node.name}`);
    }

    // Update database if capabilities were modified
    if (modified) {
      db.prepare('UPDATE nodes SET capabilities = ? WHERE nodeId = ?')
        .run(JSON.stringify(caps), node.nodeId);
      fixed++;
    }
  });

  console.log('');

  if (fixed > 0) {
    console.log(`🎯 Fixed ${fixed} capability mismatches`);
    
    // Verify the fix
    const updatedNodes = db.prepare('SELECT nodeId, name, capabilities FROM nodes').all();
    console.log('\n📋 Updated node capabilities:');
    updatedNodes.forEach(node => {
      const caps = JSON.parse(node.capabilities);
      console.log(`  ${node.name}: ${caps.join(', ')}`);
    });

    // Check if this helps with pending jobs
    const pendingTranscribe = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending' AND type = 'transcribe'").get();
    const nodesWithTranscribe = updatedNodes.filter(node => {
      const caps = JSON.parse(node.capabilities);
      return caps.includes('transcribe');
    });

    console.log(`\n📊 Impact: ${pendingTranscribe.count} pending transcribe jobs, ${nodesWithTranscribe.length} nodes with transcribe capability`);
    
  } else {
    console.log('✅ No capability mismatches found');
  }

} catch (error) {
  console.error('❌ Error fixing capabilities:', error.message);
  process.exit(1);
} finally {
  db.close();
}