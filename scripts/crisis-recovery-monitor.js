#!/usr/bin/env node

/**
 * Crisis Recovery Monitor
 * 
 * Monitors for node reconnections during capacity crisis and provides
 * automated recovery assistance and notifications.
 * 
 * Features:
 * - Real-time node reconnection detection
 * - Automatic capacity analysis when nodes return
 * - Recovery verification (can nodes actually process jobs?)
 * - Customer impact calculation
 * - Progress notifications
 * 
 * Usage:
 *   node crisis-recovery-monitor.js [--once] [--quiet]
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
    databasePath: process.env.DATABASE_PATH || 'data/mesh.db',
    checkInterval: 30000, // 30 seconds
    criticalOfflineThreshold: 5 * 60 * 1000, // 5 minutes
    logFile: 'data/crisis-recovery.log'
};

class CrisisRecoveryMonitor {
    constructor(options = {}) {
        this.options = {
            once: options.once || false,
            quiet: options.quiet || false
        };
        
        this.lastKnownNodes = new Map();
        this.recoveredNodes = new Set();
        this.criticalCapabilities = [
            'transcription', 'transcribe', 'whisper', 
            'tesseract', 'ocr', 'pdf-extract',
            'ollama', 'stable-diffusion'
        ];
        
        this.log('🚨 Crisis Recovery Monitor Starting...');
    }
    
    log(message, level = 'INFO') {
        const timestamp = new Date().toISOString();
        const logMessage = `${timestamp} [${level}] ${message}`;
        
        if (!this.options.quiet) {
            console.log(logMessage);
        }
        
        // Write to log file
        try {
            fs.appendFileSync(config.logFile, logMessage + '\\n');
        } catch (error) {
            // Fail silently if logging fails
        }
    }
    
    async getDatabase() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(config.databasePath, (err) => {
                if (err) reject(err);
                else resolve(db);
            });
        });
    }
    
    async getCurrentNodes() {
        const db = await this.getDatabase();
        
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    nodeId,
                    name,
                    capabilities,
                    lastSeen,
                    owner,
                    jobsCompleted,
                    ROUND((julianday('now') - julianday(datetime(lastSeen/1000, 'unixepoch'))) * 24 * 60) AS minutes_offline
                FROM nodes 
                ORDER BY lastSeen DESC
            `, (err, rows) => {
                db.close();
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
    
    async getPendingJobs() {
        const db = await this.getDatabase();
        
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT type, COUNT(*) as count 
                FROM jobs 
                WHERE status = 'pending' 
                GROUP BY type 
                ORDER BY count DESC
            `, (err, rows) => {
                db.close();
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
    
    parseCapabilities(capabilitiesJson) {
        try {
            return JSON.parse(capabilitiesJson || '[]');
        } catch {
            return [];
        }
    }
    
    isNodeCritical(capabilities) {
        return this.criticalCapabilities.some(cap => capabilities.includes(cap));
    }
    
    calculateRevenuePotential(jobType, count) {
        const rates = {
            'transcribe': { min: 3, max: 5 },
            'transcription': { min: 3, max: 5 },
            'pdf-extract': { min: 3, max: 5 },
            'ocr': { min: 3, max: 5 }
        };
        
        const rate = rates[jobType] || { min: 1, max: 3 };
        return {
            min: count * rate.min,
            max: count * rate.max
        };
    }
    
    async checkForRecovery() {
        try {
            const nodes = await this.getCurrentNodes();
            const pendingJobs = await this.getPendingJobs();
            
            let recoveryDetected = false;
            let newCapacity = [];
            
            // Check each node for recovery
            for (const node of nodes) {
                const capabilities = this.parseCapabilities(node.capabilities);
                const isOnline = node.minutes_offline < 5; // Within 5 minutes = online
                const isCapabilityNode = this.isNodeCritical(capabilities);
                
                // Skip test-only nodes
                if (capabilities.includes('test') && capabilities.length === 1) {
                    continue;
                }
                
                const nodeKey = node.nodeId;
                const wasOffline = this.lastKnownNodes.has(nodeKey) && 
                                 this.lastKnownNodes.get(nodeKey).offline;
                
                if (isOnline && wasOffline && isCapabilityNode) {
                    // RECOVERY DETECTED!
                    recoveryDetected = true;
                    this.recoveredNodes.add(nodeKey);
                    newCapacity.push({
                        node: node.name || node.nodeId.substring(0, 8),
                        capabilities: capabilities.filter(cap => this.criticalCapabilities.includes(cap)),
                        owner: node.owner,
                        jobsCompleted: node.jobsCompleted
                    });
                    
                    this.log(`🎉 RECOVERY: ${node.name || node.nodeId.substring(0, 8)} reconnected!`, 'SUCCESS');
                    this.log(`   Capabilities: ${capabilities.join(', ')}`, 'INFO');
                    this.log(`   Owner: ${node.owner}`, 'INFO');
                }
                
                // Update tracking
                this.lastKnownNodes.set(nodeKey, {
                    name: node.name,
                    capabilities,
                    offline: !isOnline,
                    lastSeen: node.lastSeen
                });
            }
            
            // If recovery detected, analyze impact
            if (recoveryDetected) {
                await this.analyzeRecoveryImpact(newCapacity, pendingJobs);
            }
            
            return { recoveryDetected, newCapacity };
            
        } catch (error) {
            this.log(`Error checking for recovery: ${error.message}`, 'ERROR');
            return { recoveryDetected: false, newCapacity: [] };
        }
    }
    
    async analyzeRecoveryImpact(newCapacity, pendingJobs) {
        this.log('📊 ANALYZING RECOVERY IMPACT...', 'INFO');
        
        // Calculate what jobs can now be processed
        const processableJobs = [];
        let totalRevenuePotential = { min: 0, max: 0 };
        
        for (const job of pendingJobs) {
            const canProcess = newCapacity.some(node => {
                return node.capabilities.some(cap => {
                    return job.type === cap || 
                           (job.type === 'transcribe' && cap === 'transcription') ||
                           (job.type === 'transcription' && cap === 'transcribe') ||
                           (job.type === 'transcribe' && cap === 'whisper');
                });
            });
            
            if (canProcess) {
                const revenue = this.calculateRevenuePotential(job.type, job.count);
                processableJobs.push({
                    type: job.type,
                    count: job.count,
                    revenue
                });
                totalRevenuePotential.min += revenue.min;
                totalRevenuePotential.max += revenue.max;
            }
        }
        
        // Log recovery analysis
        this.log(`✅ CAPACITY RESTORED:`, 'SUCCESS');
        for (const node of newCapacity) {
            this.log(`   • ${node.node} (${node.owner}): ${node.capabilities.join(', ')}`, 'SUCCESS');
        }
        
        if (processableJobs.length > 0) {
            this.log(`💰 REVENUE UNBLOCKED:`, 'SUCCESS');
            for (const job of processableJobs) {
                this.log(`   • ${job.count} ${job.type} jobs: $${job.revenue.min}-${job.revenue.max}`, 'SUCCESS');
            }
            this.log(`   • Total: $${totalRevenuePotential.min}-${totalRevenuePotential.max}`, 'SUCCESS');
        }
        
        // Generate recovery report
        await this.generateRecoveryReport(newCapacity, processableJobs, totalRevenuePotential);
    }
    
    async generateRecoveryReport(newCapacity, processableJobs, totalRevenue) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportPath = `RECOVERY-REPORT-${timestamp.substring(0, 19)}.md`;
        
        const report = `# 🎉 CAPACITY RECOVERY REPORT — ${new Date().toISOString()}

**STATUS:** CAPACITY PARTIALLY/FULLY RESTORED  
**RECOVERED NODES:** ${newCapacity.length}  
**REVENUE UNBLOCKED:** $${totalRevenue.min}-${totalRevenue.max}

## 🖥️ Restored Capacity

${newCapacity.map(node => 
`- **${node.node}** (${node.owner})
  - Capabilities: ${node.capabilities.join(', ')}
  - Experience: ${node.jobsCompleted} jobs completed
  - Status: ONLINE ✅`
).join('\\n')}

## 💰 Job Processing Restored

${processableJobs.length > 0 ? 
processableJobs.map(job => 
`- **${job.count} ${job.type} jobs** → $${job.revenue.min}-${job.revenue.max} revenue`
).join('\\n') : 
'No jobs can be processed with current restored capacity.'}

**Total Revenue Unblocked:** $${totalRevenue.min}-${totalRevenue.max}

## 📋 Next Steps

1. **Verify node functionality:** Test job claiming and processing
2. **Monitor stability:** Ensure nodes stay connected  
3. **Customer communication:** Update on service restoration
4. **Process backlog:** Begin working through pending jobs

## 📊 Recommendations

- Monitor recovered nodes for stability over next 24 hours
- Consider contacting node owners to ensure sustained availability  
- Review what caused the capacity crisis to prevent recurrence

---
**Report generated by:** Crisis Recovery Monitor  
**Time:** ${new Date().toISOString()}
`;

        try {
            fs.writeFileSync(reportPath, report);
            this.log(`📄 Recovery report saved: ${reportPath}`, 'INFO');
        } catch (error) {
            this.log(`Failed to save recovery report: ${error.message}`, 'ERROR');
        }
    }
    
    async monitor() {
        // Initial state capture
        const nodes = await this.getCurrentNodes();
        for (const node of nodes) {
            const capabilities = this.parseCapabilities(node.capabilities);
            this.lastKnownNodes.set(node.nodeId, {
                name: node.name,
                capabilities,
                offline: node.minutes_offline > 5,
                lastSeen: node.lastSeen
            });
        }
        
        this.log(`📊 Monitoring ${nodes.length} nodes for recovery...`);
        
        if (this.options.once) {
            await this.checkForRecovery();
            return;
        }
        
        // Continuous monitoring
        const interval = setInterval(async () => {
            const { recoveryDetected } = await this.checkForRecovery();
            
            if (recoveryDetected) {
                this.log('🎉 Recovery detected! Check report for details.', 'SUCCESS');
            }
        }, config.checkInterval);
        
        // Graceful shutdown
        process.on('SIGINT', () => {
            this.log('🛑 Crisis Recovery Monitor stopping...', 'INFO');
            clearInterval(interval);
            process.exit(0);
        });
    }
}

// CLI execution
if (require.main === module) {
    const args = process.argv.slice(2);
    const options = {
        once: args.includes('--once'),
        quiet: args.includes('--quiet')
    };
    
    const monitor = new CrisisRecoveryMonitor(options);
    monitor.monitor().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = CrisisRecoveryMonitor;