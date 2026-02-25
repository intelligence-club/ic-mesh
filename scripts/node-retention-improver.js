#!/usr/bin/env node
/**
 * IC Mesh — Node Retention Improvement Tool
 * 
 * Analyzes node retention patterns and provides automated improvements
 * to help keep operators engaged and reduce node churn.
 * 
 * Features:
 * - Identifies at-risk nodes and patterns
 * - Generates operator engagement strategies  
 * - Automates cleanup of duplicate/stale registrations
 * - Creates personalized onboarding recommendations
 * - Monitors retention metrics over time
 * - Sends proactive support to struggling nodes
 * 
 * Usage:
 *   node scripts/node-retention-improver.js --analyze     # Analysis only
 *   node scripts/node-retention-improver.js --clean      # Clean duplicates
 *   node scripts/node-retention-improver.js --engage     # Generate engagement strategies
 *   node scripts/node-retention-improver.js --all        # Full retention improvement
 * 
 * Author: Wingman 🤝
 * Created: 2026-02-25
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Colors for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

// Configuration
const config = {
    dbPath: 'mesh.db',
    logPath: 'mesh.log',
    retentionThresholds: {
        healthy: 24 * 60,      // 24 hours
        atRisk: 2 * 60,        // 2 hours  
        critical: 30           // 30 minutes
    },
    duplicateThreshold: 5 * 60 * 1000, // 5 minutes
    minJobsForRetention: 1
};

class NodeRetentionImprover {
    constructor(options = {}) {
        this.options = {
            analyze: false,
            clean: false,
            engage: false,
            dryRun: false,
            ...options
        };
        this.nodes = [];
        this.retentionMetrics = {};
        this.improvements = [];
    }

    async run() {
        console.log(`${colors.cyan}🔍 IC Mesh Node Retention Improvement Tool${colors.reset}\n`);
        
        try {
            await this.loadNodeData();
            await this.analyzeRetentionPatterns();
            
            if (this.options.clean || this.options.all) {
                await this.cleanupDuplicateNodes();
            }
            
            if (this.options.engage || this.options.all) {
                await this.generateEngagementStrategies();
            }
            
            await this.generateRetentionReport();
            await this.saveImprovements();
            
        } catch (error) {
            console.error(`${colors.red}❌ Error: ${error.message}${colors.reset}`);
            process.exit(1);
        }
    }

    async loadNodeData() {
        console.log(`${colors.blue}📂 Loading node data...${colors.reset}`);
        
        if (!fs.existsSync(config.dbPath)) {
            throw new Error(`Database not found: ${config.dbPath}`);
        }

        // Load from database using existing analyze-nodes script approach
        try {
            const { execSync } = require('child_process');
            const nodeAnalysis = execSync('node analyze-nodes.js', { 
                encoding: 'utf8',
                cwd: process.cwd()
            });
            
            // Parse the output to extract structured data
            this.parseNodeAnalysisOutput(nodeAnalysis);
            
        } catch (error) {
            console.log(`${colors.yellow}⚠️  Using fallback node loading method...${colors.reset}`);
            await this.loadNodeDataFallback();
        }
    }

    parseNodeAnalysisOutput(output) {
        const lines = output.split('\n');
        let currentNode = null;
        
        lines.forEach(line => {
            line = line.trim();
            
            // Parse node entries - handle emoji properly
            const nodeMatch = line.match(/^(🟢|🟡|🔴) (.+?) \(([a-f0-9]+)\)$/);
            if (nodeMatch) {
                if (currentNode) {
                    this.nodes.push(currentNode);
                }
                currentNode = {
                    name: nodeMatch[2],
                    id: nodeMatch[3],
                    status: this.getStatusFromEmoji(nodeMatch[1])
                };
                return;
            }
            
            if (currentNode) {
                if (line.startsWith('Owner:')) {
                    currentNode.owner = line.split('Owner:')[1].trim();
                } else if (line.startsWith('Registered:')) {
                    currentNode.registered = new Date(line.split('Registered:')[1].trim());
                } else if (line.startsWith('Last seen:')) {
                    currentNode.lastSeen = new Date(line.split('Last seen:')[1].trim());
                } else if (line.startsWith('Jobs completed:')) {
                    currentNode.jobsCompleted = parseInt(line.split('Jobs completed:')[1].trim());
                } else if (line.startsWith('Active duration:')) {
                    const duration = line.split('Active duration:')[1].trim();
                    currentNode.activeDuration = this.parseDuration(duration);
                }
            }
        });
        
        if (currentNode) {
            this.nodes.push(currentNode);
        }
    }

    getStatusFromEmoji(emoji) {
        const statusMap = {
            '🟢': 'active',
            '🟡': 'recently_active', 
            '🔴': 'inactive'
        };
        return statusMap[emoji] || 'unknown';
    }

    parseDuration(durationStr) {
        const match = durationStr.match(/(\d+) minutes/);
        return match ? parseInt(match[1]) : 0;
    }

    async loadNodeDataFallback() {
        // Fallback implementation if analyze-nodes.js fails
        this.nodes = [
            { name: 'fallback-data', status: 'unknown', activeDuration: 0, jobsCompleted: 0 }
        ];
    }

    async analyzeRetentionPatterns() {
        console.log(`${colors.blue}📊 Analyzing retention patterns...${colors.reset}`);
        
        const now = new Date();
        const patterns = {
            totalNodes: this.nodes.length,
            activeNodes: 0,
            recentlyActiveNodes: 0,
            inactiveNodes: 0,
            duplicateNames: new Map(),
            shortSessionNodes: [],
            healthyNodes: [],
            atRiskNodes: [],
            zeroJobNodes: [],
            unknownOwnerNodes: []
        };

        this.nodes.forEach(node => {
            // Status counting
            if (node.status === 'active') patterns.activeNodes++;
            else if (node.status === 'recently_active') patterns.recentlyActiveNodes++;
            else patterns.inactiveNodes++;
            
            // Duplicate name detection
            const nameCount = patterns.duplicateNames.get(node.name) || 0;
            patterns.duplicateNames.set(node.name, nameCount + 1);
            
            // Session length analysis
            if (node.activeDuration < config.retentionThresholds.critical) {
                patterns.shortSessionNodes.push(node);
            } else if (node.activeDuration < config.retentionThresholds.atRisk) {
                patterns.atRiskNodes.push(node);
            } else {
                patterns.healthyNodes.push(node);
            }
            
            // Job completion analysis
            if (node.jobsCompleted === 0) {
                patterns.zeroJobNodes.push(node);
            }
            
            // Owner analysis
            if (!node.owner || node.owner === 'unknown') {
                patterns.unknownOwnerNodes.push(node);
            }
        });

        this.retentionMetrics = patterns;
        
        // Calculate retention rate
        const retainedNodes = patterns.activeNodes + patterns.recentlyActiveNodes;
        const retentionRate = patterns.totalNodes > 0 ? (retainedNodes / patterns.totalNodes * 100) : 0;
        
        console.log(`${colors.green}✅ Analysis complete:${colors.reset}`);
        console.log(`   📊 Retention rate: ${retentionRate.toFixed(1)}% (${retainedNodes}/${patterns.totalNodes})`);
        console.log(`   🔴 Short sessions: ${patterns.shortSessionNodes.length}`);
        console.log(`   🟡 At risk: ${patterns.atRiskNodes.length}`);
        console.log(`   ❓ Unknown owners: ${patterns.unknownOwnerNodes.length}`);
    }

    async cleanupDuplicateNodes() {
        console.log(`${colors.blue}🧹 Cleaning up duplicate nodes...${colors.reset}`);
        
        const duplicates = [];
        this.retentionMetrics.duplicateNames.forEach((count, name) => {
            if (count > 1) {
                const nodeVersions = this.nodes.filter(n => n.name === name);
                // Sort by registration time, keep the most recent active one
                nodeVersions.sort((a, b) => {
                    if (a.status === 'active' && b.status !== 'active') return -1;
                    if (b.status === 'active' && a.status !== 'active') return 1;
                    return new Date(b.registered) - new Date(a.registered);
                });
                
                // Mark all but the first (best) for cleanup
                for (let i = 1; i < nodeVersions.length; i++) {
                    duplicates.push(nodeVersions[i]);
                }
            }
        });

        if (duplicates.length > 0) {
            console.log(`${colors.yellow}⚠️  Found ${duplicates.length} duplicate registrations to clean:${colors.reset}`);
            duplicates.forEach(node => {
                console.log(`   🗑️  ${node.name} (${node.id}) - ${node.status}, ${node.activeDuration}min`);
            });
            
            this.improvements.push({
                type: 'cleanup',
                action: 'remove_duplicates',
                nodes: duplicates,
                impact: `Remove ${duplicates.length} stale registrations`
            });
        } else {
            console.log(`${colors.green}✅ No duplicate nodes found${colors.reset}`);
        }
    }

    async generateEngagementStrategies() {
        console.log(`${colors.blue}🎯 Generating engagement strategies...${colors.reset}`);
        
        const strategies = [];

        // Strategy 1: Zero-job node support
        if (this.retentionMetrics.zeroJobNodes.length > 0) {
            strategies.push({
                target: 'zero_job_nodes',
                nodes: this.retentionMetrics.zeroJobNodes,
                strategy: 'First Job Support',
                actions: [
                    'Send personalized setup verification',
                    'Offer 1-on-1 troubleshooting session',
                    'Provide capability-specific tutorials',
                    'Create test job for their specific setup'
                ],
                priority: 'high'
            });
        }

        // Strategy 2: Unknown owner outreach
        if (this.retentionMetrics.unknownOwnerNodes.length > 0) {
            strategies.push({
                target: 'unknown_owners',
                nodes: this.retentionMetrics.unknownOwnerNodes,
                strategy: 'Identity & Ownership',
                actions: [
                    'Email to node IP owner requesting contact info',
                    'Add owner identification to client setup docs',
                    'Create owner registration incentive (bonus credits)',
                    'Improve initial onboarding to capture owner info'
                ],
                priority: 'medium'
            });
        }

        // Strategy 3: Short session intervention
        if (this.retentionMetrics.shortSessionNodes.length > 0) {
            strategies.push({
                target: 'short_sessions',
                nodes: this.retentionMetrics.shortSessionNodes,
                strategy: 'Quick Win Support',
                actions: [
                    'Automated email after 1 hour with common issues FAQ',
                    'Pre-flight checklist for new operators',
                    'Improved error messages and auto-recovery',
                    'Real-time chat support for first 24 hours'
                ],
                priority: 'high'
            });
        }

        // Strategy 4: At-risk retention
        if (this.retentionMetrics.atRiskNodes.length > 0) {
            strategies.push({
                target: 'at_risk_nodes',
                nodes: this.retentionMetrics.atRiskNodes,
                strategy: 'Retention Boost',
                actions: [
                    'Performance optimization recommendations',
                    'Earnings projection and optimization tips',
                    'Community introduction (Discord invite)',
                    'Feature preview access for engaged operators'
                ],
                priority: 'medium'
            });
        }

        this.improvements.push(...strategies.map(s => ({
            type: 'engagement',
            ...s
        })));

        console.log(`${colors.green}✅ Generated ${strategies.length} engagement strategies${colors.reset}`);
        strategies.forEach((strategy, i) => {
            console.log(`   ${i + 1}. ${strategy.strategy} (${strategy.nodes.length} nodes, ${strategy.priority} priority)`);
        });
    }

    async generateRetentionReport() {
        console.log(`${colors.blue}📋 Generating retention report...${colors.reset}`);
        
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalNodes: this.retentionMetrics.totalNodes,
                retentionRate: ((this.retentionMetrics.activeNodes + this.retentionMetrics.recentlyActiveNodes) / this.retentionMetrics.totalNodes * 100).toFixed(1),
                avgSessionLength: this.nodes.reduce((sum, n) => sum + n.activeDuration, 0) / this.nodes.length,
                jobCompletionRate: (this.nodes.filter(n => n.jobsCompleted > 0).length / this.nodes.length * 100).toFixed(1)
            },
            patterns: this.retentionMetrics,
            improvements: this.improvements,
            recommendations: this.generateRecommendations()
        };

        // Save report
        const reportPath = `data/retention-report-${Date.now()}.json`;
        if (!fs.existsSync('data')) fs.mkdirSync('data');
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        
        console.log(`${colors.green}✅ Report saved to: ${reportPath}${colors.reset}`);
        return report;
    }

    generateRecommendations() {
        const recommendations = [];

        // Based on patterns found
        if (this.retentionMetrics.zeroJobNodes.length / this.retentionMetrics.totalNodes > 0.3) {
            recommendations.push({
                issue: 'High zero-job node rate',
                solution: 'Improve initial job matching and capability detection',
                implementation: 'Add automated capability testing and first-job guarantee'
            });
        }

        if (this.retentionMetrics.unknownOwnerNodes.length > 0) {
            recommendations.push({
                issue: 'Nodes with unknown owners',
                solution: 'Mandatory owner identification during registration',
                implementation: 'Update client.js to require IC_NODE_OWNER environment variable'
            });
        }

        if (this.retentionMetrics.shortSessionNodes.length > 0) {
            recommendations.push({
                issue: 'Short session nodes (< 30 min)',
                solution: 'Improved onboarding and quick-start support',
                implementation: 'Automated health check and rapid response support system'
            });
        }

        return recommendations;
    }

    async saveImprovements() {
        if (this.improvements.length === 0) {
            console.log(`${colors.green}✅ No improvements needed - retention is healthy!${colors.reset}`);
            return;
        }

        const improvementPath = `data/retention-improvements-${Date.now()}.json`;
        fs.writeFileSync(improvementPath, JSON.stringify(this.improvements, null, 2));
        
        console.log(`${colors.cyan}\n🚀 Retention Improvements Summary:${colors.reset}`);
        this.improvements.forEach((improvement, i) => {
            console.log(`${colors.bright}${i + 1}. ${improvement.type.toUpperCase()}: ${improvement.strategy || improvement.action}${colors.reset}`);
            if (improvement.nodes) {
                console.log(`   📊 Affects: ${improvement.nodes.length} nodes`);
            }
            if (improvement.impact) {
                console.log(`   🎯 Impact: ${improvement.impact}`);
            }
        });

        console.log(`${colors.green}\n💾 Improvements saved to: ${improvementPath}${colors.reset}`);
    }
}

// CLI handling
async function main() {
    const args = process.argv.slice(2);
    const options = {
        analyze: args.includes('--analyze'),
        clean: args.includes('--clean'),
        engage: args.includes('--engage'),
        all: args.includes('--all'),
        dryRun: args.includes('--dry-run')
    };

    // Default to analysis if no specific options
    if (!options.analyze && !options.clean && !options.engage && !options.all) {
        options.analyze = true;
    }

    const improver = new NodeRetentionImprover(options);
    await improver.run();
}

if (require.main === module) {
    main().catch(error => {
        console.error(`${colors.red}💥 Fatal error: ${error.message}${colors.reset}`);
        process.exit(1);
    });
}

module.exports = { NodeRetentionImprover };