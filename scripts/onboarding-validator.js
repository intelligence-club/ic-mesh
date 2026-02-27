#!/usr/bin/env node
/**
 * IC Mesh Enhanced Onboarding Validator
 * 
 * Comprehensive validation and guidance tool for new operators.
 * Runs before the main client to ensure optimal setup and catch issues early.
 * 
 * Usage:
 *   node scripts/onboarding-validator.js
 *   
 * Features:
 *   - Pre-flight system validation
 *   - Configuration optimization
 *   - Network connectivity testing
 *   - Earning potential analysis
 *   - Recovery guidance for common issues
 *   - First-run success tracking
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');

// Configuration
const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(PROJECT_ROOT, 'node-config.json');
const SUCCESS_TRACKER = path.join(PROJECT_ROOT, '.onboarding-success');

// Color utilities
const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  gray: (text) => `\x1b[90m${text}\x1b[0m`
};

class OnboardingValidator {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      warnings: 0,
      issues: [],
      capabilities: {},
      earningPotential: 0
    };
    
    this.isFirstRun = !fs.existsSync(SUCCESS_TRACKER);
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString().substring(11, 19);
    const prefix = colors.gray(`[${timestamp}]`);
    
    switch (type) {
      case 'success':
        console.log(`${prefix} ✅ ${colors.green(message)}`);
        this.results.passed++;
        break;
      case 'error':
        console.log(`${prefix} ❌ ${colors.red(message)}`);
        this.results.failed++;
        break;
      case 'warning':
        console.log(`${prefix} ⚠️  ${colors.yellow(message)}`);
        this.results.warnings++;
        break;
      case 'info':
        console.log(`${prefix} ℹ️  ${colors.cyan(message)}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }

  addIssue(title, description, solution) {
    this.results.issues.push({ title, description, solution });
  }

  runCommand(command, silent = false) {
    try {
      const output = execSync(command, { 
        encoding: 'utf8', 
        stdio: silent ? 'pipe' : 'inherit',
        timeout: 30000
      });
      return { success: true, output: output?.toString().trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async checkSystemRequirements() {
    this.log('System Requirements Validation', 'info');
    console.log();

    // Node.js version check
    const nodeCheck = this.runCommand('node --version', true);
    if (nodeCheck.success) {
      const version = nodeCheck.output.replace('v', '');
      const majorVersion = parseInt(version.split('.')[0]);
      
      if (majorVersion >= 18) {
        this.log(`Node.js ${version} ✓`, 'success');
      } else {
        this.log(`Node.js ${version} - Requires 18.0+`, 'error');
        this.addIssue(
          'Node.js version too old',
          `Found Node.js ${version}, but IC Mesh requires 18.0 or higher`,
          'Install latest Node.js from https://nodejs.org'
        );
      }
    } else {
      this.log('Node.js not found', 'error');
      this.addIssue(
        'Node.js not installed',
        'Node.js is required to run IC Mesh',
        'Install Node.js 18+ from https://nodejs.org'
      );
    }

    // Git check (for auto-updates)
    const gitCheck = this.runCommand('git --version', true);
    if (gitCheck.success) {
      this.log('Git available for auto-updates ✓', 'success');
    } else {
      this.log('Git not found - auto-updates disabled', 'warning');
    }

    // NPM dependencies
    const nodeModulesExists = fs.existsSync(path.join(PROJECT_ROOT, 'node_modules'));
    if (nodeModulesExists) {
      this.log('NPM dependencies installed ✓', 'success');
    } else {
      this.log('NPM dependencies missing', 'warning');
      this.addIssue(
        'Missing dependencies',
        'Node modules not installed',
        'Run: npm install'
      );
    }

    // Disk space check
    const diskCheck = this.runCommand('df -h .', true);
    if (diskCheck.success) {
      const lines = diskCheck.output.split('\n');
      const dataLine = lines[1];
      if (dataLine) {
        const parts = dataLine.split(/\s+/);
        const available = parts[3];
        this.log(`Disk space: ${available} available ✓`, 'success');
      }
    }

    console.log();
  }

  async checkNetworkConnectivity() {
    this.log('Network Connectivity Testing', 'info');
    console.log();

    // Basic internet connectivity
    const internetCheck = this.runCommand('curl -s --max-time 10 https://google.com > /dev/null', true);
    if (internetCheck.success) {
      this.log('Internet connectivity ✓', 'success');
    } else {
      this.log('No internet connectivity', 'error');
      this.addIssue(
        'Internet connection required',
        'Cannot reach external websites',
        'Check your internet connection and firewall settings'
      );
      return;
    }

    // IC Mesh server connectivity
    const meshCheck = this.runCommand('curl -s --max-time 15 https://moilol.com:8333/status', true);
    if (meshCheck.success) {
      try {
        const status = JSON.parse(meshCheck.output);
        this.log(`IC Mesh server reachable (${status.nodes || 'N/A'} nodes online) ✓`, 'success');
      } catch (e) {
        this.log('IC Mesh server responding but data format unexpected', 'warning');
      }
    } else {
      this.log('Cannot reach IC Mesh server', 'error');
      this.addIssue(
        'Mesh server unreachable',
        'Cannot connect to https://moilol.com:8333',
        'Check firewall settings and ensure port 8333 is not blocked'
      );
    }

    // WebSocket connectivity test
    this.log('Testing WebSocket connection...', 'info');
    const wsTest = this.runCommand(
      'timeout 10 node -e "const ws = new (require(\'ws\'))(\'wss://moilol.com:8333\'); ws.on(\'open\', () => { console.log(\'OK\'); process.exit(0); }); ws.on(\'error\', () => process.exit(1));"',
      true
    );
    
    if (wsTest.success) {
      this.log('WebSocket connection ✓', 'success');
    } else {
      this.log('WebSocket connection failed - falling back to HTTP polling', 'warning');
    }

    console.log();
  }

  async detectCapabilities() {
    this.log('Capability Detection & Earning Analysis', 'info');
    console.log();

    const capabilities = {};
    let totalEarningPotential = 0;

    // Ollama detection with model inventory
    const ollamaCheck = this.runCommand('curl -s --max-time 5 http://localhost:11434/api/tags', true);
    if (ollamaCheck.success) {
      try {
        const data = JSON.parse(ollamaCheck.output);
        if (data.models && data.models.length > 0) {
          capabilities.ollama = data.models.length;
          const modelList = data.models.map(m => m.name).join(', ');
          this.log(`Ollama: ${data.models.length} models (${modelList}) ✓`, 'success');
          
          // Earning calculation: $2-4 per popular model per day
          const popularModels = data.models.filter(m => 
            m.name.includes('llama') || m.name.includes('mistral') || m.name.includes('codellama')
          );
          const dailyEarnings = popularModels.length * 3; // Conservative estimate
          totalEarningPotential += dailyEarnings;
          this.log(`  💰 Estimated daily earnings: $${dailyEarnings}-${dailyEarnings * 2}`, 'info');
        }
      } catch (e) {
        this.log('Ollama responding but no models found', 'warning');
      }
    } else {
      this.log('Ollama not detected', 'warning');
      this.log('  📈 Install Ollama (https://ollama.com) to earn $2-8/day with LLM inference', 'info');
    }

    // Whisper detection (highest value capability)
    const whisperCheck = this.runCommand('which whisper', true);
    const pythonWhisperCheck = this.runCommand('python3 -c "import whisper"', true);
    
    if (whisperCheck.success || pythonWhisperCheck.success) {
      capabilities.whisper = true;
      this.log('Whisper transcription available ✓', 'success');
      
      // High earning potential for transcription
      const transcriptionEarnings = 8; // High demand
      totalEarningPotential += transcriptionEarnings;
      this.log(`  💰 Estimated daily earnings: $${transcriptionEarnings}-${transcriptionEarnings * 2} (high demand!)`, 'info');
    } else {
      this.log('Whisper not detected', 'warning');
      this.log('  📈 Install Whisper (pip install openai-whisper) to earn $5-15/day', 'info');
    }

    // FFmpeg detection
    const ffmpegCheck = this.runCommand('which ffmpeg', true);
    if (ffmpegCheck.success) {
      capabilities.ffmpeg = true;
      this.log('FFmpeg media processing ✓', 'success');
      
      const mediaEarnings = 2;
      totalEarningPotential += mediaEarnings;
      this.log(`  💰 Estimated daily earnings: $${mediaEarnings}-${mediaEarnings * 2}`, 'info');
    } else {
      this.log('FFmpeg not detected', 'warning');
      this.log('  📈 Install FFmpeg for media processing jobs', 'info');
    }

    // Tesseract OCR detection
    const tesseractCheck = this.runCommand('which tesseract', true);
    if (tesseractCheck.success) {
      capabilities.tesseract = true;
      this.log('Tesseract OCR available ✓', 'success');
      
      const ocrEarnings = 3;
      totalEarningPotential += ocrEarnings;
      this.log(`  💰 Estimated daily earnings: $${ocrEarnings}-${ocrEarnings * 2}`, 'info');
    } else {
      this.log('Tesseract OCR not detected', 'warning');
      this.log('  📈 Install Tesseract (apt install tesseract-ocr / brew install tesseract) for OCR jobs', 'info');
    }

    // GPU detection with performance boost estimation
    const nvidiaCheck = this.runCommand('nvidia-smi -q', true);
    const metalCheck = this.runCommand('system_profiler SPDisplaysDataType | grep -i metal', true);
    
    if (nvidiaCheck.success) {
      capabilities.gpu = 'nvidia';
      this.log('NVIDIA GPU detected - performance boost enabled ✓', 'success');
      totalEarningPotential *= 1.5; // GPU boost
      this.log('  🚀 GPU acceleration increases all earnings by 50-100%', 'info');
    } else if (metalCheck.success) {
      capabilities.gpu = 'metal';
      this.log('Apple Silicon GPU detected - Metal acceleration enabled ✓', 'success');
      totalEarningPotential *= 1.3; // Moderate boost
      this.log('  🚀 Metal acceleration boosts inference performance', 'info');
    } else {
      this.log('No dedicated GPU - CPU processing still valuable', 'info');
    }

    this.results.capabilities = capabilities;
    this.results.earningPotential = Math.round(totalEarningPotential);

    // Summary
    console.log();
    if (totalEarningPotential > 0) {
      this.log(`💰 Total estimated daily earning potential: $${Math.round(totalEarningPotential)}-${Math.round(totalEarningPotential * 2)}`, 'success');
      this.log(`📊 Monthly estimate: $${Math.round(totalEarningPotential * 30)}-${Math.round(totalEarningPotential * 60)}`, 'info');
    } else {
      this.log('Limited earning capabilities detected', 'warning');
      this.addIssue(
        'Low earning potential',
        'No major earning capabilities detected',
        'Consider installing Ollama, Whisper, or FFmpeg to increase earnings'
      );
    }

    console.log();
  }

  async validateConfiguration() {
    this.log('Configuration Validation', 'info');
    console.log();

    if (!fs.existsSync(CONFIG_FILE)) {
      this.log('No configuration file found', 'warning');
      this.addIssue(
        'Missing configuration',
        'node-config.json not found',
        'Run the operator setup script: node scripts/operator-setup.js'
      );
      return;
    }

    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      this.log('Configuration file valid ✓', 'success');

      // Validate required fields
      const requiredFields = ['node.name', 'node.owner', 'server.url'];
      for (const field of requiredFields) {
        const value = field.split('.').reduce((obj, key) => obj?.[key], config);
        if (value) {
          this.log(`${field}: ${value} ✓`, 'success');
        } else {
          this.log(`Missing required field: ${field}`, 'error');
          this.addIssue(
            'Invalid configuration',
            `Required field ${field} is missing`,
            'Run setup again: node scripts/operator-setup.js'
          );
        }
      }

      // Validate enabled handlers match detected capabilities
      if (config.handlers) {
        const enabledHandlers = Object.entries(config.handlers)
          .filter(([_, handler]) => handler.enabled)
          .map(([name]) => name);
        
        if (enabledHandlers.length > 0) {
          this.log(`Enabled handlers: ${enabledHandlers.join(', ')} ✓`, 'success');
        } else {
          this.log('No handlers enabled', 'warning');
          this.addIssue(
            'No capabilities enabled',
            'All job handlers are disabled in configuration',
            'Enable handlers matching your system capabilities'
          );
        }
      }

    } catch (err) {
      this.log('Configuration file corrupted', 'error');
      this.addIssue(
        'Invalid configuration file',
        'node-config.json contains invalid JSON',
        'Delete the file and run setup again'
      );
    }

    console.log();
  }

  async performQuickIntegrationTest() {
    this.log('Quick Integration Test', 'info');
    console.log();

    // Test if we can register with the mesh
    this.log('Testing node registration...', 'info');
    
    const testConfig = {
      meshServer: 'https://moilol.com:8333',
      nodeName: `test-${crypto.randomBytes(4).toString('hex')}`,
      nodeOwner: 'onboarding-test',
      nodeRegion: 'test'
    };

    const testPayload = JSON.stringify({
      name: testConfig.nodeName,
      owner: testConfig.nodeOwner,
      region: testConfig.nodeRegion,
      capabilities: Object.keys(this.results.capabilities),
      specs: {
        ram: Math.round(require('os').totalmem() / 1024 / 1024),
        cpu: require('os').cpus().length,
        platform: require('os').platform()
      }
    });

    const registrationTest = this.runCommand(
      `curl -s --max-time 10 -X POST -H "Content-Type: application/json" -d '${testPayload}' https://moilol.com:8333/register`,
      true
    );

    if (registrationTest.success && registrationTest.output.includes('nodeId')) {
      this.log('Node registration test ✓', 'success');
      
      // Try to immediately deregister test node
      try {
        const testResult = JSON.parse(registrationTest.output);
        if (testResult.nodeId) {
          this.runCommand(
            `curl -s --max-time 5 -X POST https://moilol.com:8333/leave/${testResult.nodeId}`,
            true
          );
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    } else {
      this.log('Node registration failed', 'error');
      this.addIssue(
        'Cannot register with mesh',
        'Registration API call failed',
        'Check network connectivity and server status'
      );
    }

    console.log();
  }

  async generateOnboardingReport() {
    console.log(colors.bold('🎯 ONBOARDING VALIDATION SUMMARY'));
    console.log('=====================================');
    console.log();

    // Results summary
    const total = this.results.passed + this.results.failed + this.results.warnings;
    console.log(`📊 Checks completed: ${total}`);
    console.log(`✅ Passed: ${colors.green(this.results.passed)}`);
    console.log(`❌ Failed: ${colors.red(this.results.failed)}`);
    console.log(`⚠️  Warnings: ${colors.yellow(this.results.warnings)}`);
    console.log();

    // Earning potential
    if (this.results.earningPotential > 0) {
      console.log(`💰 Estimated earning potential: ${colors.green(`$${this.results.earningPotential}-${this.results.earningPotential * 2}/day`)}`);
    }
    console.log();

    // Success assessment
    const isReady = this.results.failed === 0;
    if (isReady) {
      console.log(colors.green('🎉 READY TO LAUNCH! Your node is properly configured and ready to start earning.'));
      
      if (this.isFirstRun) {
        fs.writeFileSync(SUCCESS_TRACKER, JSON.stringify({
          timestamp: new Date().toISOString(),
          version: require('../package.json').version,
          capabilities: Object.keys(this.results.capabilities),
          earningPotential: this.results.earningPotential
        }));
        console.log();
        console.log('💡 Next steps:');
        console.log('  1. Start your node: node client.js');
        console.log('  2. Monitor earnings: https://moilol.com/account');
        console.log('  3. View network status: https://moilol.com:8333');
      }
    } else {
      console.log(colors.red('⚠️  ISSUES DETECTED - Please resolve the following before starting your node:'));
    }

    // Issue resolution guide
    if (this.results.issues.length > 0) {
      console.log();
      console.log(colors.bold('🔧 ISSUE RESOLUTION GUIDE'));
      console.log('========================');
      
      this.results.issues.forEach((issue, index) => {
        console.log();
        console.log(colors.bold(`${index + 1}. ${issue.title}`));
        console.log(`   Problem: ${issue.description}`);
        console.log(colors.cyan(`   Solution: ${issue.solution}`));
      });
    }

    console.log();
    return isReady;
  }

  async run() {
    console.log(colors.bold('🌐 IC Mesh Enhanced Onboarding Validator'));
    console.log('========================================');
    
    if (this.isFirstRun) {
      console.log(colors.cyan('🎯 First run detected - performing comprehensive validation'));
    } else {
      console.log(colors.cyan('🔄 Validating configuration before startup'));
    }
    
    console.log();

    try {
      await this.checkSystemRequirements();
      await this.checkNetworkConnectivity();
      await this.detectCapabilities();
      await this.validateConfiguration();
      
      if (this.results.failed === 0) {
        await this.performQuickIntegrationTest();
      }

      const isReady = await this.generateOnboardingReport();
      
      return isReady ? 0 : 1;

    } catch (err) {
      console.error(colors.red(`❌ Validation failed: ${err.message}`));
      return 1;
    }
  }
}

// Main execution
if (require.main === module) {
  const validator = new OnboardingValidator();
  
  validator.run().then(exitCode => {
    process.exit(exitCode);
  }).catch(err => {
    console.error(colors.red(`Fatal error: ${err.message}`));
    process.exit(1);
  });
}

module.exports = OnboardingValidator;