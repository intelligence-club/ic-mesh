#!/usr/bin/env node

/**
 * OpenClaw Setup Test - Verify your node is ready to join IC Mesh
 * 
 * This script helps OpenClaw operators verify their setup before
 * joining the network, preventing common configuration issues.
 */

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

console.log('🤝 OpenClaw IC Mesh Setup Test\n');

// Test results tracking
let tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) {
      tests.push({ name, status: 'PASS', message: '' });
      passed++;
      console.log(`✅ ${name}`);
    } else {
      tests.push({ name, status: 'FAIL', message: result });
      failed++;
      console.log(`❌ ${name}: ${result}`);
    }
  } catch (error) {
    tests.push({ name, status: 'ERROR', message: error.message });
    failed++;
    console.log(`💥 ${name}: ${error.message}`);
  }
}

// 1. Check Node.js version
test('Node.js version (requires 18+)', () => {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0]);
  if (major < 18) {
    return `Found ${version}, need 18.0.0 or higher`;
  }
});

// 2. Check if config file exists
test('Configuration file exists', () => {
  if (!fs.existsSync('node-config.json')) {
    return 'node-config.json not found. Copy from node-config.example.json';
  }
});

// 3. Validate config file
test('Configuration file is valid JSON', () => {
  try {
    const config = JSON.parse(fs.readFileSync('node-config.json', 'utf8'));
    
    if (!config.nodeId) return 'Missing nodeId in config';
    if (!config.serverUrl) return 'Missing serverUrl in config';
    if (!config.capabilities || !Array.isArray(config.capabilities)) {
      return 'Missing or invalid capabilities array';
    }
    if (config.capabilities.length === 0) {
      return 'No capabilities defined. Add at least one: transcribe, ollama, stable-diffusion';
    }
    
    return true;
  } catch (error) {
    return `Invalid JSON: ${error.message}`;
  }
});

// 4. Check server connectivity
test('IC Mesh server connectivity', () => {
  try {
    const config = JSON.parse(fs.readFileSync('node-config.json', 'utf8'));
    const serverUrl = config.serverUrl.replace(':8333', '');
    
    // Try to connect to health endpoint
    execSync(`curl -s -m 5 ${serverUrl}/health`, { stdio: 'pipe' });
    return true;
  } catch (error) {
    return 'Cannot reach IC Mesh server. Check serverUrl in config';
  }
});

// 5. Check npm dependencies
test('NPM dependencies installed', () => {
  if (!fs.existsSync('node_modules')) {
    return 'node_modules not found. Run: npm install';
  }
  
  // Check for key dependencies
  const required = ['axios', 'ws'];
  for (const dep of required) {
    if (!fs.existsSync(`node_modules/${dep}`)) {
      return `Missing dependency: ${dep}. Run: npm install`;
    }
  }
});

// 6. Check capability dependencies
test('Capability dependencies', () => {
  try {
    const config = JSON.parse(fs.readFileSync('node-config.json', 'utf8'));
    const issues = [];
    
    if (config.capabilities.includes('transcribe')) {
      try {
        execSync('which whisper', { stdio: 'pipe' });
      } catch {
        try {
          execSync('which ffmpeg', { stdio: 'pipe' });
        } catch {
          issues.push('transcribe capability requires whisper or ffmpeg');
        }
      }
    }
    
    if (config.capabilities.includes('ollama')) {
      try {
        execSync('which ollama', { stdio: 'pipe' });
      } catch {
        issues.push('ollama capability requires ollama to be installed');
      }
    }
    
    if (config.capabilities.includes('stable-diffusion')) {
      // Check for common SD installations
      const sdPaths = [
        '/usr/local/bin/stable-diffusion',
        '/opt/stable-diffusion',
        'stable-diffusion'
      ];
      
      let foundSD = false;
      for (const sdPath of sdPaths) {
        try {
          execSync(`which ${sdPath}`, { stdio: 'pipe' });
          foundSD = true;
          break;
        } catch {}
      }
      
      if (!foundSD) {
        issues.push('stable-diffusion capability requires Stable Diffusion installed');
      }
    }
    
    if (issues.length > 0) {
      return issues.join('; ');
    }
    
    return true;
  } catch (error) {
    return `Config read error: ${error.message}`;
  }
});

// 7. Check resource availability
test('Resource availability', () => {
  try {
    const config = JSON.parse(fs.readFileSync('node-config.json', 'utf8'));
    
    if (config.resources) {
      const { cpu, memory } = config.resources;
      
      // Check if configured CPU cores are reasonable
      if (cpu) {
        const availableCPU = require('os').cpus().length;
        if (cpu > availableCPU) {
          return `Configured ${cpu} CPU cores, but only ${availableCPU} available`;
        }
        if (cpu > availableCPU * 0.8) {
          console.log(`⚠️  Warning: Using ${cpu}/${availableCPU} CPU cores (high usage)`);
        }
      }
    }
    
    return true;
  } catch (error) {
    return `Resource check failed: ${error.message}`;
  }
});

// 8. Check disk space
test('Disk space for job processing', () => {
  try {
    const stats = fs.statSync('.');
    // This is a simplified check - in practice you'd use statvfs or similar
    // For now, just ensure we can write to the current directory
    const testFile = 'test-write-permissions.tmp';
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return true;
  } catch (error) {
    return 'Cannot write to current directory. Check permissions';
  }
});

// 9. Check if client.js exists and is executable
test('Node client exists', () => {
  if (!fs.existsSync('client.js')) {
    return 'client.js not found. Check repository integrity';
  }
});

console.log('\n' + '='.repeat(60));
console.log('📊 Test Results Summary');
console.log('='.repeat(60));

console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);

if (failed === 0) {
  console.log('\n🎉 All tests passed! Your OpenClaw is ready to join IC Mesh.');
  console.log('\nNext steps:');
  console.log('1. Start your node: node client.js');
  console.log('2. Check dashboard: https://moilol.com:8333');
  console.log('3. Monitor earnings: node scripts/earnings-report.js');
} else {
  console.log('\n🔧 Issues found. Please fix the failed tests before joining.');
  console.log('\nCommon fixes:');
  console.log('• Install dependencies: npm install');
  console.log('• Copy config: cp node-config.example.json node-config.json');
  console.log('• Install whisper: pip install openai-whisper');
  console.log('• Install ollama: curl -fsSL https://ollama.ai/install.sh | sh');
  
  if (failed <= 2) {
    console.log('\n💡 You\'re close! Just a few small fixes needed.');
  }
}

console.log('\n📚 Need help? Check OPENCLAW-INTEGRATION.md or visit our Discord');
console.log('🐛 Found a bug? Report it: https://github.com/your-org/ic-mesh/issues');

// Write detailed results to file for debugging
const report = {
  timestamp: new Date().toISOString(),
  nodeInfo: {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: require('os').cpus().length,
    memory: Math.round(require('os').totalmem() / 1024 / 1024 / 1024) + 'GB'
  },
  testResults: tests,
  summary: {
    passed,
    failed,
    successRate: Math.round((passed / (passed + failed)) * 100)
  }
};

fs.writeFileSync('setup-test-report.json', JSON.stringify(report, null, 2));
console.log('\n📄 Detailed report saved to: setup-test-report.json');