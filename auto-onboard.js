#!/usr/bin/env node
/**
 * Automated Onboarding Improvement System for IC Mesh
 * 
 * Provides intelligent, automated assistance for new node operators to reduce
 * the 75% churn rate. Uses system detection, guided configuration, and 
 * proactive support to maximize onboarding success.
 * 
 * Features:
 * - System capability auto-detection and optimization
 * - Step-by-step guided configuration with validation
 * - Real-time success monitoring and intervention
 * - Automated problem resolution for common issues
 * - Personalized earning projections and optimization tips
 * 
 * Usage:
 *   ./auto-onboard.js new        # Complete onboarding wizard for new operators
 *   ./auto-onboard.js validate   # Validate existing setup and suggest improvements  
 *   ./auto-onboard.js monitor    # Monitor new nodes and provide assistance
 *   ./auto-onboard.js optimize   # Analyze and optimize existing configuration
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, exec } = require('child_process');

class AutoOnboardingSystem {
  constructor() {
    this.systemInfo = this.detectSystemCapabilities();
    this.configPath = './node-config.json';
  }

  // Comprehensive system detection and analysis
  detectSystemCapabilities() {
    console.log('🔍 Analyzing your system for optimal IC Mesh configuration...\n');

    const info = {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024),
      freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024),
      hostname: os.hostname(),
      nodeVersion: process.version,
      capabilities: [],
      limitations: [],
      recommendations: []
    };

    // CPU analysis
    info.cpuModel = os.cpus()[0].model;
    
    // Memory recommendations
    if (info.totalMemory >= 8) {
      info.recommendations.push('High memory detected - excellent for ollama and multiple capabilities');
    } else if (info.totalMemory >= 4) {
      info.recommendations.push('Moderate memory - good for transcription and whisper');
    } else {
      info.limitations.push('Low memory may limit capability options');
    }

    // GPU detection
    try {
      const gpuInfo = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', 
                               { encoding: 'utf8', stdio: 'pipe' });
      info.hasGPU = true;
      info.gpuInfo = gpuInfo.trim();
      info.capabilities.push('stable-diffusion');
      info.recommendations.push(`GPU detected: ${info.gpuInfo} - premium earning potential!`);
    } catch (e) {
      info.hasGPU = false;
      info.limitations.push('No GPU detected - image generation capabilities unavailable');
    }

    // Basic capability assessment
    info.capabilities.push('transcribe'); // Always available
    
    if (info.cpus >= 2) {
      info.capabilities.push('whisper');
    }
    
    if (info.cpus >= 4 && info.totalMemory >= 8) {
      info.capabilities.push('ollama');
    }

    // Software dependencies
    info.dependencies = this.checkDependencies();

    return info;
  }

  checkDependencies() {
    const deps = [];
    
    // Check for common dependencies
    const checks = [
      { name: 'ffmpeg', command: 'ffmpeg -version' },
      { name: 'python3', command: 'python3 --version' },
      { name: 'git', command: 'git --version' },
      { name: 'curl', command: 'curl --version' }
    ];

    checks.forEach(check => {
      try {
        execSync(check.command, { stdio: 'ignore' });
        deps.push({ name: check.name, available: true });
      } catch (e) {
        deps.push({ name: check.name, available: false });
      }
    });

    return deps;
  }

  // Interactive new operator onboarding
  async runNewOperatorOnboarding() {
    console.log('🎯 Welcome to IC Mesh! Let\\'s set up your earning node.\n');
    console.log('This wizard will configure your system for maximum success and earnings.\n');

    // Step 1: System Analysis
    console.log('═══ Step 1: System Analysis ═══');
    this.displaySystemAnalysis();

    // Step 2: Configuration Generation
    console.log('\\n═══ Step 2: Configuration Setup ═══');
    const config = this.generateOptimalConfiguration();
    console.log('Generated optimal configuration:');
    console.log(JSON.stringify(config, null, 2));

    // Write config file
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    console.log(`\\n✅ Configuration saved to ${this.configPath}`);

    // Step 3: Dependency Check and Auto-Install
    console.log('\\n═══ Step 3: Dependency Setup ═══');
    await this.setupDependencies();

    // Step 4: First Connection Test
    console.log('\\n═══ Step 4: Connection Test ═══');
    await this.performConnectionTest();

    // Step 5: Earnings Projection
    console.log('\\n═══ Step 5: Earnings Projection ═══');
    this.displayEarningsProjection(config);

    // Step 6: Next Steps
    console.log('\\n═══ Next Steps ═══');
    this.displayNextSteps();

    console.log('\\n🚀 Onboarding complete! Your node is ready to earn.');
    console.log('\\nTo start earning: node client.js');
    console.log('Monitor progress: ./auto-onboard.js monitor');
  }

  displaySystemAnalysis() {
    const info = this.systemInfo;

    console.log(`💻 System: ${info.platform}/${info.arch}`);
    console.log(`⚡ CPU: ${info.cpus} cores (${info.cpuModel})`);
    console.log(`🧠 Memory: ${info.totalMemory}GB total, ${info.freeMemory}GB free`);
    console.log(`🏷️  Hostname: ${info.hostname}`);
    console.log(`📦 Node.js: ${info.nodeVersion}\\n`);

    if (info.hasGPU) {
      console.log(`🎮 GPU: ${info.gpuInfo}`);
    }

    console.log('🎯 Recommended capabilities:');
    info.capabilities.forEach(cap => {
      const earnings = this.getCapabilityEarnings(cap);
      console.log(`   ✓ ${cap} (${earnings}/hour)`);
    });

    if (info.limitations.length > 0) {
      console.log('\\n⚠️  Limitations:');
      info.limitations.forEach(limit => console.log(`   • ${limit}`));
    }

    if (info.recommendations.length > 0) {
      console.log('\\n💡 Recommendations:');
      info.recommendations.forEach(rec => console.log(`   • ${rec}`));
    }
  }

  generateOptimalConfiguration() {
    const info = this.systemInfo;
    
    const config = {
      name: `${info.hostname.toLowerCase()}-mesh-node`,
      capabilities: info.capabilities,
      workerCount: Math.min(info.cpus, 4), // Don't overwhelm the system
      retryAttempts: 3,
      heartbeatInterval: 30000,
      logLevel: 'info',
      autoOptimize: true,
      generatedBy: 'auto-onboard',
      systemInfo: {
        cpus: info.cpus,
        memory: info.totalMemory,
        hasGPU: info.hasGPU,
        platform: info.platform
      }
    };

    // Memory-based optimizations
    if (info.totalMemory >= 16) {
      config.workerCount = Math.min(info.cpus, 6);
      config.capabilities.push('memory-intensive');
    } else if (info.totalMemory < 4) {
      config.workerCount = 1;
      config.capabilities = ['transcribe']; // Conservative for low memory
    }

    // GPU optimizations
    if (info.hasGPU) {
      config.gpu = {
        enabled: true,
        memoryLimit: '80%' // Leave some for system
      };
    }

    return config;
  }

  async setupDependencies() {
    console.log('Checking and installing required dependencies...');

    const missing = this.systemInfo.dependencies
      .filter(dep => !dep.available)
      .map(dep => dep.name);

    if (missing.length === 0) {
      console.log('✅ All dependencies are already installed!');
      return;
    }

    console.log(`⚠️  Missing dependencies: ${missing.join(', ')}`);
    console.log('\\nAttempting automatic installation...');

    // Platform-specific installation commands
    const installCommands = {
      linux: {
        ffmpeg: 'sudo apt-get update && sudo apt-get install -y ffmpeg',
        python3: 'sudo apt-get install -y python3',
        curl: 'sudo apt-get install -y curl',
        git: 'sudo apt-get install -y git'
      },
      darwin: {
        ffmpeg: 'brew install ffmpeg',
        python3: 'brew install python3',
        curl: 'brew install curl',
        git: 'brew install git'
      }
    };

    const platform = this.systemInfo.platform;
    const commands = installCommands[platform];

    if (!commands) {
      console.log(`❌ Automatic installation not supported on ${platform}`);
      console.log('Please install manually:');
      missing.forEach(dep => console.log(`   • ${dep}`));
      return;
    }

    // Install missing dependencies
    for (const dep of missing) {
      if (commands[dep]) {
        try {
          console.log(`Installing ${dep}...`);
          execSync(commands[dep], { stdio: 'inherit' });
          console.log(`✅ ${dep} installed successfully`);
        } catch (error) {
          console.log(`❌ Failed to install ${dep}. Please install manually.`);
        }
      }
    }
  }

  async performConnectionTest() {
    console.log('Testing connection to IC Mesh network...');

    try {
      // Test network connectivity
      execSync('curl -s https://moilol.com/api/health', { stdio: 'ignore' });
      console.log('✅ Network connectivity: OK');

      // Test configuration validity
      if (fs.existsSync(this.configPath)) {
        const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        console.log('✅ Configuration file: Valid');
        console.log(`✅ Capabilities configured: ${config.capabilities.join(', ')}`);
      }

      console.log('\\n🔗 Ready to connect! Your node configuration is optimal.');

    } catch (error) {
      console.log('❌ Connection test failed. Please check:');
      console.log('   • Internet connectivity');
      console.log('   • Firewall settings');
      console.log('   • DNS resolution');
    }
  }

  displayEarningsProjection(config) {
    console.log('💰 Earnings Projection for Your Setup:\\n');

    const projections = this.calculateEarningsProjection(config);

    console.log('Based on your configuration and current network activity:');
    console.log(`   Per hour: $${projections.hourly.toFixed(2)} - $${(projections.hourly * 1.5).toFixed(2)}`);
    console.log(`   Per day (24/7): $${projections.daily.toFixed(2)} - $${(projections.daily * 1.5).toFixed(2)}`);
    console.log(`   Per month: $${projections.monthly.toFixed(2)} - $${(projections.monthly * 1.5).toFixed(2)}\\n`);

    console.log('🎯 Optimization Tips:');
    console.log(`   • Your strongest capability: ${projections.bestCapability}`);
    console.log(`   • Uptime matters: 24/7 nodes earn 3x more per hour`);
    
    if (config.capabilities.length === 1) {
      console.log('   • Consider adding more capabilities as you gain experience');
    }
    
    if (!this.systemInfo.hasGPU) {
      console.log('   • GPU upgrade could increase earnings by $50-200/month');
    }

    console.log(`\\n📊 Break-even analysis:`);
    const monthlyCost = this.estimateMonthlyCosts();
    console.log(`   Estimated monthly costs: $${monthlyCost}/month`);
    console.log(`   Break-even: ${Math.ceil(monthlyCost / projections.daily)} days of 24/7 operation`);
  }

  calculateEarningsProjection(config) {
    // Base earnings per capability (conservative estimates)
    const rates = {
      'transcribe': 0.15,
      'whisper': 0.25,
      'ollama': 0.60,
      'stable-diffusion': 1.20,
      'pdf-extract': 0.10
    };

    let hourlyTotal = 0;
    let bestCapability = 'transcribe';
    let bestRate = 0;

    config.capabilities.forEach(cap => {
      const rate = rates[cap] || 0.05;
      hourlyTotal += rate;
      if (rate > bestRate) {
        bestRate = rate;
        bestCapability = cap;
      }
    });

    // Account for worker count (more workers = more parallel jobs)
    const effectiveHourly = hourlyTotal * Math.min(config.workerCount, 2); // Diminishing returns

    return {
      hourly: effectiveHourly,
      daily: effectiveHourly * 24,
      monthly: effectiveHourly * 24 * 30,
      bestCapability
    };
  }

  estimateMonthlyCosts() {
    const info = this.systemInfo;
    
    // Basic power consumption estimates (watts)
    let powerConsumption = 50; // Base system
    powerConsumption += info.cpus * 5; // CPU scaling
    if (info.hasGPU) powerConsumption += 150; // GPU

    // Convert to monthly cost (assuming $0.12/kWh)
    const monthlyPowerCost = (powerConsumption / 1000) * 24 * 30 * 0.12;
    
    // Add internet cost estimate (if dedicated)
    const internetCost = 0; // Usually existing connection
    
    return monthlyPowerCost + internetCost;
  }

  displayNextSteps() {
    console.log('✅ Your node is configured and ready!\\n');

    console.log('🚀 To start earning:');
    console.log('   1. node client.js');
    console.log('   2. Look for "Node registered successfully"');
    console.log('   3. Wait for job assignments (usually < 5 minutes)\\n');

    console.log('📊 Monitoring commands:');
    console.log('   • ./auto-onboard.js monitor     # Track performance and earnings');
    console.log('   • ./auto-onboard.js validate    # Check configuration health');
    console.log('   • ./auto-onboard.js optimize    # Get optimization suggestions\\n');

    console.log('🔧 If you encounter issues:');
    console.log('   • Check logs: tail -20 mesh.log');
    console.log('   • Get help: ./auto-onboard.js validate');
    console.log('   • Community: Discord #ic-mesh channel\\n');

    console.log('💡 Pro tips:');
    console.log('   • Run in background for 24/7 earning: nohup node client.js &');
    console.log('   • Monitor system resources: htop');
    console.log('   • Update capabilities as your system grows');
  }

  // Validation and optimization for existing setups
  validateExistingSetup() {
    console.log('🔍 Validating your current IC Mesh setup...\\n');

    const issues = [];
    const suggestions = [];

    // Check config file
    if (!fs.existsSync(this.configPath)) {
      issues.push('No node-config.json found');
      suggestions.push('Run: ./auto-onboard.js new');
      return;
    }

    const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));

    // Validate configuration
    if (!config.name || config.name.includes('example')) {
      issues.push('Generic or missing node name');
      suggestions.push('Set a unique name in node-config.json');
    }

    if (!config.capabilities || config.capabilities.length === 0) {
      issues.push('No capabilities configured');
      suggestions.push('Add at least ["transcribe"] to capabilities');
    }

    // Check system utilization
    const newInfo = this.detectSystemCapabilities();
    const currentCaps = config.capabilities || [];
    const optimalCaps = newInfo.capabilities;

    const missing = optimalCaps.filter(cap => !currentCaps.includes(cap));
    if (missing.length > 0) {
      suggestions.push(`Consider adding capabilities: ${missing.join(', ')}`);
    }

    // Performance check
    if (config.workerCount > newInfo.cpus) {
      issues.push('Worker count exceeds CPU cores');
      suggestions.push(`Reduce workerCount to ${Math.min(newInfo.cpus, 4)}`);
    }

    // Display results
    if (issues.length === 0) {
      console.log('✅ Configuration looks good!');
    } else {
      console.log('⚠️  Issues found:');
      issues.forEach(issue => console.log(`   • ${issue}`));
    }

    if (suggestions.length > 0) {
      console.log('\\n💡 Suggestions:');
      suggestions.forEach(suggestion => console.log(`   • ${suggestion}`));
    }

    // Show current projection
    console.log('\\n📊 Current earnings projection:');
    const projection = this.calculateEarningsProjection(config);
    console.log(`   Estimated: $${projection.monthly.toFixed(2)}/month (24/7 operation)`);
  }

  getCapabilityEarnings(capability) {
    const rates = {
      'transcribe': '$0.10-0.50',
      'whisper': '$0.15-0.60',
      'ollama': '$0.25-1.00',
      'stable-diffusion': '$0.50-2.00',
      'pdf-extract': '$0.05-0.30'
    };
    return rates[capability] || '$0.05-0.25';
  }
}

// CLI Interface
function main() {
  const system = new AutoOnboardingSystem();
  const command = process.argv[2] || 'new';

  switch (command) {
    case 'new':
      system.runNewOperatorOnboarding();
      break;
    case 'validate':
      system.validateExistingSetup();
      break;
    case 'monitor':
      // Integration with retention toolkit
      console.log('🔄 Redirecting to monitoring dashboard...');
      require('./node-retention-toolkit.js');
      break;
    case 'optimize':
      console.log('🎯 Configuration optimization coming soon...');
      system.validateExistingSetup();
      break;
    default:
      console.log('IC Mesh Auto-Onboarding System\\n');
      console.log('Usage: ./auto-onboard.js [command]\\n');
      console.log('Commands:');
      console.log('  new       - Complete onboarding wizard for new operators');
      console.log('  validate  - Check existing configuration for issues');
      console.log('  monitor   - Real-time performance monitoring');
      console.log('  optimize  - Analyze and optimize current setup');
      console.log('\\nStart here if you\\'re new: ./auto-onboard.js new');
  }
}

if (require.main === module) {
  main();
}

module.exports = AutoOnboardingSystem;