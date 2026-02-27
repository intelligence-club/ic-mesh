#!/usr/bin/env node
/**
 * Deployment Validator - Pre-deployment checks for IC Mesh
 * Validates environment, dependencies, and configuration before deployment
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class DeploymentValidator {
  constructor() {
    this.checks = [];
    this.warnings = [];
    this.errors = [];
  }

  async validateDeployment() {
    console.log('🚀 IC Mesh Deployment Validator\n');
    
    await this.checkEnvironment();
    await this.checkDependencies();
    await this.checkConfiguration();
    await this.checkDatabase();
    await this.checkSecurity();
    await this.checkNetworking();
    
    this.reportResults();
  }

  async checkEnvironment() {
    console.log('🔍 Environment Validation...');
    
    // Node.js version
    const nodeVersion = process.version;
    const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0]);
    
    if (nodeMajor >= 18) {
      this.pass(`Node.js ${nodeVersion} (compatible)`);
    } else {
      this.fail(`Node.js ${nodeVersion} (requires 18+)`);
    }
    
    // Operating system
    const platform = process.platform;
    if (['linux', 'darwin'].includes(platform)) {
      this.pass(`Platform: ${platform} (supported)`);
    } else {
      this.warn(`Platform: ${platform} (may have compatibility issues)`);
    }
    
    // Architecture
    const arch = process.arch;
    if (['x64', 'arm64'].includes(arch)) {
      this.pass(`Architecture: ${arch} (supported)`);
    } else {
      this.warn(`Architecture: ${arch} (limited support)`);
    }
    
    // Memory
    const totalMemMB = Math.round(require('os').totalmem() / 1024 / 1024);
    if (totalMemMB >= 2048) {
      this.pass(`RAM: ${totalMemMB}MB (adequate)`);
    } else {
      this.warn(`RAM: ${totalMemMB}MB (minimum 2GB recommended)`);
    }
    
    console.log();
  }

  async checkDependencies() {
    console.log('📦 Dependency Validation...');
    
    // Check package.json exists
    if (fs.existsSync('package.json')) {
      this.pass('package.json found');
      
      // Check if node_modules exists
      if (fs.existsSync('node_modules')) {
        this.pass('node_modules directory exists');
      } else {
        this.fail('node_modules not found - run npm install');
      }
      
      // Check key dependencies
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      const criticalDeps = ['sqlite3', 'express', 'ws'];
      criticalDeps.forEach(dep => {
        if (deps[dep]) {
          this.pass(`${dep}: ${deps[dep]}`);
        } else {
          this.fail(`Missing critical dependency: ${dep}`);
        }
      });
      
    } else {
      this.fail('package.json not found');
    }
    
    // Check for optional but recommended tools
    try {
      execSync('which docker', { stdio: 'ignore' });
      this.pass('Docker available (recommended for production)');
    } catch (e) {
      this.warn('Docker not found (recommended for production deployment)');
    }
    
    try {
      execSync('which systemctl', { stdio: 'ignore' });
      this.pass('systemd available (for service management)');
    } catch (e) {
      this.warn('systemd not available (alternative service management needed)');
    }
    
    console.log();
  }

  async checkConfiguration() {
    console.log('⚙️  Configuration Validation...');
    
    // Check for .env file
    if (fs.existsSync('.env')) {
      this.pass('.env file found');
      
      // Read and validate environment variables
      const envContent = fs.readFileSync('.env', 'utf8');
      const requiredVars = [
        'PORT',
        'JWT_SECRET',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET'
      ];
      
      requiredVars.forEach(varName => {
        if (envContent.includes(`${varName}=`)) {
          this.pass(`${varName} configured`);
        } else {
          this.fail(`Missing environment variable: ${varName}`);
        }
      });
      
    } else {
      if (fs.existsSync('.env.example')) {
        this.fail('.env file missing (copy from .env.example)');
      } else {
        this.fail('.env file and .env.example both missing');
      }
    }
    
    // Check for configuration files
    const configFiles = ['server.js', 'client.js'];
    configFiles.forEach(file => {
      if (fs.existsSync(file)) {
        this.pass(`${file} exists`);
      } else {
        this.fail(`Missing core file: ${file}`);
      }
    });
    
    console.log();
  }

  async checkDatabase() {
    console.log('🗄️  Database Validation...');
    
    // Check if mesh.db exists
    if (fs.existsSync('mesh.db')) {
      this.pass('mesh.db database file exists');
      
      // Try to connect to database
      try {
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('mesh.db');
        
        // Check for required tables
        const tables = await new Promise((resolve, reject) => {
          db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(r => r.name));
          });
        });
        
        const requiredTables = ['nodes', 'jobs', 'users', 'credits'];
        requiredTables.forEach(table => {
          if (tables.includes(table)) {
            this.pass(`Table '${table}' exists`);
          } else {
            this.fail(`Missing database table: ${table}`);
          }
        });
        
        db.close();
      } catch (err) {
        this.fail(`Database connection error: ${err.message}`);
      }
      
    } else {
      this.warn('mesh.db not found (will be created on first run)');
    }
    
    console.log();
  }

  async checkSecurity() {
    console.log('🔐 Security Validation...');
    
    // Check file permissions
    const sensitiveFiles = ['.env', 'mesh.db'];
    sensitiveFiles.forEach(file => {
      if (fs.existsSync(file)) {
        const stats = fs.statSync(file);
        const mode = (stats.mode & parseInt('777', 8)).toString(8);
        
        if (mode === '600' || mode === '644') {
          this.pass(`${file} permissions: ${mode} (secure)`);
        } else {
          this.warn(`${file} permissions: ${mode} (consider 600 for security)`);
        }
      }
    });
    
    // Check for common security files
    if (fs.existsSync('.gitignore')) {
      const gitignore = fs.readFileSync('.gitignore', 'utf8');
      if (gitignore.includes('.env')) {
        this.pass('.env excluded from git');
      } else {
        this.fail('.env not in .gitignore (security risk!)');
      }
    } else {
      this.warn('.gitignore not found');
    }
    
    // Check for SSL/TLS readiness
    if (fs.existsSync('ssl') || fs.existsSync('certs')) {
      this.pass('SSL certificate directory found');
    } else {
      this.warn('No SSL certificates found (consider HTTPS for production)');
    }
    
    console.log();
  }

  async checkNetworking() {
    console.log('🌐 Network Validation...');
    
    // Check if ports are available
    const defaultPorts = [8333, 8334, 3000];
    
    for (const port of defaultPorts) {
      try {
        const net = require('net');
        const server = net.createServer();
        
        await new Promise((resolve, reject) => {
          server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
              reject(err);
            } else {
              reject(err);
            }
          });
          
          server.listen(port, () => {
            server.close();
            resolve();
          });
        });
        
        this.pass(`Port ${port} available`);
      } catch (err) {
        this.warn(`Port ${port} may be in use`);
      }
    }
    
    // Check internet connectivity
    try {
      const https = require('https');
      await new Promise((resolve, reject) => {
        https.get('https://api.stripe.com', (res) => {
          this.pass('Internet connectivity: OK');
          resolve();
        }).on('error', reject);
      });
    } catch (err) {
      this.fail('No internet connectivity (required for Stripe)');
    }
    
    console.log();
  }

  pass(message) {
    console.log(`  ✅ ${message}`);
    this.checks.push({ status: 'pass', message });
  }

  warn(message) {
    console.log(`  ⚠️  ${message}`);
    this.warnings.push(message);
    this.checks.push({ status: 'warn', message });
  }

  fail(message) {
    console.log(`  ❌ ${message}`);
    this.errors.push(message);
    this.checks.push({ status: 'fail', message });
  }

  reportResults() {
    console.log('📊 Deployment Validation Results:\n');
    
    const passed = this.checks.filter(c => c.status === 'pass').length;
    const warned = this.warnings.length;
    const failed = this.errors.length;
    
    console.log(`✅ Passed: ${passed}`);
    console.log(`⚠️  Warnings: ${warned}`);
    console.log(`❌ Failed: ${failed}\n`);
    
    if (failed === 0) {
      console.log('🎉 DEPLOYMENT READY');
      console.log('All critical checks passed. Safe to deploy.\n');
      
      if (warned > 0) {
        console.log('💡 Recommendations:');
        this.warnings.forEach(w => console.log(`  • ${w}`));
        console.log();
      }
      
    } else {
      console.log('🚨 DEPLOYMENT BLOCKED');
      console.log('Critical issues must be resolved before deployment:\n');
      
      this.errors.forEach((error, i) => {
        console.log(`${i + 1}. ${error}`);
      });
      
      console.log('\n🛠️  Fix these issues and run validation again.');
    }
    
    return failed === 0;
  }

  async generateReport() {
    await this.validateDeployment();
    
    return {
      timestamp: new Date().toISOString(),
      ready: this.errors.length === 0,
      summary: {
        passed: this.checks.filter(c => c.status === 'pass').length,
        warnings: this.warnings.length,
        errors: this.errors.length
      },
      checks: this.checks,
      warnings: this.warnings,
      errors: this.errors
    };
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const validator = new DeploymentValidator();
  
  if (args.includes('--json')) {
    validator.generateReport().then(report => {
      console.log(JSON.stringify(report, null, 2));
    }).catch(console.error);
  } else {
    validator.validateDeployment().catch(console.error);
  }
}

module.exports = DeploymentValidator;