#!/usr/bin/env node
/**
 * Enhanced Rate Limiting Integration Script
 * 
 * Helps integrate the enhanced rate limiting system into existing IC Mesh server.
 * Provides migration tools, validation, and automated setup.
 * 
 * Usage:
 *   node scripts/integrate-enhanced-rate-limiting.js --check      # Check current setup
 *   node scripts/integrate-enhanced-rate-limiting.js --migrate    # Migrate to enhanced system  
 *   node scripts/integrate-enhanced-rate-limiting.js --validate   # Validate integration
 *   node scripts/integrate-enhanced-rate-limiting.js --setup      # Complete setup
 */

const fs = require('fs');
const path = require('path');

class EnhancedRateLimitingIntegration {
  constructor() {
    this.serverFile = './server.js';
    this.oldRateLimiterPath = './lib/rate-limit.js';
    this.newRateLimiterPath = './lib/enhanced-rate-limit.js';
    this.configDir = './config';
    this.logDir = './logs';
  }

  async checkCurrentSetup() {
    console.log('🔍 Checking Current Rate Limiting Setup\n');
    
    const checks = [
      {
        name: 'Server file exists',
        check: () => fs.existsSync(this.serverFile),
        critical: true
      },
      {
        name: 'Old rate limiter exists',
        check: () => fs.existsSync(this.oldRateLimiterPath),
        critical: false
      },
      {
        name: 'Enhanced rate limiter exists',
        check: () => fs.existsSync(this.newRateLimiterPath),
        critical: true
      },
      {
        name: 'Config directory exists',
        check: () => fs.existsSync(this.configDir),
        critical: false
      },
      {
        name: 'Logs directory exists', 
        check: () => fs.existsSync(this.logDir),
        critical: false
      }
    ];

    let criticalIssues = 0;
    checks.forEach(check => {
      const passed = check.check();
      const icon = passed ? '✅' : (check.critical ? '❌' : '⚠️');
      console.log(`${icon} ${check.name}`);
      
      if (!passed && check.critical) {
        criticalIssues++;
      }
    });

    console.log();
    
    if (criticalIssues > 0) {
      console.log('❌ Critical issues found. Cannot proceed with integration.');
      return false;
    }

    // Check server.js configuration
    console.log('🔧 Analyzing Server Configuration...');
    const analysis = this.analyzeServerConfiguration();
    
    if (analysis.usesRateLimit) {
      console.log('✅ Rate limiting is configured in server');
      console.log(`📄 Import: ${analysis.importType}`);
      console.log(`🔧 Usage: ${analysis.usagePattern}`);
    } else {
      console.log('⚠️  No rate limiting detected in server configuration');
    }

    console.log('\n📋 Integration Status:');
    if (analysis.usesEnhanced) {
      console.log('✅ Enhanced rate limiting already integrated');
    } else if (analysis.usesRateLimit) {
      console.log('🔄 Ready for migration to enhanced rate limiting');
    } else {
      console.log('🆕 Ready for fresh enhanced rate limiting setup');
    }

    return true;
  }

  analyzeServerConfiguration() {
    try {
      const serverContent = fs.readFileSync(this.serverFile, 'utf8');
      
      return {
        usesRateLimit: serverContent.includes('rate-limit') || serverContent.includes('RateLimiter'),
        usesEnhanced: serverContent.includes('enhanced-rate-limit') || serverContent.includes('EnhancedRateLimiter'),
        importType: this.detectImportType(serverContent),
        usagePattern: this.detectUsagePattern(serverContent)
      };
    } catch (e) {
      return { 
        usesRateLimit: false, 
        usesEnhanced: false, 
        importType: 'unknown', 
        usagePattern: 'unknown' 
      };
    }
  }

  detectImportType(content) {
    if (content.includes("require('./lib/enhanced-rate-limit')")) return 'enhanced';
    if (content.includes("require('./lib/rate-limit')")) return 'basic';
    if (content.includes('RateLimiter')) return 'variable_name';
    return 'none';
  }

  detectUsagePattern(content) {
    if (content.includes('new RateLimiter()')) return 'constructor';
    if (content.includes('new EnhancedRateLimiter()')) return 'enhanced_constructor';
    if (content.includes('rateLimiter.check')) return 'method_call';
    return 'none';
  }

  async setupDirectories() {
    console.log('📁 Setting Up Directories...\n');
    
    const directories = [
      { path: this.configDir, purpose: 'Configuration files' },
      { path: this.logDir, purpose: 'Rate limiting logs' }
    ];

    directories.forEach(dir => {
      if (!fs.existsSync(dir.path)) {
        fs.mkdirSync(dir.path, { recursive: true });
        console.log(`✅ Created ${dir.path} (${dir.purpose})`);
      } else {
        console.log(`📁 ${dir.path} already exists`);
      }
    });
  }

  async createDefaultConfiguration() {
    console.log('\n⚙️  Creating Default Configuration...\n');

    // Create whitelist configuration
    const whitelistFile = path.join(this.configDir, 'rate-limit-whitelist.json');
    if (!fs.existsSync(whitelistFile)) {
      const defaultWhitelist = {
        ips: ['127.0.0.1', '::1'],
        lastUpdated: new Date().toISOString(),
        description: 'Rate limit whitelist - IPs that bypass rate limiting'
      };
      
      fs.writeFileSync(whitelistFile, JSON.stringify(defaultWhitelist, null, 2));
      console.log(`✅ Created ${whitelistFile}`);
    } else {
      console.log(`📄 ${whitelistFile} already exists`);
    }

    // Create rate limiting configuration template
    const configFile = path.join(this.configDir, 'rate-limits.json');
    if (!fs.existsSync(configFile)) {
      const defaultConfig = {
        limits: {
          upload: 10,
          'jobs-post': 30,
          'nodes-register': 20,
          health: 120,
          status: 60,
          default: 60
        },
        windowMs: 60000,
        enableLogging: true,
        whitelistFile: './config/rate-limit-whitelist.json',
        logFile: './logs/rate-limits.log'
      };

      fs.writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2));
      console.log(`✅ Created ${configFile}`);
    } else {
      console.log(`📄 ${configFile} already exists`);
    }
  }

  async generateMigrationPatch() {
    console.log('\n🔄 Generating Migration Patch...\n');

    const analysis = this.analyzeServerConfiguration();
    
    if (analysis.usesEnhanced) {
      console.log('✅ Already using enhanced rate limiting - no migration needed');
      return;
    }

    if (!analysis.usesRateLimit) {
      console.log('🆕 Generating fresh integration patch...');
      this.generateFreshIntegrationPatch();
      return;
    }

    console.log('🔄 Generating migration patch from basic to enhanced...');
    
    const serverContent = fs.readFileSync(this.serverFile, 'utf8');
    let patchedContent = serverContent;

    // Replace import
    patchedContent = patchedContent.replace(
      "const RateLimiter = require('./lib/rate-limit');",
      "const EnhancedRateLimiter = require('./lib/enhanced-rate-limit');"
    );

    // Replace constructor
    patchedContent = patchedContent.replace(
      'const rateLimiter = new RateLimiter();',
      `const rateLimiter = new EnhancedRateLimiter({
  whitelistFile: './config/rate-limit-whitelist.json',
  logFile: './logs/rate-limits.log',
  enableLogging: true
});`
    );

    // Add enhanced response handling
    const enhancedHandlingCode = `
    // Enhanced rate limiting with proper headers
    if (!result.allowed) {
      res.status(429).set(result.headers).json({
        error: 'Rate limit exceeded',
        detail: \`Too many requests from \${clientIp}\`,
        retry_after: result.retryAfter,
        suggestion: \`Wait \${result.retryAfter} seconds before retrying\`
      });
      return;
    }`;

    // Find and replace basic rate limiting responses
    const basicHandlingRegex = /if\s*\(!result\.allowed\)\s*{[^}]*}/g;
    patchedContent = patchedContent.replace(basicHandlingRegex, enhancedHandlingCode.trim());

    // Write patch file
    const patchFile = './server-enhanced-rate-limiting.patch.js';
    fs.writeFileSync(patchFile, patchedContent);
    
    console.log(`✅ Migration patch created: ${patchFile}`);
    console.log('📋 To apply migration:');
    console.log(`   1. Backup current server: cp server.js server.js.backup`);
    console.log(`   2. Apply patch: cp ${patchFile} server.js`);
    console.log(`   3. Restart server`);
    console.log(`   4. Test with: node scripts/rate-limit-monitor.js`);
  }

  generateFreshIntegrationPatch() {
    const integrationCode = `
// Enhanced Rate Limiting Integration
const EnhancedRateLimiter = require('./lib/enhanced-rate-limit');

const rateLimiter = new EnhancedRateLimiter({
  limits: {
    upload: 10,
    'jobs-post': 30,
    'nodes-register': 20,
    health: 120,
    status: 60,
    default: 60
  },
  whitelistFile: './config/rate-limit-whitelist.json',
  logFile: './logs/rate-limits.log',
  enableLogging: true
});

// Rate limiting middleware
function applyRateLimit(req, res, group) {
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  const result = rateLimiter.check(clientIp, group);
  
  // Add rate limit headers
  res.set(result.headers);
  
  if (!result.allowed) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      detail: \`Too many requests from \${clientIp}\`,
      retry_after: result.retryAfter,
      suggestion: \`Wait \${result.retryAfter} seconds before retrying\`
    });
    return false;
  }
  
  return true;
}

// Example usage in request handlers:
/*
app.post('/upload', (req, res) => {
  if (!applyRateLimit(req, res, 'upload')) return;
  // ... rest of upload handler
});

app.post('/jobs', (req, res) => {
  if (!applyRateLimit(req, res, 'jobs-post')) return;
  // ... rest of job handler
});
*/`;

    const integrationFile = './enhanced-rate-limiting-integration.js';
    fs.writeFileSync(integrationFile, integrationCode);
    
    console.log(`✅ Fresh integration template created: ${integrationFile}`);
    console.log('📋 To integrate:');
    console.log('   1. Review the integration template');
    console.log('   2. Add the code to your server.js');
    console.log('   3. Apply rate limiting to your endpoints');
    console.log('   4. Test with monitoring tools');
  }

  async validateIntegration() {
    console.log('✅ Validating Enhanced Rate Limiting Integration\n');

    const validations = [
      {
        name: 'Enhanced rate limiter imported',
        check: () => {
          const content = fs.readFileSync(this.serverFile, 'utf8');
          return content.includes('enhanced-rate-limit');
        }
      },
      {
        name: 'Configuration files exist',
        check: () => {
          return fs.existsSync('./config/rate-limit-whitelist.json') &&
                 fs.existsSync('./config/rate-limits.json');
        }
      },
      {
        name: 'Log directory accessible',
        check: () => {
          try {
            fs.accessSync(this.logDir, fs.constants.W_OK);
            return true;
          } catch {
            return false;
          }
        }
      },
      {
        name: 'Monitoring tools executable',
        check: () => {
          return fs.existsSync('./scripts/rate-limit-monitor.js') &&
                 fs.existsSync('./scripts/rate-limit-dashboard.js');
        }
      }
    ];

    let allValid = true;
    validations.forEach(validation => {
      const passed = validation.check();
      const icon = passed ? '✅' : '❌';
      console.log(`${icon} ${validation.name}`);
      if (!passed) allValid = false;
    });

    console.log();
    
    if (allValid) {
      console.log('🎉 Enhanced rate limiting integration validated successfully!');
      console.log('\n🔧 Next steps:');
      console.log('   • Restart your server to apply changes');
      console.log('   • Test with: node scripts/rate-limit-monitor.js');
      console.log('   • Monitor with: node scripts/rate-limit-dashboard.js --health');
      console.log('   • Optimize with: node scripts/rate-limit-optimizer.js');
    } else {
      console.log('❌ Integration validation failed. Please review the issues above.');
    }

    return allValid;
  }

  async completeSetup() {
    console.log('🚀 Complete Enhanced Rate Limiting Setup\n');

    try {
      // Setup directories
      await this.setupDirectories();
      
      // Create configuration
      await this.createDefaultConfiguration();
      
      // Generate migration patch
      await this.generateMigrationPatch();
      
      // Validate setup
      const isValid = await this.validateIntegration();
      
      if (isValid) {
        console.log('\n🎉 Setup completed successfully!');
        this.printUsageInstructions();
      } else {
        console.log('\n⚠️  Setup completed with issues. Please review validation results.');
      }
      
    } catch (error) {
      console.error('❌ Setup failed:', error.message);
      process.exit(1);
    }
  }

  printUsageInstructions() {
    console.log('\n📋 Usage Instructions:');
    console.log('====================================');
    console.log();
    console.log('🔧 Monitoring:');
    console.log('   node scripts/rate-limit-monitor.js           # Current status');
    console.log('   node scripts/rate-limit-monitor.js --watch   # Live monitoring');
    console.log();
    console.log('📊 Analysis:');
    console.log('   node scripts/rate-limit-dashboard.js         # Full dashboard');
    console.log('   node scripts/rate-limit-dashboard.js --health # Health check');
    console.log();
    console.log('⚡ Optimization:');
    console.log('   node scripts/rate-limit-optimizer.js         # Analyze & suggest');
    console.log('   node scripts/rate-limit-optimizer.js --safe  # Apply safe optimizations');
    console.log();
    console.log('🛡️  Whitelist Management:');
    console.log('   node scripts/rate-limit-monitor.js --whitelist add 192.168.1.100');
    console.log('   node scripts/rate-limit-monitor.js --whitelist remove 192.168.1.100');
    console.log();
    console.log('📖 Documentation: docs/RATE-LIMITING-GUIDE.md');
  }
}

// CLI Interface
async function main() {
  const integration = new EnhancedRateLimitingIntegration();
  const args = process.argv.slice(2);

  if (args.includes('--check')) {
    await integration.checkCurrentSetup();
  } else if (args.includes('--migrate')) {
    await integration.generateMigrationPatch();
  } else if (args.includes('--validate')) {
    await integration.validateIntegration();
  } else if (args.includes('--setup')) {
    await integration.completeSetup();
  } else {
    console.log('🔧 Enhanced Rate Limiting Integration Tool\n');
    console.log('Usage:');
    console.log('   node scripts/integrate-enhanced-rate-limiting.js --check      # Check current setup');
    console.log('   node scripts/integrate-enhanced-rate-limiting.js --migrate    # Generate migration patch');
    console.log('   node scripts/integrate-enhanced-rate-limiting.js --validate   # Validate integration');
    console.log('   node scripts/integrate-enhanced-rate-limiting.js --setup      # Complete setup');
    console.log();
    console.log('For detailed help: see docs/RATE-LIMITING-GUIDE.md');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Integration error:', error.message);
    process.exit(1);
  });
}

module.exports = EnhancedRateLimitingIntegration;