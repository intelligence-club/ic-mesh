#!/usr/bin/env node
/**
 * IC Mesh User Experience Optimizer
 * 
 * Enhances the overall user experience by:
 * - Improving error messages with clear solutions
 * - Adding helpful guidance and tips
 * - Optimizing performance for common scenarios
 * - Creating better user feedback and monitoring
 * 
 * Usage:
 *   node scripts/user-experience-optimizer.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class UserExperienceOptimizer {
  constructor() {
    this.projectRoot = path.join(__dirname, '..');
    this.optimizations = [];
    this.issues = [];
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString().substring(11, 19);
    const colors = {
      info: '\x1b[36m',
      success: '\x1b[32m',
      warning: '\x1b[33m',
      error: '\x1b[31m',
      reset: '\x1b[0m'
    };
    
    console.log(`[${timestamp}] ${colors[type] || ''}${message}${colors.reset}`);
  }

  async optimizeErrorMessages() {
    this.log('Optimizing error messages for better user guidance...', 'info');

    const errorMappings = {
      'ECONNREFUSED': {
        userMessage: 'Cannot connect to IC Mesh server',
        solution: 'Check your internet connection and verify the server URL is correct',
        action: 'Retry in a few seconds, or check https://moilol.com:8333/status'
      },
      'ENOTFOUND': {
        userMessage: 'Server hostname not found',
        solution: 'Check your DNS settings and internet connectivity',
        action: 'Verify you can reach https://moilol.com in your browser'
      },
      'ETIMEDOUT': {
        userMessage: 'Connection timed out',
        solution: 'Server may be temporarily unavailable or your connection is slow',
        action: 'Wait a moment and try again, or check your firewall settings'
      },
      'EACCES': {
        userMessage: 'Permission denied',
        solution: 'The application lacks necessary permissions',
        action: 'Check file permissions or run with appropriate privileges'
      },
      'ENOENT': {
        userMessage: 'Required file or command not found',
        solution: 'A required dependency may not be installed',
        action: 'Verify all dependencies are installed: npm install'
      }
    };

    // Create enhanced error handler module
    const errorHandlerContent = `/**
 * Enhanced Error Handler for IC Mesh
 * Provides user-friendly error messages with clear solutions
 */

const errorMappings = ${JSON.stringify(errorMappings, null, 2)};

class EnhancedErrorHandler {
  static formatError(err) {
    const code = err.code || err.errno || 'UNKNOWN';
    const mapping = errorMappings[code];
    
    if (mapping) {
      return {
        type: 'user-friendly',
        title: mapping.userMessage,
        description: err.message,
        solution: mapping.solution,
        action: mapping.action,
        originalError: err
      };
    }
    
    return {
      type: 'technical',
      title: 'Unexpected Error',
      description: err.message,
      solution: 'This appears to be a technical issue. Please check the logs for details.',
      action: 'Try restarting the application or contact support if the issue persists',
      originalError: err
    };
  }

  static logError(err) {
    const formatted = this.formatError(err);
    
    console.error('\\n❌ \\x1b[31mError occurred\\x1b[0m');
    console.error(\`📋 Problem: \${formatted.title}\`);
    if (formatted.description !== formatted.title) {
      console.error(\`📝 Details: \${formatted.description}\`);
    }
    console.error(\`🔧 Solution: \${formatted.solution}\`);
    console.error(\`🎯 Next Step: \${formatted.action}\`);
    
    // Only show technical details if requested
    if (process.env.IC_DEBUG === 'true' || process.env.NODE_ENV === 'development') {
      console.error('\\n🔍 Technical Details:');
      console.error(formatted.originalError.stack || formatted.originalError);
    }
    
    console.error(''); // Empty line for readability
  }

  static wrapAsyncFunction(fn, context = 'operation') {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        console.error(\`\\n⚠️  Error during \${context}:\`);
        this.logError(err);
        throw err;
      }
    };
  }
}

module.exports = EnhancedErrorHandler;
`;

    fs.writeFileSync(path.join(this.projectRoot, 'lib', 'enhanced-error-handler.js'), errorHandlerContent);
    this.optimizations.push('Enhanced error handler created');
  }

  async createUserGuidanceSystem() {
    this.log('Creating user guidance system...', 'info');

    const guidanceContent = `/**
 * User Guidance System
 * Provides contextual tips and guidance for common scenarios
 */

class UserGuidance {
  static getOnboardingTips() {
    return [
      {
        icon: '💡',
        title: 'Maximize Earnings',
        message: 'Install Ollama with popular models (llama3.1, mistral) for highest earning potential'
      },
      {
        icon: '🔄',
        title: 'Stay Online',
        message: 'Keep your node running 24/7 to capture jobs and build reputation'
      },
      {
        icon: '📊',
        title: 'Monitor Performance',
        message: 'Check your earnings at https://moilol.com/account regularly'
      },
      {
        icon: '🚀',
        title: 'GPU Boost',
        message: 'GPU acceleration can double your earnings from AI inference jobs'
      },
      {
        icon: '🔧',
        title: 'Capability Expansion',
        message: 'Add Whisper (transcription) and FFmpeg (media) for more job opportunities'
      }
    ];
  }

  static getPerformanceTips() {
    const os = require('os');
    const totalRAM = Math.round(os.totalmem() / 1024 / 1024 / 1024);
    const cpuCount = os.cpus().length;
    
    const tips = [];
    
    if (totalRAM < 8) {
      tips.push({
        icon: '💾',
        priority: 'high',
        message: 'Consider upgrading RAM to 8GB+ for better performance with AI models'
      });
    }
    
    if (cpuCount < 4) {
      tips.push({
        icon: '⚡',
        priority: 'medium',
        message: 'Multi-core CPU recommended for concurrent job processing'
      });
    }
    
    tips.push({
      icon: '🌐',
      priority: 'high',
      message: 'Ensure stable internet connection (broadband recommended)'
    });
    
    tips.push({
      icon: '🔋',
      priority: 'medium',
      message: 'Use wired connection and prevent system sleep for reliability'
    });
    
    return tips;
  }

  static showWelcomeMessage(nodeConfig) {
    console.log('\\n🌟 Welcome to IC Mesh!');
    console.log('======================\\n');
    
    if (nodeConfig?.node?.name) {
      console.log(\`👋 Hello, \${nodeConfig.node.name}!\`);
      console.log(\`📧 Contact: \${nodeConfig.node.owner}\`);
      console.log('');
    }
    
    const tips = this.getOnboardingTips();
    console.log('💡 Quick Tips for Success:');
    tips.forEach((tip, index) => {
      console.log(\`   \${tip.icon} \${tip.title}: \${tip.message}\`);
    });
    console.log('');
  }

  static showPerformanceAnalysis() {
    const tips = this.getPerformanceTips();
    const highPriority = tips.filter(tip => tip.priority === 'high');
    
    if (highPriority.length > 0) {
      console.log('⚡ Performance Recommendations:');
      highPriority.forEach(tip => {
        console.log(\`   \${tip.icon} \${tip.message}\`);
      });
      console.log('');
    }
  }

  static showQuickStart() {
    console.log('🚀 Quick Start Checklist:');
    console.log('   □ Install dependencies: npm install');
    console.log('   □ Configure node: node scripts/operator-setup.js');
    console.log('   □ Start earning: node scripts/smart-start.js');
    console.log('   □ Monitor progress: https://moilol.com/account');
    console.log('');
  }

  static showTroubleshootingHelp() {
    console.log('🔧 Common Issues & Solutions:');
    console.log('   • Connection problems → Check internet and firewall');
    console.log('   • No jobs received → Verify capabilities are enabled');
    console.log('   • Low earnings → Install more capabilities (Ollama, Whisper)');
    console.log('   • Performance issues → Close other applications, check RAM');
    console.log('');
    console.log('📖 Full documentation: https://github.com/intelligence-club/ic-mesh');
    console.log('');
  }
}

module.exports = UserGuidance;
`;

    // Ensure lib directory exists
    const libDir = path.join(this.projectRoot, 'lib');
    if (!fs.existsSync(libDir)) {
      fs.mkdirSync(libDir, { recursive: true });
    }

    fs.writeFileSync(path.join(libDir, 'user-guidance.js'), guidanceContent);
    this.optimizations.push('User guidance system created');
  }

  async optimizeREADME() {
    this.log('Optimizing README for better user onboarding...', 'info');

    const readmePath = path.join(this.projectRoot, 'README.md');
    if (!fs.existsSync(readmePath)) {
      this.issues.push('README.md not found');
      return;
    }

    let readme = fs.readFileSync(readmePath, 'utf8');

    // Add quick start section at the top if not present
    const quickStartSection = `## 🚀 Quick Start (New Users)

**Want to start earning with your machine? Choose your path:**

### Option 1: Guided Setup (Recommended)
\`\`\`bash
git clone https://github.com/intelligence-club/ic-mesh.git
cd ic-mesh
node scripts/operator-setup.js
\`\`\`

### Option 2: Smart Start (Auto-validation)
\`\`\`bash
git clone https://github.com/intelligence-club/ic-mesh.git
cd ic-mesh
npm install
node scripts/smart-start.js
\`\`\`

### Option 3: Manual Setup
\`\`\`bash
git clone https://github.com/intelligence-club/ic-mesh.git
cd ic-mesh
# Follow detailed instructions in JOIN.md
\`\`\`

**✅ All methods include:**
- System capability detection
- Earning potential analysis
- Configuration validation
- Performance optimization

---
`;

    // Insert quick start after the main title if not already present
    if (!readme.includes('Quick Start (New Users)')) {
      const titleMatch = readme.match(/(# .+?\n.*?\n)/s);
      if (titleMatch) {
        readme = readme.replace(titleMatch[0], titleMatch[0] + '\n' + quickStartSection);
        this.optimizations.push('Added quick start section to README');
      }
    }

    // Add troubleshooting section if not present
    const troubleshootingSection = `## 🛠️ Troubleshooting

### Common Issues

**❌ "Connection refused" or "Cannot reach mesh server"**
- Check internet connectivity: \`curl https://google.com\`
- Verify mesh server: \`curl https://moilol.com:8333/status\`
- Check firewall settings (port 8333)

**❌ "No configuration found"**
- Run setup: \`node scripts/operator-setup.js\`
- Or copy: \`cp node-config.json.sample node-config.json\`

**❌ "No jobs received"**
- Verify capabilities: \`node scripts/onboarding-validator.js\`
- Check network status: https://moilol.com:8333
- Ensure handlers are enabled in your config

**💰 Low earnings?**
- Install high-value capabilities: Ollama, Whisper
- Keep node online 24/7
- Monitor job availability at https://moilol.com:8333

### Get Help
- 📖 Full guide: [JOIN.md](JOIN.md)
- 🔍 Validation: \`node scripts/onboarding-validator.js\`
- 📊 Status: https://moilol.com:8333
- 💬 Community: [Intelligence Club Discord](https://moilol.com)

`;

    if (!readme.includes('## 🛠️ Troubleshooting')) {
      readme += troubleshootingSection;
      this.optimizations.push('Added troubleshooting section to README');
    }

    // Save updated README
    fs.writeFileSync(readmePath, readme);
  }

  async createPerformanceOptimizations() {
    this.log('Creating performance optimization utilities...', 'info');

    const performanceOptimizerContent = `/**
 * Performance Optimizer for IC Mesh
 * Automatically optimizes system settings for better performance
 */

class PerformanceOptimizer {
  static optimizeNodeJS() {
    // Increase event listener limit
    require('events').EventEmitter.defaultMaxListeners = 20;
    
    // Optimize garbage collection
    if (!process.env.NODE_OPTIONS) {
      process.env.NODE_OPTIONS = '--max-old-space-size=2048 --optimize-for-size';
    }
    
    // Increase UV thread pool for better I/O
    if (!process.env.UV_THREADPOOL_SIZE) {
      process.env.UV_THREADPOOL_SIZE = '8';
    }
  }

  static detectOptimalSettings() {
    const os = require('os');
    const totalRAM = Math.round(os.totalmem() / 1024 / 1024); // MB
    const cpuCount = os.cpus().length;
    const platform = os.platform();
    
    const recommendations = {
      maxConcurrentJobs: Math.min(Math.floor(cpuCount / 2), 4),
      maxMemoryUsage: Math.floor(totalRAM * 0.7), // Use 70% of available RAM
      jobTimeout: platform === 'darwin' ? 600000 : 300000, // macOS gets longer timeout
      checkInterval: totalRAM > 8000 ? 30000 : 60000, // Faster polling with more RAM
      enableGPU: this.detectGPU()
    };

    console.log('\\n⚡ Performance Recommendations:');
    console.log(\`   Max concurrent jobs: \${recommendations.maxConcurrentJobs}\`);
    console.log(\`   Memory limit: \${Math.round(recommendations.maxMemoryUsage/1024)}GB\`);
    console.log(\`   GPU acceleration: \${recommendations.enableGPU ? 'Enabled' : 'Not available'}\`);
    
    return recommendations;
  }

  static detectGPU() {
    const { execSync } = require('child_process');
    
    try {
      // NVIDIA check
      execSync('nvidia-smi -q', { stdio: 'pipe' });
      return 'nvidia';
    } catch {}
    
    try {
      // Apple Silicon check
      const output = execSync('system_profiler SPDisplaysDataType', { encoding: 'utf8' });
      if (output.includes('Metal')) {
        return 'metal';
      }
    } catch {}
    
    return false;
  }

  static applyOptimizations(config) {
    const recommendations = this.detectOptimalSettings();
    
    // Apply to config if not already set
    if (!config.node) config.node = {};
    if (!config.performance) config.performance = {};
    
    config.node.maxConcurrentJobs = config.node.maxConcurrentJobs || recommendations.maxConcurrentJobs;
    config.performance.maxMemoryMB = config.performance.maxMemoryMB || recommendations.maxMemoryUsage;
    config.performance.jobTimeoutMs = config.performance.jobTimeoutMs || recommendations.jobTimeout;
    config.performance.checkIntervalMs = config.performance.checkIntervalMs || recommendations.checkInterval;
    
    if (recommendations.enableGPU && !config.capabilities) {
      config.capabilities = config.capabilities || [];
      const gpuCap = \`gpu-\${recommendations.enableGPU}\`;
      if (!config.capabilities.includes(gpuCap)) {
        config.capabilities.push(gpuCap);
      }
    }
    
    return config;
  }

  static monitorPerformance() {
    const monitoring = {
      startTime: Date.now(),
      jobsCompleted: 0,
      errorsEncountered: 0,
      avgProcessingTime: 0,
      memoryUsage: process.memoryUsage()
    };
    
    // Update every 5 minutes
    setInterval(() => {
      const currentMemory = process.memoryUsage();
      const uptime = Date.now() - monitoring.startTime;
      
      console.log(\`\\n📊 Performance Summary (\${Math.round(uptime/60000)}m uptime):\`);
      console.log(\`   Memory: \${Math.round(currentMemory.heapUsed/1024/1024)}MB used\`);
      console.log(\`   Jobs completed: \${monitoring.jobsCompleted}\`);
      if (monitoring.errorsEncountered > 0) {
        console.log(\`   Errors: \${monitoring.errorsEncountered}\`);
      }
      
    }, 300000); // 5 minutes
    
    return monitoring;
  }
}

module.exports = PerformanceOptimizer;
`;

    fs.writeFileSync(path.join(this.projectRoot, 'lib', 'performance-optimizer.js'), performanceOptimizerContent);
    this.optimizations.push('Performance optimizer created');
  }

  async createUserFeedbackSystem() {
    this.log('Creating user feedback and progress system...', 'info');

    const feedbackSystemContent = `/**
 * User Feedback System
 * Provides real-time feedback and progress updates to users
 */

class UserFeedback {
  constructor() {
    this.lastUpdateTime = Date.now();
    this.stats = {
      jobsCompleted: 0,
      totalEarnings: 0,
      uptime: Date.now(),
      connectionStatus: 'connecting'
    };
  }

  updateConnectionStatus(status) {
    if (this.stats.connectionStatus !== status) {
      const statusMessages = {
        connected: '🟢 Connected to IC Mesh network',
        connecting: '🟡 Connecting to IC Mesh...',
        disconnected: '🔴 Disconnected from network',
        error: '❌ Connection error - retrying...'
      };
      
      console.log(\`\\n\${statusMessages[status] || status}\`);
      this.stats.connectionStatus = status;
    }
  }

  reportJobProgress(jobType, progress, details = '') {
    const progressBar = this.createProgressBar(progress, 30);
    const percentage = Math.round(progress * 100);
    
    process.stdout.write(\`\\r🔄 Processing \${jobType}: \${progressBar} \${percentage}% \${details}\`);
    
    if (progress >= 1) {
      console.log(''); // New line when complete
    }
  }

  createProgressBar(progress, width = 20) {
    const filled = Math.round(progress * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  reportJobCompletion(jobId, jobType, earnings, duration) {
    this.stats.jobsCompleted++;
    this.stats.totalEarnings += earnings;
    
    const durationMs = Date.now() - duration;
    const durationStr = durationMs > 60000 ? 
      \`\${Math.round(durationMs/60000)}m\` : 
      \`\${Math.round(durationMs/1000)}s\`;
    
    console.log(\`\\n✅ Job completed: \${jobType}\`);
    console.log(\`   💰 Earned: \${earnings} ints\`);
    console.log(\`   ⏱️  Duration: \${durationStr}\`);
    console.log(\`   📊 Total: \${this.stats.jobsCompleted} jobs, \${this.stats.totalEarnings} ints\`);
  }

  reportError(error, context, suggestion) {
    console.log(\`\\n❌ \${context}: \${error}\`);
    if (suggestion) {
      console.log(\`💡 Try: \${suggestion}\`);
    }
  }

  showDailySummary() {
    const uptime = Date.now() - this.stats.uptime;
    const hours = Math.round(uptime / 3600000 * 10) / 10;
    const earningsPerHour = hours > 0 ? Math.round(this.stats.totalEarnings / hours * 100) / 100 : 0;
    
    console.log(\`\\n📈 Daily Summary:\`);
    console.log(\`   ⏰ Uptime: \${hours}h\`);
    console.log(\`   ✅ Jobs: \${this.stats.jobsCompleted}\`);
    console.log(\`   💰 Earnings: \${this.stats.totalEarnings} ints (\${earningsPerHour}/h)\`);
    console.log(\`   💵 USD equivalent: $\${(this.stats.totalEarnings/100).toFixed(2)}\`);
    
    // Provide encouragement and tips
    if (this.stats.jobsCompleted === 0) {
      console.log(\`\\n💡 No jobs yet? Check your capabilities and network status.\`);
    } else if (earningsPerHour < 1) {
      console.log(\`\\n🚀 Tip: Add more capabilities (Ollama, Whisper) to increase earnings.\`);
    } else {
      console.log(\`\\n🎉 Great work! Keep your node online for consistent earnings.\`);
    }
  }

  startPeriodicUpdates() {
    // Show summary every hour
    setInterval(() => {
      this.showDailySummary();
    }, 3600000);
    
    // Show mini-update every 15 minutes if active
    setInterval(() => {
      if (this.stats.connectionStatus === 'connected') {
        const uptime = Math.round((Date.now() - this.stats.uptime) / 60000);
        console.log(\`\\n💫 \${uptime}m online | \${this.stats.jobsCompleted} jobs | \${this.stats.totalEarnings} ints earned\`);
      }
    }, 900000);
  }

  static createStartupMessage() {
    console.log('\\n🌟 IC Mesh Node Starting...');
    console.log('==============================');
    console.log('💡 Tips:');
    console.log('   • Keep this window open to monitor progress');
    console.log('   • Check earnings at https://moilol.com/account');
    console.log('   • Press Ctrl+C to stop');
    console.log('');
  }
}

module.exports = UserFeedback;
`;

    fs.writeFileSync(path.join(this.projectRoot, 'lib', 'user-feedback.js'), feedbackSystemContent);
    this.optimizations.push('User feedback system created');
  }

  async updatePackageScripts() {
    this.log('Adding convenience scripts to package.json...', 'info');

    const packagePath = path.join(this.projectRoot, 'package.json');
    if (!fs.existsSync(packagePath)) {
      this.issues.push('package.json not found');
      return;
    }

    try {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

      // Add convenience scripts
      if (!packageJson.scripts) packageJson.scripts = {};

      const newScripts = {
        'start': 'node scripts/smart-start.js',
        'setup': 'node scripts/operator-setup.js',
        'validate': 'node scripts/onboarding-validator.js',
        'optimize': 'node scripts/user-experience-optimizer.js',
        'client': 'node client.js'
      };

      let scriptsAdded = 0;
      Object.entries(newScripts).forEach(([script, command]) => {
        if (!packageJson.scripts[script]) {
          packageJson.scripts[script] = command;
          scriptsAdded++;
        }
      });

      if (scriptsAdded > 0) {
        fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
        this.optimizations.push(`Added ${scriptsAdded} convenience scripts to package.json`);
      }

    } catch (err) {
      this.issues.push(`Failed to update package.json: ${err.message}`);
    }
  }

  async run() {
    console.log('🎨 IC Mesh User Experience Optimizer');
    console.log('=====================================\n');

    try {
      await this.optimizeErrorMessages();
      await this.createUserGuidanceSystem();
      await this.optimizeREADME();
      await this.createPerformanceOptimizations();
      await this.createUserFeedbackSystem();
      await this.updatePackageScripts();

      // Show summary
      console.log('\n✅ User Experience Optimization Complete!');
      console.log(`🔧 ${this.optimizations.length} optimizations applied:`);
      this.optimizations.forEach(opt => console.log(`   • ${opt}`));

      if (this.issues.length > 0) {
        console.log(`\n⚠️  ${this.issues.length} issues found:`);
        this.issues.forEach(issue => console.log(`   • ${issue}`));
      }

      console.log('\n🚀 New Features Available:');
      console.log('   • Enhanced error messages with clear solutions');
      console.log('   • User guidance and tips system');
      console.log('   • Performance optimization utilities');
      console.log('   • Real-time feedback and progress tracking');
      console.log('   • Convenience npm scripts (npm run start, npm run setup, etc.)');

      console.log('\n💡 Next Steps:');
      console.log('   • Test the new smart start: npm run start');
      console.log('   • Validate your setup: npm run validate');
      console.log('   • Review updated README.md for new guidance');

    } catch (err) {
      console.error(`❌ Optimization failed: ${err.message}`);
      return 1;
    }

    return 0;
  }
}

// Main execution
if (require.main === module) {
  const optimizer = new UserExperienceOptimizer();
  
  optimizer.run().then(exitCode => {
    process.exit(exitCode);
  }).catch(err => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = UserExperienceOptimizer;