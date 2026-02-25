#!/usr/bin/env node

/**
 * Comprehensive Node Diagnosis Tool
 * Analyzes node health, performance, and provides actionable repair guidance
 * Part of node retention improvement strategy
 */

const Database = require('better-sqlite3');
const path = require('path');

class NodeDiagnostic {
    constructor() {
        this.db = new Database(path.join(__dirname, '..', 'data', 'mesh.db'), { readonly: true });
        this.timestamp = new Date().toISOString();
    }

    async analyzeNodeHealth(nodeId = null) {
        console.log('🏥 Comprehensive Node Health Analysis');
        console.log('=====================================\n');

        try {
            const nodes = nodeId ? 
                await this.getNodeData(nodeId) : 
                await this.getAllNodeData();

            for (const node of nodes) {
                await this.diagnoseNode(node);
                console.log('\n' + '─'.repeat(60) + '\n');
            }

            await this.generateNetworkReport();
            await this.generateActionPlan();

        } catch (error) {
            console.error('❌ Diagnostic failed:', error.message);
        } finally {
            this.db.close();
        }
    }

    async diagnoseNode(node) {
        const healthScore = await this.calculateHealthScore(node);
        const isActive = this.isNodeActive(node);
        const jobs = await this.getNodeJobs(node.nodeId);
        
        console.log(`🖥️  Node Analysis: ${node.nodeId.substring(0, 8)}`);
        console.log(`   Owner: ${node.owner || 'unknown'}`);
        console.log(`   Status: ${isActive ? '🟢 ONLINE' : '🔴 OFFLINE'}`);
        console.log(`   Health Score: ${healthScore}%`);
        console.log(`   Last Seen: ${this.formatTimestamp(node.lastSeen)}`);
        console.log(`   Session Length: ${this.calculateSessionLength(node)} minutes`);
        
        // Performance Analysis
        const performance = this.analyzePerformance(jobs);
        console.log(`\n📊 Performance Metrics:`);
        console.log(`   Success Rate: ${performance.successRate}%`);
        console.log(`   Jobs Completed: ${performance.completed}/${performance.total}`);
        console.log(`   Avg Completion Time: ${performance.avgTime}s`);
        
        // Capability Analysis
        const capabilities = this.parseCapabilities(node.capabilities);
        console.log(`\n⚡ Capabilities: ${capabilities.join(', ')}`);
        
        // Issue Detection
        const issues = await this.detectIssues(node, jobs, performance);
        if (issues.length > 0) {
            console.log(`\n⚠️  Issues Detected:`);
            issues.forEach(issue => {
                console.log(`   • ${issue.severity}: ${issue.description}`);
                if (issue.solution) {
                    console.log(`     → Solution: ${issue.solution}`);
                }
            });
        } else {
            console.log(`\n✅ No issues detected - node operating optimally`);
        }

        // Recommendations
        const recommendations = this.generateRecommendations(node, performance, issues);
        if (recommendations.length > 0) {
            console.log(`\n🎯 Recommendations:`);
            recommendations.forEach(rec => {
                console.log(`   • ${rec.priority}: ${rec.action}`);
            });
        }
    }

    calculateHealthScore(node) {
        let score = 100;
        
        // Availability penalty
        if (!this.isNodeActive(node)) {
            score -= 50;
        }
        
        // Session length bonus/penalty
        const sessionMinutes = this.calculateSessionLength(node);
        if (sessionMinutes < 60) score -= 20;      // Less than 1 hour
        else if (sessionMinutes > 1440) score += 10; // More than 24 hours
        
        return Math.max(0, score);
    }

    isNodeActive(node) {
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        return node.lastSeen > fiveMinutesAgo;
    }

    calculateSessionLength(node) {
        return Math.round((node.lastSeen - node.registeredAt) / 1000 / 60);
    }

    analyzePerformance(jobs) {
        if (jobs.length === 0) {
            return { successRate: 0, completed: 0, total: 0, avgTime: 0 };
        }

        const completed = jobs.filter(job => job.status === 'completed').length;
        const successRate = Math.round((completed / jobs.length) * 100);
        
        // Calculate average completion time for successful jobs
        const completedJobs = jobs.filter(job => 
            job.status === 'completed' && job.completedAt && job.claimedAt
        );
        const avgTime = completedJobs.length > 0 ?
            Math.round(completedJobs.reduce((sum, job) => 
                sum + (job.completedAt - job.claimedAt), 0) / completedJobs.length / 1000) : 0;

        return {
            successRate,
            completed,
            total: jobs.length,
            avgTime
        };
    }

    parseCapabilities(capabilities) {
        if (!capabilities) return ['none'];
        try {
            const caps = JSON.parse(capabilities);
            return Array.isArray(caps) ? caps : ['parse error'];
        } catch (e) {
            return ['parse error'];
        }
    }

    async detectIssues(node, jobs, performance) {
        const issues = [];
        
        // Performance issues
        if (performance.successRate < 50) {
            issues.push({
                severity: 'CRITICAL',
                description: `Low success rate (${performance.successRate}%)`,
                solution: 'Check job handlers and dependencies'
            });
        }
        
        // Connectivity issues
        if (!this.isNodeActive(node)) {
            issues.push({
                severity: 'HIGH',
                description: 'Node offline',
                solution: 'Restart node client and check network connectivity'
            });
        }
        
        // Handler issues
        const failedJobs = jobs.filter(job => job.status === 'failed');
        const handlerErrors = this.analyzeHandlerErrors(failedJobs);
        
        for (const [handler, count] of Object.entries(handlerErrors)) {
            if (count > 2) {
                issues.push({
                    severity: 'MEDIUM',
                    description: `${handler} handler failing (${count} failures)`,
                    solution: `Install or fix ${handler} dependencies`
                });
            }
        }
        
        // Capability gaps
        const capabilities = this.parseCapabilities(node.capabilities);
        const missingCritical = ['whisper', 'ffmpeg'].filter(cap => 
            !capabilities.includes(cap)
        );
        
        if (missingCritical.length > 0) {
            issues.push({
                severity: 'MEDIUM',
                description: `Missing critical capabilities: ${missingCritical.join(', ')}`,
                solution: 'Install missing dependencies for full job coverage'
            });
        }
        
        return issues;
    }

    analyzeHandlerErrors(failedJobs) {
        const handlerErrors = {};
        
        failedJobs.forEach(job => {
            if (job.result) {
                try {
                    const result = JSON.parse(job.result);
                    if (result.error) {
                        const error = result.error.toLowerCase();
                        if (error.includes('transcribe')) {
                            handlerErrors.transcribe = (handlerErrors.transcribe || 0) + 1;
                        } else if (error.includes('pdf')) {
                            handlerErrors['pdf-extract'] = (handlerErrors['pdf-extract'] || 0) + 1;
                        } else if (error.includes('ocr')) {
                            handlerErrors.ocr = (handlerErrors.ocr || 0) + 1;
                        }
                    }
                } catch (e) {
                    // Ignore JSON parse errors
                }
            }
        });
        
        return handlerErrors;
    }

    generateRecommendations(node, performance, issues) {
        const recommendations = [];
        
        // Performance-based recommendations
        if (performance.successRate < 85 && performance.total > 5) {
            recommendations.push({
                priority: 'HIGH',
                action: 'Run handler diagnostics and fix failing job types'
            });
        }
        
        // Uptime recommendations
        const sessionHours = this.calculateSessionLength(node) / 60;
        if (sessionHours < 4) {
            recommendations.push({
                priority: 'MEDIUM',
                action: 'Consider running node as a service for better uptime'
            });
        }
        
        // Capability recommendations
        const capabilities = this.parseCapabilities(node.capabilities);
        if (capabilities.length < 3) {
            recommendations.push({
                priority: 'LOW',
                action: 'Install additional capabilities to handle more job types'
            });
        }
        
        return recommendations;
    }

    async generateNetworkReport() {
        console.log('🌐 Network Health Summary');
        console.log('=========================\n');
        
        const stats = await this.getNetworkStats();
        console.log(`Active Nodes: ${stats.activeNodes}/${stats.totalNodes}`);
        console.log(`Overall Success Rate: ${stats.successRate}%`);
        console.log(`Pending Jobs: ${stats.pendingJobs}`);
        console.log(`Network Capacity: ${stats.totalCapabilities} capabilities across active nodes`);
    }

    async generateActionPlan() {
        console.log('📋 Recommended Actions');
        console.log('======================\n');
        
        console.log('Immediate (Next Hour):');
        console.log('1. Fix nodes with <50% success rate');
        console.log('2. Contact owners of healthy but offline nodes');
        console.log('3. Clear any stuck jobs in queue');
        
        console.log('\nShort-term (Next 24 Hours):');
        console.log('1. Implement automated health monitoring');
        console.log('2. Create operator notification system');
        console.log('3. Document common issues and solutions');
        
        console.log('\nLong-term (Next Week):');
        console.log('1. Build operator dashboard');
        console.log('2. Implement performance-based incentives');
        console.log('3. Create automated setup tools');
    }

    // Database helper methods
    async getNodeData(nodeId) {
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE nodeId = ?');
        const row = stmt.get(nodeId);
        return row ? [row] : [];
    }

    async getAllNodeData() {
        const stmt = this.db.prepare('SELECT * FROM nodes ORDER BY lastSeen DESC');
        return stmt.all();
    }

    async getNodeJobs(nodeId) {
        const stmt = this.db.prepare('SELECT * FROM jobs WHERE claimedBy = ? ORDER BY claimedAt DESC');
        return stmt.all(nodeId);
    }

    async getNetworkStats() {
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        
        const nodeStatsStmt = this.db.prepare(`
            SELECT 
                COUNT(*) as totalNodes,
                SUM(CASE WHEN lastSeen > ? THEN 1 ELSE 0 END) as activeNodes
            FROM nodes
        `);
        const nodeStats = nodeStatsStmt.get(fiveMinutesAgo);
        
        const jobStatsStmt = this.db.prepare(`
            SELECT 
                COUNT(*) as totalJobs,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedJobs,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingJobs
            FROM jobs
        `);
        const jobStats = jobStatsStmt.get();
        
        return {
            totalNodes: nodeStats.totalNodes,
            activeNodes: nodeStats.activeNodes,
            successRate: jobStats.totalJobs > 0 ? 
                Math.round((jobStats.completedJobs / jobStats.totalJobs) * 100) : 0,
            pendingJobs: jobStats.pendingJobs,
            totalCapabilities: nodeStats.activeNodes * 3 // Estimate
        };
    }

    formatTimestamp(timestamp) {
        if (!timestamp) return 'never';
        const minutesAgo = Math.round((Date.now() - timestamp) / 1000 / 60);
        if (minutesAgo < 1) return 'just now';
        if (minutesAgo < 60) return `${minutesAgo} minutes ago`;
        const hoursAgo = Math.round(minutesAgo / 60);
        if (hoursAgo < 24) return `${hoursAgo} hours ago`;
        const daysAgo = Math.round(hoursAgo / 24);
        return `${daysAgo} days ago`;
    }
}

// CLI Usage
if (require.main === module) {
    const nodeId = process.argv[2];
    const diagnostic = new NodeDiagnostic();
    
    diagnostic.analyzeNodeHealth(nodeId)
        .then(() => {
            console.log('\n✅ Diagnostic complete');
        })
        .catch(error => {
            console.error('❌ Diagnostic failed:', error);
            process.exit(1);
        });
}

module.exports = NodeDiagnostic;