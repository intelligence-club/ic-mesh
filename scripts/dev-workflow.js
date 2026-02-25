#!/usr/bin/env node
/**
 * IC Mesh Development Workflow Helper
 * 
 * Automates common development tasks like testing, linting, building,
 * deployment preparation, and git workflow.
 * 
 * Usage:
 *   node scripts/dev-workflow.js <command> [options]
 * 
 * Commands:
 *   test [--watch] [--coverage]     - Run tests with optional watch mode
 *   lint [--fix]                    - Check code style, optionally fix issues
 *   build [--production]            - Build for development or production
 *   check-health                    - Run comprehensive health checks
 *   prepare-deploy                  - Prepare for deployment (tests + build + checks)
 *   git-status                      - Show detailed git status with recommendations
 *   clean                           - Clean up temporary files and logs
 *   backup-db                       - Backup database with timestamp
 */

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class DevWorkflow {
  constructor() {
    this.projectRoot = process.cwd();
    this.colors = {
      green: '\x1b[32m',
      red: '\x1b[31m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      cyan: '\x1b[36m',
      reset: '\x1b[0m',
      bold: '\x1b[1m'
    };
  }

  log(message, color = 'reset') {
    console.log(`${this.colors[color]}${message}${this.colors.reset}`);
  }

  async exec(command, options = {}) {
    return new Promise((resolve, reject) => {
      exec(command, { cwd: this.projectRoot, ...options }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Command failed: ${command}\n${error.message}\n${stderr}`));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  async spawn(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { 
        cwd: this.projectRoot,
        stdio: 'inherit',
        ...options
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`));
        }
      });

      proc.on('error', reject);
    });
  }

  async checkCommand(command) {
    try {
      await this.exec(`which ${command}`);
      return true;
    } catch {
      return false;
    }
  }

  async test(options = {}) {
    this.log('\n🧪 Running Tests...', 'cyan');
    this.log('═'.repeat(50), 'cyan');

    try {
      if (options.watch) {
        this.log('Starting test watcher...', 'yellow');
        await this.spawn('npm', ['run', 'test:watch']);
      } else {
        const result = await this.exec('npm test');
        this.log(result.stdout, 'green');
        
        if (options.coverage) {
          this.log('\n📊 Generating coverage report...', 'cyan');
          if (await this.checkCommand('c8')) {
            await this.exec('c8 --reporter=html --reporter=text npm test');
            this.log('Coverage report generated in coverage/', 'green');
          } else {
            this.log('⚠️ c8 not installed. Run: npm install -g c8', 'yellow');
          }
        }
        
        this.log('\n✅ All tests passed!', 'green');
      }
    } catch (error) {
      this.log(`\n❌ Tests failed:\n${error.message}`, 'red');
      throw error;
    }
  }

  async lint(options = {}) {
    this.log('\n🔍 Code Linting...', 'cyan');
    this.log('═'.repeat(50), 'cyan');

    // Check for common linting tools
    const linters = [
      { command: 'eslint', args: ['.', '--ext', '.js'] },
      { command: 'jshint', args: ['.'] },
      { command: 'standard', args: [] }
    ];

    let linterFound = false;
    for (const linter of linters) {
      if (await this.checkCommand(linter.command)) {
        linterFound = true;
        this.log(`Using ${linter.command}...`, 'blue');
        
        try {
          const args = options.fix && linter.command === 'eslint' 
            ? [...linter.args, '--fix']
            : linter.args;
          
          await this.spawn(linter.command, args);
          this.log('✅ Linting passed!', 'green');
        } catch (error) {
          this.log('❌ Linting issues found', 'red');
          throw error;
        }
        break;
      }
    }

    if (!linterFound) {
      this.log('⚠️ No linter found. Consider installing ESLint: npm install -g eslint', 'yellow');
      
      // Basic syntax check
      this.log('Running basic syntax check...', 'blue');
      const jsFiles = await this.exec('find . -name "*.js" -not -path "./node_modules/*"');
      const files = jsFiles.stdout.trim().split('\n').filter(f => f);
      
      for (const file of files) {
        try {
          await this.exec(`node --check "${file}"`);
        } catch (error) {
          this.log(`❌ Syntax error in ${file}`, 'red');
          throw error;
        }
      }
      this.log('✅ Basic syntax check passed!', 'green');
    }
  }

  async build(options = {}) {
    this.log('\n🔨 Building Project...', 'cyan');
    this.log('═'.repeat(50), 'cyan');

    try {
      // Check if there's a build script
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      
      if (packageJson.scripts && packageJson.scripts.build) {
        const buildCmd = options.production ? 'build:production' : 'build';
        const command = packageJson.scripts[buildCmd] ? buildCmd : 'build';
        
        this.log(`Running npm run ${command}...`, 'blue');
        await this.spawn('npm', ['run', command]);
        this.log('✅ Build completed!', 'green');
      } else {
        this.log('⚠️ No build script found in package.json', 'yellow');
        this.log('For Node.js projects, build typically means:');
        this.log('  - Checking syntax');
        this.log('  - Running tests');
        this.log('  - Generating docs');
        
        await this.lint();
        await this.test();
        this.log('✅ "Build" completed (syntax + tests)!', 'green');
      }
    } catch (error) {
      this.log(`❌ Build failed:\n${error.message}`, 'red');
      throw error;
    }
  }

  async checkHealth() {
    this.log('\n🏥 Health Check...', 'cyan');
    this.log('═'.repeat(50), 'cyan');

    try {
      // Check if health monitor script exists
      const healthScript = 'scripts/health-monitor.js';
      if (fs.existsSync(healthScript)) {
        this.log('Running comprehensive health check...', 'blue');
        await this.spawn('node', [healthScript]);
      } else {
        // Basic health checks
        this.log('Running basic health checks...', 'blue');
        
        // Check package.json
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        this.log(`✅ Package: ${packageJson.name} v${packageJson.version}`, 'green');
        
        // Check dependencies
        const result = await this.exec('npm ls --depth=0 --silent 2>/dev/null || echo "Dependencies check needed"');
        if (result.stdout.includes('check needed')) {
          this.log('⚠️ Dependencies might need updating', 'yellow');
        } else {
          this.log('✅ Dependencies OK', 'green');
        }
        
        // Check git status
        try {
          const gitStatus = await this.exec('git status --porcelain');
          const changes = gitStatus.stdout.trim().split('\n').filter(line => line);
          if (changes.length === 0) {
            this.log('✅ Git working directory clean', 'green');
          } else {
            this.log(`⚠️ ${changes.length} uncommitted changes`, 'yellow');
          }
        } catch {
          this.log('⚠️ Not a git repository', 'yellow');
        }
      }
      
      this.log('✅ Health check completed!', 'green');
    } catch (error) {
      this.log(`❌ Health check failed:\n${error.message}`, 'red');
      throw error;
    }
  }

  async prepareDeploy() {
    this.log('\n🚀 Preparing for Deployment...', 'cyan');
    this.log('═'.repeat(50), 'cyan');

    const steps = [
      { name: 'Code Linting', fn: () => this.lint() },
      { name: 'Tests', fn: () => this.test() },
      { name: 'Build', fn: () => this.build({ production: true }) },
      { name: 'Health Check', fn: () => this.checkHealth() },
      { name: 'Git Status', fn: () => this.gitStatus() }
    ];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      this.log(`\n📋 Step ${i + 1}/${steps.length}: ${step.name}`, 'bold');
      
      try {
        await step.fn();
        this.log(`✅ ${step.name} completed`, 'green');
      } catch (error) {
        this.log(`❌ ${step.name} failed - deployment preparation stopped`, 'red');
        throw error;
      }
    }

    this.log('\n🎉 Deployment preparation completed successfully!', 'green');
    this.log('Ready to deploy! 🚀', 'bold');
  }

  async gitStatus() {
    this.log('\n📊 Git Status & Recommendations...', 'cyan');
    this.log('═'.repeat(50), 'cyan');

    try {
      // Basic git status
      const status = await this.exec('git status --porcelain');
      const changes = status.stdout.trim().split('\n').filter(line => line);
      
      if (changes.length === 0) {
        this.log('✅ Working directory clean', 'green');
      } else {
        this.log(`📝 ${changes.length} uncommitted changes:`, 'yellow');
        changes.forEach(change => {
          this.log(`  ${change}`, 'yellow');
        });
      }

      // Check for unpushed commits
      try {
        const unpushed = await this.exec('git log @{u}.. --oneline');
        const unpushedCommits = unpushed.stdout.trim().split('\n').filter(line => line);
        
        if (unpushedCommits.length > 0) {
          this.log(`📤 ${unpushedCommits.length} unpushed commits:`, 'yellow');
          unpushedCommits.forEach(commit => {
            this.log(`  ${commit}`, 'yellow');
          });
        } else {
          this.log('✅ All commits pushed', 'green');
        }
      } catch {
        this.log('⚠️ No upstream branch configured', 'yellow');
      }

      // Check current branch
      const branch = await this.exec('git branch --show-current');
      this.log(`🌿 Current branch: ${branch.stdout.trim()}`, 'blue');

      // Recommendations
      this.log('\n💡 Recommendations:', 'bold');
      if (changes.length > 0) {
        this.log('  • Review and commit changes: git add . && git commit -m "message"', 'cyan');
      }
      if (changes.length === 0) {
        this.log('  • Consider pushing latest changes: git push', 'cyan');
        this.log('  • Ready for deployment!', 'green');
      }

    } catch (error) {
      this.log('⚠️ Not a git repository or git not available', 'yellow');
    }
  }

  async clean() {
    this.log('\n🧹 Cleaning Project...', 'cyan');
    this.log('═'.repeat(50), 'cyan');

    const cleanTargets = [
      { pattern: 'logs/*.log', desc: 'Log files' },
      { pattern: 'tmp/*', desc: 'Temporary files' },
      { pattern: '*.tmp', desc: 'Temporary files' },
      { pattern: '.coverage', desc: 'Coverage reports' },
      { pattern: 'coverage/', desc: 'Coverage directory' },
      { pattern: 'node_modules/.cache', desc: 'Node module caches' }
    ];

    for (const target of cleanTargets) {
      try {
        const result = await this.exec(`ls ${target.pattern} 2>/dev/null || echo ""`);
        if (result.stdout.trim()) {
          this.log(`🗑️ Cleaning ${target.desc}...`, 'yellow');
          await this.exec(`rm -rf ${target.pattern}`);
          this.log(`✅ Cleaned ${target.desc}`, 'green');
        }
      } catch {
        // Ignore errors for optional cleanup
      }
    }

    this.log('\n✅ Cleanup completed!', 'green');
  }

  async backupDb() {
    this.log('\n💾 Database Backup...', 'cyan');
    this.log('═'.repeat(50), 'cyan');

    try {
      const dbPath = 'data/mesh.db';
      if (!fs.existsSync(dbPath)) {
        this.log('⚠️ Database file not found at data/mesh.db', 'yellow');
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = 'backups';
      const backupPath = `${backupDir}/mesh-backup-${timestamp}.db`;

      // Create backups directory if it doesn't exist
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // Copy database
      fs.copyFileSync(dbPath, backupPath);
      
      const stats = fs.statSync(backupPath);
      this.log(`✅ Database backed up to ${backupPath} (${Math.round(stats.size / 1024)}KB)`, 'green');

      // Clean old backups (keep last 10)
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('mesh-backup-') && f.endsWith('.db'))
        .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime }))
        .sort((a, b) => b.time - a.time);

      if (backups.length > 10) {
        const toDelete = backups.slice(10);
        for (const backup of toDelete) {
          fs.unlinkSync(path.join(backupDir, backup.name));
          this.log(`🗑️ Removed old backup: ${backup.name}`, 'yellow');
        }
      }

    } catch (error) {
      this.log(`❌ Backup failed: ${error.message}`, 'red');
      throw error;
    }
  }

  async run() {
    const [command, ...args] = process.argv.slice(2);
    const options = {};

    // Parse options
    args.forEach(arg => {
      if (arg.startsWith('--')) {
        const key = arg.substring(2);
        options[key] = true;
      }
    });

    this.log(`${this.colors.bold}🔧 IC Mesh Development Workflow${this.colors.reset}`, 'blue');
    
    try {
      switch (command) {
        case 'test':
          await this.test(options);
          break;
        case 'lint':
          await this.lint(options);
          break;
        case 'build':
          await this.build(options);
          break;
        case 'check-health':
          await this.checkHealth();
          break;
        case 'prepare-deploy':
          await this.prepareDeploy();
          break;
        case 'git-status':
          await this.gitStatus();
          break;
        case 'clean':
          await this.clean();
          break;
        case 'backup-db':
          await this.backupDb();
          break;
        default:
          this.log('\n❌ Unknown command. Available commands:', 'red');
          this.log('  test [--watch] [--coverage]', 'cyan');
          this.log('  lint [--fix]', 'cyan');
          this.log('  build [--production]', 'cyan');
          this.log('  check-health', 'cyan');
          this.log('  prepare-deploy', 'cyan');
          this.log('  git-status', 'cyan');
          this.log('  clean', 'cyan');
          this.log('  backup-db', 'cyan');
          process.exit(1);
      }
      
      this.log('\n🎉 Task completed successfully!', 'green');
    } catch (error) {
      this.log('\n💥 Task failed!', 'red');
      process.exit(1);
    }
  }
}

// Run if called directly
if (require.main === module) {
  const workflow = new DevWorkflow();
  workflow.run();
}

module.exports = DevWorkflow;