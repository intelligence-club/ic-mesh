#!/usr/bin/env node
/**
 * IC Mesh Code Optimization Analyzer
 * 
 * Analyzes JavaScript code for optimization opportunities:
 * - Function complexity analysis
 * - Unused variable detection
 * - Performance anti-patterns
 * - Memory leak potential
 * - Code duplication detection
 * 
 * Usage:
 *   node scripts/optimize-code.js [options] [files...]
 *   
 * Options:
 *   --fix            Apply automatic fixes where possible
 *   --report=<file>  Save analysis report to file
 *   --threshold=<n>  Complexity threshold (default: 10)
 *   --exclude=<pattern> Exclude files matching pattern
 */

const fs = require('fs');
const path = require('path');

// Configuration
const COMPLEXITY_THRESHOLD = parseInt(process.argv.find(arg => arg.startsWith('--threshold='))?.split('=')[1]) || 10;
const REPORT_FILE = process.argv.find(arg => arg.startsWith('--report='))?.split('=')[1];
const AUTO_FIX = process.argv.includes('--fix');
const EXCLUDE_PATTERN = process.argv.find(arg => arg.startsWith('--exclude='))?.split('=')[1] || 'node_modules';

let analysis = {
  files: [],
  summary: {
    filesAnalyzed: 0,
    issuesFound: 0,
    fixesApplied: 0,
    potentialSavings: {
      linesRemoved: 0,
      functionsSimplified: 0,
      duplicatesRemoved: 0
    }
  },
  issues: []
};

function log(message) {
  console.log(message);
}

function addIssue(file, type, line, description, suggestion, severity = 'medium') {
  const issue = {
    file,
    type,
    line,
    description,
    suggestion,
    severity,
    fixable: false
  };
  
  analysis.issues.push(issue);
  analysis.summary.issuesFound++;
  
  return issue;
}

function analyzeComplexity(content, filePath) {
  const lines = content.split('\n');
  const functions = [];
  
  let currentFunction = null;
  let braceCount = 0;
  let complexity = 0;
  
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    
    // Detect function declarations
    if (trimmed.match(/^(function|const\s+\w+\s*=\s*function|\w+\s*:\s*function)/)) {
      if (currentFunction) {
        functions.push(currentFunction);
      }
      
      currentFunction = {
        name: extractFunctionName(trimmed),
        startLine: index + 1,
        complexity: 1,
        lines: 0
      };
      braceCount = 0;
      complexity = 1;
    }
    
    if (currentFunction) {
      currentFunction.lines++;
      
      // Count complexity indicators
      if (trimmed.match(/\b(if|while|for|switch|catch|&&|\|\||\?)\b/)) {
        complexity++;
      }
      
      // Track brace levels
      if (trimmed.includes('{')) braceCount++;
      if (trimmed.includes('}')) {
        braceCount--;
        if (braceCount <= 0 && currentFunction) {
          currentFunction.complexity = complexity;
          currentFunction.endLine = index + 1;
          functions.push(currentFunction);
          currentFunction = null;
        }
      }
    }
  });
  
  // Check for overly complex functions
  functions.forEach(func => {
    if (func.complexity > COMPLEXITY_THRESHOLD) {
      addIssue(
        filePath,
        'complexity',
        func.startLine,
        `Function '${func.name}' has high complexity (${func.complexity})`,
        'Consider breaking this function into smaller, more focused functions',
        'high'
      );
    }
    
    if (func.lines > 50) {
      addIssue(
        filePath,
        'length',
        func.startLine,
        `Function '${func.name}' is very long (${func.lines} lines)`,
        'Consider splitting this function into smaller functions',
        'medium'
      );
    }
  });
  
  return functions;
}

function extractFunctionName(line) {
  // Extract function name from various declaration patterns
  let match = line.match(/function\s+(\w+)/);
  if (match) return match[1];
  
  match = line.match(/const\s+(\w+)\s*=/);
  if (match) return match[1];
  
  match = line.match(/(\w+)\s*:/);
  if (match) return match[1];
  
  return 'anonymous';
}

function analyzeUnusedVariables(content, filePath) {
  const lines = content.split('\n');
  const variables = new Map();
  const used = new Set();
  
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    
    // Find variable declarations
    const declarations = trimmed.match(/\b(?:const|let|var)\s+(\w+)/g);
    if (declarations) {
      declarations.forEach(decl => {
        const varName = decl.split(/\s+/)[1];
        if (!variables.has(varName)) {
          variables.set(varName, index + 1);
        }
      });
    }
    
    // Find variable usage (simple pattern matching)
    const words = trimmed.match(/\b\w+\b/g) || [];
    words.forEach(word => {
      if (variables.has(word)) {
        used.add(word);
      }
    });
  });
  
  // Report unused variables
  variables.forEach((lineNumber, varName) => {
    if (!used.has(varName) && !varName.startsWith('_')) {
      const issue = addIssue(
        filePath,
        'unused-variable',
        lineNumber,
        `Variable '${varName}' is declared but never used`,
        'Remove unused variable or prefix with underscore if intentionally unused',
        'low'
      );
      issue.fixable = true;
    }
  });
}

function analyzePerformancePatterns(content, filePath) {
  const lines = content.split('\n');
  
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    
    // Detect inefficient patterns
    if (trimmed.includes('JSON.parse(JSON.stringify(')) {
      addIssue(
        filePath,
        'performance',
        index + 1,
        'Inefficient deep cloning using JSON.parse/stringify',
        'Consider using a proper deep clone library or structured cloning',
        'medium'
      );
    }
    
    if (trimmed.match(/for\s*\([^)]*\.length/)) {
      addIssue(
        filePath,
        'performance',
        index + 1,
        'Array length accessed in loop condition',
        'Cache array length in a variable before the loop',
        'low'
      );
    }
    
    if (trimmed.includes('new Date().getTime()')) {
      const issue = addIssue(
        filePath,
        'performance',
        index + 1,
        'Inefficient timestamp creation',
        'Use Date.now() instead of new Date().getTime()',
        'low'
      );
      issue.fixable = true;
    }
    
    if (trimmed.match(/setInterval\s*\([^,]*,\s*[0-9]+\s*\)/)) {
      const interval = trimmed.match(/,\s*([0-9]+)\s*\)/)?.[1];
      if (interval && parseInt(interval) < 100) {
        addIssue(
          filePath,
          'performance',
          index + 1,
          `Very frequent timer interval (${interval}ms)`,
          'Consider if such frequent updates are necessary for performance',
          'medium'
        );
      }
    }
  });
}

function detectCodeDuplication(content, filePath) {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 10);
  const lineGroups = new Map();
  
  // Group similar lines
  lines.forEach((line, index) => {
    const normalized = line.replace(/\s+/g, ' ').replace(/['"`]/g, '"');
    if (!lineGroups.has(normalized)) {
      lineGroups.set(normalized, []);
    }
    lineGroups.get(normalized).push(index + 1);
  });
  
  // Find duplicated code
  lineGroups.forEach((lineNumbers, code) => {
    if (lineNumbers.length > 2) {
      addIssue(
        filePath,
        'duplication',
        lineNumbers[0],
        `Code duplicated ${lineNumbers.length} times: "${code.substring(0, 50)}..."`,
        'Consider extracting to a reusable function',
        'medium'
      );
    }
  });
}

function analyzeMemoryLeaks(content, filePath) {
  const lines = content.split('\n');
  
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    
    // Event listeners without cleanup
    if (trimmed.includes('addEventListener') && !trimmed.includes('removeEventListener')) {
      addIssue(
        filePath,
        'memory-leak',
        index + 1,
        'Event listener added without corresponding cleanup',
        'Ensure removeEventListener is called when no longer needed',
        'medium'
      );
    }
    
    // Timers without cleanup
    if (trimmed.match(/setInterval|setTimeout/) && !content.includes('clearInterval') && !content.includes('clearTimeout')) {
      addIssue(
        filePath,
        'memory-leak',
        index + 1,
        'Timer created without cleanup mechanism',
        'Store timer reference and clear when no longer needed',
        'medium'
      );
    }
    
    // Global variable assignment
    if (trimmed.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*\s*=/) && !trimmed.includes('const') && !trimmed.includes('let') && !trimmed.includes('var')) {
      addIssue(
        filePath,
        'memory-leak',
        index + 1,
        'Potential global variable assignment',
        'Use proper variable declaration (const, let, var)',
        'low'
      );
    }
  });
}

function applyAutomaticFixes(content, filePath) {
  let fixedContent = content;
  let fixCount = 0;
  
  // Fix Date.now() optimization
  fixedContent = fixedContent.replace(/new Date\(\)\.getTime\(\)/g, () => {
    fixCount++;
    return 'Date.now()';
  });
  
  // Fix simple unused variable patterns (very basic)
  const lines = fixedContent.split('\n');
  const unusedVarPattern = /^\s*(const|let|var)\s+(\w+)\s*=.*$/;
  
  // This is a very basic fix - in practice, you'd need more sophisticated analysis
  lines.forEach((line, index) => {
    const match = line.match(unusedVarPattern);
    if (match) {
      const varName = match[2];
      const restOfFile = lines.slice(index + 1).join('\n');
      if (!restOfFile.includes(varName) && !varName.startsWith('_')) {
        lines[index] = `// REMOVED: ${line.trim()} // Unused variable`;
        fixCount++;
      }
    }
  });
  
  if (fixCount > 0) {
    fixedContent = lines.join('\n');
    analysis.summary.fixesApplied += fixCount;
    
    if (AUTO_FIX) {
      fs.writeFileSync(filePath, fixedContent);
      log(`✅ Applied ${fixCount} automatic fixes to ${filePath}`);
    }
  }
  
  return { content: fixedContent, fixes: fixCount };
}

function analyzeFile(filePath) {
  if (!fs.existsSync(filePath)) {
    log(`❌ File not found: ${filePath}`);
    return;
  }
  
  log(`🔍 Analyzing: ${filePath}`);
  
  const content = fs.readFileSync(filePath, 'utf8');
  const fileAnalysis = {
    path: filePath,
    size: content.length,
    lines: content.split('\n').length,
    functions: [],
    issues: []
  };
  
  // Run analysis
  fileAnalysis.functions = analyzeComplexity(content, filePath);
  analyzeUnusedVariables(content, filePath);
  analyzePerformancePatterns(content, filePath);
  detectCodeDuplication(content, filePath);
  analyzeMemoryLeaks(content, filePath);
  
  // Apply fixes if requested
  if (AUTO_FIX) {
    const fixResult = applyAutomaticFixes(content, filePath);
    fileAnalysis.fixes = fixResult.fixes;
  }
  
  analysis.files.push(fileAnalysis);
  analysis.summary.filesAnalyzed++;
}

function findJavaScriptFiles(directory) {
  const files = [];
  
  function scanDirectory(dir) {
    const entries = fs.readdirSync(dir);
    
    entries.forEach(entry => {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        if (!entry.includes(EXCLUDE_PATTERN)) {
          scanDirectory(fullPath);
        }
      } else if (entry.endsWith('.js') && !entry.includes('.min.') && !entry.includes('.test.')) {
        files.push(fullPath);
      }
    });
  }
  
  scanDirectory(directory);
  return files;
}

function generateReport() {
  const report = {
    timestamp: new Date().toISOString(),
    summary: analysis.summary,
    issuesByType: {},
    issuesBySeverity: {},
    recommendations: []
  };
  
  // Group issues by type and severity
  analysis.issues.forEach(issue => {
    if (!report.issuesByType[issue.type]) {
      report.issuesByType[issue.type] = 0;
    }
    report.issuesByType[issue.type]++;
    
    if (!report.issuesBySeverity[issue.severity]) {
      report.issuesBySeverity[issue.severity] = 0;
    }
    report.issuesBySeverity[issue.severity]++;
  });
  
  // Generate recommendations
  if (report.issuesByType.complexity > 0) {
    report.recommendations.push('Consider refactoring complex functions to improve maintainability');
  }
  
  if (report.issuesByType.duplication > 0) {
    report.recommendations.push('Extract duplicated code into reusable functions');
  }
  
  if (report.issuesByType['memory-leak'] > 0) {
    report.recommendations.push('Review event listeners and timers for proper cleanup');
  }
  
  if (report.issuesByType.performance > 0) {
    report.recommendations.push('Optimize performance bottlenecks identified in the analysis');
  }
  
  // Save report
  if (REPORT_FILE) {
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ ...report, detailedIssues: analysis.issues }, null, 2));
    log(`📊 Report saved to: ${REPORT_FILE}`);
  }
  
  // Console output
  console.log('\n=== CODE OPTIMIZATION ANALYSIS ===');
  console.log(`Files analyzed: ${analysis.summary.filesAnalyzed}`);
  console.log(`Issues found: ${analysis.summary.issuesFound}`);
  console.log(`Fixes applied: ${analysis.summary.fixesApplied}`);
  console.log('');
  
  console.log('Issues by type:');
  Object.entries(report.issuesByType).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
  console.log('');
  
  console.log('Issues by severity:');
  Object.entries(report.issuesBySeverity).forEach(([severity, count]) => {
    console.log(`  ${severity}: ${count}`);
  });
  console.log('');
  
  if (report.recommendations.length > 0) {
    console.log('Recommendations:');
    report.recommendations.forEach((rec, index) => {
      console.log(`  ${index + 1}. ${rec}`);
    });
    console.log('');
  }
  
  if (analysis.issues.filter(i => i.severity === 'high').length > 0) {
    console.log('High priority issues:');
    analysis.issues
      .filter(i => i.severity === 'high')
      .slice(0, 5)
      .forEach(issue => {
        console.log(`  ${issue.file}:${issue.line} - ${issue.description}`);
      });
    console.log('');
  }
  
  console.log('====================================');
}

// Main execution
const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const command = args[0] || 'analyze';

switch (command) {
  case 'analyze':
    const targetFiles = args.slice(1);
    
    if (targetFiles.length > 0) {
      // Analyze specific files
      targetFiles.forEach(analyzeFile);
    } else {
      // Analyze all JS files in current directory
      const jsFiles = findJavaScriptFiles(path.join(__dirname, '..'));
      jsFiles.forEach(analyzeFile);
    }
    
    generateReport();
    break;
    
  case 'help':
  default:
    console.log(`
IC Mesh Code Optimization Analyzer

Usage: node scripts/optimize-code.js [command] [options] [files...]

Commands:
  analyze   - Analyze code for optimization opportunities (default)
  help      - Show this help message

Options:
  --fix                Apply automatic fixes where possible
  --report=<file>      Save detailed analysis report to file
  --threshold=<n>      Complexity threshold (default: 10)
  --exclude=<pattern>  Exclude files matching pattern (default: 'node_modules')

Examples:
  node scripts/optimize-code.js analyze
  node scripts/optimize-code.js analyze server.js client.js
  node scripts/optimize-code.js analyze --fix --report=optimization-report.json
  node scripts/optimize-code.js analyze --threshold=15 --exclude=test

Analysis Types:
  - Function complexity (cyclomatic complexity)
  - Unused variable detection
  - Performance anti-patterns
  - Code duplication detection
  - Memory leak potential

Automatic Fixes Available:
  - Date.now() optimization
  - Basic unused variable removal
  - Simple performance improvements
`);
}