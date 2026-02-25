#!/usr/bin/env node
const Database = require('better-sqlite3');
const db = new Database('./data/mesh.db');

console.log('🎯 Capability-Aware Quarantine Management\n');

function updateNodeFlags(nodeId, flags) {
  const flagsJson = JSON.stringify(flags);
  db.prepare('UPDATE nodes SET flags = ? WHERE nodeId LIKE ?').run(flagsJson, nodeId + '%');
}

function getNodeFlags(nodeId) {
  const row = db.prepare('SELECT flags FROM nodes WHERE nodeId LIKE ?').get(nodeId + '%');
  return row ? JSON.parse(row.flags || '{}') : {};
}

const command = process.argv[2];
const nodeId = process.argv[3];
const capability = process.argv[4];

if (!command) {
  console.log('Usage: node capability-quarantine.js <command> [nodeId] [capability]');
  console.log('\nCommands:');
  console.log('  status                           - Show all quarantine statuses');
  console.log('  quarantine-capability <node> <cap> - Block specific capability');
  console.log('  allow-capability <node> <cap>    - Allow specific capability');
  console.log('  full-quarantine <node>           - Block all capabilities');
  console.log('  unquarantine <node>             - Allow all capabilities');
  process.exit(1);
}

switch (command) {
  case 'status':
    const nodes = db.prepare(`
      SELECT nodeId, name, flags, 
             datetime(lastSeen/1000, 'unixepoch') as last_seen 
      FROM nodes 
      WHERE lastSeen > (SELECT (julianday('now') - julianday('1970-01-01 00:00:00')) * 86400 - 3600) * 1000
      ORDER BY lastSeen DESC
    `).all();
    
    nodes.forEach(node => {
      const flags = JSON.parse(node.flags || '{}');
      const shortId = node.nodeId.substring(0, 8);
      console.log(`🖥️  ${node.name} (${shortId}) - ${node.last_seen}`);
      
      if (flags.quarantined) {
        console.log(`  🚫 Full quarantine: ${flags.reason || 'No reason given'}`);
      } else if (flags.blockedCapabilities && flags.blockedCapabilities.length > 0) {
        console.log(`  ⚠️  Blocked capabilities: ${flags.blockedCapabilities.join(', ')}`);
        console.log(`     Reason: ${flags.blockReason || 'Not specified'}`);
      } else {
        console.log(`  ✅ All capabilities allowed`);
      }
      console.log();
    });
    break;

  case 'quarantine-capability':
    if (!nodeId || !capability) {
      console.log('Error: Both nodeId and capability required');
      process.exit(1);
    }
    
    const flags = getNodeFlags(nodeId);
    flags.blockedCapabilities = flags.blockedCapabilities || [];
    if (!flags.blockedCapabilities.includes(capability)) {
      flags.blockedCapabilities.push(capability);
      flags.blockReason = `Capability ${capability} quarantined due to failures`;
      flags.blockDate = new Date().toISOString();
    }
    
    updateNodeFlags(nodeId, flags);
    console.log(`✅ Quarantined ${capability} capability for node ${nodeId}`);
    break;

  case 'allow-capability':
    if (!nodeId || !capability) {
      console.log('Error: Both nodeId and capability required');
      process.exit(1);
    }
    
    const currentFlags = getNodeFlags(nodeId);
    if (currentFlags.blockedCapabilities) {
      currentFlags.blockedCapabilities = currentFlags.blockedCapabilities.filter(c => c !== capability);
      if (currentFlags.blockedCapabilities.length === 0) {
        delete currentFlags.blockedCapabilities;
        delete currentFlags.blockReason;
        delete currentFlags.blockDate;
      }
    }
    
    updateNodeFlags(nodeId, currentFlags);
    console.log(`✅ Allowed ${capability} capability for node ${nodeId}`);
    break;

  case 'full-quarantine':
    if (!nodeId) {
      console.log('Error: nodeId required');
      process.exit(1);
    }
    
    const fullFlags = getNodeFlags(nodeId);
    fullFlags.quarantined = true;
    fullFlags.quarantinedAt = new Date().toISOString();
    fullFlags.reason = 'Full quarantine - all capabilities blocked';
    
    updateNodeFlags(nodeId, fullFlags);
    console.log(`✅ Full quarantine applied to node ${nodeId}`);
    break;

  case 'unquarantine':
    if (!nodeId) {
      console.log('Error: nodeId required');
      process.exit(1);
    }
    
    updateNodeFlags(nodeId, {});
    console.log(`✅ All quarantines removed for node ${nodeId}`);
    break;

  default:
    console.log('Unknown command:', command);
    process.exit(1);
}

db.close();