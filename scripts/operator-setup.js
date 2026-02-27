#!/usr/bin/env node
/**
 * IC Mesh Operator Setup Script
 * 
 * Quick setup for new operators joining the mesh network.
 * Designed for production use (not development).
 * 
 * Usage:
 *   node scripts/operator-setup.js
 *   
 * What it does:
 *   1. Checks system requirements
 *   2. Detects available capabilities (Ollama, Whisper, FFmpeg)
 *   3. Creates optimal configuration
 *   4. Sets up credentials
 *   5. Starts the node
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

// Configuration paths
const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(PROJECT_ROOT, 'node-config.json');
const EXAMPLE_CONFIG = path.join(PROJECT_ROOT, 'node-config.example.json');

// Color output functions
const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`
};

function log(message, color = null) {
  const output = color ? color(message) : message;
  console.log(output);
}

function success(message) {
  log(`✅ ${message}`, colors.green);
}

function error(message) {
  log(`❌ ${message}`, colors.red);
}

function warn(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

function info(message) {
  log(`ℹ️  ${message}`, colors.cyan);
}

function ask(question, defaultValue = '') {
  const prompt = defaultValue ? `${question} [${defaultValue}]` : question;
  return new Promise(resolve => {
    rl.question(`${colors.blue('?')} ${prompt}: `, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

function runCommand(command, options = {}) {
  try {
    const output = execSync(command, { 
      encoding: 'utf8', 
      stdio: 'pipe',
      ...options
    });
    return { success: true, output: output?.toString().trim() };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function detectCapabilities() {
  console.log(colors.bold('\n🔍 Detecting Your System Capabilities\n'));
  
  const capabilities = {
    node: false,
    ollama: false,
    whisper: false,
    ffmpeg: false,
    gpu: false
  };
  
  const earnings = {
    transcription: 0,
    inference: 0,
    media: 0
  };
  
  // Node.js check (required)
  const nodeCheck = runCommand('node --version');
  if (nodeCheck.success) {
    const version = nodeCheck.output.replace('v', '');
    if (parseFloat(version) >= 18) {
      success(`Node.js ${version} ✓`);
      capabilities.node = true;
    } else {
      error(`Node.js ${version} - Need 18.0 or higher`);
    }
  } else {
    error('Node.js not found - Please install Node.js 18+');
    return null;
  }
  
  // Ollama check (high value)
  const ollamaCheck = runCommand('curl -s http://localhost:11434/api/tags');
  if (ollamaCheck.success) {
    try {
      const models = JSON.parse(ollamaCheck.output);
      if (models.models && models.models.length > 0) {
        success(`Ollama with ${models.models.length} models ✓`);
        capabilities.ollama = true;
        earnings.inference = models.models.length * 2; // ~$2-4/day per model
        info(`  📈 Estimated earnings: $${earnings.inference}-${earnings.inference * 2}/day`);
      }
    } catch (e) {
      warn('Ollama responding but no models detected');
    }
  } else {
    warn('Ollama not found - Install at https://ollama.com for LLM inference jobs');
    info('  💡 Ollama can earn $2-8/day with popular models');
  }
  
  // Whisper check (very high demand)
  const whisperCheck = runCommand('which whisper');
  const pythonWhisperCheck = runCommand('python3 -c "import whisper"');
  
  if (whisperCheck.success || pythonWhisperCheck.success) {
    success('Whisper transcription available ✓');
    capabilities.whisper = true;
    earnings.transcription = 5; // High demand
    info('  📈 Estimated earnings: $5-15/day (high demand!)');
  } else {
    warn('Whisper not found - Install with: pip install openai-whisper');
    info('  💰 Transcription is highest-earning capability');
  }
  
  // FFmpeg check
  const ffmpegCheck = runCommand('which ffmpeg');
  if (ffmpegCheck.success) {
    success('FFmpeg media processing ✓');
    capabilities.ffmpeg = true;
    earnings.media = 1;
    info('  📈 Estimated earnings: $1-3/day');
  } else {
    warn('FFmpeg not found - Install for media processing jobs');
  }
  
  // GPU detection
  const nvidiaCheck = runCommand('nvidia-smi -q', { stdio: 'pipe' });
  const metalCheck = runCommand('system_profiler SPDisplaysDataType | grep -i metal', { stdio: 'pipe' });
  
  if (nvidiaCheck.success) {
    success('NVIDIA GPU detected ✓');
    capabilities.gpu = 'nvidia';
    info('  🚀 GPU acceleration will boost all earnings by 50-100%');
  } else if (metalCheck.success) {
    success('Apple Silicon GPU detected ✓');
    capabilities.gpu = 'metal';
    info('  🚀 Metal acceleration will boost inference earnings');
  } else {
    info('No dedicated GPU detected - CPU processing still valuable');
  }
  
  // Calculate total earning potential
  const totalDaily = earnings.transcription + earnings.inference + earnings.media;
  const monthlyEstimate = totalDaily * 30;
  
  console.log(colors.bold('\\n💰 Earning Potential Summary'));
  if (totalDaily > 0) {
    success(`Daily estimate: $${totalDaily}-${totalDaily * 2}`);
    success(`Monthly estimate: $${monthlyEstimate}-${monthlyEstimate * 2}`);
    if (capabilities.gpu) {
      info('(GPU acceleration could increase this by 50-100%)');
    }
  } else {
    warn('Limited earning potential - consider installing Ollama or Whisper');
  }
  
  return capabilities;
}

async function createOperatorConfig(capabilities) {
  console.log(colors.bold('\\n⚙️  Creating Your Operator Configuration\\n'));
  
  // Load base configuration
  if (!fs.existsSync(EXAMPLE_CONFIG)) {
    error('Example configuration not found');
    return false;
  }
  
  const config = JSON.parse(fs.readFileSync(EXAMPLE_CONFIG, 'utf8'));
  
  // Basic operator info
  console.log('Let\'s set up your operator identity:');
  
  const defaultName = `${require('os').hostname()}-${crypto.randomBytes(3).toString('hex')}`;
  const nodeName = await ask('Your node name (visible to job requesters)', defaultName);
  const ownerEmail = await ask('Your email address (for payments and notifications)');
  const region = await ask('Your region/country (helps with job routing)', 'US');
  
  // Update basic config
  config.node.name = nodeName;
  config.node.owner = ownerEmail;
  config.node.region = region;
  config.server.url = 'https://moilol.com:8333';
  
  // Configure capabilities based on detection
  info('Configuring handlers based on your system...');
  
  config.handlers.transcribe.enabled = capabilities.whisper;
  if (capabilities.whisper) {
    success('✅ Transcription handler enabled');
  }
  
  config.handlers.inference.enabled = capabilities.ollama;
  if (capabilities.ollama) {
    success('✅ LLM inference handler enabled');
  }
  
  config.handlers.ffmpeg.enabled = capabilities.ffmpeg;
  if (capabilities.ffmpeg) {
    success('✅ Media processing handler enabled');
  }
  
  // Resource limits
  console.log('\\nResource limits (prevents overloading your machine):');
  const maxConcurrent = await ask('Maximum concurrent jobs', '2');
  const maxCpuUsage = await ask('Maximum CPU usage %', '80');
  
  config.node.maxConcurrentJobs = parseInt(maxConcurrent);
  config.node.maxCpuUsage = parseInt(maxCpuUsage);
  
  // Save configuration
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    success(`Configuration saved to node-config.json`);
    return true;
  } catch (err) {
    error(`Failed to save configuration: ${err.message}`);
    return false;
  }
}

async function setupStripeConnect() {
  console.log(colors.bold('\n💳 Setting Up Payments (Stripe Connect)\n'));
  
  info('To receive payments, you\'ll need to set up Stripe Connect.');
  info('This is free and takes ~2 minutes.');
  
  const setupNow = await ask('Set up payments now? (y/n)', 'y');
  
  if (setupNow.toLowerCase() === 'y') {
    console.log('\\n📖 Payment Setup Instructions:');
    console.log('1. 🌐 Visit: https://moilol.com/account');
    console.log('2. 📧 Enter the email you provided:', colors.yellow(process.env.IC_NODE_OWNER || 'your-email'));
    console.log('3. ✅ Complete the Stripe Connect onboarding');
    console.log('4. 💰 Start receiving payments!');
    
    const proceed = await ask('\nPress Enter when you\'ve completed Stripe setup (or skip)');
    
    if (proceed.toLowerCase() !== 'skip') {
      success('Payment setup completed! You\'ll receive earnings via Stripe.');
    }
  } else {
    warn('Skipping payment setup - you can do this later at https://moilol.com/account');
  }
}

function testConnection() {
  console.log(colors.bold('\\n🔗 Testing Connection to IC Mesh\\n'));
  
  info('Testing connection to mesh network...');
  
  const testResult = runCommand('curl -s https://moilol.com:8333/status');
  if (testResult.success) {
    try {
      const status = JSON.parse(testResult.output);
      success('Connected to IC Mesh network ✓');
      info(`Network status: ${status.nodes || 'N/A'} nodes online`);
      return true;
    } catch (e) {
      error('Network responded but data format unexpected');
      return false;
    }
  } else {
    error('Cannot connect to IC Mesh network');
    error('Check your internet connection and try again');
    return false;
  }
}

async function startNode() {
  console.log(colors.bold('\\n🚀 Starting Your IC Mesh Node\\n'));
  
  info('Starting your node...');
  console.log(colors.yellow('Press Ctrl+C to stop the node\\n'));
  
  // Install dependencies if needed
  if (!fs.existsSync(path.join(PROJECT_ROOT, 'node_modules'))) {
    info('Installing dependencies...');
    const installResult = runCommand('npm install', { cwd: PROJECT_ROOT });
    if (!installResult.success) {
      error('Failed to install dependencies');
      return false;
    }
    success('Dependencies installed');
  }
  
  // Start the client
  const client = spawn('node', ['client.js'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      IC_NODE_OWNER: process.env.IC_NODE_OWNER || 'setup-user'
    }
  });
  
  process.on('SIGINT', () => {
    console.log('\\n');
    info('Stopping your node...');
    client.kill();
    success('Node stopped. Thanks for being part of the IC Mesh!');
    process.exit(0);
  });
  
  client.on('close', (code) => {
    if (code === 0) {
      success('Node stopped gracefully');
    } else {
      error(`Node exited with error code ${code}`);
    }
  });
  
  return true;
}

async function main() {
  console.log(colors.bold('\\n🌐 Welcome to IC Mesh Operator Setup\\n'));
  console.log('This will help you join the mesh network and start earning.');
  console.log('Setup takes about 3-5 minutes.\\n');
  
  try {
    // Step 1: Detect capabilities and earning potential
    const capabilities = detectCapabilities();
    if (!capabilities || !capabilities.node) {
      error('\\nSetup failed: Node.js 18+ is required');
      process.exit(1);
    }
    
    if (capabilities.ollama || capabilities.whisper || capabilities.ffmpeg) {
      success('\\n🎉 Great! Your system has valuable earning capabilities.');
    } else {
      warn('\\n💡 Your system can run basic jobs. Consider installing Ollama or Whisper for higher earnings.');
    }
    
    const proceed = await ask('\\nContinue with setup?', 'y');
    if (proceed.toLowerCase() !== 'y') {
      info('Setup cancelled. Run this script again anytime!');
      process.exit(0);
    }
    
    // Step 2: Create configuration
    if (!(await createOperatorConfig(capabilities))) {
      error('\\nSetup failed: Could not create configuration');
      process.exit(1);
    }
    
    // Step 3: Test network connection
    if (!testConnection()) {
      error('\\nSetup failed: Cannot connect to IC Mesh network');
      process.exit(1);
    }
    
    // Step 4: Payment setup (optional)
    await setupStripeConnect();
    
    // Step 5: Start the node
    console.log(colors.bold('\\n🎯 Setup Complete!\\n'));
    success('Your IC Mesh node is ready to start earning.');
    
    const startNow = await ask('Start your node now?', 'y');
    if (startNow.toLowerCase() === 'y') {
      await startNode();
    } else {
      console.log(colors.bold('\\n📋 Next Steps:\\n'));
      console.log('• Start your node: node client.js');
      console.log('• Monitor earnings: https://moilol.com/account');
      console.log('• View network: https://moilol.com:8333');
      console.log('• Get help: https://github.com/intelligence-club/ic-mesh/blob/main/TROUBLESHOOTING.md');
      console.log('');
      success('Welcome to the IC Mesh network! 🚀');
    }
    
  } catch (err) {
    error(`Setup failed: ${err.message}`);
    process.exit(1);
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main();
}