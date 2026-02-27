#!/usr/bin/env node

/**
 * Node Onboarding Diagnostic Tool
 * Helps new operators troubleshoot common setup issues before they cause disconnections
 */

const { execSync } = require('child_process');
const fs = require('fs');

console.log('🏗️  IC MESH NODE ONBOARDING DIAGNOSTIC');
console.log('=======================================');
console.log('This tool helps diagnose common node setup issues before they cause disconnections.\n');

let passed = 0;
let failed = 0;
let warnings = 0;

function checkPass(message) {
  console.log(`✅ ${message}`);
  passed++;
}

function checkFail(message) {
  console.log(`❌ ${message}`);
  failed++;
}

function checkWarn(message) {
  console.log(`⚠️  ${message}`);
  warnings++;
}

console.log('📡 CONNECTIVITY CHECKS\n');

// Check internet connectivity
try {
  execSync('ping -c 1 google.com > /dev/null 2>&1');
  checkPass('Internet connectivity working');
} catch (e) {
  checkFail('No internet connectivity - check network connection');
}

// Check DNS resolution
try {
  execSync('nslookup moilol.com > /dev/null 2>&1');
  checkPass('DNS resolution working');
} catch (e) {
  checkWarn('DNS resolution issues - may affect mesh server connection');
}

// Check mesh server connectivity
try {
  const response = execSync('curl -s -m 10 http://moilol.com:8333/status', {encoding: 'utf8'});
  const status = JSON.parse(response);
  checkPass(`Mesh server reachable (${status.network})`);
  
  if (status.nodes.active === 0) {
    checkWarn('No active nodes on network - you might be first to connect');
  } else {
    checkPass(`${status.nodes.active} active nodes on network`);
  }
} catch (e) {
  checkFail('Cannot reach mesh server - check firewall and port 8333 access');
}

console.log('\n🔧 SYSTEM REQUIREMENTS\n');

// Check Node.js version
try {
  const nodeVersion = execSync('node --version', {encoding: 'utf8'}).trim();
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
  
  if (majorVersion >= 18) {
    checkPass(`Node.js version adequate (${nodeVersion})`);
  } else {
    checkFail(`Node.js version too old (${nodeVersion}) - need v18 or higher`);
  }
} catch (e) {
  checkFail('Node.js not installed');
}

// Check available memory
try {
  const memInfo = execSync('cat /proc/meminfo | grep MemAvailable', {encoding: 'utf8'});
  const memKB = parseInt(memInfo.split(/\s+/)[1]);
  const memGB = Math.round(memKB / 1024 / 1024 * 100) / 100;
  
  if (memGB >= 2) {
    checkPass(`Available memory adequate (${memGB}GB)`);
  } else if (memGB >= 1) {
    checkWarn(`Limited memory (${memGB}GB) - may affect performance`);
  } else {
    checkFail(`Insufficient memory (${memGB}GB) - need at least 1GB`);
  }
} catch (e) {
  checkWarn('Could not check memory status');
}

// Check available disk space
try {
  const diskInfo = execSync('df -h / | tail -1', {encoding: 'utf8'});
  const availSpace = diskInfo.split(/\s+/)[3];
  
  if (availSpace.includes('G') && parseInt(availSpace) >= 5) {
    checkPass(`Disk space adequate (${availSpace} available)`);
  } else if (availSpace.includes('M') || (availSpace.includes('G') && parseInt(availSpace) < 5)) {
    checkWarn(`Limited disk space (${availSpace}) - may affect job processing`);
  } else {
    checkFail(`Insufficient disk space (${availSpace})`);
  }
} catch (e) {
  checkWarn('Could not check disk space');
}

console.log('\n💼 CAPABILITIES ASSESSMENT\n');

// Check common tools/capabilities
const capabilityChecks = [
  { name: 'ffmpeg', cmd: 'ffmpeg -version', capability: 'video/audio processing' },
  { name: 'python3', cmd: 'python3 --version', capability: 'Python scripts' },
  { name: 'tesseract', cmd: 'tesseract --version', capability: 'OCR processing' },
  { name: 'git', cmd: 'git --version', capability: 'code downloads' }
];

let detectedCapabilities = [];

capabilityChecks.forEach(check => {
  try {
    execSync(check.cmd + ' > /dev/null 2>&1');
    checkPass(`${check.name} available - enables ${check.capability}`);
    detectedCapabilities.push(check.name);
  } catch (e) {
    console.log(`ℹ️  ${check.name} not installed - ${check.capability} not available`);
  }
});

if (detectedCapabilities.length === 0) {
  checkWarn('No common capabilities detected - node will have limited job options');
} else {
  console.log(`\n📋 Potential capabilities: ${detectedCapabilities.join(', ')}`);
}

console.log('\n🔒 SECURITY CHECKS\n');

// Check if running as root (security concern)
try {
  const user = execSync('whoami', {encoding: 'utf8'}).trim();
  if (user === 'root') {
    checkWarn('Running as root - consider using dedicated user for security');
  } else {
    checkPass(`Running as user '${user}' (good security practice)`);
  }
} catch (e) {
  checkWarn('Could not determine user context');
}

// Check firewall status
try {
  const ufwStatus = execSync('ufw status 2>/dev/null || echo "inactive"', {encoding: 'utf8'});
  if (ufwStatus.includes('inactive')) {
    checkWarn('Firewall inactive - ensure network security is managed elsewhere');
  } else {
    checkPass('Firewall active');
  }
} catch (e) {
  // Ignore - different systems have different firewall tools
}

console.log('\n📊 DIAGNOSTIC SUMMARY');
console.log('====================');
console.log(`✅ Passed: ${passed}`);
console.log(`⚠️  Warnings: ${warnings}`);
console.log(`❌ Failed: ${failed}`);

if (failed === 0) {
  console.log('\n🎉 READY FOR ONBOARDING!');
  console.log('Your system appears ready to join the mesh network.');
  console.log('\nNext steps:');
  console.log('1. Download node software: git clone <repository>');
  console.log('2. Configure your node with detected capabilities');
  console.log('3. Start the node and monitor for successful connection');
} else {
  console.log('\n🔧 ACTION REQUIRED');
  console.log('Please resolve the failed checks before attempting to join the network.');
  console.log('This will prevent connection issues and improve your node retention.');
}

if (warnings > 0) {
  console.log('\n💡 OPTIMIZATION OPPORTUNITIES');
  console.log('Consider addressing warnings to improve node performance and reliability.');
}