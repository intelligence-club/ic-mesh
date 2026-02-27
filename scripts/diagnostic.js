#!/usr/bin/env node

/**
 * IC Mesh Diagnostic Tool
 * 
 * Quick diagnostic and troubleshooting for IC Mesh operators.
 * Checks common configuration and connectivity issues.
 * 
 * Usage:
 *   node scripts/diagnostic.js [--fix] [--verbose]
 *   
 * What it checks:
 *   - Network connectivity to mesh hub
 *   - Node configuration validity  
 *   - System capabilities and dependencies
 *   - Common permission and path issues
 *   - Database integrity
 *   - Earnings and payout status
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const https = require('https');
const crypto = require('crypto');

// Configuration
const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(PROJECT_ROOT, 'node-config.json');
const DEFAULT_HUB = 'https://moilol.com/mesh';

// Command line arguments
const args = process.argv.slice(2);
const SHOULD_FIX = args.includes('--fix');
const VERBOSE = args.includes('--verbose');

// Colors for output
const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
  dim: (text) => `\x1b[2m${text}\x1b[0m`
};

function log(message, color = null) {
  const output = color ? color(message) : message;
  console.log(output);
}

function verbose(message) {
  if (VERBOSE) {
    log(`  ${colors.dim(message)}`);
  }
}

class DiagnosticRunner {
  constructor() {
    this.issues = [];
    this.fixes = [];
    this.config = null;
  }

  async run() {
    log(colors.bold('🔍 IC Mesh Diagnostic Tool\n'));
    
    try {
      await this.checkConfiguration();
      await this.checkNetworkConnectivity();
      await this.checkSystemDependencies();
      await this.checkCapabilities();
      await this.checkDatabase();
      await this.checkEarningsStatus();
      
      this.reportResults();
      
      if (SHOULD_FIX && this.fixes.length > 0) {
        await this.applyFixes();
      }
      
    } catch (error) {
      log(`${colors.red('❌ Diagnostic failed:')} ${error.message}`);
      process.exit(1);
    }
  }

  addIssue(type, message, fix = null) {
    this.issues.push({ type, message, fix });
    if (fix) {
      this.fixes.push(fix);
    }
  }

  async checkConfiguration() {
    log(colors.blue('📋 Checking Configuration...'));
    
    // Check if config file exists
    if (!fs.existsSync(CONFIG_FILE)) {
      this.addIssue('error', 'No node-config.json found', () => {
        log('Creating default configuration...');
        const exampleExists = fs.existsSync(path.join(PROJECT_ROOT, 'node-config.example.json'));
        if (exampleExists) {
          fs.copyFileSync(path.join(PROJECT_ROOT, 'node-config.example.json'), CONFIG_FILE);
          log(colors.green('✅ Created node-config.json from example'));
        } else {
          this.createMinimalConfig();
          log(colors.green('✅ Created minimal node-config.json'));
        }
      });
      return;
    }
    
    // Load and validate config
    try {
      const configContent = fs.readFileSync(CONFIG_FILE, 'utf8');
      this.config = JSON.parse(configContent);
      verbose(`Configuration loaded from ${CONFIG_FILE}`);
      log(colors.green('✅ Configuration file exists and is valid JSON'));
    } catch (error) {
      this.addIssue('error', `Invalid JSON in node-config.json: ${error.message}`, () => {
        log('Backing up corrupted config and creating new one...');
        fs.renameSync(CONFIG_FILE, `${CONFIG_FILE}.backup`);
        this.createMinimalConfig();
        log(colors.green('✅ Created new configuration, old file backed up'));
      });
      return;
    }
    
    // Validate required fields
    const requiredFields = ['name', 'meshHub'];
    for (const field of requiredFields) {
      if (!this.config[field]) {
        this.addIssue('warning', `Missing required field: ${field}`, () => {
          if (field === 'name') {
            this.config.name = `diagnostic-node-${crypto.randomBytes(4).toString('hex')}`;
          }
          if (field === 'meshHub') {
            this.config.meshHub = DEFAULT_HUB;
          }
          this.saveConfig();
          log(colors.green(`✅ Added default value for ${field}`));
        });
      }
    }
    
    // Check mesh hub URL format
    if (this.config.meshHub && !this.config.meshHub.match(/^https?:\/\//)) {
      this.addIssue('error', 'meshHub must be a valid URL starting with http:// or https://');
    }
    
    verbose(`Node name: ${this.config.name || 'NOT SET'}`);
    verbose(`Mesh hub: ${this.config.meshHub || 'NOT SET'}`);
  }

  async checkNetworkConnectivity() {
    log(colors.blue('🌐 Checking Network Connectivity...'));
    
    const meshHub = this.config?.meshHub || DEFAULT_HUB;
    
    try {
      // Check mesh hub connectivity
      await this.makeRequest(meshHub + '/status');
      log(colors.green('✅ Can connect to mesh hub'));
      verbose(`Mesh hub responding: ${meshHub}`);
      
      // Check if this node is registered
      if (this.config?.nodeId) {
        try {
          const nodes = await this.makeRequest(meshHub + '/nodes');
          const nodeExists = nodes.some(node => node.nodeId === this.config.nodeId);
          
          if (nodeExists) {
            log(colors.green('✅ Node is registered with mesh hub'));
            verbose(`Node ID: ${this.config.nodeId}`);
          } else {
            this.addIssue('warning', 'Node ID not found in mesh registry - may need to re-register');
          }
        } catch (error) {
          verbose(`Could not check node registration: ${error.message}`);
        }
      }
      
    } catch (error) {
      this.addIssue('error', `Cannot connect to mesh hub: ${error.message}`);
      verbose(`Failed to connect to: ${meshHub}`);
    }
    
    // Check internet connectivity with fallback
    try {
      await this.makeRequest('https://httpbin.org/get', 5000); // 5 second timeout
      log(colors.green('✅ Internet connectivity working'));
    } catch (error) {
      this.addIssue('error', `Internet connectivity issue: ${error.message}`);
    }
  }

  async checkSystemDependencies() {
    log(colors.blue('🔧 Checking System Dependencies...'));
    
    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.replace('v', '').split('.')[0]);
    
    if (majorVersion >= 18) {
      log(colors.green(`✅ Node.js version: ${nodeVersion} (supported)`));
    } else {
      this.addIssue('error', `Node.js version ${nodeVersion} is too old. Requires v18 or higher.`);
    }
    
    // Check if package.json exists and npm install was run
    const packagePath = path.join(PROJECT_ROOT, 'package.json');
    const nodeModulesPath = path.join(PROJECT_ROOT, 'node_modules');
    
    if (fs.existsSync(packagePath)) {
      log(colors.green('✅ package.json found'));
      
      if (fs.existsSync(nodeModulesPath)) {
        log(colors.green('✅ node_modules directory exists'));
        
        // Check if important dependencies are installed
        const importantDeps = ['better-sqlite3', 'ws'];
        for (const dep of importantDeps) {
          const depPath = path.join(nodeModulesPath, dep);
          if (fs.existsSync(depPath)) {
            verbose(`${dep}: installed`);
          } else {
            this.addIssue('warning', `Missing dependency: ${dep}`, () => {
              log('Running npm install...');
              execSync('npm install', { cwd: PROJECT_ROOT, stdio: 'inherit' });
              log(colors.green('✅ Dependencies installed'));
            });
          }
        }
      } else {
        this.addIssue('error', 'node_modules not found - run npm install', () => {
          log('Running npm install...');
          execSync('npm install', { cwd: PROJECT_ROOT, stdio: 'inherit' });
          log(colors.green('✅ Dependencies installed'));
        });
      }
    } else {
      this.addIssue('error', 'package.json not found - are you in the IC Mesh directory?');
    }
  }

  async checkCapabilities() {
    log(colors.blue('🚀 Checking Capabilities...'));
    
    const capabilities = [];
    
    // Check for Whisper (transcription)
    try {
      execSync('which whisper', { stdio: 'ignore' });
      capabilities.push('whisper');
      log(colors.green('✅ Whisper found (transcription capability)'));
    } catch (error) {
      verbose('Whisper not found in PATH');
    }
    
    // Check for Ollama (LLM inference)  
    try {
      execSync('ollama --version', { stdio: 'ignore' });
      capabilities.push('ollama');
      log(colors.green('✅ Ollama found (LLM inference capability)'));
    } catch (error) {
      verbose('Ollama not found or not running');
    }
    
    // Check for FFmpeg (media processing)
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' });
      capabilities.push('ffmpeg');
      log(colors.green('✅ FFmpeg found (media processing capability)'));
    } catch (error) {
      verbose('FFmpeg not found in PATH');
    }
    
    // Check for Tesseract (OCR)
    try {
      execSync('tesseract --version', { stdio: 'ignore' });
      capabilities.push('tesseract');
      log(colors.green('✅ Tesseract found (OCR capability)'));
    } catch (error) {
      verbose('Tesseract not found in PATH');
    }
    
    // Check for Python (required for some capabilities)
    try {
      execSync('python3 --version', { stdio: 'ignore' });
      log(colors.green('✅ Python3 found'));
    } catch (error) {
      verbose('Python3 not found in PATH');
    }
    
    if (capabilities.length === 0) {
      this.addIssue('warning', 'No capabilities detected - node can only do basic processing');
      log(colors.yellow('ℹ️  Install Whisper, Ollama, or FFmpeg to increase earning potential'));
    } else {
      verbose(`Detected capabilities: ${capabilities.join(', ')}`);
    }
    
    // Update config with detected capabilities if fixing
    if (SHOULD_FIX && this.config && capabilities.length > 0) {
      this.config.capabilities = capabilities;
      this.saveConfig();
      log(colors.green('✅ Updated configuration with detected capabilities'));
    }
  }

  async checkDatabase() {
    log(colors.blue('🗄️  Checking Database...'));
    
    // Check if database file exists (for local development)
    const dbPath = path.join(PROJECT_ROOT, 'data', 'mesh.db');
    if (fs.existsSync(dbPath)) {
      log(colors.green('✅ Local database file found'));
      verbose(`Database path: ${dbPath}`);
      
      // Check if database is readable
      try {
        const stats = fs.statSync(dbPath);
        if (stats.size > 0) {
          verbose(`Database size: ${Math.round(stats.size / 1024)}KB`);
        } else {
          this.addIssue('warning', 'Database file exists but is empty');
        }
      } catch (error) {
        this.addIssue('warning', `Database file not readable: ${error.message}`);
      }
    } else {
      verbose('No local database found (normal for production nodes)');
    }
    
    // Check data directory permissions
    const dataDir = path.join(PROJECT_ROOT, 'data');
    if (!fs.existsSync(dataDir)) {
      this.addIssue('info', 'Data directory does not exist', () => {
        fs.mkdirSync(dataDir, { recursive: true });
        log(colors.green('✅ Created data directory'));
      });
    } else {
      try {
        fs.accessSync(dataDir, fs.constants.R_OK | fs.constants.W_OK);
        verbose('Data directory is readable and writable');
      } catch (error) {
        this.addIssue('error', `Data directory permission issue: ${error.message}`);
      }
    }
  }

  async checkEarningsStatus() {
    log(colors.blue('💰 Checking Earnings Status...'));
    
    if (!this.config?.nodeId) {
      this.addIssue('info', 'No node ID found - cannot check earnings');
      return;
    }
    
    try {
      const meshHub = this.config.meshHub || DEFAULT_HUB;
      const earnings = await this.makeRequest(`${meshHub}/payouts/${this.config.nodeId}`);
      
      if (earnings && typeof earnings.balance === 'number') {
        const balanceInts = earnings.balance;
        const balanceUsd = (balanceInts / 1000).toFixed(2);
        
        log(colors.green(`✅ Earnings balance: ${balanceInts} ints ($${balanceUsd})`));
        verbose(`Total jobs completed: ${earnings.jobs_completed || 'unknown'}`);
        
        if (balanceInts >= 1000) {
          log(colors.cyan('💡 You have enough balance to cash out!'));
        } else if (balanceInts > 0) {
          log(colors.cyan(`💡 You need ${1000 - balanceInts} more ints to reach minimum cashout`));
        }
      } else {
        this.addIssue('info', 'No earnings data found - node may not have completed any jobs yet');
      }
      
    } catch (error) {
      verbose(`Could not check earnings: ${error.message}`);
      this.addIssue('warning', 'Unable to check earnings status - network or authentication issue');
    }
  }

  reportResults() {
    log(colors.bold('\n📊 Diagnostic Results\n'));
    
    const errors = this.issues.filter(issue => issue.type === 'error');
    const warnings = this.issues.filter(issue => issue.type === 'warning');
    const info = this.issues.filter(issue => issue.type === 'info');
    
    if (errors.length === 0) {
      log(colors.green('🎉 No critical issues found!'));
    } else {
      log(colors.red(`❌ ${errors.length} critical issue(s) found:`));
      errors.forEach(issue => log(`   • ${issue.message}`));
    }
    
    if (warnings.length > 0) {
      log(colors.yellow(`\n⚠️  ${warnings.length} warning(s):`));
      warnings.forEach(issue => log(`   • ${issue.message}`));
    }
    
    if (info.length > 0 && VERBOSE) {
      log(colors.blue(`\nℹ️  ${info.length} info item(s):`));
      info.forEach(issue => log(`   • ${issue.message}`));
    }
    
    if (this.fixes.length > 0) {
      log(colors.cyan(`\n🔧 ${this.fixes.length} automatic fix(es) available`));
      if (!SHOULD_FIX) {
        log(colors.dim('   Run with --fix to apply automatically'));
      }
    }
    
    if (errors.length === 0 && warnings.length === 0) {
      log(colors.green('\n✅ Your IC Mesh node appears to be configured correctly!'));
      log(colors.cyan('💡 Next steps:'));
      log('   • Start your node: node client.js');
      log('   • Monitor earnings: node scripts/earnings-check.js');
      log('   • Check network status: https://moilol.com/mesh');
    }
  }

  async applyFixes() {
    log(colors.bold('\n🔧 Applying Automatic Fixes...\n'));
    
    for (const fix of this.fixes) {
      if (typeof fix === 'function') {
        try {
          await fix();
        } catch (error) {
          log(colors.red(`❌ Fix failed: ${error.message}`));
        }
      }
    }
    
    log(colors.green('\n✅ Automatic fixes completed'));
  }

  createMinimalConfig() {
    const config = {
      name: `diagnostic-node-${crypto.randomBytes(4).toString('hex')}`,
      meshHub: DEFAULT_HUB,
      capabilities: [],
      models: [],
      polling: {
        interval: 5000,
        method: "websocket"
      }
    };
    
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    this.config = config;
  }

  saveConfig() {
    if (this.config) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
    }
  }

  makeRequest(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const request = https.get(url, { timeout }, (response) => {
        let data = '';
        
        response.on('data', (chunk) => {
          data += chunk;
        });
        
        response.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            resolve(jsonData);
          } catch (error) {
            if (response.statusCode === 200) {
              resolve(data); // Return raw data if not JSON
            } else {
              reject(new Error(`HTTP ${response.statusCode}`));
            }
          }
        });
      });
      
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
      
      request.on('error', (error) => {
        reject(error);
      });
    });
  }
}

// CLI interface
if (require.main === module) {
  const diagnostic = new DiagnosticRunner();
  diagnostic.run().catch(error => {
    console.error(colors.red('Diagnostic failed:'), error.message);
    process.exit(1);
  });
}

module.exports = DiagnosticRunner;