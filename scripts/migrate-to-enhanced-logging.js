#!/usr/bin/env node
/**
 * Migration Script: Console.log to Enhanced Logging
 * 
 * Analyzes console.log usage and provides migration suggestions
 * Optionally performs automatic replacements for simple cases
 */

const fs = require('fs');
const path = require('path');

class LoggingMigrator {
  constructor() {
    this.patterns = [
      // Error patterns
      { 
        regex: /console\.error\(/g,
        replacement: 'logger.error(',
        confidence: 'high',
        type: 'error'
      },
      // Warning patterns
      { 
        regex: /console\.warn\(/g,
        replacement: 'logger.warn(',
        confidence: 'high',
        type: 'warn'
      },
      // Info patterns (most console.log should be info)
      {
        regex: /console\.log\(/g,
        replacement: 'logger.info(',
        confidence: 'medium',
        type: 'info'
      },
      // Debug patterns (console.debug)
      {
        regex: /console\.debug\(/g,
        replacement: 'logger.debug(',
        confidence: 'high',
        type: 'debug'
      }
    ];
  }
  
  analyzeFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const results = {
      file: filePath,
      totalConsoleStatements: 0,
      byType: {},
      suggestions: [],
      lines: []
    };
    
    lines.forEach((line, index) => {
      this.patterns.forEach(pattern => {
        const matches = line.match(pattern.regex);
        if (matches) {
          results.totalConsoleStatements += matches.length;
          results.byType[pattern.type] = (results.byType[pattern.type] || 0) + matches.length;
          
          results.suggestions.push({
            lineNumber: index + 1,
            original: line.trim(),
            suggested: line.replace(pattern.regex, pattern.replacement),
            confidence: pattern.confidence,
            type: pattern.type
          });
          
          results.lines.push({
            number: index + 1,
            content: line.trim(),
            type: pattern.type
          });
        }
      });
    });
    
    return results;
  }
  
  analyzeProject(directory = '.') {
    const jsFiles = this.findJavaScriptFiles(directory);
    const results = {
      totalFiles: jsFiles.length,
      filesWithConsole: 0,
      totalConsoleStatements: 0,
      byType: {},
      fileResults: []
    };
    
    jsFiles.forEach(file => {
      const fileResult = this.analyzeFile(file);
      if (fileResult.totalConsoleStatements > 0) {
        results.filesWithConsole++;
        results.totalConsoleStatements += fileResult.totalConsoleStatements;
        
        Object.keys(fileResult.byType).forEach(type => {
          results.byType[type] = (results.byType[type] || 0) + fileResult.byType[type];
        });
        
        results.fileResults.push(fileResult);
      }
    });
    
    return results;
  }
  
  findJavaScriptFiles(directory, files = []) {
    const items = fs.readdirSync(directory);
    
    items.forEach(item => {
      const fullPath = path.join(directory, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
        this.findJavaScriptFiles(fullPath, files);
      } else if (item.endsWith('.js') && !item.includes('.test.') && !item.includes('.spec.')) {
        files.push(fullPath);
      }
    });
    
    return files;
  }
  
  generateMigrationPlan(analysis) {
    console.log('📊 Console.log Migration Analysis');
    console.log('='.repeat(50));
    console.log(`Total Files Analyzed: ${analysis.totalFiles}`);
    console.log(`Files with Console Statements: ${analysis.filesWithConsole}`);
    console.log(`Total Console Statements: ${analysis.totalConsoleStatements}`);
    console.log('');
    
    console.log('By Statement Type:');
    Object.entries(analysis.byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    console.log('');
    
    console.log('🎯 Migration Priority (by file):');
    analysis.fileResults
      .sort((a, b) => b.totalConsoleStatements - a.totalConsoleStatements)
      .slice(0, 10)
      .forEach((file, index) => {
        console.log(`${index + 1}. ${file.file}: ${file.totalConsoleStatements} statements`);
      });
    console.log('');
    
    console.log('📋 Next Steps:');
    console.log('1. Add logger import to target files:');
    console.log('   const { createLogger } = require("./lib/enhanced-logger");');
    console.log('   const logger = createLogger("component-name");');
    console.log('');
    console.log('2. Run with --migrate flag to auto-replace simple cases');
    console.log('3. Review and test changes');
    console.log('4. Update remaining complex cases manually');
  }
  
  generateLoggerImport(componentName) {
    return `const { createLogger } = require('./lib/enhanced-logger');
const logger = createLogger('${componentName}');`;
  }
  
  // Auto-migrate a specific file (be careful!)
  migrateFile(filePath, dryRun = true) {
    const content = fs.readFileSync(filePath, 'utf8');
    let modified = content;
    let changeCount = 0;
    
    // Check if logger is already imported
    if (!content.includes('enhanced-logger')) {
      const componentName = path.basename(filePath, '.js');
      const loggerImport = this.generateLoggerImport(componentName);
      
      // Find a good place to add the import (after other requires)
      const requireRegex = /const .* = require\(.*\);/g;
      const matches = [...content.matchAll(requireRegex)];
      
      if (matches.length > 0) {
        const lastRequire = matches[matches.length - 1];
        const insertPosition = lastRequire.index + lastRequire[0].length;
        modified = modified.slice(0, insertPosition) + '\n' + loggerImport + '\n' + modified.slice(insertPosition);
      } else {
        // Add at the top if no requires found
        modified = loggerImport + '\n\n' + modified;
      }
    }
    
    // Apply pattern replacements
    this.patterns.forEach(pattern => {
      const matches = modified.match(pattern.regex);
      if (matches) {
        changeCount += matches.length;
        if (pattern.confidence === 'high') {
          modified = modified.replace(pattern.regex, pattern.replacement);
        }
      }
    });
    
    if (dryRun) {
      console.log(`[DRY RUN] ${filePath}: ${changeCount} changes would be made`);
      return modified;
    } else {
      fs.writeFileSync(filePath, modified);
      console.log(`✅ Migrated ${filePath}: ${changeCount} changes applied`);
      return modified;
    }
  }
}

// CLI Interface
function main() {
  const migrator = new LoggingMigrator();
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node migrate-to-enhanced-logging.js [OPTIONS]');
    console.log('');
    console.log('Options:');
    console.log('  --analyze         Analyze console.log usage (default)');
    console.log('  --migrate [file]  Migrate specific file (dry run)');
    console.log('  --migrate-all     Migrate all files (dry run)');
    console.log('  --force          Actually write changes (use with --migrate)');
    console.log('  --help           Show this help');
    return;
  }
  
  const dryRun = !args.includes('--force');
  
  if (args.includes('--migrate-all')) {
    const analysis = migrator.analyzeProject();
    analysis.fileResults.forEach(fileResult => {
      migrator.migrateFile(fileResult.file, dryRun);
    });
  } else if (args.includes('--migrate')) {
    const fileIndex = args.indexOf('--migrate') + 1;
    const targetFile = args[fileIndex];
    if (targetFile && fs.existsSync(targetFile)) {
      migrator.migrateFile(targetFile, dryRun);
    } else {
      console.error('Please specify a valid file to migrate');
    }
  } else {
    // Default: analyze
    const analysis = migrator.analyzeProject();
    migrator.generateMigrationPlan(analysis);
  }
}

if (require.main === module) {
  main();
}

module.exports = { LoggingMigrator };