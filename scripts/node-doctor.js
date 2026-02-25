#!/usr/bin/env node

/**
 * IC Mesh Node Doctor
 * 
 * Quick diagnostic tool for troubleshooting node connection and earning issues.
 * Run this when your node isn't working as expected.
 * 
 * Usage: node scripts/node-doctor.js [--fix] [--verbose]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class NodeDoctor {
    constructor() {
        this.issues = [];
        this.fixes = [];
        this.stats = {};
        this.verbose = process.argv.includes('--verbose');
        this.autofix = process.argv.includes('--fix');
        
        this.colors = {
            reset: '\x1b[0m',
            red: '\x1b[31m',
            green: '\x1b[32m',
            yellow: '\x1b[33m',
            blue: '\x1b[34m',
            cyan: '\x1b[36m',
            bright: '\x1b[1m'
        };
    }

    log(message, color = 'reset') {
        console.log(`${this.colors[color]}${message}${this.colors.reset}`);
    }

    runCommand(command, silent = false) {
        try {
            return execSync(command, { encoding: 'utf8', stdio: silent ? 'pipe' : 'inherit' });
        } catch (error) {
            if (!silent) {
                this.log(`Command failed: ${command}`, 'red');
                this.log(`Error: ${error.message}`, 'red');
            }
            return null;
        }
    }

    async checkNodeStatus() {
        this.log('\n🏥 IC MESH NODE DOCTOR', 'cyan');
        this.log('═'.repeat(40), 'cyan');
        this.log('Diagnosing your node connection and earnings...', 'bright');

        // Check if client is running
        this.log('\n1. Checking if node client is running...', 'yellow');
        const nodeProcesses = this.runCommand('pgrep -f "node.*client.js"', true);
        if (nodeProcesses && nodeProcesses.trim()) {
            this.log('✅ Node client process found', 'green');
            const pid = nodeProcesses.trim().split('\n')[0];
            this.stats.clientPid = pid;
            
            // Check how long it's been running
            const uptime = this.runCommand(`ps -o etime= -p ${pid}`, true);
            if (uptime) {
                this.log(`   Uptime: ${uptime.trim()}`, 'cyan');
            }
        } else {
            this.log('❌ No node client process found', 'red');
            this.issues.push({
                type: 'critical',
                message: 'Node client not running',
                fix: 'Start with: node client.js',
                autofix: () => {
                    this.log('🔧 Starting node client...', 'blue');
                    this.runCommand('nohup node client.js > node.log 2>&1 &');
                }
            });
        }
    }

    async checkMeshConnectivity() {
        this.log('\n2. Testing mesh server connectivity...', 'yellow');
        
        const meshServer = process.env.IC_MESH_SERVER || 'https://moilol.com:8333';
        const response = this.runCommand(`curl -s -m 5 ${meshServer}/status`, true);
        
        if (response) {
            try {
                const status = JSON.parse(response);
                if (status.status === 'healthy') {
                    this.log('✅ Mesh server reachable and healthy', 'green');
                    this.stats.meshServer = 'healthy';
                } else {
                    this.log('⚠️ Mesh server reachable but unhealthy', 'yellow');
                    this.stats.meshServer = 'unhealthy';
                }
            } catch {
                this.log('⚠️ Mesh server responded but with invalid JSON', 'yellow');
            }
        } else {
            this.log('❌ Cannot reach mesh server', 'red');
            this.issues.push({
                type: 'critical',
                message: 'Mesh server unreachable',
                fix: 'Check internet connection and server status'
            });
        }
    }

    async checkEarningCapabilities() {
        this.log('\n3. Checking earning capabilities...', 'yellow');
        
        const capabilities = {
            ollama: 'ollama',
            whisper: 'whisper',
            ffmpeg: 'ffmpeg',
            python: 'python3'
        };
        
        let capabilityCount = 0;
        for (const [name, command] of Object.entries(capabilities)) {
            try {
                this.runCommand(`which ${command}`, true);
                this.log(`   ✅ ${name} installed`, 'green');
                capabilityCount++;
                
                if (name === 'ollama') {
                    const models = this.runCommand('ollama list 2>/dev/null', true);
                    if (models) {
                        const modelCount = models.split('\n').filter(line => line.trim() && !line.includes('NAME')).length;
                        if (modelCount > 0) {
                            this.log(`      ${modelCount} models available`, 'cyan');
                        } else {
                            this.log('      ⚠️ No models installed', 'yellow');
                            this.issues.push({
                                type: 'earning',
                                message: 'Ollama installed but no models',
                                fix: 'Install models: ollama pull llama3.1:8b'
                            });
                        }
                    }
                }
            } catch {
                this.log(`   ❌ ${name} not found`, 'red');
                if (name === 'ollama') {
                    this.issues.push({
                        type: 'earning',
                        message: 'Ollama not installed (high earning potential)',
                        fix: 'Install from https://ollama.com'
                    });
                }
            }
        }
        
        this.stats.capabilityCount = capabilityCount;
        
        if (capabilityCount >= 3) {
            this.log(`💰 Excellent earning potential (${capabilityCount}/4 capabilities)`, 'green');
        } else if (capabilityCount >= 2) {
            this.log(`🔶 Good earning potential (${capabilityCount}/4 capabilities)`, 'yellow');
        } else {
            this.log(`⚠️ Limited earning potential (${capabilityCount}/4 capabilities)`, 'red');
            this.issues.push({
                type: 'earning',
                message: 'Few capabilities installed',
                fix: 'Install Ollama, Whisper, and FFmpeg for maximum earnings'
            });
        }
    }

    async checkDatabaseHealth() {
        this.log('\n4. Checking local mesh database...', 'yellow');
        
        const dbPath = path.join(__dirname, '..', 'mesh.db');
        if (fs.existsSync(dbPath)) {
            this.log('✅ Mesh database found', 'green');
            
            try {
                const Database = require('better-sqlite3');
                const db = new Database(dbPath, { readonly: true });
                
                // Get recent jobs for this node
                const nodeId = process.env.IC_NODE_ID || this.getStoredNodeId();
                if (nodeId) {
                    const recentJobs = db.prepare(`
                        SELECT COUNT(*) as count, 
                               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
                        FROM jobs 
                        WHERE nodeId = ? AND createdAt > ?
                    `).get(nodeId, Date.now() - 24 * 60 * 60 * 1000);
                    
                    if (recentJobs.count > 0) {
                        this.log(`   Last 24h: ${recentJobs.completed}/${recentJobs.count} jobs completed`, 'cyan');
                        this.stats.recentJobs = recentJobs;
                        
                        if (recentJobs.completed === 0 && recentJobs.count > 0) {
                            this.issues.push({
                                type: 'performance',
                                message: 'Recent jobs failed to complete',
                                fix: 'Check node logs for error details'
                            });
                        }
                    } else {
                        this.log('   ⚠️ No recent jobs found', 'yellow');
                        this.issues.push({
                            type: 'earning',
                            message: 'No jobs assigned in last 24 hours',
                            fix: 'Check capability setup and ensure 24/7 operation'
                        });
                    }
                } else {
                    this.log('   ⚠️ Node ID not found', 'yellow');
                    this.issues.push({
                        type: 'config',
                        message: 'Node ID not configured',
                        fix: 'Register node with mesh server'
                    });
                }
                
                db.close();
            } catch (error) {
                this.log(`❌ Database error: ${error.message}`, 'red');
                this.issues.push({
                    type: 'critical',
                    message: 'Database corruption or access error',
                    fix: 'Restart node client to rebuild database'
                });
            }
        } else {
            this.log('⚠️ No local mesh database found', 'yellow');
            this.issues.push({
                type: 'config',
                message: 'Node has never connected to mesh',
                fix: 'Ensure node client runs successfully and connects'
            });
        }
    }

    getStoredNodeId() {
        try {
            // Check various places where node ID might be stored
            const configPath = path.join(__dirname, '..', 'node-config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                return config.nodeId;
            }
            
            const nodeIdPath = path.join(__dirname, '..', '.node-id');
            if (fs.existsSync(nodeIdPath)) {
                return fs.readFileSync(nodeIdPath, 'utf8').trim();
            }
        } catch {
            // Ignore errors
        }
        return null;
    }

    async checkSystemResources() {
        this.log('\n5. Checking system resources...', 'yellow');
        
        try {
            // Memory check
            const memInfo = fs.readFileSync('/proc/meminfo', 'utf8');
            const memTotal = parseInt(memInfo.match(/MemTotal:\s+(\d+)/)[1]) * 1024;
            const memAvailable = parseInt(memInfo.match(/MemAvailable:\s+(\d+)/)[1]) * 1024;
            const memUsed = memTotal - memAvailable;
            const memPercent = Math.round((memUsed / memTotal) * 100);
            
            if (memPercent > 90) {
                this.log(`❌ Memory usage high: ${memPercent}%`, 'red');
                this.issues.push({
                    type: 'performance',
                    message: 'High memory usage may affect job performance',
                    fix: 'Free up memory or add more RAM'
                });
            } else if (memPercent > 80) {
                this.log(`⚠️ Memory usage: ${memPercent}%`, 'yellow');
            } else {
                this.log(`✅ Memory usage: ${memPercent}%`, 'green');
            }
            
            // Disk space check
            const df = this.runCommand('df . | tail -1', true);
            if (df) {
                const parts = df.trim().split(/\s+/);
                const usagePercent = parseInt(parts[4]);
                
                if (usagePercent > 90) {
                    this.log(`❌ Disk usage high: ${usagePercent}%`, 'red');
                    this.issues.push({
                        type: 'critical',
                        message: 'Low disk space may prevent job processing',
                        fix: 'Free up disk space'
                    });
                } else if (usagePercent > 80) {
                    this.log(`⚠️ Disk usage: ${usagePercent}%`, 'yellow');
                } else {
                    this.log(`✅ Disk usage: ${usagePercent}%`, 'green');
                }
            }
        } catch (error) {
            this.log('⚠️ Could not check system resources', 'yellow');
        }
    }

    displayDiagnosis() {
        this.log('\n📊 DIAGNOSIS SUMMARY', 'cyan');
        this.log('═'.repeat(40), 'cyan');
        
        if (this.issues.length === 0) {
            this.log('🎉 All systems healthy! Your node is ready to earn.', 'green');
            
            if (this.stats.capabilityCount < 4) {
                this.log('\n💡 Optimization tip: Install more capabilities for higher earnings', 'yellow');
            }
            
            return;
        }
        
        // Group issues by type
        const critical = this.issues.filter(i => i.type === 'critical');
        const earning = this.issues.filter(i => i.type === 'earning');
        const performance = this.issues.filter(i => i.type === 'performance');
        const config = this.issues.filter(i => i.type === 'config');
        
        if (critical.length > 0) {
            this.log('\n🚨 Critical Issues (Fix Immediately):', 'red');
            critical.forEach(issue => {
                this.log(`   ❌ ${issue.message}`, 'red');
                this.log(`      Fix: ${issue.fix}`, 'yellow');
            });
        }
        
        if (earning.length > 0) {
            this.log('\n💰 Earning Optimization:', 'yellow');
            earning.forEach(issue => {
                this.log(`   ⚠️ ${issue.message}`, 'yellow');
                this.log(`      Suggestion: ${issue.fix}`, 'cyan');
            });
        }
        
        if (performance.length > 0) {
            this.log('\n⚡ Performance Issues:', 'yellow');
            performance.forEach(issue => {
                this.log(`   ⚠️ ${issue.message}`, 'yellow');
                this.log(`      Fix: ${issue.fix}`, 'cyan');
            });
        }
        
        if (config.length > 0) {
            this.log('\n⚙️ Configuration Issues:', 'blue');
            config.forEach(issue => {
                this.log(`   🔧 ${issue.message}`, 'blue');
                this.log(`      Fix: ${issue.fix}`, 'cyan');
            });
        }
        
        if (this.autofix && critical.length > 0) {
            this.log('\n🔧 Attempting automatic fixes...', 'blue');
            for (const issue of critical) {
                if (issue.autofix) {
                    try {
                        issue.autofix();
                        this.log(`✅ Fixed: ${issue.message}`, 'green');
                    } catch (error) {
                        this.log(`❌ Auto-fix failed: ${error.message}`, 'red');
                    }
                }
            }
        }
    }

    async run() {
        try {
            await this.checkNodeStatus();
            await this.checkMeshConnectivity();
            await this.checkEarningCapabilities();
            await this.checkDatabaseHealth();
            await this.checkSystemResources();
            this.displayDiagnosis();
            
            this.log('\n💡 Next steps:', 'bright');
            if (this.issues.filter(i => i.type === 'critical').length > 0) {
                this.log('   1. Fix critical issues listed above', 'red');
                this.log('   2. Re-run doctor: node scripts/node-doctor.js', 'cyan');
            } else {
                this.log('   1. Monitor your earnings: https://moilol.com/account', 'cyan');
                this.log('   2. Check node status regularly', 'cyan');
                if (this.stats.capabilityCount < 4) {
                    this.log('   3. Install more capabilities for higher earnings', 'yellow');
                }
            }
            
        } catch (error) {
            this.log(`\n💥 Doctor encountered an error: ${error.message}`, 'red');
        }
    }
}

// CLI execution
if (require.main === module) {
    const doctor = new NodeDoctor();
    doctor.run();
}

module.exports = NodeDoctor;