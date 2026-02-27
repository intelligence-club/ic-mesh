#!/usr/bin/env node

/**
 * Monitoring Consistency Check
 * 
 * Compares different monitoring endpoints to identify discrepancies
 * and ensure all monitoring tools report consistent data.
 */

const Database = require('better-sqlite3');

class MonitoringConsistencyCheck {
    constructor() {
        this.dbPath = 'data/mesh.db';
        this.serverUrl = 'http://localhost:8333';
    }

    async checkConsistency() {
        console.log('🔍 Monitoring Consistency Check\n');
        
        try {
            // 1. Direct database query
            const dbStats = this.getDirectDatabaseStats();
            console.log('📊 Direct Database Query:');
            console.log(`   Active nodes: ${dbStats.activeNodes}/${dbStats.totalNodes}`);
            console.log(`   Pending jobs: ${dbStats.pendingJobs}`);
            console.log(`   Completed jobs: ${dbStats.completedJobs}`);
            
            // 2. HTTP status endpoint
            const httpStats = await this.getHttpStatusStats();
            console.log('\n🌐 HTTP Status Endpoint:');
            console.log(`   Active nodes: ${httpStats.activeNodes}/${httpStats.totalNodes}`);
            console.log(`   Pending jobs: ${httpStats.pendingJobs}`);
            console.log(`   Completed jobs: ${httpStats.completedJobs}`);
            
            // 3. Compare and report discrepancies
            console.log('\n🔍 Consistency Analysis:');
            this.compareStats('Active Nodes', dbStats.activeNodes, httpStats.activeNodes);
            this.compareStats('Total Nodes', dbStats.totalNodes, httpStats.totalNodes);
            this.compareStats('Pending Jobs', dbStats.pendingJobs, httpStats.pendingJobs);
            this.compareStats('Completed Jobs', dbStats.completedJobs, httpStats.completedJobs);
            
            // 4. Detailed node analysis
            console.log('\n🖥️  Detailed Node Status:');
            await this.analyzeNodeDetails();
            
        } catch (error) {
            console.error('❌ Monitoring check failed:', error.message);
            process.exit(1);
        }
    }

    getDirectDatabaseStats() {
        const db = new Database(this.dbPath, { readonly: true });
        
        // Active nodes (last 10 minutes)
        const activeNodesQuery = db.prepare(`
            SELECT COUNT(*) as count 
            FROM nodes 
            WHERE lastSeen > (strftime('%s', datetime('now', '-10 minutes')) * 1000)
        `);
        const activeNodes = activeNodesQuery.get().count;
        
        // Total nodes
        const totalNodesQuery = db.prepare('SELECT COUNT(*) as count FROM nodes');
        const totalNodes = totalNodesQuery.get().count;
        
        // Pending jobs
        const pendingJobsQuery = db.prepare(`
            SELECT COUNT(*) as count 
            FROM jobs 
            WHERE status IN ('pending', 'claimed')
        `);
        const pendingJobs = pendingJobsQuery.get().count;
        
        // Completed jobs
        const completedJobsQuery = db.prepare(`
            SELECT COUNT(*) as count 
            FROM jobs 
            WHERE status = 'completed'
        `);
        const completedJobs = completedJobsQuery.get().count;
        
        db.close();
        
        return { activeNodes, totalNodes, pendingJobs, completedJobs };
    }

    async getHttpStatusStats() {
        const response = await fetch(`${this.serverUrl}/status`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        return {
            activeNodes: data.nodes.active,
            totalNodes: data.nodes.total,
            pendingJobs: data.jobs.pending,
            completedJobs: data.jobs.completed
        };
    }

    compareStats(metric, dbValue, httpValue) {
        const match = dbValue === httpValue;
        const icon = match ? '✅' : '❌';
        const status = match ? 'MATCH' : 'MISMATCH';
        
        console.log(`   ${icon} ${metric}: DB=${dbValue}, HTTP=${httpValue} (${status})`);
        
        if (!match) {
            console.log(`      ⚠️  Discrepancy detected in ${metric}`);
        }
    }

    async analyzeNodeDetails() {
        const db = new Database(this.dbPath, { readonly: true });
        
        const nodesQuery = db.prepare(`
            SELECT 
                nodeId,
                name,
                capabilities,
                (strftime('%s', 'now') * 1000 - lastSeen) / 60000.0 as minutesAgo,
                CASE 
                    WHEN lastSeen > (strftime('%s', datetime('now', '-10 minutes')) * 1000) 
                    THEN 'ACTIVE' 
                    ELSE 'OFFLINE' 
                END as status
            FROM nodes
            ORDER BY lastSeen DESC
        `);
        
        const nodes = nodesQuery.all();
        
        nodes.forEach(node => {
            const statusIcon = node.status === 'ACTIVE' ? '🟢' : '🔴';
            const capabilities = JSON.parse(node.capabilities || '[]').join(', ') || 'none';
            console.log(`   ${statusIcon} ${node.name} (${node.nodeId.substring(0, 8)}): ${node.status} (${node.minutesAgo.toFixed(1)}m ago)`);
            console.log(`      Capabilities: ${capabilities}`);
        });
        
        db.close();
    }
}

// Run the consistency check
const checker = new MonitoringConsistencyCheck();
checker.checkConsistency().catch(console.error);