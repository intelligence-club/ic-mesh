#!/usr/bin/env node

/**
 * WebSocket Connection Analyzer
 * Identifies discrepancies between database node status and actual WebSocket connections
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const http = require('http');

class WSConnectionAnalyzer {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'data', 'mesh.db');
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('❌ Database connection failed:', err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    async getServerStatus() {
        return new Promise((resolve, reject) => {
            const req = http.get('http://localhost:8333/status', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error('Failed to parse server status: ' + error.message));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error('Server connection failed: ' + error.message));
            });

            req.setTimeout(5000, () => {
                req.abort();
                reject(new Error('Server status request timeout'));
            });
        });
    }

    async getDatabaseNodes() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT nodeId, owner, capabilities, lastSeen,
                       (strftime('%s', 'now') - lastSeen) as seconds_since_seen,
                       (SELECT COUNT(*) FROM jobs WHERE nodeId = n.nodeId AND status = 'completed') as completed_jobs,
                       flags
                FROM nodes n 
                ORDER BY lastSeen DESC
            `;

            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    analyzeConnectionGap(serverStatus, dbNodes) {
        const analysis = {
            serverConnected: serverStatus.websocket.connected,
            dbActiveNodes: 0,
            dbRecentNodes: 0,
            connectionGap: 0,
            ghostNodes: [],
            staleNodes: [],
            quickFixes: []
        };

        const now = Math.floor(Date.now() / 1000);
        
        for (const node of dbNodes) {
            const secondsSinceSeen = now - node.lastSeen;
            const minutesSinceSeen = Math.round(secondsSinceSeen / 60);

            if (secondsSinceSeen <= 300) { // 5 minutes
                analysis.dbActiveNodes++;
            }
            if (secondsSinceSeen <= 1800) { // 30 minutes
                analysis.dbRecentNodes++;
            }

            // Ghost nodes: show as active in DB but not connected to server
            if (secondsSinceSeen <= 300 && serverStatus.websocket.connected === 0) {
                analysis.ghostNodes.push({
                    nodeId: node.nodeId.substring(0, 8),
                    owner: node.owner,
                    capabilities: JSON.parse(node.capabilities || '[]'),
                    minutesSinceSeen: minutesSinceSeen,
                    completedJobs: node.completed_jobs,
                    flags: JSON.parse(node.flags || '{}')
                });
            }

            // Stale nodes: haven't been seen in a while
            if (secondsSinceSeen > 1800) { // 30 minutes
                analysis.staleNodes.push({
                    nodeId: node.nodeId.substring(0, 8),
                    owner: node.owner,
                    hoursSinceSeen: Math.round(secondsSinceSeen / 3600),
                    completedJobs: node.completed_jobs
                });
            }
        }

        analysis.connectionGap = analysis.dbActiveNodes - serverStatus.websocket.connected;

        // Generate quick fixes
        if (analysis.connectionGap > 0) {
            analysis.quickFixes.push('Database shows active nodes but WebSocket shows none - nodes may need to reconnect');
            analysis.quickFixes.push('Check if server WebSocket endpoint is working: ws://localhost:8333');
            analysis.quickFixes.push('Contact node owners to restart their mesh-transcribe processes');
        }

        if (analysis.ghostNodes.length > 0) {
            const quarantinedGhosts = analysis.ghostNodes.filter(node => 
                node.flags.quarantined || node.flags.partiallyQuarantined
            );
            if (quarantinedGhosts.length > 0) {
                analysis.quickFixes.push(`${quarantinedGhosts.length} quarantined nodes may be blocked from job claiming`);
            }
        }

        return analysis;
    }

    async displayAnalysis() {
        console.log('🔍 WEBSOCKET CONNECTION ANALYSIS');
        console.log('═════════════════════════════════════════════════');
        
        try {
            const serverStatus = await this.getServerStatus();
            const dbNodes = await this.getDatabaseNodes();
            const analysis = this.analyzeConnectionGap(serverStatus, dbNodes);

            console.log('📊 CONNECTION STATUS');
            console.log('─────────────────────────────────────');
            console.log(`Server WebSocket connections: ${serverStatus.websocket.connected}`);
            console.log(`Database active nodes (5min): ${analysis.dbActiveNodes}`);
            console.log(`Database recent nodes (30min): ${analysis.dbRecentNodes}`);
            console.log(`Connection gap: ${analysis.connectionGap}`);
            console.log('');

            if (analysis.ghostNodes.length > 0) {
                console.log('👻 GHOST NODES (Active in DB, Not Connected)');
                console.log('─────────────────────────────────────────────');
                analysis.ghostNodes.forEach(node => {
                    const capabilities = node.capabilities.join(', ') || 'none';
                    const flagStatus = node.flags.quarantined ? '🔴 QUARANTINED' : 
                                     node.flags.partiallyQuarantined ? '🟡 PARTIAL' : '✅ NORMAL';
                    console.log(`${node.nodeId} (${node.owner}): ${node.completedJobs} jobs, ${node.minutesSinceSeen}min ago`);
                    console.log(`   Capabilities: ${capabilities}`);
                    console.log(`   Status: ${flagStatus}`);
                    if (node.flags.blockReason) {
                        console.log(`   Block reason: ${node.flags.blockReason}`);
                    }
                });
                console.log('');
            }

            if (analysis.staleNodes.length > 0 && analysis.staleNodes.length <= 10) {
                console.log('🕰️  STALE NODES (Offline >30min)');
                console.log('─────────────────────────────────');
                analysis.staleNodes.slice(0, 10).forEach(node => {
                    console.log(`${node.nodeId} (${node.owner}): ${node.completedJobs} jobs, ${node.hoursSinceSeen}h ago`);
                });
                console.log('');
            }

            if (analysis.quickFixes.length > 0) {
                console.log('💡 QUICK FIXES');
                console.log('─────────────────────────────────');
                analysis.quickFixes.forEach((fix, i) => {
                    console.log(`${i + 1}. ${fix}`);
                });
                console.log('');
            }

            console.log('🎯 SUMMARY');
            console.log('─────────────────────────────────');
            if (analysis.connectionGap > 0) {
                console.log(`🔴 ${analysis.connectionGap} nodes appear active but aren't connected`);
                console.log('   → Jobs cannot be claimed until nodes reconnect');
                console.log('   → Contact node owners or check server WebSocket status');
            } else if (serverStatus.websocket.connected > 0) {
                console.log('🟢 WebSocket connections match database status');
            } else {
                console.log('🟡 No active connections (all nodes offline)');
            }

            return analysis;

        } catch (error) {
            console.error('❌ Analysis failed:', error.message);
            throw error;
        }
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// CLI Interface
async function main() {
    const analyzer = new WSConnectionAnalyzer();
    
    try {
        await analyzer.init();
        const result = await analyzer.displayAnalysis();
        
        // Exit code based on connection gap
        process.exit(result.connectionGap > 0 ? 1 : 0);
        
    } catch (error) {
        console.error('❌ WebSocket analysis failed:', error.message);
        process.exit(1);
    } finally {
        analyzer.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = WSConnectionAnalyzer;