#!/usr/bin/env node
/**
 * IC Mesh Error Diagnostic Helper
 * 
 * Provides intelligent error analysis, user-friendly explanations,
 * and actionable troubleshooting guidance for common IC Mesh issues.
 * 
 * Features:
 * - Pattern-based error classification
 * - Contextual troubleshooting steps
 * - User-friendly error translations
 * - Automated fix suggestions
 * - Knowledge base integration
 * - Support ticket auto-generation
 * 
 * Usage: node error-diagnostic-helper.js [--analyze <logfile>] [--explain <error>] [--interactive]
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Error classification patterns
const ERROR_PATTERNS = {
  'connection_timeout': {
    patterns: [
      /ECONNREFUSED/,
      /connection.*timeout/i,
      /connect.*ECONNRESET/,
      /socket.*timeout/i
    ],
    severity: 'medium',
    category: 'connectivity',
    description: 'Network connection issues preventing communication',
    commonCauses: [
      'Network connectivity problems',
      'Firewall blocking connections', 
      'Service not running or misconfigured',
      'DNS resolution failures'
    ],
    troubleshooting: [
      'Check network connectivity with ping/traceroute',
      'Verify firewall settings and open required ports',
      'Confirm IC Mesh server is running and accessible',
      'Test DNS resolution for the target host',
      'Check for proxy or network policy restrictions'
    ],
    autoFixes: [
      'restart_network_service',
      'flush_dns_cache', 
      'reset_firewall_rules'
    ]
  },

  'authentication_failed': {
    patterns: [
      /unauthorized/i,
      /invalid.*api.*key/i,
      /authentication.*failed/i,
      /401.*unauthorized/i,
      /forbidden.*access/i
    ],
    severity: 'high',
    category: 'authentication',
    description: 'API authentication or authorization failures',
    commonCauses: [
      'Invalid or expired API key',
      'Incorrect API key format or encoding',
      'Insufficient permissions for requested operation',
      'API key not properly included in request headers'
    ],
    troubleshooting: [
      'Verify API key is correct and not expired',
      'Check API key format (should be 32+ character string)',
      'Ensure X-Api-Key header is properly set in requests',
      'Confirm account has sufficient permissions',
      'Generate new API key if current one is compromised'
    ],
    autoFixes: [
      'regenerate_api_key',
      'validate_key_format',
      'check_permissions'
    ]
  },

  'job_processing_failed': {
    patterns: [
      /job.*failed/i,
      /processing.*error/i,
      /compute.*failed/i,
      /node.*crashed/i,
      /timeout.*processing/i
    ],
    severity: 'high',
    category: 'processing',
    description: 'Job execution or processing failures on compute nodes',
    commonCauses: [
      'Insufficient node resources (CPU, RAM, disk)',
      'Node software bugs or compatibility issues',
      'Input data format problems',
      'Node disconnection during processing',
      'Resource contention with other jobs'
    ],
    troubleshooting: [
      'Check node resource utilization and availability',
      'Verify input data format and size limits',
      'Review node logs for specific error details',
      'Test with smaller or different job payloads',
      'Ensure nodes have required capabilities for job type'
    ],
    autoFixes: [
      'restart_failed_nodes',
      'clear_job_queue',
      'optimize_resource_allocation'
    ]
  },

  'database_errors': {
    patterns: [
      /database.*error/i,
      /sqlite.*busy/i,
      /constraint.*failed/i,
      /transaction.*failed/i,
      /SQLITE_BUSY/,
      /database.*locked/i
    ],
    severity: 'critical',
    category: 'database',
    description: 'Database connectivity or integrity issues',
    commonCauses: [
      'Database file corruption or permission issues',
      'Concurrent access conflicts',
      'Disk space exhaustion',
      'Database schema version mismatches',
      'Lock contention from multiple processes'
    ],
    troubleshooting: [
      'Check database file permissions and integrity', 
      'Verify adequate disk space for database operations',
      'Review database schema version compatibility',
      'Identify and resolve lock contention issues',
      'Consider database backup and restore if corrupted'
    ],
    autoFixes: [
      'repair_database_integrity',
      'optimize_database_locks',
      'backup_and_restore'
    ]
  },

  'resource_exhaustion': {
    patterns: [
      /out.*of.*memory/i,
      /disk.*full/i,
      /ENOMEM/,
      /ENOSPC/,
      /resource.*unavailable/i,
      /capacity.*exceeded/i
    ],
    severity: 'critical',
    category: 'resources',
    description: 'System resource exhaustion (memory, disk, CPU)',
    commonCauses: [
      'Insufficient server resources for current load',
      'Memory leaks in application code',
      'Disk space consumed by logs or temporary files',
      'CPU bottlenecks during peak usage',
      'Network bandwidth saturation'
    ],
    troubleshooting: [
      'Monitor system resource usage (CPU, RAM, disk)',
      'Clean up temporary files and old logs',
      'Optimize application memory usage',
      'Scale resources or optimize job scheduling',
      'Implement resource usage monitoring and alerts'
    ],
    autoFixes: [
      'cleanup_temp_files',
      'restart_services',
      'optimize_memory_usage'
    ]
  },

  'node_coordination_issues': {
    patterns: [
      /node.*not.*responding/i,
      /heartbeat.*failed/i,
      /node.*disconnected/i,
      /mesh.*coordination.*error/i,
      /cluster.*split/i
    ],
    severity: 'medium',
    category: 'coordination',
    description: 'Node coordination and mesh networking problems',
    commonCauses: [
      'Network partitions between nodes',
      'Node software crashes or hangs',
      'Clock synchronization issues',
      'Coordination server overload',
      'Configuration mismatches between nodes'
    ],
    troubleshooting: [
      'Verify network connectivity between all nodes',
      'Check system clock synchronization across nodes',
      'Review coordination server logs for errors',
      'Restart unresponsive nodes',
      'Validate node configuration consistency'
    ],
    autoFixes: [
      'restart_coordination_service',
      'synchronize_node_clocks',
      'repair_network_partitions'
    ]
  }
};

// User-friendly error messages
const USER_FRIENDLY_MESSAGES = {
  'ECONNREFUSED': 'Unable to connect to the IC Mesh server. The service might be offline or unreachable.',
  'ENOTFOUND': 'Server not found. Please check the server address and your internet connection.',
  'ETIMEDOUT': 'Connection timed out. The server is taking too long to respond.',
  'UNAUTHORIZED': 'Access denied. Please check your API key or login credentials.',
  'FORBIDDEN': 'You don\'t have permission to perform this action.',
  'ENOSPC': 'Server is out of disk space. Please contact support.',
  'ENOMEM': 'Server is out of memory. Please try again later.',
  'SQLITE_BUSY': 'Database is temporarily busy. Please retry in a moment.'
};

// Troubleshooting steps templates
const TROUBLESHOOTING_TEMPLATES = {
  network_connectivity: [
    'Test basic connectivity: ping {server_host}',
    'Check DNS resolution: nslookup {server_host}',
    'Verify port accessibility: telnet {server_host} {server_port}',
    'Review firewall logs for blocked connections',
    'Test from different network location'
  ],
  
  api_authentication: [
    'Verify API key format and length (should be 32+ characters)',
    'Check request headers include: X-Api-Key: your_api_key',
    'Confirm API key has not expired',
    'Test API key with curl: curl -H "X-Api-Key: {api_key}" {api_endpoint}',
    'Generate new API key if current one is invalid'
  ],
  
  job_debugging: [
    'Check job payload format and size limits',
    'Review job logs for specific error messages',
    'Test with minimal payload to isolate issues',
    'Verify node capabilities match job requirements',
    'Monitor node resource usage during job execution'
  ],
  
  database_recovery: [
    'Check database file permissions: ls -la {db_path}',
    'Test database integrity: sqlite3 {db_path} "PRAGMA integrity_check;"',
    'Review disk space: df -h {db_directory}',
    'Backup current database before making changes',
    'Consider database vacuum/optimization if performance is slow'
  ]
};

class ErrorDiagnosticHelper {
  constructor(options = {}) {
    this.dbPath = options.dbPath || './mesh.db';
    this.logPath = options.logPath || './logs';
    this.verbose = options.verbose || false;
    this.knowledgeBase = new Map();
    this.initializeKnowledgeBase();
  }

  /**
   * Initialize error pattern knowledge base
   */
  initializeKnowledgeBase() {
    // Load historical error patterns from database
    try {
      if (fs.existsSync(this.dbPath)) {
        const db = new Database(this.dbPath, { readonly: true });
        const errorHistory = db.prepare(`
          SELECT error_message, COUNT(*) as frequency
          FROM jobs 
          WHERE error_message IS NOT NULL 
          GROUP BY error_message 
          ORDER BY frequency DESC
          LIMIT 100
        `).all();

        errorHistory.forEach(error => {
          this.knowledgeBase.set(error.error_message, {
            frequency: error.frequency,
            pattern: this.classifyError(error.error_message),
            lastSeen: new Date()
          });
        });
        db.close();
      }
    } catch (error) {
      console.warn('Could not load error history:', error.message);
    }
  }

  /**
   * Analyze error message and provide comprehensive diagnostic
   */
  analyzeError(errorMessage, context = {}) {
    const classification = this.classifyError(errorMessage);
    const userFriendlyMsg = this.translateError(errorMessage);
    const troubleshootingSteps = this.generateTroubleshootingSteps(classification, context);
    const autoFixes = this.getAutoFixSuggestions(classification);
    const similarErrors = this.findSimilarErrors(errorMessage);

    return {
      original: errorMessage,
      userFriendly: userFriendlyMsg,
      classification: classification,
      severity: classification?.severity || 'unknown',
      category: classification?.category || 'general',
      troubleshooting: troubleshootingSteps,
      autoFixes: autoFixes,
      similarErrors: similarErrors,
      supportTicket: this.generateSupportTicketTemplate(errorMessage, classification, context),
      nextSteps: this.getNextSteps(classification)
    };
  }

  /**
   * Classify error based on patterns
   */
  classifyError(errorMessage) {
    for (const [type, config] of Object.entries(ERROR_PATTERNS)) {
      if (config.patterns.some(pattern => pattern.test(errorMessage))) {
        return { type, ...config };
      }
    }
    
    return {
      type: 'unknown',
      severity: 'medium',
      category: 'general',
      description: 'Unclassified error requiring manual investigation',
      commonCauses: ['Application bug', 'Unexpected system state', 'External dependency issue'],
      troubleshooting: ['Review full error context and logs', 'Contact support with error details']
    };
  }

  /**
   * Translate technical error to user-friendly message
   */
  translateError(errorMessage) {
    // Check for exact matches first
    for (const [pattern, message] of Object.entries(USER_FRIENDLY_MESSAGES)) {
      if (errorMessage.includes(pattern)) {
        return message;
      }
    }

    // Pattern-based translation
    if (/timeout/i.test(errorMessage)) {
      return 'The operation timed out. The server might be overloaded or unreachable.';
    }
    if (/unauthorized|forbidden/i.test(errorMessage)) {
      return 'Access was denied. Please check your credentials or permissions.';
    }
    if (/not.*found|404/i.test(errorMessage)) {
      return 'The requested resource was not found. Please check the URL or resource ID.';
    }
    if (/server.*error|500/i.test(errorMessage)) {
      return 'An internal server error occurred. Please try again or contact support.';
    }

    // Generic fallback
    return `An error occurred: ${errorMessage}. Please check the troubleshooting steps below.`;
  }

  /**
   * Generate contextual troubleshooting steps
   */
  generateTroubleshootingSteps(classification, context) {
    if (!classification) return ['Review error message and check system status'];

    const steps = [...classification.troubleshooting];
    
    // Add context-specific steps
    if (context.endpoint) {
      steps.unshift(`Verify endpoint is correct: ${context.endpoint}`);
    }
    if (context.nodeId) {
      steps.push(`Check specific node status: ${context.nodeId}`);
    }
    if (context.jobId) {
      steps.push(`Review job details: ${context.jobId}`);
    }

    // Add general debugging steps
    steps.push(
      'Check server status and recent system changes',
      'Review application logs for additional context',
      'Test with a minimal reproduction case',
      'Contact support if issue persists'
    );

    return steps;
  }

  /**
   * Get automated fix suggestions
   */
  getAutoFixSuggestions(classification) {
    if (!classification || !classification.autoFixes) return [];

    const fixes = [];
    
    classification.autoFixes.forEach(fixType => {
      switch (fixType) {
        case 'restart_network_service':
          fixes.push({
            action: 'Restart Network Service',
            command: 'sudo systemctl restart networking',
            description: 'Restart network services to resolve connectivity issues',
            risk: 'low'
          });
          break;
          
        case 'regenerate_api_key':
          fixes.push({
            action: 'Regenerate API Key', 
            description: 'Generate a new API key through the account dashboard',
            url: 'https://moilol.com/account.html',
            risk: 'low'
          });
          break;
          
        case 'restart_failed_nodes':
          fixes.push({
            action: 'Restart Failed Nodes',
            command: 'node restart-failed-nodes.js',
            description: 'Automatically restart nodes that have failed or become unresponsive',
            risk: 'medium'
          });
          break;
          
        case 'cleanup_temp_files':
          fixes.push({
            action: 'Clean Temporary Files',
            command: 'find /tmp -type f -mtime +7 -delete',
            description: 'Remove old temporary files to free disk space',
            risk: 'low'
          });
          break;
      }
    });

    return fixes;
  }

  /**
   * Find similar errors from knowledge base
   */
  findSimilarErrors(errorMessage) {
    const similar = [];
    const words = errorMessage.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    
    for (const [knownError, data] of this.knowledgeBase) {
      const knownWords = knownError.toLowerCase().split(/\W+/).filter(w => w.length > 3);
      const commonWords = words.filter(w => knownWords.includes(w));
      
      if (commonWords.length >= 2) {
        similar.push({
          error: knownError,
          frequency: data.frequency,
          similarity: commonWords.length / Math.max(words.length, knownWords.length),
          pattern: data.pattern?.type || 'unknown'
        });
      }
    }
    
    return similar.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  }

  /**
   * Generate support ticket template
   */
  generateSupportTicketTemplate(errorMessage, classification, context) {
    const template = {
      subject: `${classification?.category || 'System'} Error: ${errorMessage.slice(0, 60)}...`,
      priority: classification?.severity === 'critical' ? 'high' : 'normal',
      category: classification?.category || 'technical',
      body: this.buildSupportTicketBody(errorMessage, classification, context),
      tags: [
        classification?.category,
        classification?.type,
        classification?.severity
      ].filter(Boolean)
    };

    return template;
  }

  /**
   * Build detailed support ticket body
   */
  buildSupportTicketBody(errorMessage, classification, context) {
    let body = '## Error Report\n\n';
    body += `**Error Message:** ${errorMessage}\n\n`;
    body += `**Error Type:** ${classification?.type || 'Unknown'}\n`;
    body += `**Severity:** ${classification?.severity || 'Unknown'}\n`;
    body += `**Category:** ${classification?.category || 'Unknown'}\n\n`;

    if (context.jobId) {
      body += `**Job ID:** ${context.jobId}\n`;
    }
    if (context.nodeId) {
      body += `**Node ID:** ${context.nodeId}\n`;
    }
    if (context.endpoint) {
      body += `**Endpoint:** ${context.endpoint}\n`;
    }
    if (context.timestamp) {
      body += `**Timestamp:** ${new Date(context.timestamp).toISOString()}\n`;
    }

    body += '\n## Context\n\n';
    body += '<!-- Please provide additional context about what you were trying to do when this error occurred -->\n\n';

    body += '## Steps to Reproduce\n\n';
    body += '1. <!-- Please list the steps that led to this error -->\n';
    body += '2. \n';
    body += '3. \n\n';

    body += '## Expected vs Actual Behavior\n\n';
    body += '**Expected:** <!-- What should have happened -->\n';
    body += '**Actual:** <!-- What actually happened -->\n\n';

    if (classification?.troubleshooting) {
      body += '## Troubleshooting Steps Already Tried\n\n';
      classification.troubleshooting.slice(0, 3).forEach((step, i) => {
        body += `- [ ] ${step}\n`;
      });
      body += '\n';
    }

    body += '## System Information\n\n';
    body += '- **Operating System:** \n';
    body += '- **Browser/Client:** \n';
    body += '- **IC Mesh Version:** \n';
    body += '- **Additional Details:** \n\n';

    return body;
  }

  /**
   * Get recommended next steps
   */
  getNextSteps(classification) {
    if (!classification) {
      return [
        'Document the error and when it occurs',
        'Check system logs for additional context',
        'Contact support with full error details'
      ];
    }

    const steps = [];
    
    switch (classification.severity) {
      case 'critical':
        steps.push(
          'Take immediate action to resolve the issue',
          'Implement temporary workarounds if available',
          'Contact support immediately for assistance'
        );
        break;
        
      case 'high':
        steps.push(
          'Prioritize resolution within 24 hours',
          'Try suggested troubleshooting steps',
          'Escalate to support if not resolved quickly'
        );
        break;
        
      case 'medium':
        steps.push(
          'Schedule time to investigate within a few days',
          'Try automated fixes if available',
          'Monitor for pattern or frequency increase'
        );
        break;
        
      default:
        steps.push(
          'Document for future reference',
          'Monitor if error becomes more frequent',
          'Include in routine maintenance review'
        );
    }

    return steps;
  }

  /**
   * Interactive error analysis session
   */
  async runInteractiveSession() {
    console.log('🔧 IC Mesh Error Diagnostic Helper');
    console.log('=====================================\n');

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (prompt) => new Promise((resolve) => {
      rl.question(prompt, resolve);
    });

    try {
      console.log('Welcome to the interactive error diagnostic session!');
      console.log('I\'ll help you understand and troubleshoot IC Mesh errors.\n');

      const errorMessage = await question('Please enter the error message: ');
      if (!errorMessage.trim()) {
        console.log('No error message provided. Exiting...');
        return;
      }

      const context = {};
      
      const hasJobId = await question('Do you have a job ID related to this error? (y/n): ');
      if (hasJobId.toLowerCase() === 'y') {
        context.jobId = await question('Job ID: ');
      }

      const hasNodeId = await question('Do you have a node ID related to this error? (y/n): ');
      if (hasNodeId.toLowerCase() === 'y') {
        context.nodeId = await question('Node ID: ');
      }

      const hasEndpoint = await question('Was this error from a specific API endpoint? (y/n): ');
      if (hasEndpoint.toLowerCase() === 'y') {
        context.endpoint = await question('Endpoint: ');
      }

      console.log('\n🔍 Analyzing error...\n');

      const analysis = this.analyzeError(errorMessage, context);
      this.displayAnalysis(analysis);

      const wantTicket = await question('\nWould you like me to generate a support ticket template? (y/n): ');
      if (wantTicket.toLowerCase() === 'y') {
        this.displaySupportTicket(analysis.supportTicket);
      }

    } catch (error) {
      console.error('Error during interactive session:', error.message);
    } finally {
      rl.close();
    }
  }

  /**
   * Display comprehensive error analysis
   */
  displayAnalysis(analysis) {
    console.log('📋 ERROR ANALYSIS REPORT');
    console.log('========================\n');

    console.log(`🔍 Original Error: ${analysis.original}\n`);
    console.log(`💬 User-Friendly: ${analysis.userFriendly}\n`);

    console.log(`📊 Classification:`);
    console.log(`   Type: ${analysis.classification.type}`);
    console.log(`   Severity: ${this.formatSeverity(analysis.severity)}`);
    console.log(`   Category: ${analysis.category}\n`);

    if (analysis.classification.description) {
      console.log(`📝 Description: ${analysis.classification.description}\n`);
    }

    if (analysis.classification.commonCauses?.length > 0) {
      console.log(`🔍 Common Causes:`);
      analysis.classification.commonCauses.forEach(cause => {
        console.log(`   • ${cause}`);
      });
      console.log();
    }

    if (analysis.troubleshooting?.length > 0) {
      console.log(`🛠️  Troubleshooting Steps:`);
      analysis.troubleshooting.forEach((step, i) => {
        console.log(`   ${i + 1}. ${step}`);
      });
      console.log();
    }

    if (analysis.autoFixes?.length > 0) {
      console.log(`⚡ Automated Fixes Available:`);
      analysis.autoFixes.forEach(fix => {
        console.log(`   🔧 ${fix.action}`);
        console.log(`      ${fix.description}`);
        if (fix.command) {
          console.log(`      Command: ${fix.command}`);
        }
        if (fix.url) {
          console.log(`      URL: ${fix.url}`);
        }
        console.log(`      Risk Level: ${fix.risk}`);
      });
      console.log();
    }

    if (analysis.similarErrors?.length > 0) {
      console.log(`🔗 Similar Errors:`);
      analysis.similarErrors.forEach(similar => {
        console.log(`   • ${similar.error} (${similar.frequency}x, ${Math.round(similar.similarity * 100)}% similar)`);
      });
      console.log();
    }

    console.log(`📋 Next Steps:`);
    analysis.nextSteps.forEach((step, i) => {
      console.log(`   ${i + 1}. ${step}`);
    });
    console.log();
  }

  /**
   * Display support ticket template
   */
  displaySupportTicket(ticket) {
    console.log('\n📧 SUPPORT TICKET TEMPLATE');
    console.log('==========================\n');
    
    console.log(`Subject: ${ticket.subject}`);
    console.log(`Priority: ${ticket.priority}`);
    console.log(`Category: ${ticket.category}`);
    console.log(`Tags: ${ticket.tags.join(', ')}\n`);
    console.log('Body:');
    console.log('-----');
    console.log(ticket.body);
  }

  formatSeverity(severity) {
    const icons = {
      'critical': '🔴 Critical',
      'high': '🟠 High',
      'medium': '🟡 Medium', 
      'low': '🟢 Low',
      'unknown': '⚪ Unknown'
    };
    return icons[severity] || severity;
  }

  /**
   * Analyze log file for errors
   */
  analyzeLogFile(logFilePath) {
    if (!fs.existsSync(logFilePath)) {
      console.error(`Log file not found: ${logFilePath}`);
      return;
    }

    console.log(`📄 Analyzing log file: ${logFilePath}\n`);

    const logContent = fs.readFileSync(logFilePath, 'utf8');
    const lines = logContent.split('\n');
    const errors = [];

    // Extract error lines
    lines.forEach((line, lineNum) => {
      if (/error|Error|ERROR|fail|Failed|FAIL/i.test(line)) {
        const analysis = this.analyzeError(line, { line: lineNum + 1, file: logFilePath });
        errors.push({ line: lineNum + 1, content: line, analysis });
      }
    });

    if (errors.length === 0) {
      console.log('✅ No errors found in log file.');
      return;
    }

    console.log(`Found ${errors.length} error(s) in log file:\n`);

    errors.forEach((error, i) => {
      console.log(`\n--- Error ${i + 1} (line ${error.line}) ---`);
      this.displayAnalysis(error.analysis);
      console.log('─'.repeat(60));
    });

    // Summary
    const severityCounts = errors.reduce((acc, err) => {
      acc[err.analysis.severity] = (acc[err.analysis.severity] || 0) + 1;
      return acc;
    }, {});

    console.log('\n📊 Error Summary:');
    Object.entries(severityCounts).forEach(([severity, count]) => {
      console.log(`   ${this.formatSeverity(severity)}: ${count}`);
    });
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
IC Mesh Error Diagnostic Helper

Usage:
  node error-diagnostic-helper.js [options]

Options:
  --analyze <logfile>     Analyze log file for errors
  --explain <error>       Explain specific error message
  --interactive          Start interactive diagnostic session
  --verbose              Enable verbose output
  --help                 Show this help message

Examples:
  # Interactive session
  node error-diagnostic-helper.js --interactive

  # Analyze specific error
  node error-diagnostic-helper.js --explain "ECONNREFUSED: connection refused"

  # Analyze log file
  node error-diagnostic-helper.js --analyze /var/log/ic-mesh.log
    `);
    return;
  }

  const helper = new ErrorDiagnosticHelper({
    verbose: args.includes('--verbose')
  });

  try {
    if (args.includes('--interactive')) {
      await helper.runInteractiveSession();
    } else if (args.includes('--analyze')) {
      const logFileIndex = args.indexOf('--analyze') + 1;
      if (logFileIndex < args.length) {
        helper.analyzeLogFile(args[logFileIndex]);
      } else {
        console.error('Please provide a log file path after --analyze');
      }
    } else if (args.includes('--explain')) {
      const errorIndex = args.indexOf('--explain') + 1;
      if (errorIndex < args.length) {
        const errorMessage = args.slice(errorIndex).join(' ');
        const analysis = helper.analyzeError(errorMessage);
        helper.displayAnalysis(analysis);
      } else {
        console.error('Please provide an error message after --explain');
      }
    } else {
      console.log('Use --help to see available options, or --interactive to start a diagnostic session.');
    }

  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

// Export for programmatic use
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { ErrorDiagnosticHelper, ERROR_PATTERNS, USER_FRIENDLY_MESSAGES };