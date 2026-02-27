#!/usr/bin/env node
/**
 * IC Mesh Capability Manager
 * Manage node quarantine at capability level rather than node level
 * Usage: node capability-manager.js <action> [options]
 */

const Database = require('better-sqlite3');

class CapabilityManager {
    constructor(dbPath = './data/mesh.db') {
        this.db = new Database(dbPath);
    }

    // Analyze which capabilities are quarantined vs which are actually problematic
    analyzeCapabilityHealth() {
        console.log('🔍 Capability Health Analysis');
        console.log('==============================\n');

        // Get all jobs with results grouped by node and capability
        const jobResults = this.db.prepare(`
            SELECT 
                j.claimedBy,
                json_extract(j.requirements, '$.capability') as capability,
                j.type,
                j.status,
                COUNT(*) as count
            FROM jobs j
            WHERE j.claimedBy IS NOT NULL 
            AND json_extract(j.requirements, '$.capability') IS NOT NULL
            GROUP BY j.claimedBy, capability, j.status
            ORDER BY j.claimedBy, capability, j.status
        `).all();

        // Calculate success rates by node and capability
        const capabilityStats = {};
        jobResults.forEach(row => {
            const nodeId = row.claimedBy.substring(0, 8);
            if (!capabilityStats[nodeId]) {
                capabilityStats[nodeId] = {};
            }
            if (!capabilityStats[nodeId][row.capability]) {
                capabilityStats[nodeId][row.capability] = {
                    completed: 0,
                    failed: 0,
                    total: 0
                };
            }
            
            const stat = capabilityStats[nodeId][row.capability];
            if (row.status === 'completed') {
                stat.completed += row.count;
            } else if (row.status === 'failed') {
                stat.failed += row.count;
            }
            stat.total += row.count;
        });

        // Get node names
        const nodes = this.db.prepare('SELECT nodeId, name, flags FROM nodes').all();
        const nodeNames = {};
        nodes.forEach(node => {
            nodeNames[node.nodeId.substring(0, 8)] = {
                name: node.name,
                flags: JSON.parse(node.flags || '{}')
            };
        });

        // Display results
        Object.entries(capabilityStats).forEach(([nodeId, capabilities]) => {
            const nodeInfo = nodeNames[nodeId];
            const quarantined = nodeInfo?.flags?.quarantined ? ' [QUARANTINED]' : '';
            console.log(`📊 ${nodeInfo?.name || 'unknown'} (${nodeId})${quarantined}:`);
            
            Object.entries(capabilities).forEach(([capability, stats]) => {
                const successRate = stats.total > 0 ? (stats.completed / stats.total * 100).toFixed(1) : 0;
                const statusIcon = successRate >= 80 ? '✅' : successRate >= 50 ? '⚠️' : '❌';
                console.log(`  ${statusIcon} ${capability}: ${stats.completed}/${stats.total} (${successRate}% success)`);
            });
            console.log();
        });

        return capabilityStats;
    }

    // Show current pending jobs and their capability requirements
    showPendingCapabilities() {
        console.log('📋 Pending Jobs by Capability');
        console.log('=============================\n');

        const pendingJobs = this.db.prepare(`
            SELECT 
                jobId,
                type,
                json_extract(requirements, '$.capability') as capability,
                createdAt
            FROM jobs 
            WHERE status = 'pending' AND json_extract(requirements, '$.capability') IS NOT NULL
            ORDER BY capability, createdAt
        `).all();

        const groupedJobs = {};
        pendingJobs.forEach(job => {
            if (!groupedJobs[job.capability]) {
                groupedJobs[job.capability] = [];
            }
            groupedJobs[job.capability].push(job);
        });

        Object.entries(groupedJobs).forEach(([capability, jobs]) => {
            console.log(`🎯 ${capability} (${jobs.length} jobs):`);
            jobs.forEach(job => {
                const age = Math.round((Date.now() - job.createdAt) / 60000);
                console.log(`  • ${job.jobId.substring(0, 8)} (${job.type}) - ${age}m old`);
            });
            console.log();
        });

        return groupedJobs;
    }

    // Show which nodes could handle pending capabilities
    analyzeCapabilityCoverage() {
        console.log('🔧 Capability Coverage Analysis');
        console.log('================================\n');

        const pendingCapabilities = this.db.prepare(`
            SELECT 
                json_extract(requirements, '$.capability') as capability,
                COUNT(*) as demand
            FROM jobs 
            WHERE status = 'pending' AND json_extract(requirements, '$.capability') IS NOT NULL
            GROUP BY capability
        `).all();

        const nodes = this.db.prepare(`
            SELECT nodeId, name, capabilities, flags, lastSeen
            FROM nodes ORDER BY lastSeen DESC
        `).all();

        pendingCapabilities.forEach(({ capability, demand }) => {
            console.log(`🎯 ${capability} (${demand} jobs pending):`);
            
            const capableNodes = nodes.filter(node => {
                const capabilities = JSON.parse(node.capabilities || '[]');
                const flags = JSON.parse(node.flags || '{}');
                const minutesAgo = Math.round((Date.now() - node.lastSeen) / 60000);
                
                // Check if node has the capability
                const hasCapability = capabilities.includes(capability) ||
                    (capability === 'transcription' && (capabilities.includes('whisper') || capabilities.includes('transcribe'))) ||
                    (capability === 'ocr' && capabilities.includes('tesseract')) ||
                    (capability === 'pdf-extract' && capabilities.includes('tesseract')) ||
                    (capability === 'inference' && capabilities.includes('ollama')) ||
                    (capability === 'generate-image' && capabilities.includes('stable-diffusion'));
                
                return hasCapability;
            });

            if (capableNodes.length === 0) {
                console.log('  ❌ No capable nodes found');
            } else {
                capableNodes.forEach(node => {
                    const flags = JSON.parse(node.flags || '{}');
                    const minutesAgo = Math.round((Date.now() - node.lastSeen) / 60000);
                    
                    let status = '';
                    if (flags.quarantined) {
                        status = '🔴 QUARANTINED';
                    } else if (minutesAgo > 15) {
                        status = '🟡 OFFLINE';
                    } else {
                        status = '🟢 ONLINE';
                    }
                    
                    console.log(`    ${status} ${node.name} (${node.nodeId.substring(0, 8)}) - ${minutesAgo}m ago`);
                });
            }
            console.log();
        });
    }

    // Create a capability-specific quarantine (allows some capabilities, blocks others)
    setCapabilityQuarantine(nodeId, blockedCapabilities = [], allowedCapabilities = []) {
        console.log(`🔧 Setting capability-level quarantine for ${nodeId}...`);
        
        const node = this.db.prepare('SELECT * FROM nodes WHERE nodeId LIKE ?').get(`${nodeId}%`);
        if (!node) {
            console.log('❌ Node not found');
            return false;
        }

        const flags = JSON.parse(node.flags || '{}');
        flags.capabilityQuarantine = {
            blocked: blockedCapabilities,
            allowed: allowedCapabilities,
            timestamp: Date.now()
        };

        // If we have specific allowed capabilities, remove general quarantine
        if (allowedCapabilities.length > 0) {
            delete flags.quarantined;
        }

        this.db.prepare('UPDATE nodes SET flags = ? WHERE nodeId = ?')
            .run(JSON.stringify(flags), node.nodeId);

        console.log(`✅ Updated ${node.name}:`);
        console.log(`   Blocked: ${blockedCapabilities.join(', ') || 'none'}`);
        console.log(`   Allowed: ${allowedCapabilities.join(', ') || 'all others'}`);
        
        return true;
    }

    // Remove all quarantine from a node
    clearQuarantine(nodeId) {
        const node = this.db.prepare('SELECT * FROM nodes WHERE nodeId LIKE ?').get(`${nodeId}%`);
        if (!node) {
            console.log('❌ Node not found');
            return false;
        }

        const flags = JSON.parse(node.flags || '{}');
        delete flags.quarantined;
        delete flags.capabilityQuarantine;

        this.db.prepare('UPDATE nodes SET flags = ? WHERE nodeId = ?')
            .run(JSON.stringify(flags), node.nodeId);

        console.log(`✅ Removed all quarantine from ${node.name}`);
        return true;
    }

    close() {
        this.db.close();
    }
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const action = args[0];
    
    const manager = new CapabilityManager();
    
    try {
        switch (action) {
            case 'analyze':
                manager.analyzeCapabilityHealth();
                break;
                
            case 'pending':
                manager.showPendingCapabilities();
                break;
                
            case 'coverage':
                manager.analyzeCapabilityCoverage();
                break;
                
            case 'status':
                manager.analyzeCapabilityHealth();
                console.log();
                manager.showPendingCapabilities();
                manager.analyzeCapabilityCoverage();
                break;
                
            case 'quarantine-capability':
                const nodeId = args[1];
                const blocked = args.slice(2);
                if (!nodeId) {
                    console.log('Usage: node capability-manager.js quarantine-capability <nodeId> <capability1> [capability2...]');
                    process.exit(1);
                }
                manager.setCapabilityQuarantine(nodeId, blocked, []);
                break;
                
            case 'allow-capability':
                const nodeId2 = args[1];
                const allowed = args.slice(2);
                if (!nodeId2 || allowed.length === 0) {
                    console.log('Usage: node capability-manager.js allow-capability <nodeId> <capability1> [capability2...]');
                    process.exit(1);
                }
                manager.setCapabilityQuarantine(nodeId2, [], allowed);
                break;
                
            case 'clear-quarantine':
                const nodeId3 = args[1];
                if (!nodeId3) {
                    console.log('Usage: node capability-manager.js clear-quarantine <nodeId>');
                    process.exit(1);
                }
                manager.clearQuarantine(nodeId3);
                break;
                
            default:
                console.log('IC Mesh Capability Manager');
                console.log('Usage: node capability-manager.js <action> [options]');
                console.log('');
                console.log('Actions:');
                console.log('  analyze                 - Show capability success rates by node');
                console.log('  pending                 - Show pending jobs by capability');
                console.log('  coverage               - Show capability coverage for pending jobs');
                console.log('  status                 - Full status report (all above)');
                console.log('  quarantine-capability <nodeId> <cap1> [cap2...] - Block specific capabilities');
                console.log('  allow-capability <nodeId> <cap1> [cap2...]       - Allow only specific capabilities');
                console.log('  clear-quarantine <nodeId>                        - Remove all quarantine');
                console.log('');
                console.log('Examples:');
                console.log('  node capability-manager.js status');
                console.log('  node capability-manager.js quarantine-capability fcecb481 transcription');
                console.log('  node capability-manager.js allow-capability fcecb481 ocr pdf-extract');
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    } finally {
        manager.close();
    }
}

module.exports = CapabilityManager;