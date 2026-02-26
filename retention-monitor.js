#!/usr/bin/env node

/**
 * Node Retention Monitor
 * 
 * Tracks node retention milestones and provides proactive
 * intervention recommendations based on retention patterns.
 * 
 * Key insights:
 * - 40% disconnect within 1 hour (onboarding critical period)
 * - Nodes surviving >10 hours tend to stay long-term
 * - High-end hardware has 33% retention (needs investigation)
 * 
 * Usage: node retention-monitor.js [--alerts] [--milestones]
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'mesh.db');

class RetentionMonitor {
    constructor() {
        this.db = new Database(DB_PATH);
        this.milestones = {
            CRITICAL_HOUR: 60,      // 1 hour - critical onboarding period
            STABILITY_THRESHOLD: 600, // 10 hours - stability milestone
            LONG_TERM: 1440         // 24 hours - long-term retention
        };
    }

    runMonitoring(options = {}) {
        console.log('📊 IC Mesh Node Retention Monitor\n');
        
        if (options.alerts) {
            this.checkRetentionAlerts();
        } else if (options.milestones) {
            this.trackMilestones();
        } else {
            this.fullRetentionReport();
        }
        
        this.db.close();
    }

    fullRetentionReport() {
        console.log('🎯 Full Retention Analysis Report');
        console.log('═'.repeat(50));
        
        this.displayRetentionMetrics();
        this.trackMilestones();
        this.analyzeRiskFactors();
        this.checkRetentionAlerts();
        this.provideActionableInsights();
    }

    displayRetentionMetrics() {
        const stats = this.getRetentionStats();
        
        console.log('\n📈 Retention Funnel:');
        console.log(`   Total registrations: ${stats.total}`);
        console.log(`   Survived 1 hour: ${stats.survivedHour} (${(stats.survivedHour/stats.total*100).toFixed(1)}%)`);
        console.log(`   Reached 10 hours: ${stats.reached10h} (${(stats.reached10h/stats.total*100).toFixed(1)}%)`);
        console.log(`   Active 24+ hours: ${stats.longTerm} (${(stats.longTerm/stats.total*100).toFixed(1)}%)`);
        console.log(`   Currently online: ${stats.currentlyOnline} (${(stats.currentlyOnline/stats.total*100).toFixed(1)}%)`);
    }

    trackMilestones() {
        console.log('\n🏆 Milestone Tracking:');
        
        const approaching = this.getApproachingMilestones();
        const recent = this.getRecentMilestones();
        
        if (approaching.critical.length > 0) {
            console.log('\n⚠️  Nodes in Critical Hour (risk of disconnect):');
            approaching.critical.forEach(node => {
                const minutes = this.getSessionMinutes(node);
                console.log(`   ${node.name || 'unknown'} (${node.nodeId.substr(0, 8)}): ${minutes}min session, ${node.jobsCompleted || 0} jobs`);
            });
        }
        
        if (approaching.stability.length > 0) {
            console.log('\n🎯 Nodes Approaching 10-Hour Milestone:');
            approaching.stability.forEach(node => {
                const minutes = this.getSessionMinutes(node);
                const hoursLeft = ((this.milestones.STABILITY_THRESHOLD - minutes) / 60).toFixed(1);
                console.log(`   ${node.name || 'unknown'} (${node.nodeId.substr(0, 8)}): ${hoursLeft}h to milestone`);
            });
        }
        
        if (recent.stability.length > 0) {
            console.log('\n🏆 Recent 10-Hour Milestone Achievers:');
            recent.stability.forEach(node => {
                const hours = (this.getSessionMinutes(node) / 60).toFixed(1);
                console.log(`   ${node.name || 'unknown'} (${node.nodeId.substr(0, 8)}): ${hours}h session, ${node.jobsCompleted || 0} jobs`);
            });
        }
    }

    analyzeRiskFactors() {
        console.log('\n⚠️  Risk Factor Analysis:');
        
        const riskNodes = this.getHighRiskNodes();
        const patterns = this.analyzeDisconnectionPatterns(riskNodes);
        
        console.log(`   High-risk nodes: ${riskNodes.length}`);
        console.log(`   Zero-job disconnects: ${patterns.zeroJobs}% of disconnects`);
        console.log(`   Low-success disconnects: ${patterns.lowSuccess}% of disconnects`);
        console.log(`   Quick disconnects (<1h): ${patterns.quickDisconnects}% of total`);
        
        if (patterns.commonIssues.length > 0) {
            console.log('\n🔍 Common Disconnection Issues:');
            patterns.commonIssues.forEach(issue => {
                console.log(`   ${issue.pattern}: ${issue.count} nodes`);
            });
        }
    }

    checkRetentionAlerts() {
        console.log('\n🚨 Retention Alerts:');
        
        const alerts = this.generateRetentionAlerts();
        
        if (alerts.length === 0) {
            console.log('   ✅ No retention alerts - all nodes performing well');
            return;
        }
        
        alerts.forEach(alert => {
            console.log(`   ${alert.severity} ${alert.message}`);
            if (alert.action) {
                console.log(`      Action: ${alert.action}`);
            }
        });
    }

    provideActionableInsights() {
        console.log('\n💡 Actionable Insights:');
        
        const stats = this.getRetentionStats();
        const avgSessionTime = this.getAverageSessionTime();
        
        // Calculate retention rate
        const retentionRate = stats.total > 0 ? (stats.survivedHour / stats.total * 100).toFixed(1) : 0;
        
        if (retentionRate < 60) {
            console.log(`   🔴 LOW RETENTION: ${retentionRate}% survive first hour`);
            console.log('      Priority: Improve onboarding experience');
            console.log('      Actions: Add health checks, better documentation, proactive support');
        } else if (retentionRate < 80) {
            console.log(`   🟡 MODERATE RETENTION: ${retentionRate}% survive first hour`);
            console.log('      Focus: Optimize critical first hour experience');
        } else {
            console.log(`   🟢 GOOD RETENTION: ${retentionRate}% survive first hour`);
            console.log('      Focus: Scale successful onboarding patterns');
        }
        
        console.log(`   📊 Average session: ${(avgSessionTime/60).toFixed(1)} hours`);
        console.log(`   🎯 Target: >10 hour sessions for long-term retention`);
        
        // Specific recommendations based on data
        const approaching = this.getApproachingMilestones();
        if (approaching.critical.length > 0) {
            console.log(`   ⚡ URGENT: ${approaching.critical.length} nodes in critical hour - provide immediate support`);
        }
        
        if (approaching.stability.length > 0) {
            console.log(`   🎯 OPPORTUNITY: ${approaching.stability.length} nodes near 10h milestone - encourage continuation`);
        }
    }

    generateRetentionAlerts() {
        const alerts = [];
        
        // Critical: High disconnect rate
        const recentDisconnects = this.getRecentDisconnects(60); // Last hour
        if (recentDisconnects.length > 2) {
            alerts.push({
                severity: '🔴 CRITICAL',
                message: `${recentDisconnects.length} nodes disconnected in last hour`,
                action: 'Investigate infrastructure issues or onboarding problems'
            });
        }
        
        // Warning: Nodes stuck at zero jobs
        const zeroJobNodes = this.getZeroJobNodes();
        const activeZeroJob = zeroJobNodes.filter(node => {
            const now = Math.floor(Date.now() / 1000);
            const minutes = Math.floor((now - node.lastHeartbeat) / 60);
            return minutes < 30; // Active in last 30 min but zero jobs
        });
        
        if (activeZeroJob.length > 1) {
            alerts.push({
                severity: '⚠️  WARNING',
                message: `${activeZeroJob.length} active nodes not claiming jobs`,
                action: 'Check job queue availability and node quarantine status'
            });
        }
        
        // Info: Milestone opportunities
        const approaching = this.getApproachingMilestones();
        if (approaching.stability.length > 0) {
            alerts.push({
                severity: '💡 INFO',
                message: `${approaching.stability.length} nodes approaching 10-hour milestone`,
                action: 'Send encouragement/milestone notification to operators'
            });
        }
        
        return alerts;
    }

    analyzeDisconnectionPatterns(riskNodes) {
        const total = riskNodes.length;
        if (total === 0) return { zeroJobs: 0, lowSuccess: 0, quickDisconnects: 0, commonIssues: [] };
        
        const zeroJobs = riskNodes.filter(node => (node.jobsCompleted || 0) === 0).length;
        const lowSuccess = riskNodes.filter(node => (node.jobsCompleted || 0) > 5 && (node.jobsCompleted || 0) < 20).length; // Estimate low success based on job count patterns
        const quickDisconnects = riskNodes.filter(node => {
            const sessionTime = this.getSessionMinutes(node);
            return sessionTime < 60;
        }).length;
        
        // TODO: Analyze specific error patterns from job history
        const commonIssues = [
            { pattern: 'Handler failures', count: lowSuccess },
            { pattern: 'Zero job claiming', count: zeroJobs }
        ].filter(issue => issue.count > 0);
        
        return {
            zeroJobs: Math.round(zeroJobs / total * 100),
            lowSuccess: Math.round(lowSuccess / total * 100),
            quickDisconnects: Math.round(quickDisconnects / total * 100),
            commonIssues
        };
    }

    getSessionMinutes(node) {
        return Math.floor((node.lastHeartbeat - node.registeredAt) / 60);
    }

    // Database queries
    getRetentionStats() {
        const total = this.db.prepare('SELECT COUNT(*) as count FROM nodes').get();
        
        const survivedHour = this.db.prepare(`
            SELECT COUNT(*) as count FROM nodes 
            WHERE (lastHeartbeat - registeredAt) / 60 > 60
        `).get();
        
        const reached10h = this.db.prepare(`
            SELECT COUNT(*) as count FROM nodes 
            WHERE (lastHeartbeat - registeredAt) / 60 > 600
        `).get();
        
        const longTerm = this.db.prepare(`
            SELECT COUNT(*) as count FROM nodes 
            WHERE (lastHeartbeat - registeredAt) / 60 > 1440
        `).get();
        
        const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
        const currentlyOnline = this.db.prepare(`
            SELECT COUNT(*) as count FROM nodes 
            WHERE lastHeartbeat > ?
        `).get(fiveMinutesAgo);
        
        return {
            total: total.count,
            survivedHour: survivedHour.count,
            reached10h: reached10h.count,
            longTerm: longTerm.count,
            currentlyOnline: currentlyOnline.count
        };
    }

    getApproachingMilestones() {
        const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
        
        // Nodes in critical first hour
        const critical = this.db.prepare(`
            SELECT * FROM nodes 
            WHERE lastHeartbeat > ?
            AND (lastHeartbeat - registeredAt) / 60 < 60
            ORDER BY registeredAt DESC
        `).all(tenMinutesAgo);
        
        // Nodes approaching 10-hour milestone (8-10 hours)
        const stability = this.db.prepare(`
            SELECT * FROM nodes 
            WHERE lastHeartbeat > ?
            AND (lastHeartbeat - registeredAt) / 60 BETWEEN 480 AND 600
            ORDER BY registeredAt ASC
        `).all(tenMinutesAgo);
        
        return { critical, stability };
    }

    getRecentMilestones() {
        // Nodes that recently passed 10-hour milestone (10-12 hours)
        const stability = this.db.prepare(`
            SELECT * FROM nodes 
            WHERE (lastHeartbeat - registeredAt) / 60 BETWEEN 600 AND 720
            ORDER BY registeredAt DESC
        `).all();
        
        return { stability };
    }

    getHighRiskNodes() {
        const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
        return this.db.prepare(`
            SELECT * FROM nodes 
            WHERE lastHeartbeat < ?
            ORDER BY lastHeartbeat DESC
        `).all(oneHourAgo);
    }

    getRecentDisconnects(minutes) {
        const timeAgo = Math.floor(Date.now() / 1000) - (minutes * 60);
        const dayAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
        return this.db.prepare(`
            SELECT * FROM nodes 
            WHERE lastHeartbeat < ? 
            AND lastHeartbeat > ?
            ORDER BY lastHeartbeat DESC
        `).all(timeAgo, dayAgo);
    }

    getZeroJobNodes() {
        return this.db.prepare(`
            SELECT * FROM nodes 
            WHERE jobsCompleted = 0 OR jobsCompleted IS NULL
            ORDER BY registeredAt DESC
        `).all();
    }

    getAverageSessionTime() {
        const result = this.db.prepare(`
            SELECT AVG((lastHeartbeat - registeredAt) / 60.0) as avgMinutes 
            FROM nodes
            WHERE registeredAt IS NOT NULL AND lastHeartbeat IS NOT NULL
        `).get();
        return result.avgMinutes || 0;
    }
}

// CLI execution
if (require.main === module) {
    const args = process.argv.slice(2);
    const options = {
        alerts: args.includes('--alerts'),
        milestones: args.includes('--milestones')
    };
    
    const monitor = new RetentionMonitor();
    monitor.runMonitoring(options);
}

module.exports = RetentionMonitor;