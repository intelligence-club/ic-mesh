#!/usr/bin/env node
/**
 * Specialized Onboarding Script for OpenClaw Users
 * 
 * Streamlined setup focused on the OpenClaw → IC Mesh conversion.
 * Assumes user already has Node.js, likely has Ollama, wants quick setup.
 * 
 * Usage:
 *   node openclaw-user-onboarding.js
 * 
 * Design:
 *   - Skip basic checks (they have OpenClaw, they have Node.js)  
 *   - Focus on value proposition (offset API costs)
 *   - Quick capability detection
 *   - One-click setup with smart defaults
 *   - Immediate earning potential calculation
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Enhanced colors with emoji support
const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`, 
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  dim: (text) => `\x1b[2m${text}\x1b[0m`
};

function log(message, color = null) {
  console.log(color ? color(message) : message);
}

function success(message) {
  log(`✅ ${message}`, colors.green);
}

function info(message) {
  log(`💡 ${message}`, colors.cyan);
}

function warn(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

function ask(question, defaultValue = '') {
  const prompt = defaultValue ? `${question} (${colors.dim(defaultValue)})` : question;
  return new Promise(resolve => {
    rl.question(`${colors.blue('?')} ${prompt}: `, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

function runQuiet(command) {
  try {
    const output = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
    return { success: true, output: output.trim() };
  } catch (err) {
    return { success: false };
  }
}

function detectOpenClawCapabilities() {
  console.log(colors.bold('🔍 Analyzing Your OpenClaw Setup\n'));
  
  const capabilities = {
    openclaw: false,
    ollama: { detected: false, models: 0, popular: [] },
    whisper: false, 
    ffmpeg: false,
    gpu: false,
    node_version: null
  };
  
  // OpenClaw detection
  const openclawCheck = runQuiet('which openclaw');
  if (openclawCheck.success) {
    capabilities.openclaw = true;
    success('OpenClaw installation detected ✓');
  } else {
    info('OpenClaw not in PATH (that\'s okay - you might have it elsewhere)');
  }
  
  // Node.js version (they definitely have it)
  const nodeCheck = runQuiet('node --version');
  if (nodeCheck.success) {
    capabilities.node_version = nodeCheck.output.replace('v', '');
    success(`Node.js ${capabilities.node_version} ✓`);
  }
  
  // Ollama detection with model analysis
  const ollamaCheck = runQuiet('curl -s http://localhost:11434/api/tags');
  if (ollamaCheck.success) {
    try {
      const data = JSON.parse(ollamaCheck.output);
      if (data.models && data.models.length > 0) {
        capabilities.ollama.detected = true;
        capabilities.ollama.models = data.models.length;
        
        // Identify popular/high-earning models
        const popularModels = ['llama', 'mistral', 'codellama', 'vicuna'];
        capabilities.ollama.popular = data.models
          .map(m => m.name)
          .filter(name => popularModels.some(p => name.toLowerCase().includes(p)));
          
        success(`Ollama running with ${capabilities.ollama.models} models ✓`);
        if (capabilities.ollama.popular.length > 0) {
          info(`  Popular models detected: ${capabilities.ollama.popular.join(', ')}`);
        }
      }
    } catch (e) {
      warn('Ollama running but no models detected');
    }
  } else {
    info('Ollama not running - install at https://ollama.com for $5-15/day earning potential');
  }
  
  // Whisper (highest demand capability)
  const whisperCheck = runQuiet('which whisper');
  const pythonWhisperCheck = runQuiet('python3 -c "import whisper"');
  
  if (whisperCheck.success || pythonWhisperCheck.success) {
    capabilities.whisper = true;
    success('Whisper transcription available ✓ (HIGH EARNING POTENTIAL)');
  } else {
    info('Whisper not found - transcription jobs earn $5-15/day');
  }
  
  // FFmpeg 
  const ffmpegCheck = runQuiet('which ffmpeg');
  if (ffmpegCheck.success) {
    capabilities.ffmpeg = true;
    success('FFmpeg media processing available ✓');
  } else {
    info('FFmpeg not found - install for media processing jobs');
  }
  
  // GPU detection (Apple Silicon is common for OpenClaw users)
  const metalCheck = runQuiet('system_profiler SPDisplaysDataType | grep -i metal');
  if (metalCheck.success) {
    capabilities.gpu = 'metal';
    success('Apple Silicon GPU detected ✓ (Excellent for AI workloads)');
  }
  
  return capabilities;
}

function calculateOpenClawROI(capabilities) {
  console.log(colors.bold('\n💰 Your OpenClaw Cost Offset Analysis\n'));
  
  // Estimate typical OpenClaw user API costs
  const estimatedMonthlyCosts = {
    claude: 25,      // Claude API usage
    gpt4: 15,        // GPT-4 calls
    transcription: 8, // Whisper API
    other: 7         // Misc APIs
  };
  
  const totalMonthlyCosts = Object.values(estimatedMonthlyCosts).reduce((a, b) => a + b, 0);
  
  // Calculate mesh earning potential
  let dailyEarnings = 2; // Base CPU earning
  
  if (capabilities.ollama.detected) {
    dailyEarnings += capabilities.ollama.models * 2; // $2-4 per model
  }
  
  if (capabilities.whisper) {
    dailyEarnings += 12; // High-demand transcription
  }
  
  if (capabilities.ffmpeg) {
    dailyEarnings += 2; // Media processing
  }
  
  if (capabilities.gpu === 'metal') {
    dailyEarnings = Math.round(dailyEarnings * 1.5); // GPU boost
  }
  
  const monthlyEarnings = dailyEarnings * 30;
  const netSavings = monthlyEarnings - totalMonthlyCosts;
  const offsetPercentage = Math.round((monthlyEarnings / totalMonthlyCosts) * 100);
  
  console.log('📊 Cost Analysis:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log(`💳 Estimated OpenClaw API costs: $${totalMonthlyCosts}/month`);
  console.log(`   Claude API: $${estimatedMonthlyCosts.claude}`);
  console.log(`   GPT-4 API: $${estimatedMonthlyCosts.gpt4}`);
  console.log(`   Transcription: $${estimatedMonthlyCosts.transcription}`);
  console.log(`   Other APIs: $${estimatedMonthlyCosts.other}`);
  console.log();
  
  console.log(`💰 Your IC Mesh earning potential: $${monthlyEarnings}/month`);
  console.log(`   Daily rate: $${dailyEarnings}`);
  console.log(`   Based on: ${getCapabilitySummary(capabilities)}`);
  console.log();
  
  if (netSavings > 0) {
    success(`🎉 Net monthly profit: $${netSavings}`);
    success(`   IC Mesh covers ${offsetPercentage}% of your OpenClaw costs!`);
    if (offsetPercentage >= 100) {
      success(`   🚀 FULL COST COVERAGE + ${offsetPercentage - 100}% profit!`);
    }
  } else {
    info(`📊 Cost coverage: ${offsetPercentage}% of your OpenClaw costs`);
    const additionalEarnings = Math.abs(netSavings);
    info(`   Add Whisper for +$12/day to achieve full coverage`);
  }
  
  // Founding operator bonus calculation
  const foundingBonus = monthlyEarnings * 2; // 2x multiplier
  console.log(colors.bold('\n⚡ Founding Operator Bonus (Limited Time):'));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`🔥 2x earning rate = $${foundingBonus}/month`);
  console.log(`🎯 Net profit with bonus: $${foundingBonus - totalMonthlyCosts}`);
  console.log(`⏰ Only 44 spots remaining (6/50 taken)`);
  
  return {
    monthlyCosts: totalMonthlyCosts,
    monthlyEarnings,
    netSavings,
    foundingBonus
  };
}

function getCapabilitySummary(capabilities) {
  const parts = [];
  if (capabilities.ollama.detected) parts.push(`${capabilities.ollama.models} Ollama models`);
  if (capabilities.whisper) parts.push('Whisper transcription');
  if (capabilities.ffmpeg) parts.push('FFmpeg');
  if (capabilities.gpu) parts.push('GPU acceleration');
  
  return parts.length > 0 ? parts.join(' + ') : 'CPU processing';
}

function createOptimizedConfig(capabilities) {
  console.log(colors.bold('\n⚙️  Creating Optimized Configuration\n'));
  
  // Smart defaults for OpenClaw users
  const defaultNodeName = `openclaw-${require('os').hostname()}-${crypto.randomBytes(2).toString('hex')}`;
  
  const config = {
    server: {
      url: 'https://moilol.com:8333'
    },
    node: {
      name: defaultNodeName,
      owner: '', // Will ask
      region: 'US', // Default
      maxConcurrentJobs: capabilities.gpu ? 3 : 2,
      maxCpuUsage: 75 // Conservative for always-on machines
    },
    handlers: {
      transcribe: {
        enabled: capabilities.whisper,
        priority: 'high'
      },
      inference: {
        enabled: capabilities.ollama.detected,
        priority: 'high'
      },
      ffmpeg: {
        enabled: capabilities.ffmpeg,
        priority: 'medium'
      }
    },
    optimization: {
      founding_operator: true,
      auto_restart: true,
      smart_scheduling: true
    }
  };
  
  info('Generated OpenClaw-optimized configuration');
  success(`Node name: ${defaultNodeName}`);
  success(`Max concurrent jobs: ${config.node.maxConcurrentJobs} (safe for 24/7)`);
  
  return config;
}

async function quickSetup() {
  console.log(colors.bold('\n🚀 Quick Setup for OpenClaw Users\n'));
  
  // Just the essentials
  const email = await ask('Your email (for payments)', '');
  if (!email) {
    warn('Email required for payment setup');
    return false;
  }
  
  const region = await ask('Your region', 'US');
  
  info('Using smart defaults for OpenClaw users...');
  
  // Create config file
  const capabilities = global.detectedCapabilities;
  const config = createOptimizedConfig(capabilities);
  config.node.owner = email;
  config.node.region = region;
  
  try {
    fs.writeFileSync('node-config.json', JSON.stringify(config, null, 2));
    success('Configuration saved');
    return true;
  } catch (err) {
    warn(`Config save failed: ${err.message}`);
    return false;
  }
}

async function startEarning() {
  console.log(colors.bold('\n💰 Start Earning Now\n'));
  
  info('Your IC Mesh node is ready to start generating revenue!');
  console.log();
  
  console.log('What happens next:');
  console.log('1. 🔗 Your node connects to the mesh network');
  console.log('2. 🎯 Jobs matching your capabilities get automatically assigned');  
  console.log('3. 💻 Your machine processes them during idle time');
  console.log('4. 💰 Earnings accumulate in your account');
  console.log('5. 💳 Cash out via Stripe when ready ($25 minimum)');
  console.log();
  
  const startNow = await ask('Start your node now?', 'y');
  
  if (startNow.toLowerCase() === 'y') {
    console.log(colors.bold('\\n⚡ Starting Your IC Mesh Node\\n'));
    console.log(colors.yellow('Press Ctrl+C to stop the node when needed\\n'));
    
    // Quick dependency check
    if (!fs.existsSync('node_modules')) {
      info('Installing dependencies (one-time setup)...');
      try {
        execSync('npm install', { stdio: 'inherit' });
        success('Dependencies installed');
      } catch (err) {
        warn('Dependency install failed - proceeding anyway');
      }
    }
    
    // Start the node client
    const client = spawn('node', ['client.js'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        IC_NODE_OWNER: global.detectedCapabilities.email || 'openclaw-user'
      }
    });
    
    process.on('SIGINT', () => {
      console.log('\\n');
      info('Stopping your node...');
      client.kill();
      success('Node stopped. You can restart anytime with: node client.js');
      console.log('');
      console.log(colors.bold('📚 Next Steps:'));
      console.log('• 💰 Check earnings: https://moilol.com/account');
      console.log('• 📊 Network status: https://moilol.com:8333');
      console.log('• 💳 Payment setup: Complete Stripe Connect for payouts');
      console.log('• 🚀 Founding operator: Secure your 2x rate (44 spots left)');
      process.exit(0);
    });
    
  } else {
    console.log(colors.bold('\\n📋 Manual Start Instructions:\\n'));
    console.log('When ready to start earning:');
    console.log('  node client.js');
    console.log('');
    console.log('Your node will:');
    console.log('• Auto-detect and use available capabilities');
    console.log('• Process jobs during machine idle time');
    console.log('• Respect CPU limits to not interfere with OpenClaw');
    console.log('• Accumulate earnings you can cash out via Stripe');
  }
}

async function main() {
  // Welcome banner
  console.log(colors.bold('\\n🤝 IC Mesh × OpenClaw: Turn Your Agent Into Profit\\n'));
  console.log('Your OpenClaw machine already runs 24/7. Let\'s make it pay for itself.\\n');
  
  try {
    // Capability detection
    const capabilities = detectOpenClawCapabilities();
    global.detectedCapabilities = capabilities;
    
    // ROI analysis
    const roiAnalysis = calculateOpenClawROI(capabilities);
    
    if (roiAnalysis.netSavings <= 0 && !capabilities.whisper && !capabilities.ollama.detected) {
      console.log(colors.bold('\\n💡 Optimization Recommendation:\\n'));
      warn('Limited earning potential with current setup');
      console.log('Consider installing:');
      console.log('• Ollama (https://ollama.com) - $5-15/day potential');
      console.log('• Whisper (`pip install openai-whisper`) - $10-20/day');
      console.log('');
      
      const continueAnyway = await ask('Continue with current setup?', 'y');
      if (continueAnyway.toLowerCase() !== 'y') {
        info('Setup paused. Install additional capabilities and run again for higher earnings!');
        process.exit(0);
      }
    }
    
    // Quick setup
    const proceed = await ask('\\nReady to start earning?', 'y');
    if (proceed.toLowerCase() !== 'y') {
      info('Setup cancelled. Run this script again when ready!');
      process.exit(0);  
    }
    
    if (!(await quickSetup())) {
      warn('Setup failed');
      process.exit(1);
    }
    
    // Start earning
    await startEarning();
    
  } catch (err) {
    warn(`Setup error: ${err.message}`);
    process.exit(1);
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main();
}