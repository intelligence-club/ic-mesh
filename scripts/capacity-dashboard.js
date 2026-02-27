#!/usr/bin/env node

/**
 * IC Mesh Capacity Dashboard
 * 
 * Real-time dashboard showing network capacity, job queue status,
 * and business health metrics in a clean, readable format.
 * 
 * Features:
 * - Live network status with node health indicators
 * - Job queue analysis with revenue calculations
 * - Capacity utilization and availability metrics  
 * - Critical alerts and recommendations
 * - Historical trend indicators
 * - Export options for reporting
 * 
 * Usage:
 *   node capacity-dashboard.js [--refresh=30] [--export] [--compact]
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Configuration
const config = {
    databasePath: process.env.DATABASE_PATH || 'data/mesh.db',
    refreshInterval: 30000, // 30 seconds
    offlineThreshold: 5, // minutes
    criticalCapabilities: [
        'transcription', 'transcribe', 'whisper',
        'tesseract', 'ocr', 'pdf-extract',
        'ollama', 'stable-diffusion'
    ]
};

class CapacityDashboard {
    constructor(options = {}) {
        this.refreshInterval = (options.refresh || 30) * 1000;
        this.exportMode = options.export || false;
        this.compactMode = options.compact || false;
        this.running = false;
    }
    
    async getDatabase() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(config.databasePath, (err) => {
                if (err) reject(err);
                else resolve(db);
            });
        });
    }
    
    async getNetworkStatus() {
        const db = await this.getDatabase();
        
        const nodes = await new Promise((resolve, reject) => {
            db.all(`
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
                ORDER BY 
                    CASE WHEN ROUND((julianday('now') - julianday(datetime(lastSeen/1000, 'unixepoch'))) * 24 * 60) <= ${config.offlineThreshold} THEN 0 ELSE 1 END,
                    lastSeen DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        const jobs = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    status,
                    type,
                    COUNT(*) as count
                FROM jobs 
                GROUP BY status, type
                ORDER BY status, count DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        const serverStatus = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_jobs,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    AVG(computeMs) as avg_compute_time
                FROM jobs
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        db.close();
        return { nodes, jobs, serverStatus };
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
    
    analyzeJobQueue(jobs) {
        const pending = jobs.filter(j => j.status === 'pending');
        const processing = jobs.filter(j => j.status === 'claimed');
        const completed = jobs.filter(j => j.status === 'completed');
        const failed = jobs.filter(j => j.status === 'failed');
        
        let pendingRevenue = { min: 0, max: 0 };
        for (const job of pending) {
            const revenue = this.calculateRevenue(job.type, job.count);
            pendingRevenue.min += revenue.min;
            pendingRevenue.max += revenue.max;
        }
        
        return {
            pending: { jobs: pending, totalCount: pending.reduce((sum, j) => sum + j.count, 0) },
            processing: { jobs: processing, totalCount: processing.reduce((sum, j) => sum + j.count, 0) },
            completed: { jobs: completed, totalCount: completed.reduce((sum, j) => sum + j.count, 0) },
            failed: { jobs: failed, totalCount: failed.reduce((sum, j) => sum + j.count, 0) },
            pendingRevenue
        };
    }
    
    analyzeCapacity(nodes) {
        const online = nodes.filter(n => n.minutes_offline <= config.offlineThreshold);
        const offline = nodes.filter(n => n.minutes_offline > config.offlineThreshold);
        
        // Analyze capabilities
        const availableCapabilities = new Set();
        const missingCapabilities = new Set(config.criticalCapabilities);
        
        for (const node of online) {
            const caps = this.parseCapabilities(node.capabilities);
            for (const cap of caps) {
                if (config.criticalCapabilities.includes(cap)) {
                    availableCapabilities.add(cap);
                    missingCapabilities.delete(cap);
                }
            }
        }
        
        // Calculate capacity utilization
        const totalExperience = nodes.reduce((sum, n) => sum + (n.jobsCompleted || 0), 0);
        const onlineExperience = online.reduce((sum, n) => sum + (n.jobsCompleted || 0), 0);
        const experienceUtilization = totalExperience > 0 ? (onlineExperience / totalExperience * 100) : 0;
        
        return {
            total: nodes.length,
            online: online.length,
            offline: offline.length,
            availableCapabilities: Array.from(availableCapabilities),
            missingCapabilities: Array.from(missingCapabilities),
            experienceUtilization,
            nodes: { online, offline }
        };
    }
    
    getHealthScore(capacity, jobQueue) {
        let score = 100;
        
        // Penalize for offline nodes
        const offlineRatio = capacity.offline / capacity.total;
        score -= offlineRatio * 40; // Up to -40 for all nodes offline
        
        // Penalize for missing critical capabilities
        const missingCapRatio = capacity.missingCapabilities.length / config.criticalCapabilities.length;
        score -= missingCapRatio * 30; // Up to -30 for all capabilities missing
        
        // Penalize for high job backlog
        if (jobQueue.pending.totalCount > 50) score -= 20;
        else if (jobQueue.pending.totalCount > 20) score -= 10;
        else if (jobQueue.pending.totalCount > 10) score -= 5;
        
        // Penalize for failed jobs
        if (jobQueue.failed.totalCount > 10) score -= 10;
        
        return Math.max(0, Math.round(score));
    }
    
    formatDashboard(data) {
        const { capacity, jobQueue, serverStatus } = data;
        const healthScore = this.getHealthScore(capacity, jobQueue);
        
        // Header
        let output = [];
        output.push('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗');
        output.push('║                                    🌐 IC MESH CAPACITY DASHBOARD                                     ║');
        output.push('╠══════════════════════════════════════════════════════════════════════════════════════════════════════╣');
        
        // Health Overview
        const healthIcon = healthScore >= 90 ? '🟢' : healthScore >= 70 ? '🟡' : healthScore >= 50 ? '🟠' : '🔴';
        const timestamp = new Date().toLocaleString();
        output.push(`║ ${healthIcon} System Health: ${healthScore}/100  │  📅 ${timestamp.padEnd(42)}║`);
        output.push('╠══════════════════════════════════════════════════════════════════════════════════════════════════════╣');
        
        // Network Status
        output.push('║ 🖥️  NETWORK STATUS                                                                                   ║');
        output.push('╟──────────────────────────────────────────────────────────────────────────────────────────────────────╢');
        output.push(`║ Nodes: ${capacity.online}/${capacity.total} online  │  Experience: ${capacity.experienceUtilization.toFixed(1)}% available  │  Revenue pending: $${jobQueue.pendingRevenue.min}-${jobQueue.pendingRevenue.max}     ║`);
        
        if (!this.compactMode) {
            // Online Nodes
            if (capacity.nodes.online.length > 0) {
                output.push('║                                                                                                          ║');
                output.push('║ 🟢 ONLINE NODES:                                                                                       ║');
                for (const node of capacity.nodes.online) {
                    const name = (node.name || node.nodeId.substring(0, 12)).padEnd(12);
                    const caps = this.parseCapabilities(node.capabilities)
                        .filter(c => config.criticalCapabilities.includes(c))
                        .join(', ').padEnd(30);
                    const jobs = String(node.jobsCompleted || 0).padStart(4);
                    const owner = (node.owner || '').padEnd(10);
                    output.push(`║   • ${name} │ ${caps} │ ${jobs} jobs │ ${owner} ║`);
                }
            }
            
            // Offline Nodes (critical ones only)
            const criticalOffline = capacity.nodes.offline.filter(node => {
                const caps = this.parseCapabilities(node.capabilities);
                return caps.some(cap => config.criticalCapabilities.includes(cap));
            });
            
            if (criticalOffline.length > 0) {
                output.push('║                                                                                                          ║');
                output.push('║ 🔴 OFFLINE NODES (CRITICAL):                                                                           ║');
                for (const node of criticalOffline.slice(0, 5)) { // Limit to 5 for space
                    const name = (node.name || node.nodeId.substring(0, 12)).padEnd(12);
                    const offline = this.formatDuration(node.minutes_offline).padEnd(10);
                    const caps = this.parseCapabilities(node.capabilities)
                        .filter(c => config.criticalCapabilities.includes(c))
                        .join(', ').padEnd(20);
                    const owner = (node.owner || '').padEnd(10);
                    output.push(`║   • ${name} │ ${offline} │ ${caps} │ ${owner} ║`);
                }
            }
        }
        
        output.push('╠══════════════════════════════════════════════════════════════════════════════════════════════════════╣');
        
        // Job Queue Status
        output.push('║ 📋 JOB QUEUE STATUS                                                                                     ║');
        output.push('╟──────────────────────────────────────────────────────────────────────────────────────────────────────╢');
        output.push(`║ Pending: ${String(jobQueue.pending.totalCount).padStart(3)} │ Processing: ${String(jobQueue.processing.totalCount).padStart(3)} │ Completed: ${String(jobQueue.completed.totalCount).padStart(5)} │ Failed: ${String(jobQueue.failed.totalCount).padStart(3)}                 ║`);
        
        if (!this.compactMode && jobQueue.pending.jobs.length > 0) {
            output.push('║                                                                                                          ║');
            output.push('║ 🔄 PENDING JOBS:                                                                                       ║');
            for (const job of jobQueue.pending.jobs.slice(0, 5)) {
                const revenue = this.calculateRevenue(job.type, job.count);
                const type = job.type.padEnd(15);
                const count = String(job.count).padStart(3);
                const rev = `$${revenue.min}-${revenue.max}`.padEnd(10);
                output.push(`║   • ${type} │ ${count} jobs │ ${rev}                                            ║`);
            }
        }
        
        output.push('╠══════════════════════════════════════════════════════════════════════════════════════════════════════╣');
        
        // Capabilities Status
        output.push('║ 🛠️  CAPABILITY STATUS                                                                                   ║');
        output.push('╟──────────────────────────────────────────────────────────────────────────────────────────────────────╢');
        
        const availableStr = capacity.availableCapabilities.join(', ') || 'None';
        const missingStr = capacity.missingCapabilities.join(', ') || 'None';
        
        output.push(`║ ✅ Available: ${availableStr.padEnd(80)} ║`);
        output.push(`║ ❌ Missing: ${missingStr.padEnd(82)} ║`);
        
        // Alerts & Recommendations
        const alerts = this.generateAlerts(capacity, jobQueue);
        if (alerts.length > 0) {
            output.push('╠══════════════════════════════════════════════════════════════════════════════════════════════════════╣');
            output.push('║ ⚠️  ALERTS & RECOMMENDATIONS                                                                            ║');
            output.push('╟──────────────────────────────────────────────────────────────────────────────────────────────────────╢');
            for (const alert of alerts.slice(0, 3)) {
                const lines = this.wrapText(alert, 94);
                for (let i = 0; i < lines.length; i++) {
                    output.push(`║ ${i === 0 ? '• ' : '  '}${lines[i].padEnd(94)} ║`);
                }
            }
        }
        
        output.push('╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝');
        
        return output.join('\\n');
    }
    
    generateAlerts(capacity, jobQueue) {
        const alerts = [];
        
        // Critical offline nodes
        if (capacity.missingCapabilities.length > 0) {
            alerts.push(`🚨 CRITICAL: Missing capabilities (${capacity.missingCapabilities.join(', ')}) - ${jobQueue.pending.totalCount} jobs blocked`);
        }
        
        // High job backlog
        if (jobQueue.pending.totalCount > 50) {
            alerts.push(`📈 HIGH BACKLOG: ${jobQueue.pending.totalCount} jobs pending ($${jobQueue.pendingRevenue.min}-${jobQueue.pendingRevenue.max} revenue)`);
        }
        
        // Recent failures
        if (jobQueue.failed.totalCount > 10) {
            alerts.push(`❌ FAILURES: ${jobQueue.failed.totalCount} failed jobs - check node health and job validity`);
        }
        
        // Low capacity utilization
        if (capacity.experienceUtilization < 50 && capacity.total > 2) {
            alerts.push(`⚡ LOW UTILIZATION: ${capacity.experienceUtilization.toFixed(1)}% of experienced nodes online`);
        }
        
        // Specific node recommendations
        const criticalOffline = capacity.nodes.offline.filter(n => {
            const caps = this.parseCapabilities(n.capabilities);
            return caps.some(cap => config.criticalCapabilities.includes(cap)) && n.minutes_offline < 24 * 60;
        });
        
        for (const node of criticalOffline.slice(0, 2)) {
            if (node.owner === 'drake') {
                alerts.push(`📞 CONTACT DRAKE: ${node.name} offline ${this.formatDuration(node.minutes_offline)} - run 'claw skill mesh-transcribe'`);
            } else if (node.owner !== 'unknown') {
                alerts.push(`📞 CONTACT ${node.owner.toUpperCase()}: ${node.name} offline ${this.formatDuration(node.minutes_offline)}`);
            }
        }
        
        return alerts;
    }
    
    formatDuration(minutes) {
        if (minutes < 60) return `${Math.round(minutes)}m`;
        if (minutes < 24 * 60) return `${Math.round(minutes / 60 * 10) / 10}h`;
        return `${Math.round(minutes / (24 * 60) * 10) / 10}d`;
    }
    
    wrapText(text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            if ((currentLine + word).length > maxWidth) {
                if (currentLine) {
                    lines.push(currentLine.trim());
                    currentLine = word + ' ';
                } else {
                    lines.push(word);
                }
            } else {
                currentLine += word + ' ';
            }
        }
        
        if (currentLine.trim()) {
            lines.push(currentLine.trim());
        }
        
        return lines;
    }
    
    async generateReport() {
        const data = await this.getNetworkStatus();
        const capacity = this.analyzeCapacity(data.nodes);
        const jobQueue = this.analyzeJobQueue(data.jobs);
        
        return {
            timestamp: new Date().toISOString(),
            capacity,
            jobQueue,
            serverStatus: data.serverStatus,
            healthScore: this.getHealthScore(capacity, jobQueue)
        };
    }
    
    async displayDashboard() {
        if (!this.running) return;
        
        try {
            // Clear screen (in terminal environments)
            if (process.stdout.clearLine) {
                console.clear();
            }
            
            const data = await this.getNetworkStatus();
            const capacity = this.analyzeCapacity(data.nodes);
            const jobQueue = this.analyzeJobQueue(data.jobs);
            
            const dashboard = this.formatDashboard({
                capacity,
                jobQueue,
                serverStatus: data.serverStatus
            });
            
            console.log(dashboard);
            
            if (this.exportMode) {
                const report = await this.generateReport();
                const filename = `capacity-report-${new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)}.json`;
                fs.writeFileSync(filename, JSON.stringify(report, null, 2));
            }
            
        } catch (error) {
            console.error('Dashboard error:', error.message);
        }
    }
    
    async start() {
        this.running = true;
        console.log('🚀 Starting IC Mesh Capacity Dashboard...');
        console.log(`⏰ Auto-refresh: ${this.refreshInterval/1000}s | Export: ${this.exportMode} | Compact: ${this.compactMode}`);
        console.log('Press Ctrl+C to stop\\n');
        
        // Initial display
        await this.displayDashboard();
        
        // Auto-refresh
        const interval = setInterval(() => {
            this.displayDashboard();
        }, this.refreshInterval);
        
        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('\\n🛑 Dashboard stopped');
            this.running = false;
            clearInterval(interval);
            process.exit(0);
        });
    }
    
    async showOnce() {
        await this.displayDashboard();
    }
}

// CLI execution
if (require.main === module) {
    const args = process.argv.slice(2);
    
    const options = {
        refresh: 30,
        export: args.includes('--export'),
        compact: args.includes('--compact')
    };
    
    const refreshArg = args.find(arg => arg.startsWith('--refresh='));
    if (refreshArg) {
        options.refresh = parseInt(refreshArg.split('=')[1]) || 30;
    }
    
    const dashboard = new CapacityDashboard(options);
    
    if (args.includes('--once')) {
        dashboard.showOnce();
    } else {
        dashboard.start().catch(error => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
    }
}

module.exports = CapacityDashboard;