#!/usr/bin/env node

/**
 * EMERGENCY CONTACT SYSTEM - Rapid node owner notification for outages
 * Created during 2026-02-27 service outage for automated escalation
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const db = new Database(path.join(__dirname, '../data/mesh.db'), { readonly: true });

// Contact methods and commands for known node owners
const CONTACT_DATABASE = {
  'drake': {
    discord: '@Drake',
    email: 'drakew@gmail.com',
    signal: 'available',
    command: 'claw skill mesh-transcribe',
    urgency: 'immediate'
  },
  'unknown': {
    method: 'impossible',
    note: 'Anonymous node - no contact method available'
  }
};

function analyzeOutage() {
  const now = Date.now();
  const ACTIVE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
  
  // Get offline customer-capable nodes
  const offlineNodes = db.prepare(`
    SELECT nodeId, name, lastSeen, capabilities, jobsCompleted, owner 
    FROM nodes 
    ORDER BY jobsCompleted DESC
  `).all().filter(node => {
    const isOffline = (now - node.lastSeen) > ACTIVE_THRESHOLD;
    const capabilities = JSON.parse(node.capabilities || '[]');
    const canServeCustomers = capabilities.some(cap => 
      ['transcribe', 'transcription', 'whisper', 'ocr', 'tesseract', 'pdf-extract'].includes(cap)
    );
    return isOffline && canServeCustomers;
  });
  
  // Get pending job impact
  const pendingJobs = db.prepare(`
    SELECT COUNT(*) as count 
    FROM jobs 
    WHERE status = 'pending'
  `).get();
  
  return {
    offlineNodes,
    pendingJobs: pendingJobs.count,
    revenue: `$${Math.floor(pendingJobs.count * 0.3)}-${Math.floor(pendingJobs.count * 0.5)}`
  };
}

function generateContactPlan(analysis) {
  console.log('🚨 EMERGENCY CONTACT PLAN');
  console.log('═'.repeat(50));
  console.log(`📊 Impact: ${analysis.pendingJobs} jobs blocked (${analysis.revenue} at risk)`);
  console.log(`🎯 Targets: ${analysis.offlineNodes.length} offline nodes\n`);
  
  const contactPlan = [];
  
  analysis.offlineNodes.forEach((node, priority) => {
    const minutesOffline = Math.floor((Date.now() - node.lastSeen) / 60000);
    const owner = node.owner || 'unknown';
    const contact = CONTACT_DATABASE[owner] || CONTACT_DATABASE['unknown'];
    
    console.log(`${priority + 1}. CONTACT TARGET: ${node.nodeId.substring(0,8)} (${node.name || 'unnamed'})`);
    console.log(`   Owner: ${owner}`);
    console.log(`   Performance: ${node.jobsCompleted} jobs completed`);
    console.log(`   Offline: ${Math.floor(minutesOffline/60)}h ${minutesOffline%60}m`);
    
    if (contact.method === 'impossible') {
      console.log(`   ❌ CANNOT CONTACT: ${contact.note}`);
    } else {
      console.log(`   📱 Contact methods:`);
      if (contact.discord) console.log(`      Discord: ${contact.discord}`);
      if (contact.email) console.log(`      Email: ${contact.email}`);
      if (contact.signal) console.log(`      Signal: ${contact.signal}`);
      
      console.log(`   ⚡ Recovery command: ${contact.command}`);
      console.log(`   🚨 Urgency: ${contact.urgency}`);
      
      // Generate contact scripts
      const discordMessage = `🚨 URGENT: IC Mesh service outage\\n\\n` +
        `${analysis.pendingJobs} customer jobs blocked (${analysis.revenue} revenue at risk)\\n` +
        `Your node "${node.name || node.nodeId.substring(0,8)}" has been offline for ${Math.floor(minutesOffline/60)}h ${minutesOffline%60}m\\n\\n` +
        `Please run: \`${contact.command}\`\\n\\n` +
        `This is a complete service outage - immediate attention needed.`;
      
      contactPlan.push({
        priority: priority + 1,
        owner,
        nodeId: node.nodeId.substring(0,8),
        discordMessage,
        command: contact.command
      });
    }
    console.log('');
  });
  
  return contactPlan;
}

function generateCopyPasteMessages(contactPlan) {
  console.log('📋 COPY-PASTE EMERGENCY MESSAGES');
  console.log('═'.repeat(50));
  
  contactPlan.forEach(plan => {
    console.log(`\\n${plan.priority}. DISCORD MESSAGE FOR ${plan.owner.toUpperCase()}:`);
    console.log('─'.repeat(40));
    console.log(plan.discordMessage);
  });
  
  console.log('\\n🔧 RECOVERY COMMANDS:');
  console.log('─'.repeat(25));
  contactPlan.forEach(plan => {
    console.log(`${plan.owner}: ${plan.command}`);
  });
}

// Main execution
console.log(`\\n⏰ Emergency analysis at ${new Date().toISOString()}\\n`);

const analysis = analyzeOutage();

if (analysis.offlineNodes.length === 0) {
  console.log('✅ NO EMERGENCY: All customer-capable nodes are online\\n');
} else {
  const contactPlan = generateContactPlan(analysis);
  
  if (contactPlan.length > 0) {
    generateCopyPasteMessages(contactPlan);
    
    // Save contact plan for escalation
    const escalationFile = path.join(__dirname, '../data/emergency-contact-plan.json');
    fs.writeFileSync(escalationFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      analysis,
      contactPlan
    }, null, 2));
    
    console.log(`\\n💾 Emergency contact plan saved to: ${escalationFile}\\n`);
  }
}

db.close();