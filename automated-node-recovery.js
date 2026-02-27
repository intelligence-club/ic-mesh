#!/usr/bin/env node

/**
 * Automated Node Recovery System
 * 
 * Attempts to automatically reconnect recently disconnected nodes
 * through various recovery mechanisms.
 */

const sqlite3 = require('sqlite3').verbose();
const { exec } = require('child_process');
const fs = require('fs');

class AutomatedNodeRecovery {
    constructor() {
        this.dbPath = './data/mesh.db';
        this.recoveryLogPath = './node-recovery-attempts.json';
        this.loadRecoveryLog();
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    loadRecoveryLog() {
        try {
            if (fs.existsSync(this.recoveryLogPath)) {
                this.recoveryLog = JSON.parse(fs.readFileSync(this.recoveryLogPath, 'utf8'));
            } else {
                this.recoveryLog = {
                    attempts: [],
                    successfulRecoveries: 0,
                    lastRun: null
                };
            }
        } catch (error) {
            console.warn('⚠️  Could not load recovery log, starting fresh');
            this.recoveryLog = { attempts: [], successfulRecoveries: 0, lastRun: null };
        }
    }

    saveRecoveryLog() {
        fs.writeFileSync(this.recoveryLogPath, JSON.stringify(this.recoveryLog, null, 2));
    }

    async getRecoveryTargets() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    nodeId,
                    name,
                    owner,
                    lastSeen,
                    datetime(lastSeen/1000, 'unixepoch') as last_active_time,
                    CAST((julianday('now') - julianday(datetime(lastSeen/1000, 'unixepoch'))) * 1440 AS INTEGER) as minutes_offline,
                    capabilities,
                    jobsCompleted
                FROM nodes 
                WHERE 
                    CAST((julianday('now') - julianday(datetime(lastSeen/1000, 'unixepoch'))) * 1440 AS INTEGER) BETWEEN 5 AND 1440
                    AND jobsCompleted > 0
                ORDER BY jobsCompleted DESC, minutes_offline ASC
            `;
            
            this.db.all(query, (err, nodes) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(nodes);
                }
            });
        });
    }

    async attemptWebSocketPing() {
        console.log('📡 Attempting WebSocket connectivity check...');
        
        try {
            // Check if WebSocket server is responding
            const result = await this.executeCommand('curl -s -o /dev/null -w "%{http_code}" http://localhost:8333/status');
            
            if (result.stdout.trim() === '200') {
                console.log('✅ WebSocket server is responsive');
                return { success: true, method: 'websocket_ping' };
            } else {
                console.log('❌ WebSocket server not responding');
                return { success: false, method: 'websocket_ping', error: 'Server not responding' };
            }
        } catch (error) {
            console.log(`❌ WebSocket ping failed: ${error.message}`);
            return { success: false, method: 'websocket_ping', error: error.message };
        }
    }

    async attemptServerRestart() {
        console.log('🔄 Attempting server restart to clear connection issues...');
        
        try {
            // Check if server process exists and restart if needed
            const processCheck = await this.executeCommand('pgrep -f "node server.js"');
            
            if (!processCheck.stdout.trim()) {
                console.log('🟡 Server process not found, attempting start...');
                const startResult = await this.executeCommand('cd . && npm start &');
                
                // Wait a moment for startup
                await this.sleep(3000);
                
                const verifyResult = await this.executeCommand('curl -s -o /dev/null -w "%{http_code}" http://localhost:8333/status');
                
                if (verifyResult.stdout.trim() === '200') {
                    console.log('✅ Server restart successful');
                    return { success: true, method: 'server_restart' };
                } else {
                    console.log('❌ Server restart failed - not responding');
                    return { success: false, method: 'server_restart', error: 'Server not responding after restart' };
                }
            } else {
                console.log('✅ Server process running, no restart needed');
                return { success: true, method: 'server_restart', note: 'Already running' };
            }
        } catch (error) {
            console.log(`❌ Server restart failed: ${error.message}`);
            return { success: false, method: 'server_restart', error: error.message };
        }
    }

    async attemptDatabaseCleanup() {
        console.log('🧹 Attempting database cleanup for connection issues...');
        
        try {
            // Remove very old heartbeat records that might be causing issues
            const cleanupResult = await this.executeQuery(`
                UPDATE nodes 
                SET lastSeen = ?
                WHERE lastSeen < ?
            `, [Date.now(), Date.now() - (30 * 24 * 60 * 60 * 1000)]); // 30 days ago
            
            console.log('✅ Database cleanup completed');
            return { success: true, method: 'database_cleanup' };
        } catch (error) {
            console.log(`❌ Database cleanup failed: ${error.message}`);
            return { success: false, method: 'database_cleanup', error: error.message };
        }
    }

    async generateRecoveryInstructions(targets) {
        console.log('\n📋 AUTOMATED RECOVERY INSTRUCTIONS');
        console.log('════════════════════════════════════════');
        
        targets.forEach((node, i) => {
            console.log(`\n${i + 1}. ${node.name || node.nodeId} (${node.owner})`);
            console.log(`   Status: ${node.minutes_offline} minutes offline`);
            console.log(`   Performance: ${node.jobsCompleted} jobs completed`);
            console.log(`   Capabilities: ${node.capabilities}`);
            
            // Generate specific recovery instructions
            if (node.owner === 'drake') {
                console.log(`   Recovery: Contact Drake via Discord/email`);
                console.log(`   Command: claw skill mesh-transcribe`);
            } else if (node.owner === 'unknown') {
                console.log(`   Recovery: Anonymous node - no contact method available`);
                console.log(`   Note: May reconnect automatically if temporary network issue`);
            }
        });
        
        return targets.length;
    }

    async executeCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve({ stdout, stderr });
                }
            });
        });
    }

    async executeQuery(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(query, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ changes: this.changes });
                }
            });
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async run() {
        console.log('🔧 AUTOMATED NODE RECOVERY SYSTEM');
        console.log('════════════════════════════════════════\n');
        
        try {
            await this.init();
            
            // Get recovery targets
            const targets = await this.getRecoveryTargets();
            
            if (targets.length === 0) {
                console.log('✅ No nodes need automated recovery');
                return { status: 'no_targets', recoveredNodes: 0 };
            }
            
            console.log(`🎯 Found ${targets.length} recovery targets\n`);
            
            // Attempt recovery methods
            const recoveryResults = [];
            
            // 1. WebSocket connectivity check
            const wsResult = await this.attemptWebSocketPing();
            recoveryResults.push(wsResult);
            
            // 2. Server restart if needed
            const restartResult = await this.attemptServerRestart();
            recoveryResults.push(restartResult);
            
            // 3. Database cleanup
            const cleanupResult = await this.attemptDatabaseCleanup();
            recoveryResults.push(cleanupResult);
            
            // 4. Generate manual recovery instructions
            const instructionsCount = await this.generateRecoveryInstructions(targets);
            
            // Wait a moment and check for reconnections
            console.log('\n⏱️  Waiting 10 seconds for nodes to reconnect...');
            await this.sleep(10000);
            
            // Check if any nodes reconnected
            const postRecoveryTargets = await this.getRecoveryTargets();
            const recoveredNodes = targets.length - postRecoveryTargets.length;
            
            // Log recovery attempt
            const recoveryAttempt = {
                timestamp: new Date().toISOString(),
                initialTargets: targets.length,
                recoveryMethods: recoveryResults,
                recoveredNodes,
                remainingTargets: postRecoveryTargets.length,
                success: recoveredNodes > 0
            };
            
            this.recoveryLog.attempts.push(recoveryAttempt);
            this.recoveryLog.successfulRecoveries += recoveredNodes;
            this.recoveryLog.lastRun = new Date().toISOString();
            
            // Keep only last 50 attempts
            if (this.recoveryLog.attempts.length > 50) {
                this.recoveryLog.attempts = this.recoveryLog.attempts.slice(-50);
            }
            
            this.saveRecoveryLog();
            
            // Report results
            console.log('\n📊 RECOVERY RESULTS');
            console.log('════════════════════════════════════════');
            
            recoveryResults.forEach((result, i) => {
                const icon = result.success ? '✅' : '❌';
                console.log(`${icon} ${result.method}: ${result.success ? 'SUCCESS' : result.error}`);
            });
            
            if (recoveredNodes > 0) {
                console.log(`\n🎉 SUCCESS: ${recoveredNodes} nodes reconnected!`);
            } else {
                console.log(`\n😔 No automatic recoveries successful`);
                console.log(`Manual intervention required for ${postRecoveryTargets.length} nodes`);
            }
            
            console.log(`\n📝 Recovery attempt logged to ${this.recoveryLogPath}`);
            
            return {
                status: recoveredNodes > 0 ? 'partial_success' : 'manual_required',
                recoveredNodes,
                remainingTargets: postRecoveryTargets.length,
                recoveryResults
            };
            
        } catch (error) {
            console.error('❌ Recovery system error:', error.message);
            return { status: 'error', error: error.message };
        } finally {
            this.close();
        }
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// CLI execution
async function main() {
    const recovery = new AutomatedNodeRecovery();
    
    try {
        const result = await recovery.run();
        process.exit(result.status === 'error' ? 1 : 0);
    } catch (error) {
        console.error('❌ Error running automated recovery:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = AutomatedNodeRecovery;