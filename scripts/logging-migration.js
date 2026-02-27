#!/usr/bin/env node
/**
 * IC Mesh Logging Migration Tool
 * 
 * Analyzes and migrates console.log usage to structured logging system.
 * 
 * Features:
 * - Scan codebase for console.log usage patterns
 * - Categorize by file and log type
 * - Suggest appropriate log levels 
 * - Generate migration report
 * - Optional automatic replacement (with backup)
 * 
 * Usage:
 *   node scripts/logging-migration.js --analyze    # Analyze current usage
 *   node scripts/logging-migration.js --migrate    # Auto-migrate (creates backups)
 *   node scripts/logging-migration.js --report     # Generate detailed report
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class LoggingMigrationTool {
  constructor(options = {}) {
    this.options = {
      dryRun: options.dryRun !== false,
      backup: options.backup !== false,
      verbose: options.verbose || false,
      excludePatterns: ['node_modules', '.git', 'data', 'uploads', 'logs'],
      targetExtensions: ['.js']
    };
    
    this.analysis = {
      files: new Map(),
      patterns: new Map(),
      totalConsoleStatements: 0,
      categories: {
        debug: [],
        info: [],
        warn: [],
        error: [],
        unknown: []
      }
    };
    
    this.logLevelPatterns = [
      { pattern: /console\.log\([^)]*debug[^)]*\)/gi, level: 'debug' },
      { pattern: /console\.log\([^)]*error[^)]*\)/gi, level: 'error' },
      { pattern: /console\.log\([^)]*warn[^)]*\)/gi, level: 'warn' },
      { pattern: /console\.log\([^)]*fail[^)]*\)/gi, level: 'error' },
      { pattern: /console\.log\([^)]*success[^)]*\)/gi, level: 'info' },
      { pattern: /console\.log\([^)]*✅[^)]*\)/gi, level: 'info' },
      { pattern: /console\.log\([^)]*❌[^)]*\)/gi, level: 'error' },
      { pattern: /console\.log\([^)]*⚠️[^)]*\)/gi, level: 'warn' },
      { pattern: /console\.log\([^)]*🔍[^)]*\)/gi, level: 'debug' },
      { pattern: /console\.log\([^)]*started[^)]*\)/gi, level: 'info' },
      { pattern: /console\.log\([^)]*completed[^)]*\)/gi, level: 'info' },
      { pattern: /console\.log\([^)]*monitoring[^)]*\)/gi, level: 'debug' }
    ];
    
    this.migrationPatterns = [
      {
        from: /console\.log\((['"`])(.*?)\1\);?/g,
        to: 'logger.info("$2");',
        description: 'Simple string message'
      },
      {
        from: /console\.log\((['"`])(.*?)\1,\s*([^)]+)\);?/g,
        to: 'logger.info("$2", { data: $3 });',
        description: 'Message with data'
      },
      {
        from: /console\.log\(([^'"`][^,)]+)\);?/g,
        to: 'logger.info("Console output", { data: $1 });',
        description: 'Variable or expression'
      }
    ];
  }
  
  async analyzeCodebase(rootPath = '.') {
    console.log('🔍 Analyzing console.log usage patterns...\n');
    
    const files = this.findJavaScriptFiles(rootPath);
    
    for (const filePath of files) {
      await this.analyzeFile(filePath);
    }
    
    this.categorizeLogStatements();
    return this.analysis;
  }
  
  findJavaScriptFiles(rootPath) {
    const files = [];
    
    const scan = (dir) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            if (!this.options.excludePatterns.some(pattern => 
              entry.name.includes(pattern) || fullPath.includes(pattern)
            )) {
              scan(fullPath);
            }
          } else if (this.options.targetExtensions.some(ext => 
            entry.name.endsWith(ext)
          )) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        console.warn(`⚠️  Skipping directory ${dir}: ${error.message}`);
      }
    };
    
    scan(rootPath);
    return files;
  }
  
  async analyzeFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      const consoleMatches = [];
      const consolePattern = /console\.log\([^)]*\)/g;
      
      let match;
      while ((match = consolePattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split('\n').length;
        const statement = match[0];
        const context = lines[lineNumber - 1]?.trim() || '';
        
        consoleMatches.push({
          statement,
          lineNumber,
          context,
          level: this.determineLogLevel(statement)
        });
      }
      
      if (consoleMatches.length > 0) {
        this.analysis.files.set(filePath, {
          totalStatements: consoleMatches.length,
          statements: consoleMatches,
          size: content.length,
          lines: lines.length
        });
        
        this.analysis.totalConsoleStatements += consoleMatches.length;
      }
      
    } catch (error) {
      console.warn(`⚠️  Error analyzing ${filePath}: ${error.message}`);
    }
  }
  
  determineLogLevel(statement) {
    for (const pattern of this.logLevelPatterns) {
      if (pattern.pattern.test(statement)) {
        return pattern.level;
      }
    }
    
    // Additional heuristics
    if (statement.toLowerCase().includes('error') || 
        statement.includes('❌') || 
        statement.includes('failed')) {
      return 'error';
    }
    
    if (statement.toLowerCase().includes('warn') || 
        statement.includes('⚠️')) {
      return 'warn';
    }
    
    if (statement.toLowerCase().includes('debug') || 
        statement.includes('🔍')) {
      return 'debug';
    }
    
    return 'info'; // Default
  }
  
  categorizeLogStatements() {
    for (const [filePath, fileData] of this.analysis.files) {
      for (const stmt of fileData.statements) {
        this.analysis.categories[stmt.level].push({
          file: filePath,
          line: stmt.lineNumber,
          statement: stmt.statement
        });
      }
    }
  }
  
  generateReport() {
    console.log('📊 IC Mesh Logging Migration Report\n');
    console.log('═══════════════════════════════════════\n');
    
    console.log('📈 Overview:');
    console.log(`  Total Files Analyzed: ${this.analysis.files.size}`);
    console.log(`  Total console.log Statements: ${this.analysis.totalConsoleStatements}`);
    console.log();
    
    console.log('📊 By Log Level:');
    for (const [level, statements] of Object.entries(this.analysis.categories)) {
      console.log(`  ${level.toUpperCase()}: ${statements.length} statements`);
    }
    console.log();
    
    console.log('🔍 Top Files by Console Usage:');
    const sortedFiles = [...this.analysis.files.entries()]
      .sort((a, b) => b[1].totalStatements - a[1].totalStatements)
      .slice(0, 10);
    
    for (const [filePath, data] of sortedFiles) {
      const relativePath = path.relative('.', filePath);
      console.log(`  ${relativePath}: ${data.totalStatements} statements`);
    }
    console.log();
    
    console.log('💡 Migration Recommendations:');
    console.log('  1. Start with files having the most console.log statements');
    console.log('  2. Focus on error/warn statements first (production impact)');
    console.log('  3. Use structured logging for metadata-rich statements');
    console.log('  4. Consider performance timers for monitoring statements');
    console.log();
    
    return {
      totalFiles: this.analysis.files.size,
      totalStatements: this.analysis.totalConsoleStatements,
      categories: Object.fromEntries(
        Object.entries(this.analysis.categories).map(([level, statements]) => 
          [level, statements.length]
        )
      ),
      topFiles: sortedFiles.map(([filePath, data]) => ({
        path: path.relative('.', filePath),
        statements: data.totalStatements
      }))
    };
  }
  
  async migrateFile(filePath, options = {}) {
    if (!this.analysis.files.has(filePath)) {
      console.log(`⚠️  No console.log statements found in ${filePath}`);
      return false;
    }
    
    console.log(`🔄 Migrating ${path.relative('.', filePath)}...`);
    
    try {
      let content = fs.readFileSync(filePath, 'utf8');
      const originalContent = content;
      
      // Add logger import if not present
      if (!content.includes('require(') || !content.includes('logger')) {
        const importStatement = "const logger = require('./utils/logger');\n";
        content = importStatement + content;
      }
      
      // Apply migration patterns
      let migratedCount = 0;
      for (const pattern of this.migrationPatterns) {
        const matches = content.match(pattern.from);
        if (matches) {
          content = content.replace(pattern.from, pattern.to);
          migratedCount += matches.length;
        }
      }
      
      if (migratedCount > 0) {
        if (!this.options.dryRun) {
          // Create backup
          if (this.options.backup) {
            const backupPath = filePath + '.backup.' + Date.now();
            fs.writeFileSync(backupPath, originalContent);
          }
          
          // Write migrated file
          fs.writeFileSync(filePath, content);
        }
        
        console.log(`  ✅ Migrated ${migratedCount} statements`);
        return true;
      } else {
        console.log(`  ℹ️  No automatic migrations available`);
        return false;
      }
      
    } catch (error) {
      console.error(`  ❌ Migration failed: ${error.message}`);
      return false;
    }
  }
  
  async migrateAll() {
    console.log('🚀 Starting automatic migration...\n');
    
    let totalMigrated = 0;
    let filesModified = 0;
    
    for (const filePath of this.analysis.files.keys()) {
      const success = await this.migrateFile(filePath);
      if (success) {
        filesModified++;
      }
    }
    
    console.log(`\n✨ Migration Summary:`);
    console.log(`  Files Modified: ${filesModified}`);
    console.log(`  Files Backed Up: ${this.options.backup ? filesModified : 0}`);
    
    if (this.options.dryRun) {
      console.log('  🧪 DRY RUN - No files were actually modified');
    }
  }
  
  exportReport(filePath = './logging-migration-report.json') {
    const report = {
      timestamp: new Date().toISOString(),
      analysis: {
        totalFiles: this.analysis.files.size,
        totalStatements: this.analysis.totalConsoleStatements,
        categories: Object.fromEntries(
          Object.entries(this.analysis.categories).map(([level, statements]) => 
            [level, statements.length]
          )
        )
      },
      files: Object.fromEntries(this.analysis.files),
      recommendations: [
        'Implement structured logging with ./utils/logger.js',
        'Start migration with high-impact files first',
        'Use appropriate log levels (debug, info, warn, error)',
        'Add contextual metadata for better observability',
        'Configure log rotation and persistence'
      ]
    };
    
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    console.log(`📄 Detailed report exported to ${filePath}`);
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const migrationTool = new LoggingMigrationTool({
    dryRun: args.includes('--dry-run'),
    backup: !args.includes('--no-backup'),
    verbose: args.includes('--verbose')
  });
  
  try {
    await migrationTool.analyzeCodebase('.');
    
    switch (command) {
      case '--analyze':
      case 'analyze':
        migrationTool.generateReport();
        break;
        
      case '--migrate':
      case 'migrate':
        migrationTool.generateReport();
        await migrationTool.migrateAll();
        break;
        
      case '--report':
      case 'report':
        migrationTool.generateReport();
        migrationTool.exportReport();
        break;
        
      default:
        console.log('🔍 IC Mesh Logging Migration Tool\n');
        console.log('Usage:');
        console.log('  node scripts/logging-migration.js --analyze    # Analyze current usage');
        console.log('  node scripts/logging-migration.js --migrate    # Auto-migrate (with backup)');
        console.log('  node scripts/logging-migration.js --report     # Generate detailed report');
        console.log('\nOptions:');
        console.log('  --dry-run      # Preview changes without modifying files');
        console.log('  --no-backup    # Skip backup creation');
        console.log('  --verbose      # Enable detailed output');
        
        // Default: show quick analysis
        console.log('\n🚀 Quick Analysis:\n');
        migrationTool.generateReport();
    }
    
  } catch (error) {
    console.error('❌ Migration tool failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { LoggingMigrationTool };