#!/usr/bin/env node
/**
 * IC Mesh Development Setup Script
 * 
 * Automates local development environment setup:
 * - Environment validation
 * - Configuration file creation
 * - Dependency checks
 * - Database initialization
 * - Test execution
 * - Local server startup
 * 
 * Usage:
 *   node scripts/dev-setup.js [command]
 *   
 * Commands:
 *   check     - Check system requirements
 *   init      - Initialize development environment
 *   test      - Run test suite
 *   start     - Start development server
 *   reset     - Reset development database
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Configuration paths
const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(PROJECT_ROOT, 'node-config.json');
const EXAMPLE_CONFIG = path.join(PROJECT_ROOT, 'node-config.example.json');
const ENV_FILE = path.join(PROJECT_ROOT, '.env');
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'mesh.db');

// Color output functions
const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`
};

function log(message, color = null) {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = colors.blue(`[${timestamp}]`);
  const output = color ? color(message) : message;
  console.log(`${prefix} ${output}`);
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
  log(`ℹ️  ${message}`);
}

function ask(question) {
  return new Promise(resolve => {
    rl.question(`${colors.blue('?')} ${question}: `, resolve);
  });
}

function runCommand(command, description, options = {}) {
  const silent = options.silent || false;
  const optional = options.optional || false;
  
  if (!silent) {
    info(`Running: ${description}`);
  }
  
  try {
    const output = execSync(command, { 
      encoding: 'utf8', 
      stdio: silent ? 'pipe' : 'inherit',
      cwd: PROJECT_ROOT
    });
    
    if (!silent) {
      success(`${description} completed`);
    }
    
    return { success: true, output: output?.toString().trim() };
  } catch (err) {
    if (optional) {
      warn(`${description} skipped (optional): ${err.message.split('\\n')[0]}`);
      return { success: false, optional: true, error: err.message };
    } else {
      error(`${description} failed: ${err.message.split('\\n')[0]}`);
      return { success: false, error: err.message };
    }
  }
}

function checkSystemRequirements() {
  console.log(colors.bold('\\n🔍 Checking System Requirements\\n'));
  
  const checks = [
    { name: 'Node.js version', command: 'node --version', min: '18.0.0' },
    { name: 'npm availability', command: 'npm --version' },
    { name: 'Git availability', command: 'git --version' },
    { name: 'SQLite3 availability', command: 'sqlite3 --version', optional: true },
    { name: 'Python3 availability', command: 'python3 --version', optional: true },
    { name: 'FFmpeg availability', command: 'ffmpeg -version', optional: true }
  ];
  
  let allRequired = true;
  let optionalCount = 0;
  
  for (const check of checks) {
    const result = runCommand(check.command, check.name, { 
      silent: true, 
      optional: check.optional 
    });
    
    if (result.success) {
      success(`${check.name}: ${result.output.split('\\n')[0]}`);
      if (check.optional) optionalCount++;
    } else if (result.optional) {
      warn(`${check.name}: Not available (optional)`);
    } else {
      error(`${check.name}: Missing`);
      allRequired = false;
    }
  }
  
  console.log('');
  
  if (allRequired) {
    success(`All required dependencies available (${optionalCount} optional tools found)`);
    return true;
  } else {
    error('Some required dependencies are missing');
    return false;
  }
}

function checkEnvironmentVariables() {
  const requiredEnvVars = [
    'IC_MESH_SERVER',
    'IC_NODE_NAME',
    'IC_NODE_OWNER'
  ];
  
  const optionalEnvVars = [
    'STRIPE_SECRET_KEY',
    'DATABASE_URL',
    'RESEND_API_KEY',
    'WHISPER_MODEL'
  ];
  
  info('Checking environment variables...');
  
  let hasRequired = true;
  let optionalCount = 0;
  
  for (const envVar of requiredEnvVars) {
    if (process.env[envVar]) {
      success(`${envVar}: Set`);
    } else {
      warn(`${envVar}: Missing (will prompt during init)`);
      hasRequired = false;
    }
  }
  
  for (const envVar of optionalEnvVars) {
    if (process.env[envVar]) {
      success(`${envVar}: Set`);
      optionalCount++;
    }
  }
  
  info(`Environment: ${requiredEnvVars.filter(v => process.env[v]).length}/${requiredEnvVars.length} required, ${optionalCount} optional`);
  return hasRequired;
}

async function createConfiguration() {
  console.log(colors.bold('\\n⚙️  Creating Configuration\\n'));
  
  // Check if config already exists
  if (fs.existsSync(CONFIG_FILE)) {
    const overwrite = await ask('Configuration file exists. Overwrite? (y/N)');
    if (overwrite.toLowerCase() !== 'y') {
      info('Using existing configuration');
      return true;
    }
  }
  
  // Load example configuration
  if (!fs.existsSync(EXAMPLE_CONFIG)) {
    error('Example configuration file not found');
    return false;
  }
  
  const exampleConfig = JSON.parse(fs.readFileSync(EXAMPLE_CONFIG, 'utf8'));
  
  // Prompt for basic configuration
  console.log('\\nPlease provide basic configuration:');
  
  const nodeName = await ask(`Node name [${exampleConfig.node.name}]`) || exampleConfig.node.name;
  const nodeOwner = await ask(`Node owner [${exampleConfig.node.owner}]`) || exampleConfig.node.owner;
  const nodeRegion = await ask(`Node region [${exampleConfig.node.region}]`) || exampleConfig.node.region;
  const serverUrl = await ask(`Server URL [${exampleConfig.server.url}]`) || exampleConfig.server.url;
  
  // Update configuration
  exampleConfig.node.name = nodeName;
  exampleConfig.node.owner = nodeOwner;
  exampleConfig.node.region = nodeRegion;
  exampleConfig.server.url = serverUrl;
  
  // Handler capability detection
  console.log('\\nDetecting available handlers...');
  
  // Check for Whisper/transcription capability
  const whisperCheck = runCommand('which whisper', 'Whisper CLI', { silent: true, optional: true });
  if (whisperCheck.success) {
    success('Whisper found - enabling transcription handler');
    exampleConfig.handlers.transcribe.enabled = true;
  } else {
    warn('Whisper not found - transcription handler disabled');
    exampleConfig.handlers.transcribe.enabled = false;
  }
  
  // Check for Ollama
  const ollamaCheck = runCommand('curl -s http://localhost:11434/api/tags', 'Ollama API', { silent: true, optional: true });
  if (ollamaCheck.success) {
    success('Ollama found - enabling inference handler');
    exampleConfig.handlers.inference.enabled = true;
  } else {
    warn('Ollama not found - inference handler disabled');
    exampleConfig.handlers.inference.enabled = false;
  }
  
  // Check for FFmpeg
  const ffmpegCheck = runCommand('which ffmpeg', 'FFmpeg', { silent: true, optional: true });
  if (ffmpegCheck.success) {
    success('FFmpeg found - enabling media processing handler');
    exampleConfig.handlers.ffmpeg.enabled = true;
  } else {
    warn('FFmpeg not found - media processing handler disabled');
    exampleConfig.handlers.ffmpeg.enabled = false;
  }
  
  // Save configuration
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(exampleConfig, null, 2));
    success(`Configuration saved to ${CONFIG_FILE}`);
    return true;
  } catch (err) {
    error(`Failed to save configuration: ${err.message}`);
    return false;
  }
}

function createEnvFile() {
  info('Creating .env file template...');
  
  const envTemplate = `# IC Mesh Environment Configuration
# Copy this file and fill in your values

# Required
IC_MESH_SERVER=https://moilol.com:8333
IC_NODE_NAME=my-development-node
IC_NODE_OWNER=developer

# Optional - for full development
STRIPE_SECRET_KEY=sk_test_...
DATABASE_URL=sqlite:./data/mesh.db
RESEND_API_KEY=re_...

# Handler-specific
WHISPER_MODEL=base
OLLAMA_URL=http://localhost:11434
SD_URL=http://localhost:7860

# Development
NODE_ENV=development
DEBUG=ic-mesh:*
`;

  if (fs.existsSync(ENV_FILE)) {
    warn('.env file already exists - not overwriting');
  } else {
    fs.writeFileSync(ENV_FILE, envTemplate);
    success('.env template created');
  }
}

function initializeDatabase() {
  console.log(colors.bold('\\n💾 Initializing Database\\n'));
  
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    success('Created data directory');
  }
  
  // Check if database exists
  if (fs.existsSync(DB_PATH)) {
    info('Database already exists');
    return true;
  }
  
  // Initialize database by starting and stopping server briefly
  info('Initializing database schema...');
  
  try {
    // This will create the database with the schema
    const server = spawn('node', ['server.js'], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Give it a moment to initialize
    setTimeout(() => {
      server.kill();
    }, 3000);
    
    return new Promise((resolve) => {
      server.on('close', () => {
        if (fs.existsSync(DB_PATH)) {
          success('Database initialized');
          resolve(true);
        } else {
          error('Database initialization failed');
          resolve(false);
        }
      });
    });
    
  } catch (err) {
    error(`Database initialization failed: ${err.message}`);
    return false;
  }
}

function installDependencies() {
  console.log(colors.bold('\\n📦 Installing Dependencies\\n'));
  
  const result = runCommand('npm install', 'Installing npm packages');
  return result.success;
}

function runTests() {
  console.log(colors.bold('\\n🧪 Running Tests\\n'));
  
  const result = runCommand('npm test', 'Running test suite');
  return result.success;
}

async function startDevelopmentServer() {
  console.log(colors.bold('\\n🚀 Starting Development Server\\n'));
  
  info('Starting IC Mesh server...');
  console.log(colors.yellow('Press Ctrl+C to stop the server\\n'));
  
  const server = spawn('node', ['server.js'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit'
  });
  
  process.on('SIGINT', () => {
    info('Stopping development server...');
    server.kill();
    process.exit(0);
  });
  
  server.on('close', (code) => {
    if (code === 0) {
      success('Server stopped');
    } else {
      error(`Server exited with code ${code}`);
    }
  });
}

function resetDatabase() {
  console.log(colors.bold('\\n🔄 Resetting Database\\n'));
  
  if (fs.existsSync(DB_PATH)) {
    try {
      fs.unlinkSync(DB_PATH);
      success('Database file deleted');
    } catch (err) {
      error(`Failed to delete database: ${err.message}`);
      return false;
    }
  } else {
    info('Database file not found - nothing to reset');
  }
  
  return initializeDatabase();
}

async function init() {
  console.log(colors.bold('\\n🎯 IC Mesh Development Setup\\n'));
  
  // Step 1: Check system requirements
  if (!checkSystemRequirements()) {
    error('\\nSetup aborted: Missing required dependencies');
    process.exit(1);
  }
  
  // Step 2: Check environment
  checkEnvironmentVariables();
  
  // Step 3: Install dependencies
  if (!installDependencies()) {
    error('\\nSetup aborted: Dependency installation failed');
    process.exit(1);
  }
  
  // Step 4: Create configuration
  if (!(await createConfiguration())) {
    error('\\nSetup aborted: Configuration creation failed');
    process.exit(1);
  }
  
  // Step 5: Create environment template
  createEnvFile();
  
  // Step 6: Initialize database
  if (!(await initializeDatabase())) {
    error('\\nSetup aborted: Database initialization failed');
    process.exit(1);
  }
  
  // Step 7: Run tests
  if (!runTests()) {
    warn('\\nTests failed - setup continues but check test output');
  }
  
  console.log(colors.bold('\\n🎉 Setup Complete!\\n'));
  success('IC Mesh development environment is ready');
  
  console.log(colors.green('\\nNext steps:'));
  console.log('1. Review and update .env file with your credentials');
  console.log('2. Run: node scripts/dev-setup.js start');
  console.log('3. Visit: http://localhost:8333/status');
  console.log('\\nOr run individual commands:');
  console.log('• node scripts/dev-setup.js test  - Run tests');
  console.log('• node scripts/dev-setup.js check - System check');
  console.log('• node scripts/dev-setup.js reset - Reset database');
}

// Command line interface
async function main() {
  const command = process.argv[2] || 'help';
  
  try {
    switch (command) {
      case 'check':
        checkSystemRequirements();
        checkEnvironmentVariables();
        break;
        
      case 'init':
        await init();
        break;
        
      case 'test':
        runTests();
        break;
        
      case 'start':
        await startDevelopmentServer();
        break;
        
      case 'reset':
        await resetDatabase();
        break;
        
      case 'help':
      default:
        console.log(colors.bold('\\nIC Mesh Development Setup\\n'));
        console.log('Commands:');
        console.log('  check     - Check system requirements and environment');
        console.log('  init      - Complete development environment setup');
        console.log('  test      - Run test suite');
        console.log('  start     - Start development server');
        console.log('  reset     - Reset development database');
        console.log('');
        console.log('Examples:');
        console.log('  node scripts/dev-setup.js init');
        console.log('  node scripts/dev-setup.js start');
        console.log('');
        break;
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

module.exports = {
  checkSystemRequirements,
  createConfiguration,
  initializeDatabase,
  runTests
};