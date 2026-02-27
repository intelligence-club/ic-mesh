#!/usr/bin/env node
/**
 * IC Mesh Deployment Script
 * 
 * Automates deployment tasks:
 * - Environment validation
 * - Database migrations
 * - Service restarts
 * - Health checks
 * - Rollback capabilities
 * 
 * Usage:
 *   node scripts/deploy.js [command]
 *   
 * Commands:
 *   check     - Pre-deployment checks
 *   deploy    - Full deployment
 *   rollback  - Rollback to previous version
 *   status    - Post-deployment status
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const DEPLOY_LOG = path.join(__dirname, '..', 'data', 'deploy.log');
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');

// Ensure directories exist
fs.mkdirSync(path.dirname(DEPLOY_LOG), { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function log(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  console.log(message);
  fs.appendFileSync(DEPLOY_LOG, logLine);
}

function runCommand(command, description) {
  log(`Running: ${description}`);
  try {
    const output = execSync(command, { encoding: 'utf8', cwd: __dirname });
    log(`✅ ${description} completed`);
    return { success: true, output };
  } catch (error) {
    log(`❌ ${description} failed: ${error.message}`);
    return { success: false, error: error.message, output: error.stdout };
  }
}

function checkEnvironment() {
  log('🔍 Running environment checks...');
  
  const checks = [
    {
      name: 'Node.js version',
      command: 'node --version',
      validator: (output) => {
        const version = output.trim().substring(1);
        const major = parseInt(version.split('.')[0]);
        return major >= 18;
      }
    },
    {
      name: 'NPM packages',
      command: 'npm list --depth=0',
      validator: (output) => !output.includes('UNMET DEPENDENCY')
    },
    {
      name: 'Database file',
      command: 'ls -la ../data/mesh.db',
      validator: (output) => output.includes('mesh.db')
    },
    {
      name: 'Required environment variables',
      command: 'env',
      validator: (output) => {
        const required = ['STRIPE_API_KEY', 'RESEND_API_KEY'];
        return required.every(var_ => output.includes(`${var_}=`));
      }
    }
  ];
  
  let allPassed = true;
  
  for (const check of checks) {
    const result = runCommand(check.command, check.name);
    if (result.success && check.validator(result.output)) {
      log(`✅ ${check.name}: PASS`);
    } else {
      log(`❌ ${check.name}: FAIL`);
      allPassed = false;
    }
  }
  
  return allPassed;
}

function backupDatabase() {
  log('💾 Creating database backup...');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUP_DIR, `mesh-${timestamp}.db`);
  const dbFile = path.join(__dirname, '..', 'data', 'mesh.db');
  
  if (fs.existsSync(dbFile)) {
    fs.copyFileSync(dbFile, backupFile);
    log(`✅ Database backed up to: ${backupFile}`);
    return backupFile;
  } else {
    log(`⚠️ No database file found at: ${dbFile}`);
    return null;
  }
}

function runTests() {
  log('🧪 Running test suite...');
  
  const result = runCommand('npm test', 'Test suite');
  if (!result.success) {
    log('❌ Tests failed - deployment aborted');
    return false;
  }
  
  return true;
}

function restartServices() {
  log('🔄 Restarting services...');
  
  // Kill existing processes gracefully
  try {
    execSync('pkill -f "node.*server.js" || true', { encoding: 'utf8' });
    log('✅ Stopped existing server processes');
  } catch (error) {
    log(`⚠️ Error stopping processes: ${error.message}`);
  }
  
  // Wait for processes to stop
  setTimeout(() => {
    // Start new process in background
    const serverProcess = spawn('node', ['server.js'], {
      detached: true,
      stdio: 'ignore',
      cwd: path.join(__dirname, '..')
    });
    
    serverProcess.unref();
    log('✅ Started new server process');
  }, 2000);
  
  return true;
}

function runHealthCheck() {
  log('🏥 Running post-deployment health check...');
  
  // Wait for server to start
  setTimeout(() => {
    const result = runCommand('node health-check.js', 'Health check');
    return result.success;
  }, 5000);
  
  return true;
}

function performDeployment() {
  log('🚀 Starting deployment process...');
  
  // Pre-deployment checks
  if (!checkEnvironment()) {
    log('❌ Environment checks failed - deployment aborted');
    return false;
  }
  
  // Backup database
  const backupFile = backupDatabase();
  
  // Run tests
  if (!runTests()) {
    return false;
  }
  
  // Restart services
  if (!restartServices()) {
    log('❌ Service restart failed - deployment aborted');
    return false;
  }
  
  // Health check
  if (!runHealthCheck()) {
    log('❌ Health check failed - consider rollback');
    return false;
  }
  
  log('✅ Deployment completed successfully');
  if (backupFile) {
    log(`📋 Backup created: ${path.basename(backupFile)}`);
  }
  
  return true;
}

function performRollback() {
  log('🔄 Starting rollback process...');
  
  // Find most recent backup
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(file => file.startsWith('mesh-') && file.endsWith('.db'))
    .sort()
    .reverse();
    
  if (backups.length === 0) {
    log('❌ No backup files found for rollback');
    return false;
  }
  
  const latestBackup = backups[0];
  const backupPath = path.join(BACKUP_DIR, latestBackup);
  const dbPath = path.join(__dirname, '..', 'data', 'mesh.db');
  
  log(`📦 Rolling back to backup: ${latestBackup}`);
  
  // Stop services
  try {
    execSync('pkill -f "node.*server.js" || true', { encoding: 'utf8' });
    log('✅ Stopped services for rollback');
  } catch (error) {
    log(`⚠️ Error stopping services: ${error.message}`);
  }
  
  // Restore database
  fs.copyFileSync(backupPath, dbPath);
  log('✅ Database restored from backup');
  
  // Restart services
  setTimeout(() => {
    restartServices();
    log('✅ Services restarted');
    
    // Health check
    setTimeout(() => {
      runHealthCheck();
      log('✅ Rollback completed');
    }, 5000);
  }, 2000);
  
  return true;
}

function showStatus() {
  log('📊 Checking deployment status...');
  
  // Check process status
  try {
    const processes = execSync('ps aux | grep "node.*server.js" | grep -v grep || echo "No processes found"', { encoding: 'utf8' });
    log(`🔄 Running processes:\n${processes}`);
  } catch (error) {
    log(`❌ Error checking processes: ${error.message}`);
  }
  
  // Run health check
  runCommand('node health-check.js', 'Current system health');
  
  // Show recent logs
  if (fs.existsSync(DEPLOY_LOG)) {
    const logContent = fs.readFileSync(DEPLOY_LOG, 'utf8');
    const recentLines = logContent.split('\n').slice(-10).join('\n');
    log(`📋 Recent deployment activity:\n${recentLines}`);
  }
}

// Main execution
const command = process.argv[2] || 'help';

switch (command) {
  case 'check':
    checkEnvironment();
    break;
    
  case 'deploy':
    performDeployment();
    break;
    
  case 'rollback':
    performRollback();
    break;
    
  case 'status':
    showStatus();
    break;
    
  case 'help':
  default:
    console.log(`
IC Mesh Deployment Script

Usage: node scripts/deploy.js [command]

Commands:
  check     - Run pre-deployment environment checks
  deploy    - Perform full deployment (check → backup → test → restart → verify)
  rollback  - Rollback to previous database backup and restart services
  status    - Show current deployment status and recent activity

Examples:
  node scripts/deploy.js check
  node scripts/deploy.js deploy
  node scripts/deploy.js rollback
  node scripts/deploy.js status

Logs are written to: ${DEPLOY_LOG}
Backups are stored in: ${BACKUP_DIR}
`);
}