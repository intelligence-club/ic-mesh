#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const fs = require('fs');

/**
 * Data Consistency Verification Tool
 * 
 * Compares data from multiple sources to identify discrepancies:
 * - Direct database queries
 * - API endpoints
 * - Cached data from analysis tools
 * 
 * Usage: node data-consistency-check.js
 */

class DataConsistencyChecker {
    constructor() {
        this.db = new sqlite3.Database('mesh.db');
        this.apiBase = 'http://localhost:8333';
        this.results = {
            timestamp: new Date().toISOString(),
            sources: {},
            discrepancies: [],
            summary: {}
        };
    }

    async checkDatabase() {
        return new Promise((resolve, reject) => {
            console.log('🔍 Checking database...');
            
            const queries = {
                pendingJobs: "SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'",
                completedJobs: "SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'",
                totalJobs: "SELECT COUNT(*) as count FROM jobs",
                activeNodes: "SELECT COUNT(*) as count FROM nodes WHERE lastHeartbeat > datetime('now', '-5 minutes')",
                totalNodes: "SELECT COUNT(*) as count FROM nodes",
                recentJobs: "SELECT * FROM jobs ORDER BY createdAt DESC LIMIT 5"
            };

            const results = {};
            let completed = 0;
            const total = Object.keys(queries).length;

            Object.entries(queries).forEach(([key, query]) => {
                this.db.all(query, [], (err, rows) => {
                    if (err) {
                        console.error(`❌ Database query failed for ${key}:`, err.message);
                        results[key] = { error: err.message };
                    } else {
                        if (key === 'recentJobs') {
                            results[key] = rows;
                        } else {
                            results[key] = rows[0].count;
                        }
                    }
                    
                    completed++;
                    if (completed === total) {
                        this.results.sources.database = results;
                        resolve(results);
                    }
                });
            });
        });
    }

    async checkAPI() {
        console.log('🌐 Checking API endpoints...');
        
        try {
            const endpoints = {
                status: '/status',
                nodes: '/nodes',
                availableJobs: '/jobs/available'
            };

            const results = {};
            
            for (const [key, endpoint] of Object.entries(endpoints)) {
                try {
                    const data = await this.httpGet(endpoint);
                    
                    if (key === 'nodes') {
                        results.totalNodes = Object.keys(data.nodes || {}).length;
                        results.activeNodes = Object.values(data.nodes || {})
                            .filter(node => node.status === 'online').length;
                    } else if (key === 'availableJobs') {
                        results.availableJobs = data.jobs ? data.jobs.length : 0;
                    } else if (key === 'status') {
                        results.status = data;
                    }
                } catch (apiErr) {
                    console.error(`❌ API endpoint ${endpoint} failed:`, apiErr.message);
                    results[key] = { error: apiErr.message };
                }
            }
            
            this.results.sources.api = results;
            return results;
        } catch (err) {
            console.error('❌ API check failed:', err.message);
            this.results.sources.api = { error: err.message };
            return { error: err.message };
        }
    }

    httpGet(path) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'localhost',
                port: 8333,
                path: path,
                method: 'GET'
            };

            const req = http.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    } catch (parseErr) {
                        reject(new Error(`Failed to parse response: ${parseErr.message}`));
                    }
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.setTimeout(5000, () => {
                req.abort();
                reject(new Error('Request timeout'));
            });

            req.end();
        });
    }

    async checkAnalysisTools() {
        console.log('🔧 Checking analysis tool outputs...');
        
        const results = {};
        
        // Check if analysis files exist and are recent
        const analysisFiles = [
            { path: 'revival-attempts.json', tool: 'node-revival-system' },
            { path: 'reports/node-retention-investigation-2026-02-27.json', tool: 'node-retention-investigator' }
        ];
        
        for (const file of analysisFiles) {
            if (fs.existsSync(file.path)) {
                try {
                    const data = JSON.parse(fs.readFileSync(file.path, 'utf8'));
                    const stat = fs.statSync(file.path);
                    const ageMinutes = (Date.now() - stat.mtime.getTime()) / (1000 * 60);
                    
                    results[file.tool] = {
                        lastModified: stat.mtime.toISOString(),
                        ageMinutes: Math.round(ageMinutes),
                        data: data,
                        fresh: ageMinutes < 60 // Less than 1 hour old
                    };
                } catch (parseErr) {
                    results[file.tool] = { error: `Parse error: ${parseErr.message}` };
                }
            } else {
                results[file.tool] = { status: 'file not found' };
            }
        }
        
        this.results.sources.analysisTools = results;
        return results;
    }

    findDiscrepancies() {
        console.log('⚖️  Analyzing discrepancies...');
        
        const { database, api, analysisTools } = this.results.sources;
        
        // Compare job counts
        if (database.pendingJobs !== undefined && api.availableJobs !== undefined) {
            if (database.pendingJobs !== api.availableJobs) {
                this.results.discrepancies.push({
                    type: 'job_count_mismatch',
                    severity: 'high',
                    description: `Database shows ${database.pendingJobs} pending jobs but API shows ${api.availableJobs} available jobs`,
                    sources: { database: database.pendingJobs, api: api.availableJobs }
                });
            }
        }

        // Compare node counts
        if (database.activeNodes !== undefined && api.activeNodes !== undefined) {
            if (database.activeNodes !== api.activeNodes) {
                this.results.discrepancies.push({
                    type: 'active_node_count_mismatch',
                    severity: 'medium',
                    description: `Database shows ${database.activeNodes} active nodes but API shows ${api.activeNodes} active nodes`,
                    sources: { database: database.activeNodes, api: api.activeNodes }
                });
            }
        }

        // Check for stale analysis data
        Object.entries(analysisTools).forEach(([tool, data]) => {
            if (data.ageMinutes > 60 && !data.fresh) {
                this.results.discrepancies.push({
                    type: 'stale_analysis_data',
                    severity: 'low',
                    description: `Analysis tool ${tool} has data that is ${data.ageMinutes} minutes old`,
                    sources: { tool, ageMinutes: data.ageMinutes }
                });
            }
        });
    }

    generateSummary() {
        this.results.summary = {
            discrepanciesFound: this.results.discrepancies.length,
            highSeverityIssues: this.results.discrepancies.filter(d => d.severity === 'high').length,
            mediumSeverityIssues: this.results.discrepancies.filter(d => d.severity === 'medium').length,
            lowSeverityIssues: this.results.discrepancies.filter(d => d.severity === 'low').length,
            overallConsistency: this.results.discrepancies.length === 0 ? 'excellent' : 
                               this.results.discrepancies.filter(d => d.severity === 'high').length > 0 ? 'poor' : 
                               this.results.discrepancies.filter(d => d.severity === 'medium').length > 0 ? 'fair' : 'good'
        };
    }

    async run() {
        console.log('🔍 IC Mesh Data Consistency Check');
        console.log('══════════════════════════════════');
        
        try {
            await this.checkDatabase();
            await this.checkAPI();
            await this.checkAnalysisTools();
            
            this.findDiscrepancies();
            this.generateSummary();
            
            // Output results
            console.log('\n📊 CONSISTENCY RESULTS');
            console.log('═════════════════════════');
            
            console.log(`\n✅ Overall Consistency: ${this.results.summary.overallConsistency.toUpperCase()}`);
            console.log(`📈 Total Discrepancies: ${this.results.summary.discrepanciesFound}`);
            
            if (this.results.discrepancies.length > 0) {
                console.log('\n🚨 DISCREPANCIES FOUND:');
                this.results.discrepancies.forEach((disc, i) => {
                    const icon = disc.severity === 'high' ? '🔴' : disc.severity === 'medium' ? '🟡' : '🟢';
                    console.log(`   ${icon} ${disc.type}: ${disc.description}`);
                });
            }
            
            console.log('\n📋 DATA SOURCES COMPARISON:');
            console.log(`   Database: ${this.results.sources.database.pendingJobs || 0} pending jobs, ${this.results.sources.database.activeNodes || 0} active nodes`);
            console.log(`   API:      ${this.results.sources.api.availableJobs || 0} available jobs, ${this.results.sources.api.activeNodes || 0} active nodes`);
            
            // Save detailed results
            const outputFile = `consistency-check-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
            fs.writeFileSync(outputFile, JSON.stringify(this.results, null, 2));
            console.log(`\n💾 Detailed results saved: ${outputFile}`);
            
            console.log('\n✅ Data consistency check complete!');
            
        } catch (err) {
            console.error('❌ Consistency check failed:', err.message);
            process.exit(1);
        } finally {
            this.db.close();
        }
    }
}

// Run the check
if (require.main === module) {
    const checker = new DataConsistencyChecker();
    checker.run().catch(console.error);
}

module.exports = DataConsistencyChecker;