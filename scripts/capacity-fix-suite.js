#!/usr/bin/env node
/**
 * Capacity Fix Suite
 * 
 * Targeted fixes for identified capacity issues:
 * 1. Unquarantine capable nodes for needed capabilities
 * 2. Reset processing for stuck transcribe jobs
 * 3. Create operator alerts for missing capabilities
 */

const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

class CapacityFixSuite {
    constructor() {
        this.db = null;
        this.fixes = [];
    }

    async init() {
        console.log('🔧 Capacity Fix Suite');
        console.log('======================');
        console.log(`Started: ${new Date().toISOString()}\n`);

        this.db = new sqlite3.Database('data/mesh.db', (err) => {
            if (err) {
                console.error('❌ Database connection failed:', err.message);
                process.exit(1);
            }
        });

        await this.runFixes();
    }

    async runFixes() {
        console.log('🔍 ANALYZING CURRENT ISSUES');
        console.log('────────────────────────────');

        const issues = await this.analyzeIssues();
        this.displayIssues(issues);

        console.log('⚡ APPLYING AUTOMATED FIXES');
        console.log('────────────────────────────');

        // Fix 1: Unquarantine nodes for critical capabilities
        await this.fixQuarantinedCapabilities(issues);

        // Fix 2: Reset old pending jobs that might be stuck
        await this.resetStuckJobs();

        // Fix 3: Generate recruitment alerts
        await this.generateRecruitmentAlerts(issues);

        // Verify fixes
        console.log('✅ VERIFICATION');
        console.log('───────────────');
        const postFixIssues = await this.analyzeIssues();
        this.displayFixResults(issues, postFixIssues);
    }

    async analyzeIssues() {
        const jobTypes = await this.getBlockedJobTypes();
        const quarantinedNodes = await this.getQuarantinedNodes();
        const oldJobs = await this.getOldJobs();

        return {
            blockedJobTypes: jobTypes,
            quarantinedNodes: quarantinedNodes,
            oldJobs: oldJobs
        };
    }

    async getBlockedJobTypes() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    type,
                    COUNT(*) as count
                FROM jobs 
                WHERE status = 'pending'
                GROUP BY type
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async getQuarantinedNodes() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    nodeId,
                    capabilities,
                    flags
                FROM nodes
                WHERE flags IS NOT NULL AND flags != '{}'
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async getOldJobs() {
        return new Promise((resolve, reject) => {
            const cutoffTime = Math.floor(Date.now() / 1000) - (2 * 60 * 60); // 2 hours ago
            
            this.db.all(`
                SELECT 
                    type,
                    COUNT(*) as count,
                    MIN(createdAt) as oldestTimestamp
                FROM jobs 
                WHERE status = 'pending' 
                AND createdAt < ?
                GROUP BY type
            `, [cutoffTime], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    displayIssues(issues) {
        console.log(`🔴 Blocked job types: ${issues.blockedJobTypes.length}`);
        issues.blockedJobTypes.forEach(job => {
            console.log(`  • ${job.type}: ${job.count} jobs`);
        });

        console.log(`🚫 Quarantined nodes: ${issues.quarantinedNodes.length}`);
        issues.quarantinedNodes.forEach(node => {
            const nodeIdShort = node.nodeId.substring(0, 8);
            const flags = JSON.parse(node.flags || '{}');
            console.log(`  • ${nodeIdShort}: ${JSON.stringify(flags.blockedCapabilities || [])}`);
        });

        console.log(`⏰ Old pending jobs: ${issues.oldJobs.length} types`);
        issues.oldJobs.forEach(job => {
            const age = this.formatAge(job.oldestTimestamp);
            console.log(`  • ${job.type}: ${job.count} jobs (oldest: ${age})`);
        });

        console.log('');
    }

    async fixQuarantinedCapabilities(issues) {
        console.log('🔓 Fixing quarantined capabilities...');

        for (const node of issues.quarantinedNodes) {
            const nodeIdShort = node.nodeId.substring(0, 8);
            const flags = JSON.parse(node.flags || '{}');
            const blockedCapabilities = flags.blockedCapabilities || [];
            const nodeCapabilities = JSON.parse(node.capabilities || '[]');

            // Check if this node has capabilities needed for blocked job types
            const neededCapabilities = [];
            issues.blockedJobTypes.forEach(jobType => {
                if (nodeCapabilities.includes(jobType.type) && blockedCapabilities.includes(jobType.type)) {
                    neededCapabilities.push(jobType.type);
                }
            });

            if (neededCapabilities.length > 0) {
                console.log(`  Unquarantining ${nodeIdShort} for: ${neededCapabilities.join(', ')}`);
                
                // Remove blocked capabilities for critical needs
                const updatedBlockedCapabilities = blockedCapabilities.filter(cap => 
                    !neededCapabilities.includes(cap)
                );
                
                const updatedFlags = {
                    ...flags,
                    blockedCapabilities: updatedBlockedCapabilities,
                    unquarantinedAt: new Date().toISOString(),
                    unquarantinedReason: 'Critical capacity need - auto-unquarantined by capacity fix suite'
                };

                await this.updateNodeFlags(node.nodeId, updatedFlags);
                this.fixes.push({
                    type: 'unquarantine',
                    node: nodeIdShort,
                    capabilities: neededCapabilities
                });
            }
        }
    }

    async updateNodeFlags(nodeId, flags) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                UPDATE nodes 
                SET flags = ?
                WHERE nodeId = ?
            `, [JSON.stringify(flags), nodeId], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    async resetStuckJobs() {
        console.log('🔄 Resetting stuck jobs...');

        const cutoffTime = Math.floor(Date.now() / 1000) - (6 * 60 * 60); // 6 hours ago

        return new Promise((resolve, reject) => {
            this.db.run(`
                UPDATE jobs 
                SET status = 'pending',
                    claimedBy = NULL,
                    claimedAt = NULL,
                    result = NULL
                WHERE status = 'claimed'
                AND claimedAt < ?
            `, [cutoffTime], function(err) {
                if (err) {
                    reject(err);
                } else {
                    if (this.changes > 0) {
                        console.log(`  Reset ${this.changes} stuck jobs to pending`);
                    } else {
                        console.log(`  No stuck jobs found`);
                    }
                    resolve(this.changes);
                }
            });
        });
    }

    async generateRecruitmentAlerts(issues) {
        console.log('📢 Generating recruitment alerts...');

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `URGENT-CAPACITY-ALERT-${timestamp}.md`;

        // Find capabilities that are completely missing
        const activeCapabilities = await this.getActiveCapabilities();
        const missingCapabilities = [];

        issues.blockedJobTypes.forEach(jobType => {
            if (!activeCapabilities.includes(jobType.type)) {
                missingCapabilities.push({
                    capability: jobType.type,
                    jobCount: jobType.count
                });
            }
        });

        if (missingCapabilities.length > 0) {
            const alertContent = this.generateAlertContent(missingCapabilities);
            fs.writeFileSync(`../${fileName}`, alertContent);
            console.log(`  Created alert: ${fileName}`);
            
            this.fixes.push({
                type: 'alert',
                file: fileName,
                missingCapabilities: missingCapabilities.length
            });
        } else {
            console.log(`  All job types have capable nodes available`);
        }
    }

    async getActiveCapabilities() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT DISTINCT capabilities
                FROM nodes 
                WHERE lastSeen > strftime('%s', 'now') - 300
            `, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }

                const capabilities = new Set();
                rows.forEach(row => {
                    try {
                        const caps = JSON.parse(row.capabilities || '[]');
                        caps.forEach(cap => capabilities.add(cap));
                    } catch (e) {
                        // Skip invalid JSON
                    }
                });

                resolve(Array.from(capabilities));
            });
        });
    }

    generateAlertContent(missingCapabilities) {
        const timestamp = new Date().toISOString();
        
        let content = `# URGENT: Missing Node Capabilities Alert\n\n`;
        content += `**Generated:** ${timestamp}\n`;
        content += `**Alert Type:** Critical capacity gap\n`;
        content += `**Priority:** HIGH\n\n`;
        
        content += `## 🚨 IMMEDIATE ACTION REQUIRED\n\n`;
        content += `IC Mesh is missing critical node capabilities, blocking customer jobs:\n\n`;
        
        missingCapabilities.forEach(cap => {
            content += `- **${cap.capability}**: ${cap.jobCount} jobs blocked\n`;
        });
        
        content += `\n## 🎯 RECRUITMENT TARGETS\n\n`;
        content += `We need nodes with these specific capabilities:\n\n`;
        
        missingCapabilities.forEach(cap => {
            content += `### ${cap.capability} Capability\n\n`;
            content += `**Jobs blocked:** ${cap.jobCount}\n`;
            content += `**Setup command:** \`claw skill mesh-${cap.capability}\` (if skill exists)\n`;
            
            if (cap.capability === 'pdf-extract') {
                content += `**Requirements:** PDF processing tools\n`;
                content += `**Skills:** Text extraction, document parsing\n`;
            } else if (cap.capability === 'ocr') {
                content += `**Requirements:** Tesseract OCR engine\n`;
                content += `**Skills:** Image text extraction, document scanning\n`;
            } else if (cap.capability === 'transcribe') {
                content += `**Requirements:** Whisper or similar speech-to-text\n`;
                content += `**Skills:** Audio transcription\n`;
            }
            content += `\n`;
        });
        
        content += `## 📢 RECRUITMENT ACTIONS\n\n`;
        content += `1. **Discord announcement** - Post in #mesh-network channel\n`;
        content += `2. **Direct outreach** - Contact known operators with these capabilities\n`;
        content += `3. **Documentation** - Ensure setup guides exist for missing capabilities\n`;
        content += `4. **Incentives** - Consider capability-specific bonuses\n\n`;
        
        content += `## 🔧 TECHNICAL DETAILS\n\n`;
        content += `**Check status:** \`node scripts/job-processing-analyzer.js\`\n`;
        content += `**Monitor queue:** \`node scripts/quick-queue-analysis.js\`\n`;
        content += `**Node health:** \`node scripts/system-dashboard.js\`\n\n`;
        
        content += `---\n\n`;
        content += `*Alert generated automatically by Capacity Fix Suite*\n`;
        content += `*Next check recommended in 1 hour if no progress*\n`;
        
        return content;
    }

    displayFixResults(beforeIssues, afterIssues) {
        console.log('🔧 Fixes applied:');
        
        if (this.fixes.length === 0) {
            console.log('  No automated fixes were necessary');
        } else {
            this.fixes.forEach(fix => {
                if (fix.type === 'unquarantine') {
                    console.log(`  ✅ Unquarantined node ${fix.node} for: ${fix.capabilities.join(', ')}`);
                } else if (fix.type === 'alert') {
                    console.log(`  ✅ Created recruitment alert for ${fix.missingCapabilities} missing capabilities`);
                }
            });
        }

        console.log('\n📊 Impact summary:');
        console.log(`  Before: ${beforeIssues.blockedJobTypes.reduce((sum, job) => sum + job.count, 0)} blocked jobs`);
        console.log(`  After: ${afterIssues.blockedJobTypes.reduce((sum, job) => sum + job.count, 0)} blocked jobs`);
        
        const quarantineBefore = beforeIssues.quarantinedNodes.length;
        const quarantineAfter = afterIssues.quarantinedNodes.filter(node => {
            const flags = JSON.parse(node.flags || '{}');
            return (flags.blockedCapabilities || []).length > 0;
        }).length;
        
        if (quarantineBefore !== quarantineAfter) {
            console.log(`  Quarantine changes: ${quarantineBefore} → ${quarantineAfter} nodes with blocked capabilities`);
        }
    }

    formatAge(timestamp) {
        const now = Math.floor(Date.now() / 1000);
        const created = parseInt(timestamp);
        const diffMinutes = Math.floor((now - created) / 60);
        
        if (diffMinutes < 60) {
            return `${diffMinutes}min ago`;
        } else if (diffMinutes < 1440) {
            return `${Math.floor(diffMinutes / 60)}h ago`;
        } else {
            return `${Math.floor(diffMinutes / 1440)}d ago`;
        }
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// CLI execution
if (require.main === module) {
    const fixSuite = new CapacityFixSuite();
    
    fixSuite.init().then(() => {
        fixSuite.close();
        console.log('\n🏁 Capacity fixes complete');
        process.exit(0);
    }).catch((error) => {
        console.error('❌ Fix suite failed:', error);
        fixSuite.close();
        process.exit(1);
    });
}

module.exports = CapacityFixSuite;