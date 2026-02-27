#!/usr/bin/env node
/**
 * Onboarding Diagnostic Tool for IC Mesh Node Operators
 * 
 * Helps diagnose common issues that cause nodes to disconnect immediately
 * Run this before connecting a node to identify potential problems
 * 
 * Usage: node onboarding-diagnostic.js [node-config.json]
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const https = require('https');
const crypto = require('crypto');

class OnboardingDiagnostic {
    constructor() {
        this.config = null;
        this.results = {
            connectivity: {},
            authentication: {},
            resources: {},
            configuration: {},
            recommendations: []
        };
    }

    log(category, test, status, message, details = null) {
        const icon = status === 'pass' ? '✅' : status === 'warn' ? '⚠️' : '❌';
        console.log(`${icon} [${category}] ${test}: ${message}`);
        if (details) console.log(`   ${details}`);
        
        this.results[category][test] = { status, message, details };
    }

    async loadConfig(configPath = './node-config.json') {
        try {
            if (!fs.existsSync(configPath)) {
                this.log('configuration', 'config_file', 'fail', 'Configuration file not found', 
                    `Looking for: ${path.resolve(configPath)}`);
                return false;
            }

            const configData = fs.readFileSync(configPath, 'utf8');
            this.config = JSON.parse(configData);
            this.log('configuration', 'config_file', 'pass', 'Configuration loaded successfully');
            return true;
        } catch (error) {
            this.log('configuration', 'config_file', 'fail', 'Failed to load configuration', 
                error.message);
            return false;
        }
    }

    validateConfiguration() {
        if (!this.config) {
            this.log('configuration', 'validation', 'fail', 'No configuration to validate');
            return false;
        }

        const required = ['SERVER_HOST', 'SERVER_PORT', 'NODE_ID', 'capabilities'];
        const missing = required.filter(field => !this.config[field]);
        
        if (missing.length > 0) {
            this.log('configuration', 'validation', 'fail', 'Missing required fields', 
                `Missing: ${missing.join(', ')}`);
            return false;
        }

        if (!Array.isArray(this.config.capabilities) || this.config.capabilities.length === 0) {
            this.log('configuration', 'validation', 'fail', 'Capabilities must be non-empty array');
            return false;
        }

        this.log('configuration', 'validation', 'pass', 'Configuration structure valid');
        return true;
    }

    async testConnectivity() {
        if (!this.config) return false;

        // Test TCP connectivity to mesh server
        return new Promise((resolve) => {
            const socket = new net.Socket();
            const timeout = setTimeout(() => {
                socket.destroy();
                this.log('connectivity', 'tcp_connection', 'fail', 'Connection timeout', 
                    `Could not connect to ${this.config.SERVER_HOST}:${this.config.SERVER_PORT} within 5s`);
                resolve(false);
            }, 5000);

            socket.connect(this.config.SERVER_PORT, this.config.SERVER_HOST, () => {
                clearTimeout(timeout);
                socket.destroy();
                this.log('connectivity', 'tcp_connection', 'pass', 'TCP connection successful');
                resolve(true);
            });

            socket.on('error', (error) => {
                clearTimeout(timeout);
                this.log('connectivity', 'tcp_connection', 'fail', 'Connection failed', error.message);
                resolve(false);
            });
        });
    }

    async testHealthEndpoint() {
        return new Promise((resolve) => {
            const options = {
                hostname: this.config?.SERVER_HOST || 'moilol.com',
                port: 443,
                path: '/health',
                method: 'GET',
                timeout: 5000
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const health = JSON.parse(data);
                        if (health.status === 'healthy') {
                            this.log('connectivity', 'health_endpoint', 'pass', 'Health endpoint responsive');
                        } else {
                            this.log('connectivity', 'health_endpoint', 'warn', 'Health endpoint reports issues', 
                                JSON.stringify(health));
                        }
                        resolve(true);
                    } catch (error) {
                        this.log('connectivity', 'health_endpoint', 'fail', 'Invalid health response', data);
                        resolve(false);
                    }
                });
            });

            req.on('error', (error) => {
                this.log('connectivity', 'health_endpoint', 'fail', 'Health endpoint unreachable', error.message);
                resolve(false);
            });

            req.on('timeout', () => {
                this.log('connectivity', 'health_endpoint', 'fail', 'Health endpoint timeout');
                req.destroy();
                resolve(false);
            });

            req.end();
        });
    }

    checkResources() {
        const os = require('os');
        
        // Check available memory
        const totalMem = os.totalmem() / (1024 * 1024 * 1024); // GB
        const freeMem = os.freemem() / (1024 * 1024 * 1024); // GB
        
        if (freeMem < 1) {
            this.log('resources', 'memory', 'warn', 'Low available memory', 
                `${freeMem.toFixed(2)}GB free of ${totalMem.toFixed(2)}GB total`);
        } else {
            this.log('resources', 'memory', 'pass', 'Sufficient memory available', 
                `${freeMem.toFixed(2)}GB free of ${totalMem.toFixed(2)}GB total`);
        }

        // Check CPU load
        const loadAvg = os.loadavg()[0];
        const cpuCount = os.cpus().length;
        const loadPercent = (loadAvg / cpuCount) * 100;
        
        if (loadPercent > 80) {
            this.log('resources', 'cpu_load', 'warn', 'High CPU load', 
                `${loadPercent.toFixed(1)}% load (${loadAvg.toFixed(2)} across ${cpuCount} cores)`);
        } else {
            this.log('resources', 'cpu_load', 'pass', 'Normal CPU load', 
                `${loadPercent.toFixed(1)}% load (${loadAvg.toFixed(2)} across ${cpuCount} cores)`);
        }

        // Check disk space
        try {
            const stats = fs.statSync('.');
            this.log('resources', 'disk_access', 'pass', 'Disk access working');
        } catch (error) {
            this.log('resources', 'disk_access', 'fail', 'Disk access issues', error.message);
        }
    }

    checkCapabilityTools() {
        if (!this.config?.capabilities) return;

        const capabilityChecks = {
            'whisper': 'which whisper',
            'ffmpeg': 'which ffmpeg', 
            'tesseract': 'which tesseract',
            'ollama': 'which ollama',
            'stable-diffusion': 'which python3'
        };

        this.config.capabilities.forEach(capability => {
            if (capabilityChecks[capability]) {
                try {
                    require('child_process').execSync(capabilityChecks[capability], { stdio: 'ignore' });
                    this.log('configuration', `capability_${capability}`, 'pass', 
                        `Tool for ${capability} found`);
                } catch (error) {
                    this.log('configuration', `capability_${capability}`, 'warn', 
                        `Tool for ${capability} not found`, 
                        'Node may fail jobs requiring this capability');
                }
            }
        });
    }

    generateRecommendations() {
        const issues = [];
        
        // Collect all failed and warned checks
        Object.entries(this.results).forEach(([category, tests]) => {
            Object.entries(tests).forEach(([test, result]) => {
                if (result.status === 'fail') {
                    issues.push(`${category}/${test}: ${result.message}`);
                } else if (result.status === 'warn') {
                    issues.push(`${category}/${test}: ${result.message} (warning)`);
                }
            });
        });

        console.log('\n🎯 ONBOARDING RECOMMENDATIONS');
        console.log('═══════════════════════════════════════');
        
        if (issues.length === 0) {
            console.log('✅ All checks passed! Your node should connect successfully.');
            console.log('💡 Next steps:');
            console.log('   1. Run: node client.js');
            console.log('   2. Monitor logs for job assignments');
            console.log('   3. Check operator dashboard for earnings');
        } else {
            console.log('❌ Issues found that may cause connection problems:');
            issues.forEach((issue, index) => {
                console.log(`   ${index + 1}. ${issue}`);
            });
            
            console.log('\n🔧 SUGGESTED FIXES:');
            if (this.results.connectivity?.tcp_connection?.status === 'fail') {
                console.log('   • Check firewall settings for outbound connections');
                console.log('   • Verify network connectivity to moilol.com');
                console.log('   • Try: ping moilol.com');
            }
            if (this.results.configuration?.config_file?.status === 'fail') {
                console.log('   • Create node-config.json with required fields');
                console.log('   • Copy example from documentation');
            }
            console.log('   • Review IC Mesh documentation');
            console.log('   • Contact support if issues persist');
        }
    }

    async run(configPath) {
        console.log('🚀 IC MESH NODE ONBOARDING DIAGNOSTIC');
        console.log('══════════════════════════════════════════════');
        console.log(`📋 Checking system readiness for node operation...\n`);

        // Configuration checks
        if (await this.loadConfig(configPath)) {
            this.validateConfiguration();
            this.checkCapabilityTools();
        }

        // Connectivity checks
        await this.testConnectivity();
        await this.testHealthEndpoint();

        // Resource checks
        this.checkResources();

        // Generate recommendations
        this.generateRecommendations();

        // Output summary
        console.log('\n📊 DIAGNOSTIC SUMMARY');
        console.log('═══════════════════════════════════════');
        
        const summary = {};
        Object.entries(this.results).forEach(([category, tests]) => {
            summary[category] = {
                pass: Object.values(tests).filter(r => r.status === 'pass').length,
                warn: Object.values(tests).filter(r => r.status === 'warn').length,
                fail: Object.values(tests).filter(r => r.status === 'fail').length
            };
        });

        Object.entries(summary).forEach(([category, counts]) => {
            const total = counts.pass + counts.warn + counts.fail;
            if (total > 0) {
                console.log(`${category}: ✅${counts.pass} ⚠️${counts.warn} ❌${counts.fail}`);
            }
        });
    }
}

// CLI usage
if (require.main === module) {
    const configPath = process.argv[2] || './node-config.json';
    const diagnostic = new OnboardingDiagnostic();
    diagnostic.run(configPath).catch(console.error);
}

module.exports = OnboardingDiagnostic;