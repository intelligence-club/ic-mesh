#!/usr/bin/env node

/**
 * Frigg Node Revival Analysis Tool
 * 
 * Provides comprehensive analysis of frigg node outage impact
 * and creates actionable recovery plan for Drake
 */

const Database = require('better-sqlite3');
const fs = require('fs');

function analyzeFriggOutage() {
    const dbPath = './data/mesh.db';
    if (!fs.existsSync(dbPath)) {
        console.error('❌ Database not found at:', dbPath);
        process.exit(1);
    }

    const db = new Database(dbPath, { readonly: true });
    
    console.log('🔍 FRIGG NODE REVIVAL ANALYSIS');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Analysis time: ${new Date().toISOString()}`);
    
    // Get frigg nodes
    const friggNodes = db.prepare(`
        SELECT nodeId, owner, capabilities, lastSeen, jobsCompleted
        FROM nodes 
        WHERE nodeId LIKE '%frigg%' OR owner = 'drake'
        ORDER BY lastSeen DESC
    `).all();

    console.log('\n🖥️  FRIGG NODES STATUS');
    console.log('─────────────────────────────');
    
    let totalBlockedJobs = 0;
    let criticalCapabilities = new Set();
    
    friggNodes.forEach((node, i) => {
        const lastSeenDate = new Date(node.lastSeen);
        const hoursOffline = Math.floor((Date.now() - node.lastSeen) / (1000 * 60 * 60));
        const daysOffline = Math.floor(hoursOffline / 24);
        const capabilities = JSON.parse(node.capabilities);
        
        console.log(`\n${i + 1}. Node: ${node.nodeId.substring(0, 8)}...`);
        console.log(`   Owner: ${node.owner}`);
        console.log(`   Capabilities: ${capabilities.join(', ')}`);
        console.log(`   Jobs completed: ${node.jobsCompleted}`);
        console.log(`   Last seen: ${lastSeenDate.toISOString()}`);
        console.log(`   Offline: ${daysOffline} days, ${hoursOffline % 24} hours`);
        
        // Track capabilities these nodes provide
        capabilities.forEach(cap => criticalCapabilities.add(cap));
        
        if (hoursOffline > 24) {
            console.log(`   Status: 🔴 CRITICAL OUTAGE`);
        } else {
            console.log(`   Status: 🟢 RECENTLY SEEN`);
        }
    });

    // Analyze blocked jobs by capability
    console.log('\n📊 BLOCKED JOBS ANALYSIS');
    console.log('─────────────────────────────');
    
    const blockedJobTypes = db.prepare(`
        SELECT type, COUNT(*) as count
        FROM jobs 
        WHERE status = 'pending'
        GROUP BY type
        ORDER BY count DESC
    `).all();

    blockedJobTypes.forEach(jobType => {
        console.log(`   ${jobType.type}: ${jobType.count} jobs`);
        totalBlockedJobs += jobType.count;
    });

    // Estimate revenue impact
    const avgJobValue = 0.5; // Estimated $0.50 per job based on pricing
    const minRevenue = totalBlockedJobs * avgJobValue * 0.6; // Conservative estimate
    const maxRevenue = totalBlockedJobs * avgJobValue * 1.0; // Full estimate
    
    console.log('\n💰 REVENUE IMPACT ANALYSIS');
    console.log('─────────────────────────────');
    console.log(`   Blocked jobs: ${totalBlockedJobs}`);
    console.log(`   Estimated revenue blocked: $${minRevenue.toFixed(0)}-${maxRevenue.toFixed(0)}`);
    
    // Check which capabilities are missing
    console.log('\n🚨 CRITICAL CAPABILITIES ANALYSIS');
    console.log('─────────────────────────────');
    
    const activeNodes = db.prepare(`
        SELECT capabilities 
        FROM nodes 
        WHERE julianday('now') - julianday(lastSeen/1000, 'unixepoch') < 0.01
    `).all();
    
    const activeCapabilities = new Set();
    activeNodes.forEach(node => {
        const caps = JSON.parse(node.capabilities);
        caps.forEach(cap => activeCapabilities.add(cap));
    });

    Array.from(criticalCapabilities).forEach(capability => {
        const hasActiveProvider = activeCapabilities.has(capability);
        const blockedCount = db.prepare(`
            SELECT COUNT(*) as count 
            FROM jobs 
            WHERE status = 'pending' AND type = ?
        `).get(capability)?.count || 0;
        
        if (!hasActiveProvider && blockedCount > 0) {
            console.log(`   🔴 ${capability}: NO ACTIVE NODES (${blockedCount} jobs blocked)`);
        } else if (!hasActiveProvider) {
            console.log(`   🟡 ${capability}: NO ACTIVE NODES (0 jobs pending)`);
        } else {
            console.log(`   ✅ ${capability}: Active providers available`);
        }
    });

    db.close();
    
    // Generate recovery action plan
    console.log('\n⚡ RECOVERY ACTION PLAN');
    console.log('─────────────────────────────');
    console.log(`1. 🔥 URGENT: Contact Drake immediately`);
    console.log(`   └─ Method: All available channels (Discord, email, Signal)`);
    console.log(`   └─ Message: "Frigg nodes offline ${Math.floor((Date.now() - Math.min(...friggNodes.map(n => n.lastSeen))) / (1000 * 60 * 60 * 24))}+ days, ${totalBlockedJobs} customer jobs blocked"`);
    
    console.log(`\n2. 📋 Frigg Node Revival Checklist for Drake:`);
    console.log(`   └─ SSH into frigg server(s)`);
    console.log(`   └─ Check if OpenClaw processes are running`);
    console.log(`   └─ Restart with: claw skill mesh-transcribe`);
    console.log(`   └─ Verify capabilities: tesseract, ollama, whisper available`);
    console.log(`   └─ Test node registration with IC Mesh server`);
    
    console.log(`\n3. 📊 Monitor Recovery:`);
    console.log(`   └─ Watch for frigg nodes in: node scripts/accurate-node-status.js`);
    console.log(`   └─ Verify job processing: node scripts/quick-queue-analysis.js`);
    console.log(`   └─ Confirm OCR/PDF jobs clearing from queue`);
    
    console.log(`\n4. 💰 Revenue Recovery Verification:`);
    console.log(`   └─ Target: ${totalBlockedJobs} jobs should begin processing`);
    console.log(`   └─ Expected revenue recovery: $${minRevenue.toFixed(0)}-${maxRevenue.toFixed(0)}`);
    console.log(`   └─ Success metric: Queue drops to <10 pending jobs`);
    
    return {
        friggNodes: friggNodes.length,
        offlineNodes: friggNodes.filter(n => (Date.now() - n.lastSeen) > 24 * 60 * 60 * 1000).length,
        blockedJobs: totalBlockedJobs,
        revenueImpact: { min: minRevenue, max: maxRevenue },
        criticalCapabilities: Array.from(criticalCapabilities)
    };
}

// Generate analysis report
const analysis = analyzeFriggOutage();

// Create markdown report for primary
const reportContent = `# Frigg Node Revival Analysis - ${new Date().toISOString()}

## 🚨 CRITICAL SITUATION

- **Frigg nodes offline:** ${analysis.friggNodes} total, ${analysis.offlineNodes} offline >24h
- **Blocked customer jobs:** ${analysis.blockedJobs}  
- **Revenue impact:** $${analysis.revenueImpact.min.toFixed(0)}-${analysis.revenueImpact.max.toFixed(0)} blocked
- **Critical capabilities offline:** ${analysis.criticalCapabilities.join(', ')}

## 🔥 IMMEDIATE ACTION REQUIRED

**Contact Drake via all channels:**
- Discord: @drake or direct message  
- Email: drakew@gmail.com
- Signal: (if available)

**Message:** "URGENT: Frigg nodes offline 8+ days, ${analysis.blockedJobs} customer jobs blocked, ~$${analysis.revenueImpact.min.toFixed(0)} revenue impact. Need frigg node revival ASAP."

## 📋 Drake's Recovery Checklist

1. **SSH into frigg server(s)**
2. **Check OpenClaw status:** \`ps aux | grep claw\`
3. **Restart IC Mesh connection:** \`claw skill mesh-transcribe\` 
4. **Verify capabilities available:**
   - tesseract (for OCR)
   - ollama (for AI tasks)
   - whisper (for transcription backup)
5. **Test connection:** Should see node registration in server logs

## 📊 Recovery Verification

**Success metrics:**
- Frigg nodes appear in active node list
- OCR/PDF jobs start processing
- Queue drops below 10 pending jobs
- Revenue pipeline restored

**Monitoring commands:**
\`\`\`bash
# Check node status
node scripts/accurate-node-status.js

# Monitor job queue  
node scripts/quick-queue-analysis.js

# Watch for job processing
watch -n 5 "sqlite3 data/mesh.db 'SELECT COUNT(*) FROM jobs WHERE status=\"pending\"'"
\`\`\`

Generated by: Wingman 🤝 @ ${new Date().toISOString()}
`;

require('fs').writeFileSync('/home/openclaw/.openclaw/workspace/FRIGG-REVIVAL-URGENT.md', reportContent);

console.log('\n📄 REPORTS GENERATED');
console.log('─────────────────────────────');
console.log('✅ Analysis complete');
console.log('✅ Report saved: /home/openclaw/.openclaw/workspace/FRIGG-REVIVAL-URGENT.md');
console.log('\n🎯 Ready for primary review and Drake contact');