#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();

/**
 * Job Availability Analysis Tool
 * 
 * Analyzes why pending jobs aren't showing as available.
 * Provides detailed capability matching and node availability insights.
 */

class JobAvailabilityAnalyzer {
    constructor() {
        this.db = new sqlite3.Database('data/mesh.db');
    }

    async analyze() {
        console.log('🔍 Job Availability Analysis');
        console.log('═══════════════════════════════');
        
        const [pendingJobs, nodes] = await Promise.all([
            this.getPendingJobs(),
            this.getNodes()
        ]);

        console.log(`\n📊 SYSTEM OVERVIEW`);
        console.log(`   Pending Jobs: ${pendingJobs.length}`);
        console.log(`   Total Nodes: ${nodes.length}`);
        
        const activeNodes = this.getActiveNodes(nodes);
        console.log(`   Active Nodes: ${activeNodes.length} (seen in last 5 minutes)`);

        if (pendingJobs.length === 0) {
            console.log('\n✅ No pending jobs - system is clear!');
            return;
        }

        console.log(`\n📋 PENDING JOB ANALYSIS`);
        console.log(`════════════════════════════`);

        for (const job of pendingJobs) {
            this.analyzeJob(job, nodes, activeNodes);
        }

        console.log(`\n📈 SYSTEM RECOMMENDATIONS`);
        console.log(`═══════════════════════════════`);
        this.generateRecommendations(pendingJobs, nodes, activeNodes);

        await this.close();
    }

    analyzeJob(job, allNodes, activeNodes) {
        const req = JSON.parse(job.requirements || '{}');
        console.log(`\n🔧 Job ${job.jobId.substring(0, 8)}... (${job.type})`);
        
        if (req.capability) {
            console.log(`   Requires: ${req.capability} capability`);
            
            const capableNodes = allNodes.filter(node => {
                const caps = JSON.parse(node.capabilities || '[]');
                return caps.includes(req.capability);
            });
            
            const activeCapableNodes = activeNodes.filter(node => {
                const caps = JSON.parse(node.capabilities || '[]');
                return caps.includes(req.capability);
            });

            console.log(`   Capable nodes: ${capableNodes.length} total, ${activeCapableNodes.length} active`);
            
            if (capableNodes.length === 0) {
                console.log(`   ❌ No nodes have ${req.capability} capability`);
            } else if (activeCapableNodes.length === 0) {
                console.log(`   ⏰ ${capableNodes.length} capable node(s) offline`);
                capableNodes.forEach(node => {
                    const lastSeenMins = Math.floor((Date.now() - node.lastSeen) / (1000 * 60));
                    console.log(`      - ${node.name} (last seen ${lastSeenMins} minutes ago)`);
                });
            } else {
                console.log(`   ✅ ${activeCapableNodes.length} node(s) can process this job`);
                activeCapableNodes.forEach(node => {
                    console.log(`      - ${node.name} (active)`);
                });
            }
        } else {
            console.log(`   No specific capability required`);
            if (activeNodes.length === 0) {
                console.log(`   ⏰ No active nodes available`);
            } else {
                console.log(`   ✅ ${activeNodes.length} node(s) can process this job`);
            }
        }
    }

    generateRecommendations(pendingJobs, allNodes, activeNodes) {
        // Analyze capability gaps
        const requiredCaps = new Set();
        pendingJobs.forEach(job => {
            const req = JSON.parse(job.requirements || '{}');
            if (req.capability) requiredCaps.add(req.capability);
        });

        const availableCaps = new Set();
        activeNodes.forEach(node => {
            const caps = JSON.parse(node.capabilities || '[]');
            caps.forEach(cap => availableCaps.add(cap));
        });

        const missingCaps = [...requiredCaps].filter(cap => !availableCaps.has(cap));
        
        if (missingCaps.length > 0) {
            console.log(`   🎯 MISSING CAPABILITIES: ${missingCaps.join(', ')}`);
            console.log(`      Need to recruit nodes with these capabilities`);
        }

        const offlineCapableNodes = allNodes.filter(node => {
            const caps = JSON.parse(node.capabilities || '[]');
            const hasNeededCap = [...requiredCaps].some(cap => caps.includes(cap));
            const lastSeenMins = (Date.now() - node.lastSeen) / (1000 * 60);
            return hasNeededCap && lastSeenMins > 5;
        });

        if (offlineCapableNodes.length > 0) {
            console.log(`   🔄 RECONNECTION OPPORTUNITIES:`);
            offlineCapableNodes.forEach(node => {
                const caps = JSON.parse(node.capabilities || '[]');
                const lastSeenMins = Math.floor((Date.now() - node.lastSeen) / (1000 * 60));
                const neededCaps = caps.filter(cap => requiredCaps.has(cap));
                console.log(`      - Contact ${node.name} (${neededCaps.join(', ')}, offline ${lastSeenMins}m)`);
            });
        }

        if (activeNodes.length === 0 && allNodes.length > 0) {
            console.log(`   📞 ALL NODES OFFLINE - Contact node operators for reconnection`);
        }
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
    const analyzer = new JobAvailabilityAnalyzer();
    analyzer.analyze().catch(console.error);
}

module.exports = JobAvailabilityAnalyzer;