#!/usr/bin/env node
/**
 * IC Mesh Code Quality Analyzer
 * 
 * Comprehensive code quality assessment tool providing:
 * - Static analysis and complexity metrics
 * - Security vulnerability scanning  
 * - Performance optimization recommendations
 * - Code style consistency analysis
 * - Dependency health assessment
 * - Technical debt identification
 * 
 * Usage: node code-quality-analyzer.js [--fix] [--export] [--verbose]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class CodeQualityAnalyzer {
  constructor(options = {}) {
    this.options = {
      fixMode: options.fix || false,
      verbose: options.verbose || false,
      exportResults: options.export || false,
      excludePatterns: options.exclude || ['node_modules', '.git', 'data', 'uploads'],
      includeExtensions: options.extensions || ['.js', '.json', '.md']
    };
    
    this.results = {
      overview: {},
      files: {},
      security: { issues: [], score: 100 },
      performance: { issues: [], score: 100 },
      maintainability: { issues: [], score: 100 },
      dependencies: { issues: [], score: 100 },
      recommendations: []
    };
    
    this.securityPatterns = [
      { pattern: /process\.env\[\s*['"](.*?)['"]\s*\]/, severity: 'low', message: 'Environment variable access without default' },
      { 
        pattern: /exec\s*\(/, 
        severity: 'high', 
        message: 'Direct exec() usage - potential command injection',
        validate: (match, line) => {
          // Ignore database exec calls (SQLite, better-sqlite3)
          return !line.includes('.db.exec(') && 
                 !line.includes('this.db.exec(') && 
                 !line.includes('Database.exec(');
        }
      },
      { pattern: /eval\s*\(/, severity: 'critical', message: 'eval() usage - critical security risk' },
      { pattern: /innerHTML\s*=/, severity: 'medium', message: 'innerHTML assignment - potential XSS risk' },
      { pattern: /require\s*\(\s*['"]\.\.\//, severity: 'low', message: 'Relative require path - potential path traversal' },
      { pattern: /Math\.random\s*\(\s*\)/, severity: 'medium', message: 'Math.random() - not cryptographically secure' },
      { pattern: /console\.log\s*\(.*password.*\)/i, severity: 'high', message: 'Password logging detected' },
      { pattern: /console\.log\s*\(.*token.*\)/i, severity: 'high', message: 'Token logging detected' },
      { pattern: /SELECT.*\+.*FROM/i, severity: 'high', message: 'Potential SQL injection via string concatenation' }
    ];
    
    this.performancePatterns = [
      { pattern: /for\s*\(\s*var\s+\w+\s*=\s*0.*\.length/, severity: 'low', message: 'Loop with repeated .length access' },
      { pattern: /JSON\.parse\s*\(\s*JSON\.stringify/, severity: 'medium', message: 'Inefficient deep clone pattern' },
      { pattern: /\.\s*forEach\s*\(.*\.\s*push\s*\(/, severity: 'low', message: 'forEach with push - consider map()' },
      { pattern: /new\s+RegExp\s*\(/, severity: 'low', message: 'Dynamic RegExp - consider static if possible' },
      { pattern: /fs\.readFileSync/, severity: 'low', message: 'Synchronous file operation - blocks event loop' },
      { pattern: /setTimeout\s*\(\s*.*,\s*0\s*\)/, severity: 'low', message: 'setTimeout with 0 delay - consider setImmediate' }
    ];
    
    this.codeSmells = [
      { pattern: /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]{500,}?\}/, severity: 'medium', message: 'Large function - consider breaking down' },
      { pattern: /if\s*\([^{]+\)\s*\{[^}]*if\s*\([^{]+\)\s*\{[^}]*if/, severity: 'medium', message: 'Deep nesting - consider refactoring' },
      { pattern: /\/\*[\s\S]*?\*\/[\s\S]{0,10}\/\*/, severity: 'low', message: 'Multiple comment blocks - consider consolidation' },
      { pattern: /console\.log\([^)]*\);\s*\/\/.*DEBUG/i, severity: 'low', message: 'Debug console.log left in code' },
      { pattern: /TODO|FIXME|XXX|HACK/i, severity: 'low', message: 'Technical debt marker found' }
    ];
  }

  /**
   * Run comprehensive code quality analysis
   */
  async analyze(rootPath = '.') {
    console.log('🔍 IC Mesh Code Quality Analysis\n');
    
    const startTime = Date.now();
    await this.scanDirectory(rootPath);
    await this.analyzeDependencies();
    await this.generateRecommendations();
    
    const duration = Date.now() - startTime;
    
    this.results.overview = {
      filesScanned: Object.keys(this.results.files).length,
      totalLines: Object.values(this.results.files).reduce((sum, file) => sum + file.lines, 0),
      duration: `${duration}ms`,
      overallScore: this.calculateOverallScore()
    };
    
    this.displayResults();
    
    if (this.options.exportResults) {
      this.exportResults();
    }
    
    return this.results;
  }

  /**
   * Recursively scan directory for code files
   */
  async scanDirectory(dirPath) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative('.', fullPath);
      
      // Skip excluded patterns
      if (this.shouldExclude(relativePath)) {
        continue;
      }
      
      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath);
      } else if (entry.isFile() && this.shouldInclude(entry.name)) {
        await this.analyzeFile(fullPath, relativePath);
      }
    }
  }

  /**
   * Analyze individual file for quality issues
   */
  async analyzeFile(filePath, relativePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      const analysis = {
        path: relativePath,
        lines: lines.length,
        size: content.length,
        complexity: this.calculateComplexity(content),
        issues: [],
        score: 100
      };
      
      // Security analysis (exclude documentation and comments)
      if (!this.isDocumentationFile(relativePath)) {
        this.securityPatterns.forEach(pattern => {
          const matches = [...content.matchAll(new RegExp(pattern.pattern, 'g'))];
          matches.forEach(match => {
            const lineNum = this.getLineNumber(content, match.index);
            const contextLine = lines[lineNum - 1] || '';
            
            // Skip if the match is in a comment or documentation context
            if (!this.isInComment(contextLine) && !this.isDocumentationContext(contextLine, pattern.pattern)) {
              // Use validate function if available
              if (pattern.validate && !pattern.validate(match, contextLine)) {
                return; // Skip this match
              }
              
              analysis.issues.push({
                type: 'security',
                severity: pattern.severity,
                message: pattern.message,
                line: lineNum,
                context: this.getContext(lines, lineNum)
              });
              this.results.security.issues.push({ file: relativePath, ...analysis.issues[analysis.issues.length - 1] });
            }
          });
        });
      }
      
      // Performance analysis
      this.performancePatterns.forEach(pattern => {
        const matches = [...content.matchAll(new RegExp(pattern.pattern, 'g'))];
        matches.forEach(match => {
          analysis.issues.push({
            type: 'performance',
            severity: pattern.severity,
            message: pattern.message,
            line: this.getLineNumber(content, match.index),
            context: this.getContext(lines, this.getLineNumber(content, match.index))
          });
          this.results.performance.issues.push({ file: relativePath, ...analysis.issues[analysis.issues.length - 1] });
        });
      });
      
      // Code smell analysis
      this.codeSmells.forEach(pattern => {
        const matches = [...content.matchAll(new RegExp(pattern.pattern, 'g'))];
        matches.forEach(match => {
          analysis.issues.push({
            type: 'maintainability',
            severity: pattern.severity,
            message: pattern.message,
            line: this.getLineNumber(content, match.index),
            context: this.getContext(lines, this.getLineNumber(content, match.index))
          });
          this.results.maintainability.issues.push({ file: relativePath, ...analysis.issues[analysis.issues.length - 1] });
        });
      });
      
      // Calculate file score
      analysis.score = Math.max(0, 100 - (analysis.issues.length * 5));
      
      this.results.files[relativePath] = analysis;
      
    } catch (error) {
      if (this.options.verbose) {
        console.error(`Error analyzing ${relativePath}:`, error.message);
      }
    }
  }

  /**
   * Calculate cyclomatic complexity
   */
  calculateComplexity(content) {
    const complexityKeywords = /\b(if|else|while|for|switch|case|catch|&&|\|\||\?)\b/g;
    const matches = content.match(complexityKeywords) || [];
    return Math.max(1, matches.length);
  }

  /**
   * Get line number from character index
   */
  getLineNumber(content, index) {
    return content.substring(0, index).split('\n').length;
  }

  /**
   * Get context around a line
   */
  getContext(lines, lineNum, contextLines = 1) {
    const start = Math.max(0, lineNum - contextLines - 1);
    const end = Math.min(lines.length, lineNum + contextLines);
    return lines.slice(start, end).map((line, i) => {
      const actualLineNum = start + i + 1;
      const marker = actualLineNum === lineNum ? '>>> ' : '    ';
      return `${marker}${actualLineNum}: ${line}`;
    }).join('\n');
  }

  /**
   * Analyze package dependencies
   */
  async analyzeDependencies() {
    try {
      const packagePath = './package.json';
      if (!fs.existsSync(packagePath)) return;
      
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      const totalDeps = Object.keys(dependencies).length;
      const knownVulnerabilities = this.checkKnownVulnerabilities(dependencies);
      const outdatedPackages = await this.checkOutdatedPackages(dependencies);
      
      this.results.dependencies = {
        total: totalDeps,
        vulnerabilities: knownVulnerabilities,
        outdated: outdatedPackages,
        score: Math.max(0, 100 - (knownVulnerabilities.length * 15) - (outdatedPackages.length * 5))
      };
      
    } catch (error) {
      if (this.options.verbose) {
        console.error('Dependency analysis failed:', error.message);
      }
    }
  }

  /**
   * Check for known vulnerability patterns
   */
  checkKnownVulnerabilities(dependencies) {
    const vulnerablePatterns = [
      { name: 'lodash', versions: ['<4.17.11'], severity: 'high', cve: 'CVE-2019-10744' },
      { name: 'moment', versions: ['*'], severity: 'low', issue: 'Large bundle size, consider date-fns' },
      { name: 'request', versions: ['*'], severity: 'medium', issue: 'Deprecated, use axios or fetch' }
    ];
    
    const found = [];
    Object.keys(dependencies).forEach(dep => {
      const vulnerable = vulnerablePatterns.find(v => v.name === dep);
      if (vulnerable) {
        found.push({ package: dep, ...vulnerable });
      }
    });
    
    return found;
  }

  /**
   * Check for outdated packages (simplified)
   */
  async checkOutdatedPackages(dependencies) {
    // This is a simplified implementation
    // In a real scenario, you'd use npm API or npm outdated
    const potentiallyOutdated = Object.keys(dependencies).filter(dep => {
      const version = dependencies[dep];
      return version.startsWith('^') && !version.includes('0.0.') && !version.includes('1.0.');
    });
    
    return potentiallyOutdated.slice(0, 5).map(dep => ({
      package: dep,
      current: dependencies[dep],
      suggestion: 'Check npm outdated for latest version'
    }));
  }

  /**
   * Generate improvement recommendations
   */
  async generateRecommendations() {
    const recommendations = [];
    
    // Security recommendations
    const criticalSecurity = this.results.security.issues.filter(i => i.severity === 'critical');
    const highSecurity = this.results.security.issues.filter(i => i.severity === 'high');
    
    if (criticalSecurity.length > 0) {
      recommendations.push({
        priority: 'Critical',
        category: 'Security',
        title: 'Critical security vulnerabilities found',
        description: `${criticalSecurity.length} critical security issues require immediate attention`,
        impact: 'System compromise risk',
        action: 'Review and fix critical security issues immediately'
      });
    }
    
    if (highSecurity.length > 0) {
      recommendations.push({
        priority: 'High',
        category: 'Security', 
        title: 'High-priority security issues',
        description: `${highSecurity.length} high-priority security issues found`,
        impact: 'Data exposure risk',
        action: 'Review and remediate high-priority security findings'
      });
    }
    
    // Performance recommendations
    const performanceIssues = this.results.performance.issues.filter(i => i.severity === 'medium' || i.severity === 'high');
    if (performanceIssues.length > 3) {
      recommendations.push({
        priority: 'Medium',
        category: 'Performance',
        title: 'Performance optimization opportunities',
        description: `${performanceIssues.length} performance improvements identified`,
        impact: 'Better response times and resource usage',
        action: 'Review performance patterns and optimize hot paths'
      });
    }
    
    // Maintainability recommendations
    const complexFiles = Object.values(this.results.files).filter(f => f.complexity > 10);
    if (complexFiles.length > 0) {
      recommendations.push({
        priority: 'Low',
        category: 'Maintainability',
        title: 'High complexity functions detected',
        description: `${complexFiles.length} files with high cyclomatic complexity`,
        impact: 'Reduced maintainability and testing difficulty',
        action: 'Refactor complex functions into smaller, focused units'
      });
    }
    
    // Dependency recommendations
    if (this.results.dependencies.vulnerabilities?.length > 0) {
      recommendations.push({
        priority: 'High',
        category: 'Dependencies',
        title: 'Vulnerable dependencies found', 
        description: `${this.results.dependencies.vulnerabilities.length} packages with known issues`,
        impact: 'Supply chain security risk',
        action: 'Update or replace vulnerable dependencies'
      });
    }
    
    this.results.recommendations = recommendations;
  }

  /**
   * Calculate overall quality score
   */
  calculateOverallScore() {
    const securityWeight = 0.3;
    const performanceWeight = 0.25;
    const maintainabilityWeight = 0.25;
    const dependencyWeight = 0.2;
    
    // Calculate individual scores
    const securityScore = Math.max(0, 100 - (this.results.security.issues.length * 5));
    const performanceScore = Math.max(0, 100 - (this.results.performance.issues.length * 3));
    const maintainabilityScore = Math.max(0, 100 - (this.results.maintainability.issues.length * 2));
    const dependencyScore = this.results.dependencies.score || 100;
    
    const overall = Math.round(
      securityScore * securityWeight +
      performanceScore * performanceWeight +
      maintainabilityScore * maintainabilityWeight +
      dependencyScore * dependencyWeight
    );
    
    return Math.max(0, Math.min(100, overall));
  }

  /**
   * Display comprehensive results
   */
  displayResults() {
    const { overview, security, performance, maintainability, dependencies, recommendations } = this.results;
    
    console.log('📊 Code Quality Report\n');
    
    // Overview
    console.log(`📈 Overview:`);
    console.log(`  Files Scanned: ${overview.filesScanned}`);
    console.log(`  Total Lines: ${overview.totalLines.toLocaleString()}`);
    console.log(`  Analysis Time: ${overview.duration}`);
    console.log(`  Overall Score: ${overview.overallScore}/100 ${this.getScoreEmoji(overview.overallScore)}\n`);
    
    // Security
    console.log(`🔒 Security Analysis:`);
    console.log(`  Issues Found: ${security.issues.length}`);
    const criticalSec = security.issues.filter(i => i.severity === 'critical').length;
    const highSec = security.issues.filter(i => i.severity === 'high').length;
    console.log(`  Critical: ${criticalSec} | High: ${highSec}`);
    console.log(`  Score: ${Math.max(0, 100 - security.issues.length * 5)}/100\n`);
    
    // Performance
    console.log(`⚡ Performance Analysis:`);
    console.log(`  Issues Found: ${performance.issues.length}`);
    console.log(`  Score: ${Math.max(0, 100 - performance.issues.length * 3)}/100\n`);
    
    // Maintainability
    console.log(`🔧 Maintainability Analysis:`);
    console.log(`  Issues Found: ${maintainability.issues.length}`);
    console.log(`  Score: ${Math.max(0, 100 - maintainability.issues.length * 2)}/100\n`);
    
    // Dependencies
    if (dependencies.total) {
      console.log(`📦 Dependency Analysis:`);
      console.log(`  Total Dependencies: ${dependencies.total}`);
      console.log(`  Vulnerabilities: ${dependencies.vulnerabilities?.length || 0}`);
      console.log(`  Outdated: ${dependencies.outdated?.length || 0}`);
      console.log(`  Score: ${dependencies.score}/100\n`);
    }
    
    // Top Issues by Severity
    const allIssues = [...security.issues, ...performance.issues, ...maintainability.issues];
    const criticalIssues = allIssues.filter(i => i.severity === 'critical').slice(0, 3);
    const highIssues = allIssues.filter(i => i.severity === 'high').slice(0, 3);
    
    if (criticalIssues.length > 0) {
      console.log(`🚨 Critical Issues:`);
      criticalIssues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue.file}:${issue.line} - ${issue.message}`);
      });
      console.log();
    }
    
    if (highIssues.length > 0) {
      console.log(`⚠️  High Priority Issues:`);
      highIssues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue.file}:${issue.line} - ${issue.message}`);
      });
      console.log();
    }
    
    // Recommendations
    if (recommendations.length > 0) {
      console.log(`💡 Recommendations:`);
      recommendations.forEach((rec, i) => {
        console.log(`  ${i + 1}. [${rec.priority}] ${rec.title}`);
        console.log(`     Impact: ${rec.impact}`);
        console.log(`     Action: ${rec.action}\n`);
      });
    }
    
    // Summary
    const grade = this.getQualityGrade(overview.overallScore);
    console.log(`🎯 Overall Assessment: ${grade} (${overview.overallScore}/100)`);
  }

  getScoreEmoji(score) {
    if (score >= 90) return '🏆';
    if (score >= 80) return '✅';
    if (score >= 70) return '🟡';
    if (score >= 60) return '⚠️';
    return '🔴';
  }

  getQualityGrade(score) {
    if (score >= 90) return 'Excellent';
    if (score >= 80) return 'Good';
    if (score >= 70) return 'Satisfactory';
    if (score >= 60) return 'Needs Improvement';
    return 'Poor';
  }

  /**
   * Export results to file
   */
  exportResults() {
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `code-quality-report-${timestamp}.json`;
    
    fs.writeFileSync(filename, JSON.stringify(this.results, null, 2));
    console.log(`\n📁 Report exported to: ${filename}`);
  }

  shouldExclude(filePath) {
    return this.options.excludePatterns.some(pattern => 
      filePath.includes(pattern) || filePath.startsWith(pattern)
    );
  }

  shouldInclude(fileName) {
    return this.options.includeExtensions.some(ext => fileName.endsWith(ext));
  }

  isDocumentationFile(filePath) {
    const docExtensions = ['.md', '.txt', '.rst', '.adoc'];
    const docPaths = ['README', 'CHANGELOG', 'LICENSE', 'CONTRIBUTING'];
    
    // Exclude the code quality analyzer from analyzing itself (to avoid false positives from patterns)
    if (filePath.endsWith('code-quality-analyzer.js')) return true;
    
    return docExtensions.some(ext => filePath.toLowerCase().endsWith(ext)) ||
           docPaths.some(path => filePath.toUpperCase().includes(path));
  }

  isInComment(line) {
    const trimmed = line.trim();
    return trimmed.startsWith('//') || 
           trimmed.startsWith('/*') || 
           trimmed.startsWith('*') ||
           trimmed.startsWith('#') ||
           (trimmed.startsWith('-') && trimmed.includes('eval()')); // Markdown list with eval() mention
  }

  isDocumentationContext(line, pattern) {
    const lowerLine = line.toLowerCase();
    const patternStr = pattern.toString();
    
    // If checking for eval() and the line contains documentation keywords
    if (patternStr.includes('eval') && 
        (lowerLine.includes('no eval') || 
         lowerLine.includes('avoid eval') || 
         lowerLine.includes('prevent eval') ||
         lowerLine.includes('documentation') ||
         lowerLine.includes('example'))) {
      return true;
    }
    
    return false;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  const options = {
    fix: args.includes('--fix'),
    export: args.includes('--export'),
    verbose: args.includes('--verbose')
  };
  
  const analyzer = new CodeQualityAnalyzer(options);
  
  try {
    await analyzer.analyze('.');
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = CodeQualityAnalyzer;