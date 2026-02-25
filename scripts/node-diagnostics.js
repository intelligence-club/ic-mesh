#!/usr/bin/env node
/**
 * IC Mesh — Node Diagnostics Tool
 * 
 * Comprehensive diagnostic tool for IC Mesh node operators.
 * Checks configuration, capabilities, network connectivity, and performance.
 * Provides actionable insights for optimization and troubleshooting.
 * 
 * Usage:
 *   node scripts/node-diagnostics.js                  # Quick check
 *   node scripts/node-diagnostics.js --full          # Comprehensive scan
 *   node scripts/node-diagnostics.js --capabilities  # Capability detection only
 *   node scripts/node-diagnostics.js --earnings      # Show earnings summary
 * 
 * Exit codes:
 *   0 - All systems healthy
 *   1 - Minor issues (warnings)
 *   2 - Major issues (errors)
 *   3 - Critical issues (node unusable)
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const https = require('https');
const http = require('http');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

class NodeDiagnostics {
  constructor() {
    this.issues = { critical: [], errors: [], warnings: [], info: [] };
    this.config = this.loadConfig();
    this.capabilities = {};
    this.networkStats = {};
  }

  // Load node configuration
  loadConfig() {
    const config = {
      server: process.env.IC_MESH_SERVER || 'https://moilol.com:8333',
      nodeName: process.env.IC_NODE_NAME || 'unknown',
      nodeOwner: process.env.IC_NODE_OWNER || 'unknown',
      nodeId: null
    };

    // Try to load persisted node ID
    try {
      if (fs.existsSync('node-config.json')) {
        const saved = JSON.parse(fs.readFileSync('node-config.json', 'utf8'));
        config.nodeId = saved.nodeId;
      }
    } catch (error) {
      this.addIssue('warnings', 'Could not load node-config.json - node may register as new');
    }

    return config;
  }

  // Add issue to appropriate category
  addIssue(level, message, fix = null) {
    const issue = { message };
    if (fix) issue.fix = fix;
    this.issues[level].push(issue);
  }

  // Colorized output
  color(text, colorName) {
    return `${colors[colorName]}${text}${colors.reset}`;
  }

  // System information check
  checkSystemInfo() {
    console.log(this.color('\n🖥️  System Information', 'cyan'));
    console.log('─'.repeat(50));

    const platform = os.platform();
    const arch = os.arch();
    const totalMem = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1);
    const freeMem = (os.freemem() / (1024 * 1024 * 1024)).toFixed(1);
    const cpus = os.cpus();
    const load = os.loadavg();

    console.log(`Platform: ${platform} (${arch})`);
    console.log(`CPUs: ${cpus.length} cores (${cpus[0]?.model || 'unknown'})`);
    console.log(`Memory: ${freeMem}GB free / ${totalMem}GB total`);
    console.log(`Load average: ${load.map(l => l.toFixed(2)).join(', ')}`);
    console.log(`Node.js: ${process.version}`);
    console.log(`Uptime: ${(os.uptime() / 3600).toFixed(1)} hours`);

    // Memory warnings
    const memUsage = ((totalMem - freeMem) / totalMem) * 100;
    if (memUsage > 90) {
      this.addIssue('errors', `Memory usage very high: ${memUsage.toFixed(1)}%`, 
        'Consider closing other applications or adding more RAM');
    } else if (memUsage > 80) {
      this.addIssue('warnings', `Memory usage high: ${memUsage.toFixed(1)}%`);
    }

    // CPU load warnings
    const avgLoad = load[0] / cpus.length;
    if (avgLoad > 2.0) {
      this.addIssue('errors', `CPU load very high: ${avgLoad.toFixed(2)}x`, 
        'High CPU usage may affect job performance');
    } else if (avgLoad > 1.0) {
      this.addIssue('warnings', `CPU load elevated: ${avgLoad.toFixed(2)}x`);
    }
  }

  // Configuration validation
  checkConfiguration() {
    console.log(this.color('\n⚙️  Configuration', 'cyan'));
    console.log('─'.repeat(50));

    console.log(`Server: ${this.config.server}`);
    console.log(`Node Name: ${this.config.nodeName}`);
    console.log(`Node Owner: ${this.config.nodeOwner}`);
    console.log(`Node ID: ${this.config.nodeId || 'not registered'}`);

    if (this.config.nodeName === 'unknown') {
      this.addIssue('errors', 'IC_NODE_NAME not set', 
        'Set IC_NODE_NAME environment variable');
    }

    if (this.config.nodeOwner === 'unknown') {
      this.addIssue('warnings', 'IC_NODE_OWNER not set', 
        'Set IC_NODE_OWNER environment variable for proper attribution');
    }

    if (!this.config.nodeId) {
      this.addIssue('info', 'Node not registered yet - will register on first run');
    }
  }

  // Capability detection (matches client.js logic)
  async checkCapabilities() {
    console.log(this.color('\n🔧 Capability Detection', 'cyan'));
    console.log('─'.repeat(50));

    const capabilities = [];

    // Check for Whisper (macOS with Apple Silicon)
    if (os.platform() === 'darwin' && os.arch() === 'arm64') {
      capabilities.push('whisper');
      console.log(this.color('✓ Whisper (Apple Silicon detected)', 'green'));
    } else {
      console.log('✗ Whisper (requires macOS with Apple Silicon)');
    }

    // Check for ffmpeg
    try {
      execSync('which ffmpeg', { stdio: 'ignore' });
      capabilities.push('ffmpeg');
      console.log(this.color('✓ ffmpeg', 'green'));
    } catch {
      console.log('✗ ffmpeg (not installed)');
      this.addIssue('warnings', 'ffmpeg not found', 
        'Install ffmpeg for media processing jobs');
    }

    // Check for Ollama
    try {
      execSync('which ollama', { stdio: 'ignore' });
      capabilities.push('ollama');
      console.log(this.color('✓ Ollama', 'green'));
      
      // Check for models
      try {
        const models = execSync('ollama list', { encoding: 'utf8' });
        const modelCount = models.split('\n').filter(line => 
          line.trim() && !line.startsWith('NAME')).length;
        console.log(`  Models available: ${modelCount}`);
        if (modelCount === 0) {
          this.addIssue('warnings', 'Ollama installed but no models available', 
            'Pull models with: ollama pull llama2');
        }
      } catch {
        this.addIssue('warnings', 'Could not list Ollama models');
      }
    } catch {
      console.log('✗ Ollama (not installed)');
    }

    // Check for GPU capabilities
    const gpuInfo = this.detectGPU();
    if (gpuInfo.length > 0) {
      console.log(this.color('✓ GPU capabilities:', 'green'));
      gpuInfo.forEach(gpu => console.log(`  ${gpu}`));
      if (gpuInfo.some(gpu => gpu.includes('Metal'))) {
        capabilities.push('gpu-metal');
      }
      if (gpuInfo.some(gpu => gpu.includes('NVIDIA'))) {
        capabilities.push('gpu-nvidia');
      }
    } else {
      console.log('✗ GPU (none detected or unsupported)');
    }

    this.capabilities = capabilities;
    console.log(`\nTotal capabilities: ${this.color(capabilities.length.toString(), 'bright')}`);

    if (capabilities.length === 0) {
      this.addIssue('critical', 'No capabilities detected - node cannot accept jobs', 
        'Install ffmpeg, Ollama, or use compatible hardware');
    } else if (capabilities.length === 1) {
      this.addIssue('info', 'Limited capabilities - consider adding more tools');
    }
  }

  // GPU detection
  detectGPU() {
    const gpus = [];
    
    try {
      if (os.platform() === 'darwin') {
        // macOS - check for Metal
        const systemProfiler = execSync('system_profiler SPDisplaysDataType', { encoding: 'utf8' });
        if (systemProfiler.includes('Metal')) {
          gpus.push('Metal (Apple Silicon)');
        }
      } else if (os.platform() === 'linux') {
        // Linux - check for NVIDIA
        try {
          const nvidiaSmi = execSync('nvidia-smi --query-gpu=name --format=csv,noheader,nounits', 
            { encoding: 'utf8' });
          nvidiaSmi.split('\n').filter(line => line.trim()).forEach(gpu => {
            gpus.push(`NVIDIA ${gpu.trim()}`);
          });
        } catch {
          // nvidia-smi not available
        }
      }
    } catch (error) {
      // GPU detection failed
    }

    return gpus;
  }

  // Network connectivity check
  async checkNetworkConnectivity() {
    console.log(this.color('\n🌐 Network Connectivity', 'cyan'));
    console.log('─'.repeat(50));

    const serverUrl = new URL(this.config.server);
    const isHttps = serverUrl.protocol === 'https:';
    const port = serverUrl.port || (isHttps ? 443 : 80);
    
    console.log(`Testing connection to ${serverUrl.hostname}:${port}...`);

    try {
      const startTime = Date.now();
      const response = await this.httpRequest(`${this.config.server}/status`);
      const responseTime = Date.now() - startTime;
      
      console.log(this.color(`✓ Server reachable (${responseTime}ms)`, 'green'));
      
      if (response.network) {
        console.log(`Network: ${response.network.name || 'IC Mesh'} v${response.version || '?'}`);
        console.log(`Status: ${response.status}`);
        console.log(`Active nodes: ${response.nodes?.active || 0}/${response.nodes?.total || 0}`);
        this.networkStats = response;
      }

      if (responseTime > 5000) {
        this.addIssue('warnings', `Slow connection to server (${responseTime}ms)`, 
          'High latency may affect job performance');
      }

    } catch (error) {
      console.log(this.color(`✗ Server unreachable: ${error.message}`, 'red'));
      this.addIssue('critical', `Cannot connect to IC Mesh server: ${error.message}`, 
        'Check network connection and server URL');
    }
  }

  // Node registration status
  async checkNodeRegistration() {
    if (!this.config.nodeId) {
      console.log(this.color('\n📝 Node Registration', 'cyan'));
      console.log('─'.repeat(50));
      console.log('Node not yet registered - this is normal for first run');
      return;
    }

    console.log(this.color('\n📝 Node Registration', 'cyan'));
    console.log('─'.repeat(50));

    try {
      const nodes = await this.httpRequest(`${this.config.server}/nodes`);
      const thisNode = nodes.find(node => node.id === this.config.nodeId);
      
      if (thisNode) {
        console.log(this.color('✓ Node registered and active', 'green'));
        console.log(`Last seen: ${thisNode.lastSeen || 'unknown'}`);
        console.log(`Jobs completed: ${thisNode.jobsCompleted || 0}`);
        console.log(`Uptime: ${thisNode.uptime || 'unknown'}`);
        
        // Check for stale registration
        const lastSeen = new Date(thisNode.lastSeen);
        const staleMinutes = (Date.now() - lastSeen.getTime()) / (1000 * 60);
        if (staleMinutes > 10) {
          this.addIssue('warnings', 
            `Node registration stale (${staleMinutes.toFixed(0)} minutes)`, 
            'Start client.js to refresh registration');
        }
      } else {
        console.log(this.color('✗ Node ID not found in active nodes', 'red'));
        this.addIssue('errors', 'Node registration lost or expired', 
          'Restart client.js to re-register');
      }
    } catch (error) {
      console.log(this.color(`✗ Could not check registration: ${error.message}`, 'red'));
    }
  }

  // Show earnings summary
  async checkEarnings() {
    if (!this.config.nodeId) {
      console.log(this.color('\n💰 Earnings', 'cyan'));
      console.log('─'.repeat(50));
      console.log('No earnings data (node not registered)');
      return;
    }

    console.log(this.color('\n💰 Earnings', 'cyan'));
    console.log('─'.repeat(50));

    try {
      const ledger = await this.httpRequest(`${this.config.server}/ledger/${this.config.nodeId}`);
      
      console.log(`Balance: ${ledger.balance || 0} ints`);
      console.log(`Jobs completed: ${ledger.jobsCompleted || 0}`);
      console.log(`Total earned: ${ledger.totalEarned || 0} ints`);
      
      if (ledger.balance > 0) {
        console.log(`USD equivalent: ~$${(ledger.balance / 1000).toFixed(2)}`);
      }

      if ((ledger.totalEarned || 0) === 0) {
        this.addIssue('info', 'No earnings yet - node may be new or inactive');
      }
    } catch (error) {
      console.log(this.color(`✗ Could not fetch earnings: ${error.message}`, 'red'));
    }
  }

  // HTTP request helper
  httpRequest(url) {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith('https');
      const requester = isHttps ? https : http;
      
      const req = requester.get(url, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ raw: data });
          }
        });
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      req.on('error', reject);
    });
  }

  // Display summary and recommendations
  displaySummary() {
    console.log(this.color('\n📊 Diagnostic Summary', 'cyan'));
    console.log('═'.repeat(50));

    const totalIssues = this.issues.critical.length + this.issues.errors.length + 
                       this.issues.warnings.length;

    if (this.issues.critical.length > 0) {
      console.log(this.color(`\n🚨 Critical Issues (${this.issues.critical.length}):`, 'red'));
      this.issues.critical.forEach(issue => {
        console.log(`   • ${issue.message}`);
        if (issue.fix) console.log(`     Fix: ${issue.fix}`);
      });
    }

    if (this.issues.errors.length > 0) {
      console.log(this.color(`\n⚠️  Errors (${this.issues.errors.length}):`, 'yellow'));
      this.issues.errors.forEach(issue => {
        console.log(`   • ${issue.message}`);
        if (issue.fix) console.log(`     Fix: ${issue.fix}`);
      });
    }

    if (this.issues.warnings.length > 0) {
      console.log(this.color(`\n⚡ Warnings (${this.issues.warnings.length}):`, 'yellow'));
      this.issues.warnings.forEach(issue => {
        console.log(`   • ${issue.message}`);
        if (issue.fix) console.log(`     Fix: ${issue.fix}`);
      });
    }

    if (this.issues.info.length > 0) {
      console.log(this.color(`\n💡 Info (${this.issues.info.length}):`, 'blue'));
      this.issues.info.forEach(issue => {
        console.log(`   • ${issue.message}`);
        if (issue.fix) console.log(`     Suggestion: ${issue.fix}`);
      });
    }

    if (totalIssues === 0) {
      console.log(this.color('\n✅ All systems healthy! Node ready to accept jobs.', 'green'));
    }

    // Overall score
    let score = 100;
    score -= this.issues.critical.length * 30;
    score -= this.issues.errors.length * 15;
    score -= this.issues.warnings.length * 5;
    score = Math.max(0, score);

    console.log(`\n📈 Node Health Score: ${this.color(score + '%', score > 80 ? 'green' : score > 60 ? 'yellow' : 'red')}`);

    // Exit code
    if (this.issues.critical.length > 0) return 3;
    if (this.issues.errors.length > 0) return 2;
    if (this.issues.warnings.length > 0) return 1;
    return 0;
  }

  // Run full diagnostics
  async run(options = {}) {
    console.log(this.color('🔍 IC Mesh Node Diagnostics', 'bright'));
    console.log(this.color('═'.repeat(40), 'blue'));
    
    if (!options.capabilities && !options.earnings) {
      this.checkSystemInfo();
      this.checkConfiguration();
    }

    if (!options.earnings) {
      await this.checkCapabilities();
    }

    if (!options.capabilities && !options.earnings) {
      await this.checkNetworkConnectivity();
      await this.checkNodeRegistration();
    }

    if (options.earnings || options.full) {
      await this.checkEarnings();
    }

    return this.displaySummary();
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    full: args.includes('--full'),
    capabilities: args.includes('--capabilities'),
    earnings: args.includes('--earnings')
  };

  const diagnostics = new NodeDiagnostics();
  diagnostics.run(options).then(exitCode => {
    process.exit(exitCode);
  }).catch(error => {
    console.error('Diagnostics failed:', error.message);
    process.exit(3);
  });
}

module.exports = NodeDiagnostics;