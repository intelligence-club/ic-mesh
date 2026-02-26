#!/usr/bin/env node
/**
 * Node Reconnection Advisor - Diagnose and solve node connectivity issues
 * 
 * Provides specific guidance for getting offline nodes back online,
 * including troubleshooting steps and automated recovery suggestions.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '../data/mesh.db');

class NodeReconnectionAdvisor {
    constructor() {
        this.db = new sqlite3.Database(dbPath);
    }

    async analyzeNodeConnectivity() {
        console.log('🔗 Node Reconnection Advisor - Connectivity Analysis\n');

        const nodes = await this.getAllNodes();
        
        if (nodes.length === 0) {
            console.log('❌ No nodes found in database');
            this.close();
            return;
        }

        const activeNodes = nodes.filter(node => node.minutesOffline < 5);
        const recentNodes = nodes.filter(node => node.minutesOffline >= 5 && node.minutesOffline < 60);
        const offlineNodes = nodes.filter(node => node.minutesOffline >= 60);

        console.log(`📊 Node Connectivity Overview:`);
        console.log(`   Total nodes: ${nodes.length}`);
        console.log(`   🟢 Active (< 5min): ${activeNodes.length}`);
        console.log(`   🟡 Recent (< 1hr): ${recentNodes.length}`);
        console.log(`   🔴 Offline (≥ 1hr): ${offlineNodes.length}`);

        if (activeNodes.length > 0) {
            console.log(`\n✅ Active Nodes (${activeNodes.length}):`);
            activeNodes.forEach(node => this.displayNodeSummary(node, '🟢'));
        }

        if (recentNodes.length > 0) {
            console.log(`\n🟡 Recently Offline Nodes (${recentNodes.length}):`);
            recentNodes.forEach(node => this.displayNodeSummary(node, '🟡'));
            console.log(`   💡 These nodes may reconnect on their own - monitor for 1-2 hours`);
        }

        if (offlineNodes.length > 0) {
            console.log(`\n🔴 Offline Nodes Needing Attention (${offlineNodes.length}):`);
            for (const node of offlineNodes) {
                await this.analyzeOfflineNode(node);
            }
        }

        // Generate reconnection strategies
        if (recentNodes.length > 0 || offlineNodes.length > 0) {
            console.log('\n🛠️  Reconnection Strategies:');
            await this.generateReconnectionStrategies(recentNodes, offlineNodes);
        }
    }

    async getAllNodes() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    nodeId,
                    name,
                    capabilities,
                    flags,
                    lastSeen,
                    registeredAt,
                    datetime(lastSeen/1000, 'unixepoch') as lastSeenTime,
                    datetime(registeredAt/1000, 'unixepoch') as registeredTime,
                    (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - lastSeen) / 60000 as minutesOffline,
                    (lastSeen - registeredAt) / 60000 as totalSessionMinutes
                FROM nodes
                ORDER BY lastSeen DESC
            `, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                // Process node data
                rows.forEach(node => {
                    try {
                        node.flagsObj = JSON.parse(node.flags || '{}');
                        node.capabilitiesArray = JSON.parse(node.capabilities || '[]');
                        node.isQuarantined = !!node.flagsObj.quarantined || !!node.flagsObj.partiallyQuarantined;
                    } catch (e) {
                        node.flagsObj = {};
                        node.capabilitiesArray = [];
                        node.isQuarantined = false;
                    }
                });
                
                resolve(rows);
            });
        });
    }

    displayNodeSummary(node, icon) {
        const hoursOffline = (node.minutesOffline / 60).toFixed(1);
        const sessionHours = (node.totalSessionMinutes / 60).toFixed(1);
        const quarantineStatus = node.isQuarantined ? '🔒' : '';
        
        console.log(`   ${icon}${quarantineStatus} ${node.nodeId.slice(0,8)} (${node.name || 'unnamed'})`);
        console.log(`      Last seen: ${node.lastSeenTime} (${hoursOffline}h ago)`);
        console.log(`      Session time: ${sessionHours}h total`);
        console.log(`      Capabilities: ${node.capabilitiesArray.slice(0,3).join(', ')}`);
    }

    async analyzeOfflineNode(node) {
        const hoursOffline = (node.minutesOffline / 60).toFixed(1);
        const sessionHours = (node.totalSessionMinutes / 60).toFixed(1);
        const quarantineStatus = node.isQuarantined ? '🔒' : '';
        
        console.log(`\n   ${quarantineStatus} ${node.nodeId.slice(0,8)} (${node.name || 'unnamed'})`);
        console.log(`      ⏰ Offline: ${hoursOffline} hours`);
        console.log(`      💼 Previous session: ${sessionHours} hours`);
        console.log(`      🔧 Capabilities: ${node.capabilitiesArray.join(', ')}`);
        
        // Analyze disconnection patterns
        const disconnectionType = this.categorizeDisconnection(node);
        console.log(`      🔍 Pattern: ${disconnectionType.type}`);
        console.log(`      💡 Likely cause: ${disconnectionType.cause}`);
        
        // Quarantine analysis
        if (node.isQuarantined) {
            this.analyzeQuarantineStatus(node);
        }
        
        // Generate specific reconnection steps
        const steps = this.generateReconnectionSteps(node, disconnectionType);
        console.log(`      📋 Reconnection steps:`);
        steps.forEach((step, i) => {
            console.log(`         ${i + 1}. ${step}`);
        });
    }

    categorizeDisconnection(node) {
        const hoursOffline = node.minutesOffline / 60;
        const sessionHours = node.totalSessionMinutes / 60;
        
        if (hoursOffline > 24 * 7) { // More than a week
            return {
                type: 'Long-term disconnection',
                cause: 'Node operator may have stopped running the client'
            };
        } else if (hoursOffline > 24) { // More than a day
            return {
                type: 'Extended outage',
                cause: 'System restart, network issues, or operator intervention'
            };
        } else if (sessionHours < 1) { // Short session
            return {
                type: 'Quick disconnect',
                cause: 'Setup issues, immediate errors, or testing'
            };
        } else if (node.isQuarantined) {
            return {
                type: 'Quarantine-related disconnect',
                cause: 'Node may have disconnected due to job failures'
            };
        } else {
            return {
                type: 'Normal disconnect',
                cause: 'Temporary network issues, system maintenance, or restart'
            };
        }
    }

    analyzeQuarantineStatus(node) {
        if (node.flagsObj.quarantined) {
            console.log(`         🔒 Fully quarantined: ${node.flagsObj.quarantinedAt}`);
            if (node.flagsObj.blockedCapabilities) {
                console.log(`         ❌ Blocked: ${node.flagsObj.blockedCapabilities.join(', ')}`);
            }
        } else if (node.flagsObj.partiallyQuarantined) {
            console.log(`         🔓 Partially recovered: ${node.flagsObj.recoveredAt}`);
            if (node.flagsObj.recoveredCapabilities) {
                console.log(`         ✅ Available: ${node.flagsObj.recoveredCapabilities.join(', ')}`);
            }
            if (node.flagsObj.blockedCapabilities) {
                console.log(`         ❌ Still blocked: ${node.flagsObj.blockedCapabilities.join(', ')}`);
            }
        }
    }

    generateReconnectionSteps(node, disconnectionType) {
        const steps = [];
        const hoursOffline = node.minutesOffline / 60;
        
        // Basic steps for all nodes
        steps.push(`Check if node process is running on operator's system`);
        
        if (hoursOffline > 24) {
            steps.push(`Contact node operator - extended outage needs attention`);
        }
        
        if (node.isQuarantined) {
            if (node.flagsObj.partiallyQuarantined) {
                steps.push(`Good news: Node was partially recovered for safe capabilities`);
                steps.push(`Node can process: ${node.flagsObj.recoveredCapabilities?.join(', ') || 'available capabilities'}`);
            } else {
                steps.push(`Address quarantine issues before reconnection`);
                steps.push(`Fix underlying problems that caused job failures`);
            }
        }
        
        // Network connectivity steps
        steps.push(`Verify network connectivity to ${process.env.IC_MESH_SERVER || 'moilol.com:8333'}`);
        steps.push(`Check firewall settings and port access`);
        
        // Node-specific steps based on capabilities
        if (node.capabilitiesArray.includes('whisper')) {
            steps.push(`Ensure Whisper is properly installed (transcription capability)`);
        }
        if (node.capabilitiesArray.includes('tesseract')) {
            steps.push(`Verify Tesseract OCR installation and permissions`);
        }
        if (node.capabilitiesArray.includes('ollama')) {
            steps.push(`Check Ollama service status and model availability`);
        }
        
        // Final steps
        if (disconnectionType.type === 'Quick disconnect') {
            steps.push(`Review node logs for immediate error messages`);
            steps.push(`Consider running diagnostic tests before reconnection`);
        }
        
        steps.push(`Restart node client with latest configuration`);
        
        return steps;
    }

    async generateReconnectionStrategies(recentNodes, offlineNodes) {
        // Priority-based recovery strategy
        console.log(`\n🎯 Priority Recovery Strategy:\n`);
        
        // High-priority nodes (valuable capabilities, recent disconnect)
        const highPriorityNodes = [...recentNodes, ...offlineNodes.filter(n => n.minutesOffline < 24 * 60)]
            .filter(node => {
                const valuableCapabilities = ['tesseract', 'whisper', 'ollama', 'stable-diffusion'];
                return node.capabilitiesArray.some(cap => valuableCapabilities.includes(cap));
            })
            .sort((a, b) => a.minutesOffline - b.minutesOffline);

        if (highPriorityNodes.length > 0) {
            console.log(`**Priority 1 - High-Value Nodes (${highPriorityNodes.length}):**`);
            highPriorityNodes.forEach(node => {
                const keyCapabilities = node.capabilitiesArray.filter(cap => 
                    ['tesseract', 'whisper', 'ollama', 'stable-diffusion'].includes(cap)
                );
                console.log(`   🎯 ${node.nodeId.slice(0,8)}: ${keyCapabilities.join(', ')} (offline ${(node.minutesOffline/60).toFixed(1)}h)`);
                
                if (keyCapabilities.includes('tesseract')) {
                    console.log(`      🚨 CRITICAL: Can resolve ${this.getPendingJobCount('ocr')} OCR jobs`);
                }
            });
            console.log(`   ➤ Contact these operators FIRST - highest impact on capacity\n`);
        }
        
        // Medium priority (stable but older disconnects)
        const mediumPriorityNodes = offlineNodes.filter(node => 
            node.minutesOffline >= 24 * 60 && 
            node.totalSessionMinutes > 60 && 
            !highPriorityNodes.includes(node)
        );
        
        if (mediumPriorityNodes.length > 0) {
            console.log(`**Priority 2 - Stable Nodes (${mediumPriorityNodes.length}):**`);
            mediumPriorityNodes.forEach(node => {
                console.log(`   📞 ${node.nodeId.slice(0,8)}: ${(node.totalSessionMinutes/60).toFixed(1)}h previous session`);
            });
            console.log(`   ➤ Reach out within 24-48 hours - proven operators\n`);
        }
        
        // Low priority (quick disconnects, may be testing)
        const lowPriorityNodes = offlineNodes.filter(node => 
            node.totalSessionMinutes < 60 && 
            !highPriorityNodes.includes(node)
        );
        
        if (lowPriorityNodes.length > 0) {
            console.log(`**Priority 3 - Quick Disconnects (${lowPriorityNodes.length}):**`);
            console.log(`   ➤ May be testing or had setup issues - monitor but don't prioritize\n`);
        }
        
        // Operational recommendations
        console.log(`🔧 **Operational Recommendations:**`);
        console.log(`   • Send reconnection guide to Priority 1 nodes immediately`);
        console.log(`   • Set up monitoring alerts for high-value node disconnections`);
        console.log(`   • Create automated health checks for quarantined nodes`);
        console.log(`   • Consider operator incentives for maintaining uptime`);
        
        // Generate contact script
        await this.generateContactScript(highPriorityNodes);
    }

    async generateContactScript(priorityNodes) {
        if (priorityNodes.length === 0) return;
        
        console.log(`\n📧 **Sample Contact Script for Priority Nodes:**\n`);
        console.log(`Subject: IC Mesh Node Reconnection - Your help needed!`);
        console.log(`\nHi [Operator],`);
        console.log(`\nWe noticed your IC Mesh node went offline recently. Your node has valuable`);
        console.log(`capabilities that are currently needed by the network:`);
        console.log(`\n[Node-specific capabilities and impact]`);
        console.log(`\nQuick reconnection steps:`);
        console.log(`1. Check if your node process is still running`);
        console.log(`2. Restart if needed: [restart command]`);
        console.log(`3. Verify network connectivity to moilol.com:8333`);
        console.log(`\nIf you're experiencing issues, reply to this email and we'll help`);
        console.log(`troubleshoot. Your node makes a real difference to the network!`);
        console.log(`\nThanks for being part of IC Mesh,`);
        console.log(`The Network Team`);
    }

    async getPendingJobCount(jobType) {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT COUNT(*) as count 
                FROM jobs 
                WHERE status = 'pending' AND type = ?
            `, [jobType], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
    }

    close() {
        this.db.close();
    }
}

// CLI interface
async function main() {
    const advisor = new NodeReconnectionAdvisor();
    
    try {
        await advisor.analyzeNodeConnectivity();
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        advisor.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = { NodeReconnectionAdvisor };