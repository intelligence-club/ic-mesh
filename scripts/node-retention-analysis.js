#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'mesh.db');
const db = new sqlite3.Database(dbPath);

console.log('🔍 IC MESH NODE RETENTION ANALYSIS');
console.log('=====================================\n');

// Analyze node retention patterns
db.all(`SELECT 
  nodeId, 
  substr(nodeId, 1, 8) as short_id,
  name,
  capabilities,
  registeredAt,
  lastSeen,
  jobsCompleted,
  computeMinutes,
  CASE 
    WHEN lastSeen IS NULL THEN 'never_active'
    WHEN (unixepoch('now') - lastSeen) / 60 < 5 THEN 'online'
    WHEN (unixepoch('now') - lastSeen) / 3600 < 1 THEN 'recent'
    WHEN (unixepoch('now') - lastSeen) / 3600 < 24 THEN 'daily_churn'
    ELSE 'long_gone'
  END as retention_category,
  CASE 
    WHEN lastSeen IS NULL THEN 'never seen'
    WHEN (unixepoch('now') - lastSeen) / 60 < 5 THEN 'online'
    ELSE printf('%.1f hrs ago', (unixepoch('now') - lastSeen) / 3600.0)
  END as status,
  CASE 
    WHEN registeredAt IS NULL OR lastSeen IS NULL THEN 0
    ELSE (lastSeen - registeredAt) / 60.0
  END as session_minutes
FROM nodes 
ORDER BY lastSeen DESC NULLS LAST`, (err, nodes) => {
  if (err) { 
    console.error('❌ Database error:', err); 
    process.exit(1); 
  }
  
  // Display node status table
  console.log('📊 NODE STATUS & RETENTION PATTERNS\n');
  console.log('Node ID     Status         Session Time  Capabilities');
  console.log('-------     ------         ------------  ------------');
  
  let onlineCount = 0;
  let recentCount = 0;
  let dailyChurnCount = 0;
  let longGoneCount = 0;
  let neverActiveCount = 0;
  let totalNodes = nodes.length;
  let totalSessionTime = 0;
  let activeSessionTime = 0;

  const retentionCategories = {};
  const capabilityAnalysis = {};
  
  nodes.forEach(node => {
    const shortId = node.short_id;
    const status = node.status;
    const category = node.retention_category;
    const sessionTime = node.session_minutes > 60 ? 
      (node.session_minutes / 60).toFixed(1) + 'h' : 
      node.session_minutes.toFixed(0) + 'm';
    
    let caps = 'none';
    if (node.capabilities) {
      try {
        const capArray = JSON.parse(node.capabilities);
        caps = capArray.join(', ');
        
        // Track capability distribution
        capArray.forEach(cap => {
          if (!capabilityAnalysis[cap]) capabilityAnalysis[cap] = { online: 0, total: 0 };
          capabilityAnalysis[cap].total++;
          if (category === 'online') capabilityAnalysis[cap].online++;
        });
      } catch(e) {
        caps = 'parse_error';
      }
    }
    
    console.log(`${shortId}    ${status.padEnd(14)} ${sessionTime.padEnd(13)} ${caps.substring(0, 50)}`);
    
    // Count categories
    retentionCategories[category] = (retentionCategories[category] || 0) + 1;
    
    switch(category) {
      case 'online': onlineCount++; activeSessionTime += node.session_minutes; break;
      case 'recent': recentCount++; break;
      case 'daily_churn': dailyChurnCount++; break;
      case 'long_gone': longGoneCount++; break;
      case 'never_active': neverActiveCount++; break;
    }
    
    totalSessionTime += node.session_minutes;
  });
  
  // Retention Analysis
  console.log('\n🔍 RETENTION CATEGORY BREAKDOWN\n');
  Object.entries(retentionCategories).forEach(([category, count]) => {
    const percentage = (count / totalNodes * 100).toFixed(1);
    console.log(`${category.padEnd(15)}: ${count.toString().padStart(2)} nodes (${percentage}%)`);
  });
  
  // Key Metrics
  console.log('\n📈 KEY RETENTION METRICS\n');
  console.log(`Total nodes registered: ${totalNodes}`);
  console.log(`Currently online: ${onlineCount} (${(onlineCount/totalNodes*100).toFixed(1)}%)`);
  console.log(`Recently active: ${recentCount} (${(recentCount/totalNodes*100).toFixed(1)}%)`);
  console.log(`Daily churn: ${dailyChurnCount} (${(dailyChurnCount/totalNodes*100).toFixed(1)}%)`);
  console.log(`Long-term gone: ${longGoneCount} (${(longGoneCount/totalNodes*100).toFixed(1)}%)`);
  console.log(`Never activated: ${neverActiveCount} (${(neverActiveCount/totalNodes*100).toFixed(1)}%)`);
  
  let healthyRetention = 0;
  if (totalNodes > 0) {
    healthyRetention = (onlineCount + recentCount) / totalNodes * 100;
    const avgSessionTime = totalSessionTime / totalNodes / 60;
    const avgActiveSessionTime = onlineCount > 0 ? activeSessionTime / onlineCount / 60 : 0;
    
    console.log(`\nHealthy retention rate: ${healthyRetention.toFixed(1)}% (online + recent)`);
    console.log(`Average session time: ${avgSessionTime.toFixed(1)} hours`);
    console.log(`Average online session: ${avgActiveSessionTime.toFixed(1)} hours`);
  }
  
  // Capability Analysis
  console.log('\n⚙️  CAPABILITY AVAILABILITY ANALYSIS\n');
  if (Object.keys(capabilityAnalysis).length > 0) {
    console.log('Capability     Online/Total    Availability');
    console.log('----------     ------------    ------------');
    Object.entries(capabilityAnalysis).forEach(([cap, data]) => {
      const availability = (data.online / data.total * 100).toFixed(1);
      const status = data.online > 0 ? '✅' : '❌';
      console.log(`${cap.padEnd(14)} ${data.online}/${data.total}           ${availability}% ${status}`);
    });
  } else {
    console.log('No capability data available');
  }
  
  // Retention Health Assessment
  console.log('\n🏥 RETENTION HEALTH ASSESSMENT\n');
  
  const healthScore = healthyRetention;
  let healthStatus, recommendations;
  
  if (healthScore >= 70) {
    healthStatus = '🟢 EXCELLENT';
    recommendations = ['Monitor for any drops in retention', 'Continue current practices'];
  } else if (healthScore >= 50) {
    healthStatus = '🟡 MODERATE';
    recommendations = [
      'Investigate why nodes are leaving',
      'Implement node retention outreach',
      'Improve onboarding experience'
    ];
  } else if (healthScore >= 25) {
    healthStatus = '🟠 CONCERNING';
    recommendations = [
      'URGENT: Node retention crisis',
      'Implement automated retention tools',
      'Contact recently disconnected nodes',
      'Review node requirements and barriers'
    ];
  } else {
    healthStatus = '🔴 CRITICAL';
    recommendations = [
      'IMMEDIATE ACTION REQUIRED',
      'Emergency node retention program',
      'Contact all recent nodes personally',
      'Review fundamental retention barriers'
    ];
  }
  
  console.log(`Overall Health: ${healthStatus} (${healthScore.toFixed(1)}%)`);
  console.log('\n💡 RECOMMENDED ACTIONS:');
  recommendations.forEach((rec, i) => {
    console.log(`${i + 1}. ${rec}`);
  });
  
  db.close();
});