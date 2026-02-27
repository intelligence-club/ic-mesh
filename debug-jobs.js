#!/usr/bin/env node

const Database = require('better-sqlite3');
const db = new Database('./data/mesh.db', { readonly: true });

function aliasCapability(capability) {
  const aliases = {
    'transcription': 'whisper',
    'transcribe': 'whisper', 
    'ocr': 'tesseract',
    'pdf-extract': 'tesseract',
    'inference': 'ollama',
    'generate-image': 'stable-diffusion'
  };
  return aliases[capability] || capability;
}

function jobToJSON(row) {
  return {
    jobId: row.jobId,
    type: row.type,
    payload: JSON.parse(row.payload || '{}'),
    requirements: JSON.parse(row.requirements || '{}'),
    status: row.status,
    createdAt: row.createdAt,
    progress: JSON.parse(row.progress || '{}')
  };
}

function debugGetAvailableJobs(nodeId) {
  const pending = db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY createdAt ASC").all();
  const node = db.prepare('SELECT * FROM nodes WHERE nodeId = ?').get(nodeId);
  
  console.log(`Debug: Found ${pending.length} pending jobs`);
  console.log(`Debug: Node found:`, !!node);
  
  if (!node) {
    console.log('Debug: No node found, returning empty');
    return [];
  }
  
  // Check if node is quarantined
  if (node) {
    const flags = JSON.parse(node.flags || '{}');
    console.log('Debug: Node flags:', flags);
    if (flags.quarantined) {
      console.log('Debug: Node is quarantined, returning empty');
      return [];
    }
  }
  
  const nodeCaps = node ? JSON.parse(node.capabilities || '[]') : [];
  const nodeModels = node ? JSON.parse(node.models || '[]') : [];
  console.log('Debug: Node capabilities:', nodeCaps);
  console.log('Debug: Node models:', nodeModels);
  
  const filtered = pending.filter((row, index) => {
    console.log(`\nDebug: Checking job ${index + 1}/${pending.length}: ${row.jobId}`);
    
    const req = JSON.parse(row.requirements || '{}');
    console.log('Debug: Job requirements:', req);
    
    if (req.capability) {
      const requiredCap = aliasCapability(req.capability);
      console.log(`Debug: Required capability (original): ${req.capability}`);
      console.log(`Debug: Required capability (aliased): ${requiredCap}`);
      console.log(`Debug: Node has aliased: ${nodeCaps.includes(requiredCap)}`);
      console.log(`Debug: Node has original: ${nodeCaps.includes(req.capability)}`);
      
      // Updated logic: check both original and aliased
      if (!nodeCaps.includes(requiredCap) && !nodeCaps.includes(req.capability)) {
        console.log('Debug: REJECTED - capability mismatch');
        return false;
      }
      console.log('Debug: PASSED capability check');
    }
    
    if (req.model && !nodeModels.includes(req.model)) {
      console.log(`Debug: REJECTED - model mismatch: required ${req.model}, node has [${nodeModels.join(', ')}]`);
      return false;
    }
    
    if (req.minRAM && node && node.ramFreeMB < req.minRAM) {
      console.log(`Debug: REJECTED - RAM insufficient: required ${req.minRAM}MB, node has ${node.ramFreeMB}MB`);
      return false;
    }
    
    console.log('Debug: ACCEPTED - all checks passed');
    return true;
  }).map(jobToJSON);
  
  console.log(`\nDebug: Final filtered result: ${filtered.length} jobs`);
  return filtered;
}

// Test the function
const nodeId = '5ef95d698bdfa57a';
console.log(`Testing getAvailableJobs for node: ${nodeId}\n`);

const result = debugGetAvailableJobs(nodeId);
console.log(`\nFinal result count: ${result.length}`);
if (result.length > 0) {
  console.log('Jobs found:');
  result.forEach(job => {
    console.log(`- ${job.jobId}: ${job.type}`);
  });
}

db.close();