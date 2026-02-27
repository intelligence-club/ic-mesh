#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

/**
 * Capacity Recovery Planning Tool
 * 
 * Analyzes current capacity gaps and generates actionable recovery plans.
 * Creates specific outreach messages for different types of nodes.
 */

class CapacityRecoveryPlanner {
    constructor() {
        this.db = new sqlite3.Database('data/mesh.db');
        this.analysis = {
            pendingJobs: [],
            nodes: [],
            activeNodes: [],
            capabilityGaps: new Map(),
            offlineOpportunities: [],
            recommendations: []
        };
    }

    async generateRecoveryPlan() {
        console.log('🏥 Capacity Recovery Planning');
        console.log('════════════════════════════════');
        
        await this.analyzeCurrentState();
        this.identifyCapabilityGaps();
        this.identifyReconnectionOpportunities();
        this.generateActionPlan();
        await this.saveRecoveryPlan();
        
        console.log('\n✅ Recovery plan generated and saved');
        await this.close();
    }

    async analyzeCurrentState() {
        console.log('\n🔍 Analyzing current system state...');
        
        this.analysis.pendingJobs = await this.getPendingJobs();
        this.analysis.nodes = await this.getNodes();
        this.analysis.activeNodes = this.getActiveNodes(this.analysis.nodes);
        
        console.log(`   Pending jobs: ${this.analysis.pendingJobs.length}`);
        console.log(`   Total nodes: ${this.analysis.nodes.length}`);
        console.log(`   Active nodes: ${this.analysis.activeNodes.length}`);
    }

    identifyCapabilityGaps() {
        console.log('\n🎯 Identifying capability gaps...');
        
        // Find required capabilities from pending jobs
        const requiredCaps = new Set();
        this.analysis.pendingJobs.forEach(job => {
            const req = JSON.parse(job.requirements || '{}');
            if (req.capability) requiredCaps.add(req.capability);
        });

        // Find available capabilities from active nodes  
        const availableCaps = new Set();
        this.analysis.activeNodes.forEach(node => {
            const caps = JSON.parse(node.capabilities || '[]');
            caps.forEach(cap => availableCaps.add(cap));
        });

        // Calculate gaps
        const missingCaps = [...requiredCaps].filter(cap => !availableCaps.has(cap));
        missingCaps.forEach(cap => {
            const jobsNeedingCap = this.analysis.pendingJobs.filter(job => {
                const req = JSON.parse(job.requirements || '{}');
                return req.capability === cap;
            });
            
            this.analysis.capabilityGaps.set(cap, {
                pendingJobs: jobsNeedingCap.length,
                hasCapableNodes: this.hasNodesWithCapability(cap),
                capableNodeCount: this.getNodesWithCapability(cap).length
            });
        });

        console.log(`   Missing capabilities: ${missingCaps.join(', ')}`);
    }

    identifyReconnectionOpportunities() {
        console.log('\n🔄 Identifying reconnection opportunities...');
        
        const requiredCaps = new Set();
        this.analysis.pendingJobs.forEach(job => {
            const req = JSON.parse(job.requirements || '{}');
            if (req.capability) requiredCaps.add(req.capability);
        });

        this.analysis.offlineOpportunities = this.analysis.nodes
            .filter(node => {
                const caps = JSON.parse(node.capabilities || '[]');
                const hasNeededCap = [...requiredCaps].some(cap => caps.includes(cap));
                const lastSeenMins = (Date.now() - node.lastSeen) / (1000 * 60);
                return hasNeededCap && lastSeenMins > 5;
            })
            .map(node => {
                const caps = JSON.parse(node.capabilities || '[]');
                const neededCaps = caps.filter(cap => requiredCaps.has(cap));
                const lastSeenMins = Math.floor((Date.now() - node.lastSeen) / (1000 * 60));
                
                return {
                    ...node,
                    neededCapabilities: neededCaps,
                    offlineMinutes: lastSeenMins,
                    priority: this.calculatePriority(node, neededCaps, lastSeenMins)
                };
            })
            .sort((a, b) => b.priority - a.priority);

        console.log(`   Reconnection opportunities: ${this.analysis.offlineOpportunities.length}`);
    }

    generateActionPlan() {
        console.log('\n📋 Generating action plan...');
        
        const actions = [];

        // High priority: Reconnect capable nodes
        this.analysis.offlineOpportunities.forEach(node => {
            if (node.offlineMinutes < 1440) { // Less than 24 hours offline
                actions.push({
                    type: 'reconnect',
                    priority: 'high',
                    target: node.name,
                    nodeId: node.nodeId,
                    capabilities: node.neededCapabilities,
                    offlineTime: `${Math.floor(node.offlineMinutes / 60)}h ${node.offlineMinutes % 60}m`,
                    message: this.generateReconnectionMessage(node),
                    expectedJobs: this.countJobsForCapabilities(node.neededCapabilities)
                });
            }
        });

        // Medium priority: Recruit new capability nodes
        for (const [capability, info] of this.analysis.capabilityGaps) {
            if (!info.hasCapableNodes) {
                actions.push({
                    type: 'recruit',
                    priority: 'medium', 
                    capability: capability,
                    pendingJobs: info.pendingJobs,
                    recruitmentMessage: this.generateRecruitmentMessage(capability),
                    suggestedChannels: ['discord', 'reddit', 'direct-outreach']
                });
            }
        }

        // Low priority: General node expansion
        if (this.analysis.activeNodes.length === 0) {
            actions.push({
                type: 'expand',
                priority: 'low',
                reason: 'No active nodes in network',
                suggestion: 'General recruitment campaign for any node types'
            });
        }

        this.analysis.recommendations = actions;
        console.log(`   Generated ${actions.length} action items`);
    }

    async saveRecoveryPlan() {
        const plan = {
            timestamp: new Date().toISOString(),
            summary: {
                pendingJobs: this.analysis.pendingJobs.length,
                totalNodes: this.analysis.nodes.length,
                activeNodes: this.analysis.activeNodes.length,
                capabilityGaps: Array.from(this.analysis.capabilityGaps.entries()),
                reconnectionOpportunities: this.analysis.offlineOpportunities.length
            },
            actions: this.analysis.recommendations,
            detailedAnalysis: {
                pendingJobsBreakdown: this.analysis.pendingJobs.map(job => ({
                    jobId: job.jobId.substring(0, 8) + '...',
                    type: job.type,
                    requirements: JSON.parse(job.requirements || '{}'),
                    createdAt: job.createdAt
                })),
                nodeStatus: this.analysis.nodes.map(node => ({
                    nodeId: node.nodeId.substring(0, 8) + '...',
                    name: node.name,
                    capabilities: JSON.parse(node.capabilities || '[]'),
                    lastSeenMinutes: Math.floor((Date.now() - node.lastSeen) / (1000 * 60)),
                    active: (Date.now() - node.lastSeen) < (5 * 60 * 1000)
                }))
            }
        };

        const filename = `capacity-recovery-plan-${new Date().toISOString().split('T')[0]}.json`;
        fs.writeFileSync(filename, JSON.stringify(plan, null, 2));
        console.log(`   Saved to: ${filename}`);
        
        // Also save a human-readable markdown version
        const mdFilename = filename.replace('.json', '.md');
        fs.writeFileSync(mdFilename, this.generateMarkdownReport(plan));
        console.log(`   Human-readable report: ${mdFilename}`);
    }

    generateReconnectionMessage(node) {
        const caps = node.neededCapabilities.join(', ');
        const jobCount = this.countJobsForCapabilities(node.neededCapabilities);
        
        return `Hi ${node.name}! Your node with ${caps} capabilities has been offline for ${Math.floor(node.offlineMinutes / 60)} hours. We currently have ${jobCount} job(s) waiting that need your capabilities. Could you check your node connection? Thanks!`;
    }

    generateRecruitmentMessage(capability) {
        const jobCount = this.analysis.pendingJobs.filter(job => {
            const req = JSON.parse(job.requirements || '{}');
            return req.capability === capability;
        }).length;

        const descriptions = {
            'ocr': 'OCR (Optical Character Recognition) - extract text from images',
            'pdf-extract': 'PDF text extraction - extract text from PDF documents', 
            'transcription': 'Audio transcription using Whisper',
            'stable-diffusion': 'AI image generation',
            'TEST_MODE': 'Development testing capabilities'
        };

        const desc = descriptions[capability] || capability;
        return `Looking for nodes with ${desc} capability! We currently have ${jobCount} jobs pending that need this capability. Great opportunity to earn rewards while helping the network.`;
    }

    generateMarkdownReport(plan) {
        let md = `# Capacity Recovery Plan - ${plan.timestamp.split('T')[0]}\n\n`;
        
        md += `## System Summary\n`;
        md += `- **Pending Jobs:** ${plan.summary.pendingJobs}\n`;
        md += `- **Total Nodes:** ${plan.summary.totalNodes}\n`;
        md += `- **Active Nodes:** ${plan.summary.activeNodes}\n`;
        md += `- **Reconnection Opportunities:** ${plan.summary.reconnectionOpportunities}\n\n`;

        md += `## Action Plan\n\n`;
        plan.actions.forEach((action, i) => {
            md += `### ${i + 1}. ${action.type.toUpperCase()}: ${action.target || action.capability || action.reason}\n`;
            md += `**Priority:** ${action.priority}\n\n`;
            
            if (action.message) {
                md += `**Contact Message:**\n\`\`\`\n${action.message}\n\`\`\`\n\n`;
            }
            
            if (action.recruitmentMessage) {
                md += `**Recruitment Message:**\n\`\`\`\n${action.recruitmentMessage}\n\`\`\`\n\n`;
            }
        });

        return md;
    }

    calculatePriority(node, neededCaps, offlineMinutes) {
        let priority = 0;
        
        // Higher priority for recently offline nodes
        if (offlineMinutes < 60) priority += 100;
        else if (offlineMinutes < 1440) priority += 50;
        else priority += 10;
        
        // Higher priority for nodes with critical capabilities
        priority += neededCaps.length * 20;
        
        // Higher priority for nodes with good track record
        priority += Math.min(node.jobsCompleted || 0, 50);
        
        return priority;
    }

    hasNodesWithCapability(cap) {
        return this.analysis.nodes.some(node => {
            const caps = JSON.parse(node.capabilities || '[]');
            return caps.includes(cap);
        });
    }

    getNodesWithCapability(cap) {
        return this.analysis.nodes.filter(node => {
            const caps = JSON.parse(node.capabilities || '[]');
            return caps.includes(cap);
        });
    }

    countJobsForCapabilities(caps) {
        return this.analysis.pendingJobs.filter(job => {
            const req = JSON.parse(job.requirements || '{}');
            return caps.includes(req.capability);
        }).length;
    }

    getActiveNodes(nodes) {
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        return nodes.filter(node => node.lastSeen > fiveMinutesAgo);
    }

    getPendingJobs() {
        return new Promise((resolve, reject) => {
            this.db.all(
                "SELECT * FROM jobs WHERE status = 'pending' ORDER BY createdAt",
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    getNodes() {
        return new Promise((resolve, reject) => {
            this.db.all(
                "SELECT * FROM nodes ORDER BY lastSeen DESC",
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    close() {
        return new Promise((resolve) => {
            this.db.close(() => resolve());
        });
    }
}

if (require.main === module) {
    const planner = new CapacityRecoveryPlanner();
    planner.generateRecoveryPlan().catch(console.error);
}

module.exports = CapacityRecoveryPlanner;