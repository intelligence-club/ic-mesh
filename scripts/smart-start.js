#!/usr/bin/env node
/**
 * IC Mesh Smart Start
 * 
 * Intelligent startup wrapper that ensures smooth onboarding for new operators.
 * Automatically runs validation, handles common issues, and provides guidance.
 * 
 * Usage:
 *   node scripts/smart-start.js
 *   
 * Features:
 *   - Pre-startup validation
 *   - Automatic issue detection and resolution
 *   - Performance optimization
 *   - User guidance and feedback
 *   - Graceful error handling
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

// Configuration
const PROJECT_ROOT = path.join(__dirname, '..');
const SUCCESS_TRACKER = path.join(PROJECT_ROOT, '.onboarding-success');
const CLIENT_SCRIPT = path.join(PROJECT_ROOT, 'client.js');

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

class SmartStart {
  constructor() {
    this.isFirstRun = !fs.existsSync(SUCCESS_TRACKER);
    this.startTime = Date.now();
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString().substring(11, 19);
    const prefix = colors.gray(`[${timestamp}]`);
    
    switch (type) {
      case 'success':
        console.log(`${prefix} ✅ ${colors.green(message)}`);
        break;
      case 'error':
        console.log(`${prefix} ❌ ${colors.red(message)}`);
        break;
      case 'warning':
        console.log(`${prefix} ⚠️  ${colors.yellow(message)}`);
        break;
      case 'info':
        console.log(`${prefix} ℹ️  ${colors.cyan(message)}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }

  async runOnboardingValidation() {
    this.log('Running pre-startup validation...', 'info');
    
    try {
      const validatorPath = path.join(__dirname, 'onboarding-validator.js');
      
      // Check if validator exists
      if (!fs.existsSync(validatorPath)) {
        this.log('Validator not found, skipping validation', 'warning');
        return true;
      }

      // Run validator
      const result = execSync(`node "${validatorPath}"`, { 
        encoding: 'utf8',
        stdio: 'inherit'
      });
      
      return true; // If no exception, validation passed

    } catch (err) {
      this.log('Validation failed - please resolve issues before starting', 'error');
      return false;
    }
  }

  async autoInstallDependencies() {
    const nodeModulesExists = fs.existsSync(path.join(PROJECT_ROOT, 'node_modules'));
    
    if (!nodeModulesExists) {
      this.log('Installing dependencies...', 'info');
      
      try {
        execSync('npm install', { 
          cwd: PROJECT_ROOT,
          stdio: 'inherit'
        });
        this.log('Dependencies installed successfully ✓', 'success');
        return true;
      } catch (err) {
        this.log('Failed to install dependencies', 'error');
        return false;
      }
    }
    
    return true;
  }

  async checkConfiguration() {
    const configFile = path.join(PROJECT_ROOT, 'node-config.json');
    
    if (!fs.existsSync(configFile)) {
      this.log('No configuration found', 'warning');
      this.log('Please run: node scripts/operator-setup.js', 'info');
      return false;
    }

    try {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      
      // Check for required fields
      if (!config.node?.name || !config.node?.owner || !config.server?.url) {
        this.log('Configuration incomplete', 'warning');
        this.log('Please run: node scripts/operator-setup.js', 'info');
        return false;
      }

      this.log(`Configuration loaded: ${config.node.name}`, 'success');
      return true;

    } catch (err) {
      this.log('Configuration file corrupted', 'error');
      return false;
    }
  }

  async optimizeEnvironment() {
    this.log('Optimizing environment...', 'info');

    // Set optimal process limits
    try {
      process.setMaxListeners(20); // Increase event listener limit
      
      // Set environment variables for better performance
      process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '8';
      process.env.NODE_OPTIONS = process.env.NODE_OPTIONS || '--max-old-space-size=2048';
      
      this.log('Environment optimized ✓', 'success');
      return true;
    } catch (err) {
      this.log('Environment optimization failed, continuing anyway', 'warning');
      return true;
    }
  }

  async showStartupBanner() {
    const uptimeHours = Math.round((Date.now() - this.startTime) / 1000 / 60);
    const config = this.loadConfig();
    
    console.log();
    console.log(colors.bold('┌──────────────────────────────────────┐'));
    console.log(colors.bold('│  🌐 IC MESH - Smart Start v1.0.0     │'));
    console.log(colors.bold('└──────────────────────────────────────┘'));
    console.log();
    
    if (config) {
      console.log(`  Node: ${colors.cyan(config.node?.name || 'unknown')}`);
      console.log(`  Owner: ${colors.cyan(config.node?.owner || 'unknown')}`);
      console.log(`  Server: ${colors.cyan(config.server?.url || 'unknown')}`);
    }
    
    console.log();
    console.log(colors.yellow('🚀 Starting your IC Mesh node...'));
    console.log(colors.gray('   Press Ctrl+C to stop'));
    console.log();
  }

  loadConfig() {
    const configFile = path.join(PROJECT_ROOT, 'node-config.json');
    try {
      return JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch {
      return null;
    }
  }

  async startMainClient() {
    this.log('Starting IC Mesh client...', 'info');

    // Check if client exists
    if (!fs.existsSync(CLIENT_SCRIPT)) {
      this.log('Client script not found!', 'error');
      return false;
    }

    // Start the main client
    const client = spawn('node', [CLIENT_SCRIPT], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        IC_SMART_START: 'true'
      }
    });

    // Handle graceful shutdown
    const shutdown = (signal) => {
      console.log();
      this.log(`Received ${signal}, shutting down...`, 'info');
      client.kill(signal);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Monitor client status
    client.on('close', (code, signal) => {
      console.log();
      
      if (signal) {
        this.log(`Node stopped by signal ${signal}`, 'info');
      } else if (code === 0) {
        this.log('Node stopped gracefully', 'success');
      } else {
        this.log(`Node exited with error code ${code}`, 'error');
        
        // Provide restart guidance
        console.log();
        console.log(colors.yellow('💡 Troubleshooting tips:'));
        console.log('  - Check network connectivity');
        console.log('  - Verify configuration: node scripts/onboarding-validator.js');
        console.log('  - View logs for detailed error information');
        console.log('  - Restart with: node scripts/smart-start.js');
      }
    });

    client.on('error', (err) => {
      this.log(`Failed to start client: ${err.message}`, 'error');
    });

    // Keep process alive
    return new Promise((resolve) => {
      client.on('close', resolve);
    });
  }

  async showFirstRunWelcome() {
    if (!this.isFirstRun) return;

    console.log();
    console.log(colors.bold('🎉 Welcome to IC Mesh!'));
    console.log('===================');
    console.log();
    console.log('This appears to be your first time running IC Mesh.');
    console.log('We\'ll help ensure everything is properly configured.');
    console.log();
  }

  async showPerformanceTips() {
    const config = this.loadConfig();
    if (!config) return;

    console.log();
    console.log(colors.bold('💡 Performance Tips'));
    console.log('==================');
    console.log();

    // Memory optimization
    const totalRAM = Math.round(require('os').totalmem() / 1024 / 1024 / 1024);
    if (totalRAM < 4) {
      this.log('Consider closing other applications to free up memory', 'warning');
    }

    // Capability optimization
    const enabledHandlers = config.handlers ? 
      Object.entries(config.handlers)
        .filter(([_, handler]) => handler.enabled)
        .map(([name]) => name) : [];

    if (enabledHandlers.length === 0) {
      this.log('No job handlers enabled - consider enabling capabilities in your config', 'warning');
    }

    // Network optimization tips
    this.log('Keep your machine running 24/7 for maximum earning potential', 'info');
    this.log('Ensure stable internet connection for reliable job processing', 'info');
    
    console.log();
  }

  async run() {
    try {
      // Welcome message for first-time users
      await this.showFirstRunWelcome();

      // Pre-startup checks
      this.log('Starting IC Mesh with smart validation...', 'info');

      // Install dependencies if needed
      if (!(await this.autoInstallDependencies())) {
        this.log('Dependency installation failed', 'error');
        return 1;
      }

      // Check configuration
      if (!(await this.checkConfiguration())) {
        this.log('Configuration check failed', 'error');
        return 1;
      }

      // Run validation (skip on repeated runs if no issues)
      if (this.isFirstRun || process.argv.includes('--force-validation')) {
        if (!(await this.runOnboardingValidation())) {
          this.log('Validation failed - please resolve issues first', 'error');
          return 1;
        }
      }

      // Optimize environment
      await this.optimizeEnvironment();

      // Show performance tips
      await this.showPerformanceTips();

      // Show startup banner
      await this.showStartupBanner();

      // Start the main client
      await this.startMainClient();

      return 0;

    } catch (err) {
      this.log(`Fatal error: ${err.message}`, 'error');
      console.error(err.stack);
      return 1;
    }
  }
}

// CLI handling
if (require.main === module) {
  const smartStart = new SmartStart();
  
  // Handle command line arguments
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('IC Mesh Smart Start');
    console.log('');
    console.log('Usage: node scripts/smart-start.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  --force-validation   Run full validation even on repeat runs');
    console.log('  --help, -h          Show this help message');
    console.log('');
    process.exit(0);
  }

  smartStart.run().then(exitCode => {
    process.exit(exitCode);
  }).catch(err => {
    console.error(colors.red(`Smart start failed: ${err.message}`));
    process.exit(1);
  });
}

module.exports = SmartStart;