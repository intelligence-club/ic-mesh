#!/usr/bin/env node

/**
 * Generate Node Outreach Messages
 * 
 * Creates personalized outreach messages for contacting node owners
 * during capacity crises, with specific impact data and recovery instructions.
 * 
 * Usage:
 *   node generate-node-outreach.js [--owner=drake] [--urgent]
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Configuration
const config = {
    databasePath: process.env.DATABASE_PATH || 'data/mesh.db'
};

class NodeOutreachGenerator {
    constructor() {
        this.contactMethods = {
            'drake': {
                discord: '@drake (Discord DM)',
                telegram: '@drakew (Telegram)',
                email: 'drakew@gmail.com',
                openclaw: 'OpenClaw Discord channel'
            },
            'unknown': {
                note: 'No contact method available for anonymous nodes'
            }
        };
    }
    
    async getDatabase() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(config.databasePath, (err) => {
                if (err) reject(err);
                else resolve(db);
            });
        });
    }
    
    async getOfflineNodes(ownerFilter = null) {
        const db = await this.getDatabase();
        
        const query = `
            SELECT 
                nodeId,
                name,
                capabilities,
                lastSeen,
                owner,
                jobsCompleted,
                computeMinutes,
                ROUND((julianday('now') - julianday(datetime(lastSeen/1000, 'unixepoch'))) * 24 * 60) AS minutes_offline
            FROM nodes 
            WHERE ${ownerFilter ? 'owner = ?' : '1=1'}
            ORDER BY minutes_offline DESC
        `;
        
        return new Promise((resolve, reject) => {
            const params = ownerFilter ? [ownerFilter] : [];
            db.all(query, params, (err, rows) => {
                db.close();
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
    
    async getBlockedJobs() {
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
    
    calculateRevenue(jobType, count) {
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
    
    analyzeNodeImpact(node, blockedJobs) {
        const capabilities = this.parseCapabilities(node.capabilities);
        const canProcess = [];
        let totalRevenue = { min: 0, max: 0 };
        
        for (const job of blockedJobs) {
            const canHandle = capabilities.some(cap => {
                return job.type === cap || 
                       (job.type === 'transcribe' && cap === 'transcription') ||
                       (job.type === 'transcription' && cap === 'transcribe') ||
                       (job.type === 'transcribe' && cap === 'whisper');
            });
            
            if (canHandle) {
                const revenue = this.calculateRevenue(job.type, job.count);
                canProcess.push({
                    type: job.type,
                    count: job.count,
                    revenue
                });
                totalRevenue.min += revenue.min;
                totalRevenue.max += revenue.max;
            }
        }
        
        return { canProcess, totalRevenue };
    }
    
    generateUrgentMessage(node, impact, contactInfo) {
        const nodeName = node.name || node.nodeId.substring(0, 8);
        const offlineHours = Math.round(node.minutes_offline / 60 * 10) / 10;
        
        return `🚨 URGENT: ${nodeName} Node Capacity Crisis

Hi ${node.owner}!

Your ${nodeName} node has been offline for ${offlineHours} hours and we have a customer service crisis:

📊 **CUSTOMER IMPACT:**
${impact.canProcess.map(job => 
`• ${job.count} ${job.type} jobs waiting ($${job.revenue.min}-${job.revenue.max})`
).join('\\n')}

💰 **Revenue blocked:** $${impact.totalRevenue.min}-${impact.totalRevenue.max}

⚡ **QUICK FIX:** 
${node.owner === 'drake' ? 'Run: `claw skill mesh-transcribe`' : 'Restart your IC Mesh node'}

${contactInfo ? `📱 **Contact channels:**
${Object.entries(contactInfo).map(([method, contact]) => `• ${method}: ${contact}`).join('\\n')}` : ''}

Your node is critical infrastructure - customers are waiting! 🙏

Thanks for helping restore service,
IC Mesh Team`;
    }
    
    generatePoliteMessage(node, impact, contactInfo) {
        const nodeName = node.name || node.nodeId.substring(0, 8);
        const offlineDays = Math.round(node.minutes_offline / (60 * 24) * 10) / 10;
        
        return `👋 ${nodeName} Node Check-in

Hi ${node.owner}!

Your ${nodeName} node has been offline for ${offlineDays} days. No rush, but wanted to check in:

🖥️ **Node details:**
• Name: ${nodeName}
• Capabilities: ${this.parseCapabilities(node.capabilities).join(', ')}
• Track record: ${node.jobsCompleted} jobs completed (⭐ excellent!)

${impact.canProcess.length > 0 ? `💼 **Would help with:**
${impact.canProcess.map(job => `• ${job.count} ${job.type} jobs`).join('\\n')}

💰 Potential earnings: $${impact.totalRevenue.min}-${impact.totalRevenue.max}` : ''}

🔧 **To reconnect:**
${node.owner === 'drake' ? 'Run: `claw skill mesh-transcribe`' : 'Restart your IC Mesh client when convenient'}

No pressure - just wanted to let you know the network would love to have you back when you're ready! 

${contactInfo ? `📫 **Feel free to reach out:**
${Object.entries(contactInfo).filter(([k]) => k !== 'note').map(([method, contact]) => `• ${method}: ${contact}`).join('\\n')}` : ''}

Best regards,
IC Mesh Team`;
    }
    
    async generateOutreach(options = {}) {
        const { owner, urgent } = options;
        
        try {
            console.log('🔍 Analyzing offline nodes...');
            
            const offlineNodes = await this.getOfflineNodes(owner);
            const blockedJobs = await this.getBlockedJobs();
            
            if (offlineNodes.length === 0) {
                console.log('✅ All nodes are online!');
                return;
            }
            
            const messages = [];
            
            for (const node of offlineNodes) {
                // Skip test-only nodes
                const capabilities = this.parseCapabilities(node.capabilities);
                if (capabilities.includes('test') && capabilities.length === 1) {
                    continue;
                }
                
                const impact = this.analyzeNodeImpact(node, blockedJobs);
                const contactInfo = this.contactMethods[node.owner] || this.contactMethods['unknown'];
                
                // Determine urgency
                const isUrgent = urgent || node.minutes_offline < 24 * 60; // Less than 24 hours = urgent
                
                if (contactInfo.note) {
                    // Anonymous node
                    messages.push({
                        node: node.name || node.nodeId.substring(0, 8),
                        owner: node.owner,
                        message: `ℹ️ ${node.name || node.nodeId.substring(0, 8)}: ${contactInfo.note}`
                    });
                } else {
                    // Generate appropriate message
                    const message = isUrgent ? 
                        this.generateUrgentMessage(node, impact, contactInfo) :
                        this.generatePoliteMessage(node, impact, contactInfo);
                    
                    messages.push({
                        node: node.name || node.nodeId.substring(0, 8),
                        owner: node.owner,
                        contact: contactInfo,
                        urgent: isUrgent,
                        impact,
                        message
                    });
                }
            }
            
            // Output results
            console.log(`\\n📝 Generated ${messages.length} outreach messages:\\n`);
            
            for (const msg of messages) {
                console.log(`=== ${msg.node} (${msg.owner}) ${msg.urgent ? '🚨 URGENT' : '📅 FOLLOW-UP'} ===`);
                console.log(msg.message);
                console.log('\\n' + '='.repeat(80) + '\\n');
            }
            
            // Save to file
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
            const filename = `outreach-messages-${timestamp}.md`;
            
            const fileContent = `# Node Outreach Messages — ${new Date().toISOString()}

${messages.map(msg => `## ${msg.node} (${msg.owner}) ${msg.urgent ? '🚨 URGENT' : '📅 FOLLOW-UP'}

\`\`\`
${msg.message}
\`\`\`

${msg.contact && !msg.contact.note ? `**Contact Methods:**
${Object.entries(msg.contact).map(([method, contact]) => `- ${method}: ${contact}`).join('\\n')}` : ''}

---
`).join('\\n')}

*Generated by Node Outreach Generator on ${new Date().toISOString()}*`;

            fs.writeFileSync(filename, fileContent);
            console.log(`💾 Messages saved to: ${filename}`);
            
            return messages;
            
        } catch (error) {
            console.error('❌ Error generating outreach:', error.message);
            throw error;
        }
    }
}

// CLI execution
if (require.main === module) {
    const args = process.argv.slice(2);
    const options = {
        owner: args.find(arg => arg.startsWith('--owner='))?.split('=')[1] || null,
        urgent: args.includes('--urgent')
    };
    
    const generator = new NodeOutreachGenerator();
    generator.generateOutreach(options).catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = NodeOutreachGenerator;