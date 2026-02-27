#!/usr/bin/env node

/**
 * Critical Node Notification System
 * Detects when nodes with unique capabilities go offline
 * Generates actionable alerts for network operators
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = './data/mesh.db';
const ALERT_PATH = './critical-node-alerts.json';

// Critical time thresholds (in milliseconds)
const OFFLINE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
const CRITICAL_THRESHOLD = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Load existing alerts to prevent spam
 */
function loadExistingAlerts() {
  try {
    if (fs.existsSync(ALERT_PATH)) {
      return JSON.parse(fs.readFileSync(ALERT_PATH, 'utf8'));
    }
  } catch (error) {
    console.log('⚠️  Could not load existing alerts:', error.message);
  }
  return { alerts: [], lastCheck: 0 };
}

/**
 * Save alerts to prevent repeat notifications
 */
function saveAlerts(alertData) {
  try {
    fs.writeFileSync(ALERT_PATH, JSON.stringify(alertData, null, 2));
  } catch (error) {
    console.log('⚠️  Could not save alerts:', error.message);
  }
}

/**
 * Parse capabilities JSON string safely
 */
function parseCapabilities(capabilitiesStr) {
  try {
    return JSON.parse(capabilitiesStr || '[]');
  } catch {
    return [];
  }
}

/**
 * Identify critical capabilities that are unique or rare
 */
function identifyCriticalCapabilities(allNodes) {
  const capabilityCount = {};
  
  // Count how many nodes have each capability
  allNodes.forEach(node => {
    const capabilities = parseCapabilities(node.capabilities);
    capabilities.forEach(capability => {
      capabilityCount[capability] = (capabilityCount[capability] || 0) + 1;
    });
  });
  
  // Mark capabilities as critical if only 1-2 nodes have them
  const criticalCapabilities = Object.entries(capabilityCount)
    .filter(([capability, count]) => count <= 2 && capability !== 'test')
    .map(([capability]) => capability);
    
  return { capabilityCount, criticalCapabilities };
}

/**
 * Generate notification message for offline critical node
 */
function generateNodeAlert(node, capabilities, offlineDuration) {
  const hours = Math.floor(offlineDuration / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  
  const timeDesc = days > 0 ? `${days} days` : `${hours} hours`;
  const severity = days >= 7 ? 'CRITICAL' : days >= 1 ? 'HIGH' : 'MEDIUM';
  
  return {
    nodeId: node.nodeId,
    nodeName: node.name,
    owner: node.owner,
    severity,
    offlineDuration: offlineDuration,
    timeDescription: timeDesc,
    capabilities: capabilities.critical,
    allCapabilities: parseCapabilities(node.capabilities),
    jobsCompleted: node.jobsCompleted,
    lastSeen: new Date(node.lastSeen).toISOString(),
    alertTime: new Date().toISOString(),
    message: `🚨 ${severity}: Node ${node.name} (${node.nodeId.substr(0,8)}) offline for ${timeDesc}`,
    details: `Owner: ${node.owner} | Critical capabilities: ${capabilities.critical.join(', ')} | Jobs completed: ${node.jobsCompleted}`,
    action: node.owner === 'drake' ? 'Contact Drake to restore node' : `Contact ${node.owner} or recruit replacement`
  };
}

/**
 * Main monitoring function
 */
async function checkCriticalNodes() {
  return new Promise((resolve, reject) => {
    console.log('🔍 Checking for critical node outages...\n');
    
    const db = new sqlite3.Database(DB_PATH);
    const now = Date.now();
    
    db.all(`
      SELECT nodeId, name, capabilities, owner, lastSeen, jobsCompleted 
      FROM nodes 
      ORDER BY lastSeen DESC
    `, (err, rows) => {
      if (err) {
        console.error('❌ Database error:', err);
        reject(err);
        return;
      }
      
      if (rows.length === 0) {
        console.log('📊 No nodes found in database');
        resolve({ alerts: [], summary: 'No nodes registered' });
        return;
      }
      
      // Analyze capability distribution
      const { capabilityCount, criticalCapabilities } = identifyCriticalCapabilities(rows);
      
      // Load existing alerts to prevent spam
      const existingAlerts = loadExistingAlerts();
      
      console.log('📊 Network Capability Analysis:');
      console.log('Critical capabilities (≤2 nodes):');
      criticalCapabilities.forEach(cap => {
        console.log(`  - ${cap}: ${capabilityCount[cap]} node(s)`);
      });
      console.log();
      
      // Check each node for critical outages
      const alerts = [];
      let activeNodes = 0;
      let offlineNodes = 0;
      
      rows.forEach(node => {
        const offlineDuration = now - node.lastSeen;
        const isOffline = offlineDuration > OFFLINE_THRESHOLD;
        
        if (!isOffline) {
          activeNodes++;
          return;
        }
        
        offlineNodes++;
        const nodeCapabilities = parseCapabilities(node.capabilities);
        const criticalCaps = nodeCapabilities.filter(cap => criticalCapabilities.includes(cap));
        
        if (criticalCaps.length > 0) {
          const alertId = `${node.nodeId}_${Math.floor(offlineDuration / (24 * 60 * 60 * 1000))}d`;
          
          // Check if we've already alerted for this node/duration
          const alreadyAlerted = existingAlerts.alerts.some(alert => alert.alertId === alertId);
          
          if (!alreadyAlerted || offlineDuration > CRITICAL_THRESHOLD) {
            const alert = generateNodeAlert(node, { critical: criticalCaps }, offlineDuration);
            alert.alertId = alertId;
            alerts.push(alert);
            
            console.log(`${alert.message}`);
            console.log(`  ${alert.details}`);
            console.log(`  Action: ${alert.action}\n`);
          }
        }
      });
      
      // Save new alerts
      const updatedAlerts = {
        alerts: [...existingAlerts.alerts, ...alerts],
        lastCheck: now,
        summary: {
          totalNodes: rows.length,
          activeNodes,
          offlineNodes,
          criticalAlertsGenerated: alerts.length,
          criticalCapabilities,
          capabilityCount
        }
      };
      
      saveAlerts(updatedAlerts);
      
      console.log('📋 Summary:');
      console.log(`  Total nodes: ${rows.length}`);
      console.log(`  Active: ${activeNodes} | Offline: ${offlineNodes}`);
      console.log(`  New critical alerts: ${alerts.length}`);
      
      if (alerts.length === 0) {
        console.log('✅ No new critical node outages detected');
      }
      
      db.close();
      resolve({ alerts, summary: updatedAlerts.summary });
    });
  });
}

// Run if called directly
if (require.main === module) {
  checkCriticalNodes()
    .then(result => {
      if (result.alerts.length > 0) {
        process.exit(1); // Exit with error code if alerts found
      }
    })
    .catch(error => {
      console.error('💥 Error:', error);
      process.exit(1);
    });
}

module.exports = { checkCriticalNodes, identifyCriticalCapabilities };