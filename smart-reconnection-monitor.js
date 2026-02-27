#!/usr/bin/env node

/**
 * Smart Reconnection Monitor for IC Mesh
 * Detects node patterns and optimizes for intermittent connections
 */

const sqlite3 = require('better-sqlite3');
const fs = require('fs');

class SmartReconnectionMonitor {
    constructor() {
        this.db = sqlite3('data/mesh.db');
        this.monitoringState = this.loadState();
        this.checkInterval = 15000; // 15 seconds for faster detection
    }

    loadState() {
        try {
            const data = fs.readFileSync('reconnection-monitor-state.json', 'utf8');
            return JSON.parse(data);
        } catch {
            return {
                lastChecked: Date.now(),
                nodePatterns: {},
                reconnectionAlerts: [],
                processedJobs: 0
            };
        }
    }

    saveState() {
        fs.writeFileSync('reconnection-monitor-state.json', JSON.stringify(this.monitoringState, null, 2));
    }

    analyzeNodePatterns() {
        const nodes = this.db.prepare(`
            SELECT nodeId, name, lastSeen, jobsCompleted, capabilities, owner
            FROM nodes 
            ORDER BY lastSeen DESC
        `).all();

        const patterns = {};
        const now = Date.now();

        for (const node of nodes) {
            const minutesOffline = Math.round((now - node.lastSeen) / (1000 * 60));
            const isActive = minutesOffline < 5;
            
            // Track pattern for intermittent nodes
            if (node.nodeId === '5ef95d698bdfa57a') { // unnamed node
                patterns.unnamed = {
                    nodeId: node.nodeId,
                    status: isActive ? 'active' : 'offline',
                    minutesOffline,
                    jobsCompleted: node.jobsCompleted,
                    capabilities: JSON.parse(node.capabilities || '[]'),
                    lastPattern: this.monitoringState.nodePatterns.unnamed?.lastPattern || 'first-check'
                };

                // Detect pattern changes
                const prevStatus = this.monitoringState.nodePatterns.unnamed?.status;
                if (prevStatus === 'offline' && isActive) {
                    patterns.unnamed.lastPattern = 'reconnection';
                    this.logReconnection(node);
                } else if (prevStatus === 'active' && !isActive) {
                    patterns.unnamed.lastPattern = 'disconnection';
                    this.logDisconnection(node);
                }
            }

            // Track Drake's nodes
            if (node.owner === 'drake') {
                patterns[node.name] = {
                    nodeId: node.nodeId,
                    status: isActive ? 'active' : 'offline', 
                    minutesOffline,
                    jobsCompleted: node.jobsCompleted,
                    capabilities: JSON.parse(node.capabilities || '[]'),
                    criticalCapabilities: this.getCriticalCapabilities(JSON.parse(node.capabilities || '[]'))
                };
            }
        }

        return patterns;
    }

    getCriticalCapabilities(capabilities) {
        const critical = ['tesseract', 'whisper', 'transcription'];
        return capabilities.filter(cap => critical.includes(cap));
    }

    logReconnection(node) {
        const alert = {
            timestamp: new Date().toISOString(),
            type: 'reconnection',
            nodeId: node.nodeId,
            name: node.name,
            jobsCompleted: node.jobsCompleted,
            message: `🟢 Node ${node.name || 'unnamed'} reconnected - processing ready`
        };

        this.monitoringState.reconnectionAlerts.push(alert);
        console.log(alert.message);

        // Trigger processing optimization
        this.optimizeForReconnection(node);
    }

    logDisconnection(node) {
        const alert = {
            timestamp: new Date().toISOString(),
            type: 'disconnection',
            nodeId: node.nodeId, 
            name: node.name,
            jobsCompleted: node.jobsCompleted,
            message: `🔴 Node ${node.name || 'unnamed'} disconnected - monitoring for return`
        };

        this.monitoringState.reconnectionAlerts.push(alert);
        console.log(alert.message);
    }

    optimizeForReconnection(node) {
        // Check if there are jobs this node can process
        const capabilities = JSON.parse(node.capabilities || '[]');
        const pendingJobs = this.db.prepare(`
            SELECT type, COUNT(*) as count 
            FROM jobs 
            WHERE status = 'pending' 
            GROUP BY type
        `).all();

        for (const job of pendingJobs) {
            if (this.canNodeProcessType(capabilities, job.type)) {
                console.log(`⚡ ${job.count} ${job.type} jobs ready for processing by ${node.name || 'unnamed'}`);
            }
        }
    }

    canNodeProcessType(capabilities, jobType) {
        const requirements = {
            'transcribe': ['whisper', 'transcription'],
            'ocr': ['tesseract'],
            'pdf-extract': ['tesseract'],
            'stable-diffusion': ['stable-diffusion']
        };

        const required = requirements[jobType] || [];
        return required.some(req => capabilities.includes(req));
    }

    generateStatusReport() {
        const patterns = this.analyzeNodePatterns();
        const pendingJobs = this.db.prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?').get('pending').count;
        
        console.log('\\n📊 SMART RECONNECTION MONITORING REPORT');
        console.log('════════════════════════════════════════');
        console.log(`Timestamp: ${new Date().toISOString()}`);
        console.log(`Pending jobs: ${pendingJobs}`);
        
        console.log('\\n🔍 Node Pattern Analysis:');
        Object.entries(patterns).forEach(([name, pattern]) => {
            const status = pattern.status === 'active' ? '🟢 ACTIVE' : `🔴 OFFLINE (${pattern.minutesOffline}m)`;
            console.log(`  ${name.padEnd(12)}: ${status} | ${pattern.jobsCompleted} jobs | ${pattern.capabilities.join(', ')}`);
        });

        // Show recent alerts
        const recentAlerts = this.monitoringState.reconnectionAlerts.slice(-5);
        if (recentAlerts.length > 0) {
            console.log('\\n📢 Recent Connection Events:');
            recentAlerts.forEach(alert => {
                console.log(`  ${alert.timestamp.substring(11, 19)} ${alert.message}`);
            });
        }

        return { patterns, pendingJobs, recentAlerts };
    }

    run() {
        console.log('🚀 Starting Smart Reconnection Monitor...');
        
        setInterval(() => {
            this.monitoringState.nodePatterns = this.analyzeNodePatterns();
            this.saveState();
        }, this.checkInterval);

        // Initial report
        this.generateStatusReport();
    }

    runOnce() {
        this.monitoringState.nodePatterns = this.analyzeNodePatterns();
        this.saveState();
        return this.generateStatusReport();
    }
}

if (require.main === module) {
    const monitor = new SmartReconnectionMonitor();
    
    const args = process.argv.slice(2);
    if (args.includes('--once')) {
        monitor.runOnce();
        monitor.db.close();
    } else {
        monitor.run();
        
        process.on('SIGINT', () => {
            console.log('\\n🛑 Monitoring stopped');
            monitor.db.close();
            process.exit();
        });
    }
}

module.exports = SmartReconnectionMonitor;