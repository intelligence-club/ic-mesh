#!/usr/bin/env node
/**
 * Quarantine Recovery System - Safe node recovery and capability management
 * 
 * Analyzes quarantined nodes, tests specific capabilities, and provides 
 * selective recovery options to maximize network capacity while maintaining safety.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/mesh.db');

class QuarantineRecoverySystem {
    constructor() {
        this.db = new sqlite3.Database(dbPath);
    }

    async analyzeQuarantinedNodes() {
        console.log('🏥 Quarantine Recovery System - Node Analysis\n');

        const quarantinedNodes = await this.getQuarantinedNodes();
        
        if (quarantinedNodes.length === 0) {
            console.log('✅ No quarantined nodes found - all nodes healthy');
            this.close();
            return;
        }

        console.log(`🔒 Found ${quarantinedNodes.length} quarantined node(s):\n`);

        for (const node of quarantinedNodes) {
            await this.analyzeNode(node);
        }

        console.log('\n🎯 Recovery Recommendations:\n');
        await this.generateRecoveryPlan(quarantinedNodes);
    }

    async getQuarantinedNodes() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    nodeId,
                    name,
                    capabilities,
                    flags,
                    lastSeen,
                    datetime(registeredAt/1000, 'unixepoch') as registeredTime,
                    datetime(lastSeen/1000, 'unixepoch') as lastSeenTime
                FROM nodes 
                WHERE JSON_EXTRACT(flags, '$.quarantined') = 1
                ORDER BY lastSeen DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    async analyzeNode(node) {
        const flags = JSON.parse(node.flags || '{}');
        const capabilities = JSON.parse(node.capabilities || '[]');
        const minutesOffline = Math.round((Date.now() - node.lastSeen) / (1000 * 60));
        
        console.log(`📊 Node Analysis: ${node.nodeId.slice(0,8)} (${node.name || 'unnamed'})`);
        console.log(`   Last seen: ${node.lastSeenTime} (${minutesOffline}m ago)`);
        console.log(`   Total capabilities: ${capabilities.length}`);
        console.log(`   Available: ${capabilities.join(', ')}`);
        
        // Analyze quarantine details
        if (flags.quarantined) {
            console.log(`   🔒 Quarantine date: ${new Date(flags.quarantinedAt).toISOString()}`);
            if (flags.blockedCapabilities) {
                console.log(`   ❌ Blocked capabilities: ${flags.blockedCapabilities.join(', ')}`);
                console.log(`   📝 Block reason: ${flags.blockReason || 'Not specified'}`);
                
                // Calculate recovery potential
                const blockedCount = flags.blockedCapabilities.length;
                const availableCount = capabilities.length - blockedCount;
                const recoveryPotential = availableCount / capabilities.length * 100;
                
                console.log(`   🔓 Recovery potential: ${recoveryPotential.toFixed(1)}% (${availableCount}/${capabilities.length} capabilities)`);
                
                if (availableCount > 0) {
                    const availableCapabilities = capabilities.filter(cap => 
                        !flags.blockedCapabilities.includes(cap)
                    );
                    console.log(`   ✅ Safe to recover: ${availableCapabilities.join(', ')}`);
                }
            }
        }

        // Check pending jobs that need this node's capabilities
        const pendingJobs = await this.getPendingJobsForCapabilities(capabilities);
        if (pendingJobs.length > 0) {
            console.log(`   🚦 Pending jobs needing this node: ${pendingJobs.length}`);
            const jobTypes = {};
            pendingJobs.forEach(job => {
                jobTypes[job.type] = (jobTypes[job.type] || 0) + 1;
            });
            Object.entries(jobTypes).forEach(([type, count]) => {
                console.log(`      • ${type}: ${count} jobs`);
            });
        }

        console.log('');
    }

    async getPendingJobsForCapabilities(nodeCapabilities) {
        return new Promise((resolve, reject) => {
            // Get all pending jobs
            this.db.all(`
                SELECT type, COUNT(*) as count
                FROM jobs 
                WHERE status = 'pending'
                GROUP BY type
            `, (err, jobTypes) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Filter for jobs this node could handle
                const relevantJobs = [];
                jobTypes.forEach(jobType => {
                    // Simple capability mapping - could be more sophisticated
                    if (nodeCapabilities.includes(jobType.type) || 
                        (jobType.type === 'ocr' && nodeCapabilities.includes('tesseract')) ||
                        (jobType.type === 'transcribe' && nodeCapabilities.includes('whisper')) ||
                        (jobType.type === 'pdf-extract' && nodeCapabilities.includes('tesseract'))) {
                        
                        for (let i = 0; i < jobType.count; i++) {
                            relevantJobs.push({ type: jobType.type });
                        }
                    }
                });

                resolve(relevantJobs);
            });
        });
    }

    async generateRecoveryPlan(quarantinedNodes) {
        for (const node of quarantinedNodes) {
            const flags = JSON.parse(node.flags || '{}');
            const capabilities = JSON.parse(node.capabilities || '[]');
            
            console.log(`🔧 Recovery Plan: ${node.nodeId.slice(0,8)}`);
            
            if (flags.blockedCapabilities && flags.blockedCapabilities.length < capabilities.length) {
                const safeCapabilities = capabilities.filter(cap => 
                    !flags.blockedCapabilities.includes(cap)
                );
                
                console.log(`   ✅ SAFE PARTIAL RECOVERY AVAILABLE`);
                console.log(`   • Can recover: ${safeCapabilities.join(', ')}`);
                console.log(`   • Keep blocked: ${flags.blockedCapabilities.join(', ')}`);
                console.log(`   • Command: node scripts/quarantine-recovery-system.js --partial-recover ${node.nodeId.slice(0,8)}`);
                
                // Check specific high-value capabilities
                if (safeCapabilities.includes('tesseract')) {
                    console.log(`   🎯 HIGH PRIORITY: Node has tesseract - can resolve OCR backlog`);
                }
                if (safeCapabilities.includes('ollama')) {
                    console.log(`   🎯 HIGH VALUE: Node has ollama - adds AI generation capacity`);
                }
            } else {
                console.log(`   ⚠️  Full quarantine - manual investigation required`);
                console.log(`   • Reason: ${flags.blockReason || 'Unknown'}`);
                console.log(`   • Action needed: Check node logs and fix underlying issues`);
            }
            console.log('');
        }
    }

    async performPartialRecovery(nodeIdPrefix) {
        console.log(`🔄 Performing partial recovery for node: ${nodeIdPrefix}...\n`);
        
        // Find the full node ID
        const nodes = await this.getQuarantinedNodes();
        const targetNode = nodes.find(node => node.nodeId.startsWith(nodeIdPrefix));
        
        if (!targetNode) {
            console.log(`❌ Node not found or not quarantined: ${nodeIdPrefix}`);
            this.close();
            return;
        }

        const flags = JSON.parse(targetNode.flags || '{}');
        const capabilities = JSON.parse(targetNode.capabilities || '[]');
        
        if (!flags.blockedCapabilities) {
            console.log(`❌ No blocked capabilities found - cannot perform partial recovery`);
            this.close();
            return;
        }

        const safeCapabilities = capabilities.filter(cap => 
            !flags.blockedCapabilities.includes(cap)
        );

        if (safeCapabilities.length === 0) {
            console.log(`❌ No safe capabilities to recover`);
            this.close();
            return;
        }

        // Create new flags with selective capability blocks
        const newFlags = {
            ...flags,
            quarantined: false, // Remove full quarantine
            partiallyQuarantined: true,
            blockedCapabilities: flags.blockedCapabilities, // Keep capability blocks
            recoveredAt: new Date().toISOString(),
            recoveryType: 'partial',
            recoveredCapabilities: safeCapabilities
        };

        console.log(`✅ Recovering capabilities: ${safeCapabilities.join(', ')}`);
        console.log(`🔒 Keeping blocked: ${flags.blockedCapabilities.join(', ')}`);

        // Update the database
        await this.updateNodeFlags(targetNode.nodeId, newFlags);
        
        console.log(`\n🎉 Partial recovery complete for node ${nodeIdPrefix}`);
        console.log(`   Node can now accept jobs for: ${safeCapabilities.join(', ')}`);
        console.log(`   Blocked capabilities remain quarantined for safety`);
        
        // Show immediate impact
        const pendingJobs = await this.getPendingJobsForCapabilities(safeCapabilities);
        if (pendingJobs.length > 0) {
            console.log(`\n📈 Immediate impact: ${pendingJobs.length} pending jobs can now be processed`);
        }
    }

    async updateNodeFlags(nodeId, newFlags) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE nodes SET flags = ? WHERE nodeId = ?',
                [JSON.stringify(newFlags), nodeId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    close() {
        this.db.close();
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    const system = new QuarantineRecoverySystem();

    try {
        if (args.includes('--partial-recover')) {
            const nodeIdIndex = args.indexOf('--partial-recover') + 1;
            const nodeId = args[nodeIdIndex];
            if (!nodeId) {
                console.log('❌ Please provide a node ID prefix for partial recovery');
                console.log('Usage: node quarantine-recovery-system.js --partial-recover <nodeId>');
                process.exit(1);
            }
            await system.performPartialRecovery(nodeId);
        } else {
            await system.analyzeQuarantinedNodes();
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        system.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = { QuarantineRecoverySystem };