#!/usr/bin/env node
/**
 * Security Analysis & Vulnerability Scanner
 * 
 * Comprehensive security assessment toolkit for IC Mesh infrastructure,
 * code, configuration, and operational security posture.
 * 
 * Features:
 * - Static code analysis for security vulnerabilities
 * - Configuration security assessment
 * - Network security analysis
 * - Authentication and authorization review
 * - Data protection compliance checking
 * - Dependency vulnerability scanning
 * - API security testing
 * - Operational security assessment
 * - Security monitoring recommendations
 * - Incident response planning
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

class SecurityAnalyzer {
  constructor() {
    this.vulnerabilities = [];
    this.findings = [];
    this.recommendations = [];
    this.securityScore = 0;
    this.severityLevels = {
      CRITICAL: { score: 100, color: '\x1b[91m', symbol: '🔴' },
      HIGH: { score: 75, color: '\x1b[93m', symbol: '🟠' },
      MEDIUM: { score: 50, color: '\x1b[93m', symbol: '🟡' },
      LOW: { score: 25, color: '\x1b[92m', symbol: '🟢' },
      INFO: { score: 0, color: '\x1b[96m', symbol: 'ℹ️' }
    };
    
    this.baseDir = path.join(__dirname, '..');
    this.reportPath = path.join(this.baseDir, 'data', `security-report-${new Date().toISOString().split('T')[0]}.json`);
  }

  // ===== STATIC CODE ANALYSIS =====
  async analyzeCodeSecurity() {
    console.log('🔍 Static Code Security Analysis');
    console.log('=================================\n');

    const codeFiles = this.getCodeFiles();
    let totalIssues = 0;

    for (const file of codeFiles) {
      const issues = await this.scanCodeFile(file);
      totalIssues += issues.length;
      this.findings.push(...issues);
    }

    console.log(`📂 Analyzed ${codeFiles.length} files, found ${totalIssues} potential security issues\n`);
    
    // Group findings by severity
    const grouped = this.groupFindingsBySeverity(this.findings);
    Object.entries(grouped).forEach(([severity, findings]) => {
      if (findings.length > 0) {
        console.log(`${this.severityLevels[severity].symbol} ${severity}: ${findings.length} issues`);
      }
    });
    console.log('');

    return this.findings;
  }

  async scanCodeFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const issues = [];
    const relativePath = path.relative(this.baseDir, filePath);

    // SQL Injection vulnerabilities
    if (content.includes('.prepare(') && !content.includes('?')) {
      const matches = content.match(/\.prepare\([^)]*\)/g) || [];
      for (const match of matches) {
        if (!match.includes('?') && match.includes('${')) {
          issues.push({
            type: 'SQL_INJECTION',
            severity: 'HIGH',
            file: relativePath,
            line: this.getLineNumber(content, match),
            description: 'Potential SQL injection vulnerability in prepared statement',
            evidence: match.substring(0, 100),
            recommendation: 'Use parameterized queries with ? placeholders'
          });
        }
      }
    }

    // Command injection vulnerabilities
    const commandFunctions = ['exec', 'spawn', 'execSync', 'spawnSync'];
    commandFunctions.forEach(func => {
      if (content.includes(`${func}(`)) {
        const regex = new RegExp(`${func}\\([^)]*\\$\\{[^}]*\\}[^)]*\\)`, 'g');
        const matches = content.match(regex) || [];
        matches.forEach(match => {
          issues.push({
            type: 'COMMAND_INJECTION',
            severity: 'CRITICAL',
            file: relativePath,
            line: this.getLineNumber(content, match),
            description: 'Potential command injection vulnerability',
            evidence: match.substring(0, 100),
            recommendation: 'Sanitize user input and use safe alternatives'
          });
        });
      }
    });

    // Hardcoded secrets detection
    const secretPatterns = [
      { pattern: /(['"])(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*?&]{20,}\1/, type: 'HARDCODED_SECRET' },
      { pattern: /sk_[a-zA-Z0-9]{24,}/, type: 'STRIPE_SECRET_KEY' },
      { pattern: /pk_[a-zA-Z0-9]{24,}/, type: 'STRIPE_PUBLISHABLE_KEY' },
      { pattern: /AKIA[0-9A-Z]{16}/, type: 'AWS_ACCESS_KEY' },
      { pattern: /ghp_[0-9a-zA-Z]{36}/, type: 'GITHUB_TOKEN' },
      { pattern: /xoxb-[0-9]{11}-[0-9]{11}-[0-9a-zA-Z]{24}/, type: 'SLACK_BOT_TOKEN' }
    ];

    secretPatterns.forEach(({ pattern, type }) => {
      const matches = content.match(pattern) || [];
      matches.forEach(match => {
        // Skip if it's in a comment or example
        const context = this.getContext(content, match);
        if (!context.includes('//') && !context.includes('example') && !context.includes('placeholder')) {
          issues.push({
            type,
            severity: 'CRITICAL',
            file: relativePath,
            line: this.getLineNumber(content, match),
            description: `Potential ${type.replace('_', ' ').toLowerCase()} found in code`,
            evidence: match.substring(0, 10) + '***',
            recommendation: 'Move secrets to environment variables or secure vault'
          });
        }
      });
    });

    // Insecure cryptography
    const weakCrypto = ['md5', 'sha1', 'des', 'rc4'];
    weakCrypto.forEach(algo => {
      if (content.toLowerCase().includes(algo)) {
        const matches = content.match(new RegExp(algo, 'gi')) || [];
        matches.forEach(match => {
          issues.push({
            type: 'WEAK_CRYPTOGRAPHY',
            severity: 'MEDIUM',
            file: relativePath,
            line: this.getLineNumber(content, match),
            description: `Weak cryptographic algorithm detected: ${match}`,
            evidence: match,
            recommendation: 'Use stronger algorithms like SHA-256, AES-256'
          });
        });
      }
    });

    // Insecure HTTP headers
    if (content.includes('res.setHeader') || content.includes('res.writeHead')) {
      const securityHeaders = [
        'Content-Security-Policy',
        'X-Frame-Options', 
        'X-Content-Type-Options',
        'X-XSS-Protection',
        'Strict-Transport-Security'
      ];
      
      const missingHeaders = securityHeaders.filter(header => 
        !content.includes(header)
      );

      if (missingHeaders.length > 0) {
        issues.push({
          type: 'MISSING_SECURITY_HEADERS',
          severity: 'MEDIUM',
          file: relativePath,
          line: 1,
          description: `Missing security headers: ${missingHeaders.join(', ')}`,
          evidence: 'HTTP response configuration',
          recommendation: 'Add comprehensive security headers to all HTTP responses'
        });
      }
    }

    // Path traversal vulnerabilities
    if (content.includes('path.join') && content.includes('req.')) {
      const pathJoinMatches = content.match(/path\.join\([^)]*req\.[^)]*\)/g) || [];
      pathJoinMatches.forEach(match => {
        if (!match.includes('path.normalize') && !match.includes('path.resolve')) {
          issues.push({
            type: 'PATH_TRAVERSAL',
            severity: 'HIGH',
            file: relativePath,
            line: this.getLineNumber(content, match),
            description: 'Potential path traversal vulnerability',
            evidence: match,
            recommendation: 'Validate and sanitize file paths, use path.resolve()'
          });
        }
      });
    }

    // Unsafe file operations
    const unsafeFileOps = ['fs.unlink', 'fs.rmdir', 'fs.rm'];
    unsafeFileOps.forEach(op => {
      if (content.includes(op) && content.includes('req.')) {
        issues.push({
          type: 'UNSAFE_FILE_OPERATION',
          severity: 'HIGH',
          file: relativePath,
          line: this.getLineNumber(content, op),
          description: `Unsafe file operation: ${op} with user input`,
          evidence: op,
          recommendation: 'Validate file paths and implement access controls'
        });
      }
    });

    // Information disclosure
    if (content.includes('.stack') || content.includes('console.log') && content.includes('error')) {
      const stackTraceMatches = content.match(/\.stack|console\.log.*error/g) || [];
      stackTraceMatches.forEach(match => {
        issues.push({
          type: 'INFORMATION_DISCLOSURE',
          severity: 'LOW',
          file: relativePath,
          line: this.getLineNumber(content, match),
          description: 'Potential information disclosure through error messages',
          evidence: match,
          recommendation: 'Log detailed errors securely, return generic messages to users'
        });
      });
    }

    return issues;
  }

  // ===== CONFIGURATION SECURITY =====
  async analyzeConfigurationSecurity() {
    console.log('⚙️ Configuration Security Assessment');
    console.log('====================================\n');

    const configIssues = [];

    // Check environment configuration
    const envExample = path.join(this.baseDir, '.env.example');
    if (fs.existsSync(envExample)) {
      const envContent = fs.readFileSync(envExample, 'utf8');
      configIssues.push(...this.analyzeEnvSecurity(envContent));
    }

    // Check Docker configuration
    const dockerFile = path.join(this.baseDir, 'Dockerfile');
    if (fs.existsSync(dockerFile)) {
      const dockerContent = fs.readFileSync(dockerFile, 'utf8');
      configIssues.push(...this.analyzeDockerSecurity(dockerContent));
    }

    // Check database configuration
    configIssues.push(...this.analyzeDatabaseSecurity());

    // Check server configuration
    const serverFile = path.join(this.baseDir, 'server.js');
    if (fs.existsSync(serverFile)) {
      const serverContent = fs.readFileSync(serverFile, 'utf8');
      configIssues.push(...this.analyzeServerSecurity(serverContent));
    }

    this.findings.push(...configIssues);
    
    console.log(`🔧 Configuration analysis complete: ${configIssues.length} issues found\n`);
    
    configIssues.forEach(issue => {
      console.log(`${this.severityLevels[issue.severity].symbol} ${issue.type}: ${issue.description}`);
    });
    console.log('');

    return configIssues;
  }

  analyzeEnvSecurity(envContent) {
    const issues = [];

    // Check for default/example values that should be changed
    const defaultPatterns = [
      { pattern: /your-secret-key/i, desc: 'Default secret key value' },
      { pattern: /localhost:3306/i, desc: 'Default database connection' },
      { pattern: /admin:password/i, desc: 'Default credentials' },
      { pattern: /secret123/i, desc: 'Weak default secret' }
    ];

    defaultPatterns.forEach(({ pattern, desc }) => {
      if (pattern.test(envContent)) {
        issues.push({
          type: 'DEFAULT_CONFIGURATION',
          severity: 'HIGH',
          file: '.env.example',
          description: `${desc} detected in configuration`,
          recommendation: 'Replace default values with secure configuration'
        });
      }
    });

    // Check for missing critical environment variables
    const requiredVars = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY'];
    requiredVars.forEach(varName => {
      if (!envContent.includes(varName)) {
        issues.push({
          type: 'MISSING_CONFIG_VAR',
          severity: 'MEDIUM',
          file: '.env.example',
          description: `Missing required environment variable: ${varName}`,
          recommendation: `Add ${varName} to environment configuration`
        });
      }
    });

    return issues;
  }

  analyzeDockerSecurity(dockerContent) {
    const issues = [];

    // Check for running as root
    if (!dockerContent.includes('USER ') || dockerContent.includes('USER root')) {
      issues.push({
        type: 'DOCKER_ROOT_USER',
        severity: 'HIGH',
        file: 'Dockerfile',
        description: 'Container running as root user',
        recommendation: 'Create and use non-root user in Dockerfile'
      });
    }

    // Check for COPY with broad permissions
    if (dockerContent.includes('COPY . .')) {
      issues.push({
        type: 'DOCKER_BROAD_COPY',
        severity: 'MEDIUM',
        file: 'Dockerfile',
        description: 'Copying entire directory including potentially sensitive files',
        recommendation: 'Use specific COPY commands for required files only'
      });
    }

    // Check for missing health check
    if (!dockerContent.includes('HEALTHCHECK')) {
      issues.push({
        type: 'DOCKER_NO_HEALTHCHECK',
        severity: 'LOW',
        file: 'Dockerfile',
        description: 'Missing health check configuration',
        recommendation: 'Add HEALTHCHECK instruction for container monitoring'
      });
    }

    return issues;
  }

  analyzeDatabaseSecurity() {
    const issues = [];

    // Check SQLite file permissions (if using SQLite)
    const sqliteFiles = ['mesh.db', 'data/mesh.db'].map(f => path.join(this.baseDir, f));
    sqliteFiles.forEach(dbFile => {
      if (fs.existsSync(dbFile)) {
        const stats = fs.statSync(dbFile);
        const mode = stats.mode & parseInt('777', 8);
        
        if (mode & parseInt('044', 8)) { // World readable
          issues.push({
            type: 'DATABASE_PERMISSIONS',
            severity: 'HIGH',
            file: path.relative(this.baseDir, dbFile),
            description: 'Database file is world-readable',
            recommendation: 'Set restrictive permissions (600) on database files'
          });
        }
      }
    });

    return issues;
  }

  analyzeServerSecurity(serverContent) {
    const issues = [];

    // Check for CORS configuration
    if (serverContent.includes('Access-Control-Allow-Origin') && 
        serverContent.includes("'*'")) {
      issues.push({
        type: 'INSECURE_CORS',
        severity: 'MEDIUM',
        file: 'server.js',
        description: 'CORS configured to allow all origins',
        recommendation: 'Configure CORS with specific allowed origins'
      });
    }

    // Check for rate limiting
    if (!serverContent.includes('RateLimiter') && !serverContent.includes('rate-limit')) {
      issues.push({
        type: 'MISSING_RATE_LIMITING',
        severity: 'HIGH',
        file: 'server.js',
        description: 'No rate limiting implementation detected',
        recommendation: 'Implement rate limiting for API endpoints'
      });
    }

    // Check for input validation
    if (serverContent.includes('parseBody') && !serverContent.includes('validate')) {
      issues.push({
        type: 'MISSING_INPUT_VALIDATION',
        severity: 'HIGH',
        file: 'server.js',
        description: 'Input parsing without validation',
        recommendation: 'Add comprehensive input validation'
      });
    }

    return issues;
  }

  // ===== DEPENDENCY SECURITY =====
  async analyzeDependencySecurity() {
    console.log('📦 Dependency Security Analysis');
    console.log('===============================\n');

    const packageJsonPath = path.join(this.baseDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      console.log('No package.json found, skipping dependency analysis\n');
      return [];
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    console.log(`🔍 Analyzing ${Object.keys(dependencies).length} dependencies...`);

    const vulnerabilities = await this.scanDependencyVulnerabilities(dependencies);
    const outdatedPackages = await this.checkOutdatedPackages();

    this.findings.push(...vulnerabilities);
    this.findings.push(...outdatedPackages);

    console.log(`📊 Found ${vulnerabilities.length} vulnerabilities and ${outdatedPackages.length} outdated packages\n`);

    return [...vulnerabilities, ...outdatedPackages];
  }

  async scanDependencyVulnerabilities(dependencies) {
    // Simulate npm audit results (in production, would call npm audit API)
    const knownVulnerabilities = [
      { package: 'lodash', version: '<4.17.21', severity: 'HIGH', cve: 'CVE-2020-8203' },
      { package: 'minimist', version: '<1.2.6', severity: 'CRITICAL', cve: 'CVE-2021-44906' },
      { package: 'node-fetch', version: '<2.6.7', severity: 'HIGH', cve: 'CVE-2022-0235' }
    ];

    const vulnerabilities = [];
    
    Object.entries(dependencies).forEach(([pkg, version]) => {
      const vuln = knownVulnerabilities.find(v => v.package === pkg);
      if (vuln) {
        vulnerabilities.push({
          type: 'DEPENDENCY_VULNERABILITY',
          severity: vuln.severity,
          file: 'package.json',
          description: `Vulnerable dependency: ${pkg}@${version}`,
          evidence: `CVE: ${vuln.cve}`,
          recommendation: `Update ${pkg} to version ${vuln.version.replace('<', '>=')} or later`
        });
      }
    });

    return vulnerabilities;
  }

  async checkOutdatedPackages() {
    // Simplified outdated package check
    const outdatedPackages = [];
    
    // This would normally run 'npm outdated' and parse results
    // For demo purposes, we'll simulate some results
    const simulatedOutdated = [
      { package: 'express', current: '4.17.1', wanted: '4.18.2', latest: '4.18.2' },
      { package: 'ws', current: '8.2.3', wanted: '8.13.0', latest: '8.13.0' }
    ];

    simulatedOutdated.forEach(pkg => {
      outdatedPackages.push({
        type: 'OUTDATED_DEPENDENCY',
        severity: 'INFO',
        file: 'package.json',
        description: `Outdated package: ${pkg.package}@${pkg.current}`,
        evidence: `Latest: ${pkg.latest}`,
        recommendation: `Update ${pkg.package} to ${pkg.latest}`
      });
    });

    return outdatedPackages;
  }

  // ===== API SECURITY TESTING =====
  async analyzeAPISecurity() {
    console.log('🔐 API Security Assessment');
    console.log('==========================\n');

    const apiIssues = [];

    // Test authentication mechanisms
    apiIssues.push(...await this.testAuthenticationSecurity());
    
    // Test authorization controls
    apiIssues.push(...await this.testAuthorizationSecurity());
    
    // Test input validation
    apiIssues.push(...await this.testInputValidation());
    
    // Test error handling
    apiIssues.push(...await this.testErrorHandlingSecurity());

    this.findings.push(...apiIssues);
    
    console.log(`🛡️ API security assessment complete: ${apiIssues.length} issues found\n`);

    return apiIssues;
  }

  async testAuthenticationSecurity() {
    const issues = [];

    // Check if API endpoints require authentication
    const serverFile = path.join(this.baseDir, 'server.js');
    if (fs.existsSync(serverFile)) {
      const content = fs.readFileSync(serverFile, 'utf8');
      
      // Look for endpoints without authentication checks
      const endpointMatches = content.match(/\w+\s*===?\s*['"`]\/[^'"`]+['"`]/g) || [];
      endpointMatches.forEach(match => {
        const context = this.getContext(content, match, 200);
        if (!context.includes('auth') && !context.includes('token') && 
            !context.includes('key') && !context.includes('verify')) {
          issues.push({
            type: 'MISSING_AUTHENTICATION',
            severity: 'HIGH',
            file: 'server.js',
            description: 'API endpoint without authentication check',
            evidence: match,
            recommendation: 'Add authentication middleware to protect endpoints'
          });
        }
      });
    }

    return issues;
  }

  async testAuthorizationSecurity() {
    const issues = [];

    // Check for authorization bypass opportunities
    // This would normally involve active testing, but we'll do static analysis
    
    issues.push({
      type: 'AUTHORIZATION_REVIEW_NEEDED',
      severity: 'MEDIUM',
      file: 'server.js',
      description: 'Authorization controls need manual review',
      recommendation: 'Verify proper role-based access controls are implemented'
    });

    return issues;
  }

  async testInputValidation() {
    const issues = [];

    const serverFile = path.join(this.baseDir, 'server.js');
    if (fs.existsSync(serverFile)) {
      const content = fs.readFileSync(serverFile, 'utf8');
      
      // Check for direct use of request data without validation
      const directUsage = content.match(/req\.(body|query|params)\.[a-zA-Z_]+/g) || [];
      directUsage.forEach(match => {
        const context = this.getContext(content, match, 100);
        if (!context.includes('validate') && !context.includes('sanitize') && 
            !context.includes('check') && !context.includes('typeof')) {
          issues.push({
            type: 'UNVALIDATED_INPUT',
            severity: 'MEDIUM',
            file: 'server.js',
            description: 'Request data used without validation',
            evidence: match,
            recommendation: 'Validate and sanitize all user input'
          });
        }
      });
    }

    return issues;
  }

  async testErrorHandlingSecurity() {
    const issues = [];

    const serverFile = path.join(this.baseDir, 'server.js');
    if (fs.existsSync(serverFile)) {
      const content = fs.readFileSync(serverFile, 'utf8');
      
      // Check for error information leakage
      if (content.includes('error.message') || content.includes('err.stack')) {
        issues.push({
          type: 'ERROR_INFORMATION_LEAKAGE',
          severity: 'MEDIUM',
          file: 'server.js',
          description: 'Error details may be exposed to clients',
          recommendation: 'Return generic error messages, log details securely'
        });
      }
    }

    return issues;
  }

  // ===== OPERATIONAL SECURITY =====
  async analyzeOperationalSecurity() {
    console.log('🚨 Operational Security Assessment');
    console.log('==================================\n');

    const opSecIssues = [];

    // Check logging and monitoring
    opSecIssues.push(...this.analyzeLoggingMonitoring());
    
    // Check backup and recovery
    opSecIssues.push(...this.analyzeBackupRecovery());
    
    // Check network security
    opSecIssues.push(...this.analyzeNetworkSecurity());

    this.findings.push(...opSecIssues);
    
    console.log(`📋 Operational security assessment: ${opSecIssues.length} items for review\n`);

    return opSecIssues;
  }

  analyzeLoggingMonitoring() {
    const issues = [];

    const serverFile = path.join(this.baseDir, 'server.js');
    if (fs.existsSync(serverFile)) {
      const content = fs.readFileSync(serverFile, 'utf8');
      
      if (!content.includes('logger') && !content.includes('winston') && !content.includes('log4js')) {
        issues.push({
          type: 'INSUFFICIENT_LOGGING',
          severity: 'MEDIUM',
          file: 'server.js',
          description: 'No structured logging framework detected',
          recommendation: 'Implement comprehensive security logging and monitoring'
        });
      }
    }

    return issues;
  }

  analyzeBackupRecovery() {
    const issues = [];

    const backupScript = path.join(this.baseDir, 'scripts', 'backup-system.js');
    if (!fs.existsSync(backupScript)) {
      issues.push({
        type: 'MISSING_BACKUP_STRATEGY',
        severity: 'HIGH',
        file: 'N/A',
        description: 'No backup system implementation found',
        recommendation: 'Implement automated backup and recovery procedures'
      });
    }

    return issues;
  }

  analyzeNetworkSecurity() {
    const issues = [];

    // Check for HTTPS enforcement
    const serverFile = path.join(this.baseDir, 'server.js');
    if (fs.existsSync(serverFile)) {
      const content = fs.readFileSync(serverFile, 'utf8');
      
      if (!content.includes('https') && !content.includes('ssl') && !content.includes('tls')) {
        issues.push({
          type: 'NO_HTTPS_ENFORCEMENT',
          severity: 'HIGH',
          file: 'server.js',
          description: 'No HTTPS/TLS configuration detected',
          recommendation: 'Implement HTTPS with proper certificate management'
        });
      }
    }

    return issues;
  }

  // ===== REPORTING AND SCORING =====
  calculateSecurityScore() {
    const criticalCount = this.findings.filter(f => f.severity === 'CRITICAL').length;
    const highCount = this.findings.filter(f => f.severity === 'HIGH').length;
    const mediumCount = this.findings.filter(f => f.severity === 'MEDIUM').length;
    const lowCount = this.findings.filter(f => f.severity === 'LOW').length;

    // Security score calculation (100 = perfect security)
    const penalties = {
      CRITICAL: 25,
      HIGH: 10,
      MEDIUM: 5,
      LOW: 1
    };

    const totalPenalties = 
      (criticalCount * penalties.CRITICAL) +
      (highCount * penalties.HIGH) +
      (mediumCount * penalties.MEDIUM) +
      (lowCount * penalties.LOW);

    this.securityScore = Math.max(0, 100 - totalPenalties);
    
    return {
      score: this.securityScore,
      grade: this.getSecurityGrade(this.securityScore),
      findings: {
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
        low: lowCount,
        total: this.findings.length
      }
    };
  }

  getSecurityGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  generateSecurityReport() {
    const scoreCard = this.calculateSecurityScore();
    
    console.log('📊 Security Assessment Report');
    console.log('=============================\n');
    
    console.log(`🏆 Security Score: ${scoreCard.score}/100 (Grade: ${scoreCard.grade})`);
    console.log(`📈 Security Level: ${this.getSecurityLevel(scoreCard.score)}\n`);
    
    console.log('📋 Findings Summary:');
    console.log(`   🔴 Critical: ${scoreCard.findings.critical}`);
    console.log(`   🟠 High: ${scoreCard.findings.high}`);
    console.log(`   🟡 Medium: ${scoreCard.findings.medium}`);
    console.log(`   🟢 Low: ${scoreCard.findings.low}`);
    console.log(`   📊 Total: ${scoreCard.findings.total}\n`);

    // Top recommendations
    console.log('🎯 Top Priority Recommendations:');
    const topIssues = this.findings
      .filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')
      .slice(0, 5);
      
    topIssues.forEach((issue, i) => {
      console.log(`   ${i + 1}. ${issue.description}`);
      console.log(`      ➤ ${issue.recommendation}\n`);
    });

    return {
      timestamp: new Date().toISOString(),
      scoreCard,
      findings: this.findings,
      recommendations: this.generateSecurityRecommendations(),
      nextReview: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };
  }

  generateSecurityRecommendations() {
    const recommendations = [
      {
        priority: 'HIGH',
        title: 'Implement Comprehensive Input Validation',
        description: 'Add validation for all user inputs across API endpoints',
        effort: 'Medium',
        impact: 'High'
      },
      {
        priority: 'HIGH', 
        title: 'Enable HTTPS/TLS Encryption',
        description: 'Configure SSL certificates and enforce HTTPS for all connections',
        effort: 'Low',
        impact: 'High'
      },
      {
        priority: 'MEDIUM',
        title: 'Add Security Headers',
        description: 'Implement comprehensive HTTP security headers',
        effort: 'Low',
        impact: 'Medium'
      },
      {
        priority: 'MEDIUM',
        title: 'Enhance Authentication Controls',
        description: 'Add multi-factor authentication and session management',
        effort: 'High',
        impact: 'High'
      },
      {
        priority: 'LOW',
        title: 'Security Monitoring Setup',
        description: 'Implement real-time security monitoring and alerting',
        effort: 'High',
        impact: 'Medium'
      }
    ];

    return recommendations;
  }

  async exportSecurityReport(format = 'json') {
    const report = this.generateSecurityReport();
    
    if (format === 'json') {
      fs.writeFileSync(this.reportPath, JSON.stringify(report, null, 2));
      console.log(`📄 Security report exported to: ${this.reportPath}`);
    }
    
    return this.reportPath;
  }

  // ===== UTILITY METHODS =====
  getCodeFiles() {
    const extensions = ['.js', '.ts', '.jsx', '.tsx'];
    const files = [];
    
    const walkDir = (dir) => {
      if (dir.includes('node_modules') || dir.includes('.git')) return;
      
      const items = fs.readdirSync(dir);
      items.forEach(item => {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else if (extensions.some(ext => item.endsWith(ext))) {
          files.push(fullPath);
        }
      });
    };
    
    walkDir(this.baseDir);
    return files;
  }

  getLineNumber(content, searchString) {
    const index = content.indexOf(searchString);
    if (index === -1) return 1;
    
    return content.substring(0, index).split('\n').length;
  }

  getContext(content, searchString, length = 50) {
    const index = content.indexOf(searchString);
    if (index === -1) return '';
    
    const start = Math.max(0, index - length);
    const end = Math.min(content.length, index + searchString.length + length);
    
    return content.substring(start, end);
  }

  groupFindingsBySeverity(findings) {
    return findings.reduce((groups, finding) => {
      const severity = finding.severity || 'UNKNOWN';
      if (!groups[severity]) groups[severity] = [];
      groups[severity].push(finding);
      return groups;
    }, {});
  }

  getSecurityLevel(score) {
    if (score >= 90) return 'Excellent';
    if (score >= 80) return 'Good';
    if (score >= 70) return 'Fair'; 
    if (score >= 60) return 'Poor';
    return 'Critical';
  }
}

// ===== CLI INTERFACE =====
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'full';
  
  const analyzer = new SecurityAnalyzer();
  
  console.log('🔒 IC Mesh Security Analysis & Vulnerability Scanner');
  console.log('===================================================\n');
  
  switch (command) {
    case 'full':
    case 'all':
      await analyzer.analyzeCodeSecurity();
      await analyzer.analyzeConfigurationSecurity();
      await analyzer.analyzeDependencySecurity();
      await analyzer.analyzeAPISecurity();
      await analyzer.analyzeOperationalSecurity();
      analyzer.generateSecurityReport();
      await analyzer.exportSecurityReport();
      break;
      
    case 'code':
      await analyzer.analyzeCodeSecurity();
      break;
      
    case 'config':
      await analyzer.analyzeConfigurationSecurity();
      break;
      
    case 'deps':
    case 'dependencies':
      await analyzer.analyzeDependencySecurity();
      break;
      
    case 'api':
      await analyzer.analyzeAPISecurity();
      break;
      
    case 'ops':
    case 'operational':
      await analyzer.analyzeOperationalSecurity();
      break;
      
    case 'report':
      // Load previous findings if available
      analyzer.generateSecurityReport();
      break;
      
    default:
      console.log('Usage: node security-analyzer.js [command]');
      console.log('Commands:');
      console.log('  full         - Complete security assessment (default)');
      console.log('  code         - Static code security analysis');
      console.log('  config       - Configuration security assessment'); 
      console.log('  deps         - Dependency vulnerability scanning');
      console.log('  api          - API security testing');
      console.log('  ops          - Operational security assessment');
      console.log('  report       - Generate security report');
      break;
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = SecurityAnalyzer;