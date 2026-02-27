#!/usr/bin/env node
/**
 * WebSocket vs Database Sync Check
 * Investigates discrepancies between WebSocket connections and database node status
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const http = require('http');

const DB_PATH = path.join(__dirname, '../data/mesh.db');

async function getServerStatus() {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: 8333,
            path: '/status',
            method: 'GET'
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(`JSON parse error: ${e.message}`);
                }
            });
        });
        
        req.on('error', reject);
        req.setTimeout(5000, () => reject('Request timeout'));
        req.end();
    });
}

function getDbNodes() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                reject(`Database connection error: ${err.message}`);
                return;
            }
        });

        db.all(`
            SELECT 
                nodeId,
                owner,
                capabilities,
                lastSeen,
                jobsCompleted,
                (strftime('%s', 'now') - lastSeen) / 60 as minutesOffline,
                registeredAt,
                cpuCores,
                ramMB
            FROM nodes
            ORDER BY jobsCompleted DESC
        `, (err, nodes) => {
            if (err) {
                reject(`Query error: ${err.message}`);
                return;
            }
            db.close();
            resolve(nodes);
        });
    });
}

function parseCapabilities(capStr) {
    try {
        return JSON.parse(capStr || '[]');
    } catch {
        return [];
    }
}

async function analyzeSync() {
    try {
        console.log('🔍 WebSocket vs Database Sync Analysis');
        console.log('=====================================\n');

        // Get server status (WebSocket connections)
        console.log('📡 Fetching server status...');
        const serverStatus = await getServerStatus();
        
        console.log('📊 Server WebSocket Status:');
        console.log(`   Active connections: ${serverStatus.activeNodes || 0}`);
        console.log(`   Total registered: ${serverStatus.totalNodes || 0}`);
        console.log(`   Pending jobs: ${serverStatus.pendingJobs || 0}\n`);

        // Get database node info
        console.log('💾 Fetching database node status...');
        const dbNodes = await getDbNodes();
        
        console.log('📊 Database Node Status:');
        console.log(`   Registered nodes: ${dbNodes.length}`);
        const recentlyActive = dbNodes.filter(n => n.minutesOffline < 5).length;
        console.log(`   Recently active (<5min): ${recentlyActive}`);
        console.log(`   Long offline (>60min): ${dbNodes.filter(n => n.minutesOffline > 60).length}\n`);

        // Detailed comparison
        console.log('🔄 Sync Discrepancy Analysis:');
        
        if ((serverStatus.activeNodes || 0) !== recentlyActive) {
            console.log('   ⚠️  DISCREPANCY DETECTED:');
            console.log(`      WebSocket active: ${serverStatus.activeNodes || 0}`);
            console.log(`      Database active: ${recentlyActive}`);
            console.log('      This indicates nodes are registered but not connected\n');
        } else {
            console.log('   ✅ WebSocket and database counts match\n');
        }

        // Node details with capability analysis
        console.log('🖥️  Detailed Node Analysis:');
        dbNodes.forEach(node => {
            const caps = parseCapabilities(node.capabilities);
            const hasTestCap = caps.includes('tesseract');
            const hasTranscribe = caps.includes('transcribe') || caps.includes('transcription');
            
            let status = '🔴';
            let timeDesc = `${Math.round(node.minutesOffline)}m offline`;
            
            if (node.minutesOffline < 5) {
                status = '🟢';
                timeDesc = 'Active (DB)';
            } else if (node.minutesOffline < 60) {
                status = '🟡';
                timeDesc = `${Math.round(node.minutesOffline)}m ago`;
            }

            console.log(`   ${status} ${node.nodeId.substring(0, 8)}... (${node.owner})`);
            console.log(`      Status: ${timeDesc}`);
            console.log(`      Performance: ${node.jobsCompleted} jobs, ${caps.length} capabilities`);
            
            if (hasTestCap) {
                console.log(`      🔍 HAS TESSERACT - can process OCR/PDF jobs`);
            }
            if (hasTranscribe) {
                console.log(`      🎵 HAS TRANSCRIPTION - can process audio jobs`);
            }
            
            console.log(`      Capabilities: ${caps.join(', ')}`);
            console.log();
        });

        // Actionable recommendations
        console.log('💡 Sync Resolution Recommendations:');
        
        if ((serverStatus.activeNodes || 0) === 0 && recentlyActive > 0) {
            console.log('   🚨 CRITICAL: Database shows active nodes but WebSocket shows none');
            console.log('   📋 This means nodes are registered but disconnected');
            console.log('   🔧 Actions needed:');
            
            const nodesWithTesseract = dbNodes.filter(n => 
                parseCapabilities(n.capabilities).includes('tesseract')
            );
            
            if (nodesWithTesseract.length > 0) {
                console.log('   📞 Contact node owners to reconnect:');
                nodesWithTesseract.forEach(node => {
                    console.log(`      • ${node.owner}: node ${node.nodeId.substring(0, 8)}... (HAS TESSERACT)`);
                });
            }
            
            const highPerformers = dbNodes.filter(n => n.jobsCompleted > 100);
            if (highPerformers.length > 0) {
                console.log('   🏆 High-value nodes to prioritize:');
                highPerformers.forEach(node => {
                    console.log(`      • ${node.nodeId.substring(0, 8)}... (${node.jobsCompleted} jobs)`);
                });
            }
        } else if ((serverStatus.activeNodes || 0) > 0) {
            console.log('   ✅ Nodes are connected and ready to process jobs');
            console.log('   📋 If jobs aren\'t processing, check job-node capability matching');
        }

        // Timestamp integrity check
        const now = Math.floor(Date.now() / 1000);
        const futureNodes = dbNodes.filter(n => n.lastSeen > now + 3600); // More than 1hr in future
        const ancientNodes = dbNodes.filter(n => n.lastSeen < now - 86400 * 365); // More than 1yr old
        
        if (futureNodes.length > 0 || ancientNodes.length > 0) {
            console.log('\n   ⚠️  Database timestamp integrity issues detected:');
            if (futureNodes.length > 0) {
                console.log(`      • ${futureNodes.length} nodes have future timestamps`);
            }
            if (ancientNodes.length > 0) {
                console.log(`      • ${ancientNodes.length} nodes have very old timestamps`);
            }
            console.log('      🔧 Consider running timestamp repair utility');
        }

    } catch (error) {
        console.error('❌ Analysis failed:', error);
        process.exit(1);
    }
}

// Run the analysis
if (require.main === module) {
    analyzeSync();
}

module.exports = { analyzeSync };