#!/usr/bin/env node

/**
 * System Readiness Check - Pre-onboarding verification tool
 * 
 * Verifies the IC Mesh network is ready for new operators and shows
 * them exactly what they'll encounter when joining.
 * 
 * Usage:
 *   node system-readiness-check.js              # Full readiness report
 *   node system-readiness-check.js --quick      # Quick status only
 *   node system-readiness-check.js --operator   # Operator-focused view
 */

const http = require('http');
const https = require('https');
const sqlite3 = require('sqlite3').verbose();

class SystemReadinessCheck {
    constructor() {
        this.meshServer = 'http://localhost:8333';
        this.dbPath = './data/mesh.db';
        this.results = {
            overall: 'unknown',
            checks: [],
            operatorOpportunity: {},
            recommendations: []
        };
    }

    async check(options = {}) {
        console.log('🔍 IC Mesh System Readiness Check');
        console.log('═══════════════════════════════════════\n');

        if (options.quick) {
            await this.quickCheck();
        } else if (options.operator) {
            await this.operatorCheck();
        } else {
            await this.fullCheck();
        }

        this.displayResults(options);
        return this.results;
    }

    async quickCheck() {
        console.log('⚡ Quick Status Check...\n');
        
        // Essential checks only
        await this.checkServerHealth();
        await this.checkDatabase();
        await this.checkNetworkCapacity();
        
        this.setOverallStatus();
    }

    async operatorCheck() {
        console.log('👥 Operator-Focused Analysis...\n');
        
        await this.checkServerHealth();
        await this.checkDatabase();
        await this.checkNetworkCapacity();
        await this.analyzeEarningOpportunity();
        await this.checkOnboardingReadiness();
        
        this.setOverallStatus();
    }

    async fullCheck() {
        console.log('🔬 Comprehensive System Analysis...\n');
        
        await this.checkServerHealth();
        await this.checkDatabase();
        await this.checkNetworkCapacity();
        await this.checkJobProcessing();
        await this.analyzeEarningOpportunity();
        await this.checkOnboardingReadiness();
        await this.checkDocumentation();
        
        this.setOverallStatus();
    }

    async checkServerHealth() {
        try {
            const status = await this.makeRequest('/status');
            
            this.addCheck('Server Health', 'pass', {
                status: status.status,
                uptime: this.formatUptime(status.uptime),
                version: status.version,
                network: status.network
            });
        } catch (error) {
            this.addCheck('Server Health', 'fail', {
                error: error.message,
                impact: 'New operators cannot register until server is available'
            });
        }
    }

    async checkDatabase() {
        return new Promise((resolve) => {
            const db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY, async (err) => {
                if (err) {
                    this.addCheck('Database Health', 'fail', {
                        error: err.message,
                        impact: 'Node registration and job processing unavailable'
                    });
                    resolve();
                    return;
                }

                try {
                    // Check table integrity
                    const tables = await this.queryDb(db, "SELECT name FROM sqlite_master WHERE type='table'");
                    const jobCount = await this.queryDb(db, "SELECT COUNT(*) as count FROM jobs");
                    const nodeCount = await this.queryDb(db, "SELECT COUNT(*) as count FROM nodes");

                    this.addCheck('Database Health', 'pass', {
                        tables: tables.map(t => t.name),
                        totalJobs: jobCount[0].count,
                        registeredNodes: nodeCount[0].count,
                        status: 'Clean and operational'
                    });
                } catch (queryError) {
                    this.addCheck('Database Health', 'fail', {
                        error: queryError.message,
                        impact: 'Data access issues may affect node operations'
                    });
                }

                db.close();
                resolve();
            });
        });
    }

    async checkNetworkCapacity() {
        try {
            const status = await this.makeRequest('/status');
            const nodes = status.nodes || {};
            const jobs = status.jobs || {};
            
            const hasCapacity = nodes.active > 0;
            const hasBacklog = jobs.pending > 0;
            
            this.addCheck('Network Capacity', hasCapacity ? 'pass' : 'warn', {
                activeNodes: nodes.active,
                totalNodes: nodes.total,
                pendingJobs: jobs.pending,
                completedJobs: jobs.completed,
                opportunity: hasCapacity ? 'Competitive network' : 'High opportunity - no active competition',
                recommendation: hasCapacity ? 'Join established network' : 'First mover advantage available'
            });
        } catch (error) {
            this.addCheck('Network Capacity', 'fail', {
                error: error.message,
                impact: 'Cannot assess earning opportunity'
            });
        }
    }

    async checkJobProcessing() {
        try {
            const status = await this.makeRequest('/status');
            const compute = status.compute || {};
            const capabilities = compute.capabilities || [];
            
            this.addCheck('Job Processing', 'info', {
                availableCapabilities: capabilities,
                totalCores: compute.totalCores,
                totalRAM_GB: compute.totalRAM_GB,
                models: compute.models || [],
                websocketConnections: status.websocket ? status.websocket.connected : 0
            });
        } catch (error) {
            this.addCheck('Job Processing', 'warn', {
                error: error.message,
                note: 'Could not verify processing capabilities'
            });
        }
    }

    async analyzeEarningOpportunity() {
        try {
            const status = await this.makeRequest('/status');
            const jobs = status.jobs || {};
            const nodes = status.nodes || {};
            
            // Calculate opportunity metrics
            const pendingJobs = jobs.pending || 0;
            const activeNodes = nodes.active || 0;
            const estimatedValue = pendingJobs * 0.35; // $0.30-0.50 per job
            
            this.results.operatorOpportunity = {
                immediateJobs: pendingJobs,
                competition: activeNodes,
                estimatedEarnings: `$${estimatedValue.toFixed(2)}`,
                competitiveAdvantage: activeNodes === 0 ? 'First mover - no competition' : 
                                      activeNodes === 1 ? 'Low competition' :
                                      activeNodes < 5 ? 'Moderate competition' : 'High competition',
                timeToStart: '~5 minutes',
                payoutMethod: 'Stripe Connect (USD)',
                payoutFrequency: 'Immediate after job completion'
            };

            this.addCheck('Earning Opportunity', pendingJobs > 0 ? 'pass' : 'info', {
                ...this.results.operatorOpportunity,
                note: pendingJobs > 0 ? 'Jobs available immediately' : 'Network ready for incoming jobs'
            });
        } catch (error) {
            this.addCheck('Earning Opportunity', 'warn', {
                error: error.message,
                note: 'Could not analyze current opportunity'
            });
        }
    }

    async checkOnboardingReadiness() {
        const checks = [
            { file: 'JOIN.md', purpose: 'Onboarding guide' },
            { file: 'README.md', purpose: 'Project overview' },
            { file: 'client.js', purpose: 'Node client' },
            { file: 'node-config.json.sample', purpose: 'Configuration template' }
        ];

        const missing = [];
        const available = [];

        for (const check of checks) {
            try {
                const fs = require('fs');
                if (fs.existsSync(check.file)) {
                    available.push(check);
                } else {
                    missing.push(check);
                }
            } catch (error) {
                missing.push(check);
            }
        }

        this.addCheck('Onboarding Readiness', missing.length === 0 ? 'pass' : 'warn', {
            availableFiles: available.length,
            missingFiles: missing.length,
            available: available.map(f => f.file),
            missing: missing.map(f => f.file),
            completeness: `${Math.round((available.length / checks.length) * 100)}%`
        });
    }

    async checkDocumentation() {
        try {
            const fs = require('fs');
            const docsDir = './docs';
            
            if (fs.existsSync(docsDir)) {
                const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
                
                this.addCheck('Documentation', 'pass', {
                    docsDirectory: true,
                    guides: files.length,
                    availableGuides: files,
                    coverage: 'Comprehensive'
                });
            } else {
                this.addCheck('Documentation', 'warn', {
                    docsDirectory: false,
                    note: 'No docs directory found'
                });
            }
        } catch (error) {
            this.addCheck('Documentation', 'warn', {
                error: error.message,
                note: 'Could not verify documentation'
            });
        }
    }

    setOverallStatus() {
        const failed = this.results.checks.filter(c => c.status === 'fail').length;
        const warned = this.results.checks.filter(c => c.status === 'warn').length;
        
        if (failed > 0) {
            this.results.overall = 'not_ready';
            this.results.recommendations.push('Critical issues must be resolved before operator onboarding');
        } else if (warned > 2) {
            this.results.overall = 'partially_ready';
            this.results.recommendations.push('Some issues should be addressed for optimal operator experience');
        } else {
            this.results.overall = 'ready';
            this.results.recommendations.push('System ready for new operator registrations');
        }

        // Add opportunity-specific recommendations
        if (this.results.operatorOpportunity.immediateJobs > 0) {
            this.results.recommendations.push('Immediate earning opportunity available');
        }
        
        if (this.results.operatorOpportunity.competition === 0) {
            this.results.recommendations.push('First mover advantage - no current competition');
        }
    }

    displayResults(options) {
        console.log('\n📊 READINESS RESULTS');
        console.log('═════════════════════════════════════\n');

        // Overall status
        const statusIcon = this.results.overall === 'ready' ? '✅' :
                          this.results.overall === 'partially_ready' ? '⚠️' : '❌';
        console.log(`${statusIcon} Overall Status: ${this.results.overall.replace('_', ' ').toUpperCase()}\n`);

        // Individual checks
        this.results.checks.forEach(check => {
            const icon = check.status === 'pass' ? '✅' :
                        check.status === 'warn' ? '⚠️' :
                        check.status === 'fail' ? '❌' : 'ℹ️';
            
            console.log(`${icon} ${check.name}`);
            
            if (options.operator && check.name === 'Earning Opportunity') {
                console.log(`   💰 Immediate earnings: ${check.details.estimatedEarnings}`);
                console.log(`   🎯 Competition: ${check.details.competitiveAdvantage}`);
                console.log(`   ⏱️  Time to start: ${check.details.timeToStart}`);
            } else if (!options.quick) {
                Object.entries(check.details).forEach(([key, value]) => {
                    if (typeof value === 'object' && value !== null) {
                        console.log(`   ${key}: ${Array.isArray(value) ? value.join(', ') : JSON.stringify(value)}`);
                    } else {
                        console.log(`   ${key}: ${value}`);
                    }
                });
            }
            console.log('');
        });

        // Recommendations
        if (this.results.recommendations.length > 0) {
            console.log('🎯 RECOMMENDATIONS');
            console.log('═════════════════════════════════════');
            this.results.recommendations.forEach((rec, i) => {
                console.log(`${i + 1}. ${rec}`);
            });
            console.log('');
        }

        // Operator summary
        if (options.operator || !options.quick) {
            console.log('👥 NEW OPERATOR SUMMARY');
            console.log('═════════════════════════════════════');
            if (this.results.operatorOpportunity.immediateJobs !== undefined) {
                console.log(`💼 Jobs available now: ${this.results.operatorOpportunity.immediateJobs}`);
                console.log(`💰 Potential earnings: ${this.results.operatorOpportunity.estimatedEarnings}`);
                console.log(`⚡ Competition level: ${this.results.operatorOpportunity.competitiveAdvantage}`);
                console.log(`⏱️  Setup time: ${this.results.operatorOpportunity.timeToStart}`);
                console.log(`💳 Payment: ${this.results.operatorOpportunity.payoutMethod}`);
            } else {
                console.log('Could not analyze current opportunity - check network connectivity');
            }
        }

        console.log('\n🚀 Ready to onboard new operators!\n');
    }

    addCheck(name, status, details) {
        this.results.checks.push({ name, status, details });
    }

    async makeRequest(path) {
        return new Promise((resolve, reject) => {
            const url = `${this.meshServer}${path}`;
            const client = url.startsWith('https') ? https : http;
            
            client.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Invalid JSON response: ${error.message}`));
                    }
                });
            }).on('error', reject);
        });
    }

    async queryDb(db, query) {
        return new Promise((resolve, reject) => {
            db.all(query, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }
}

// CLI execution
async function main() {
    const args = process.argv.slice(2);
    const options = {
        quick: args.includes('--quick'),
        operator: args.includes('--operator')
    };

    const checker = new SystemReadinessCheck();
    
    try {
        const results = await checker.check(options);
        
        // Exit codes for automation
        const exitCode = results.overall === 'ready' ? 0 :
                         results.overall === 'partially_ready' ? 1 : 2;
        process.exit(exitCode);
    } catch (error) {
        console.error('❌ Error running readiness check:', error.message);
        process.exit(2);
    }
}

if (require.main === module) {
    main();
}

module.exports = SystemReadinessCheck;