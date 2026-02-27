#!/usr/bin/env node
/**
 * Capability Mapper
 * 
 * Analyzes capability mappings between job types and node capabilities
 * Identifies mismatches that prevent job processing
 */

const sqlite3 = require('sqlite3').verbose();

class CapabilityMapper {
    constructor() {
        this.db = null;
        this.capabilityMappings = {
            'transcribe': ['transcription', 'whisper', 'transcribe'],
            'ocr': ['tesseract', 'ocr'],
            'pdf-extract': ['pdf-extract', 'pdf'],
            'generate': ['generate', 'ollama'],
            'stable-diffusion': ['stable-diffusion', 'gpu']
        };
    }

    async init() {
        console.log('🗺️  Capability Mapper');
        console.log('=====================');
        console.log(`Started: ${new Date().toISOString()}\n`);

        this.db = new sqlite3.Database('data/mesh.db', (err) => {
            if (err) {
                console.error('❌ Database connection failed:', err.message);
                process.exit(1);
            }
        });

        await this.analyzeCapabilities();
    }

    async analyzeCapabilities() {
        const jobTypes = await this.getJobTypes();
        const nodeCapabilities = await this.getNodeCapabilities();

        console.log('📋 JOB TYPE ANALYSIS');
        console.log('─────────────────────');
        jobTypes.forEach(job => {
            console.log(`${job.type}: ${job.count} jobs`);
        });

        console.log('\n🖥️  NODE CAPABILITY ANALYSIS');
        console.log('─────────────────────────────');
        nodeCapabilities.forEach(node => {
            const nodeIdShort = node.nodeId.substring(0, 8);
            const caps = JSON.parse(node.capabilities || '[]');
            const flags = JSON.parse(node.flags || '{}');
            const blockedCaps = flags.blockedCapabilities || [];
            
            console.log(`${nodeIdShort}:`);
            console.log(`  Capabilities: ${caps.join(', ')}`);
            if (blockedCaps.length > 0) {
                console.log(`  Blocked: ${blockedCaps.join(', ')}`);
            }
        });

        console.log('\n🔍 CAPABILITY MATCHING ANALYSIS');
        console.log('─────────────────────────────');

        for (const job of jobTypes) {
            console.log(`\n${job.type} (${job.count} jobs):`);
            
            const possibleCapabilities = this.capabilityMappings[job.type] || [job.type];
            console.log(`  Looks for: ${possibleCapabilities.join(' OR ')}`);
            
            const compatibleNodes = [];
            const blockedNodes = [];
            
            nodeCapabilities.forEach(node => {
                const caps = JSON.parse(node.capabilities || '[]');
                const flags = JSON.parse(node.flags || '{}');
                const blockedCaps = flags.blockedCapabilities || [];
                const nodeIdShort = node.nodeId.substring(0, 8);
                
                const hasCapability = possibleCapabilities.some(cap => caps.includes(cap));
                const isBlocked = possibleCapabilities.some(cap => blockedCaps.includes(cap));
                
                if (hasCapability && !isBlocked) {
                    compatibleNodes.push(nodeIdShort);
                } else if (hasCapability && isBlocked) {
                    blockedNodes.push(nodeIdShort);
                }
            });
            
            if (compatibleNodes.length > 0) {
                console.log(`  ✅ Compatible nodes: ${compatibleNodes.join(', ')}`);
            } else {
                console.log(`  ❌ No compatible nodes`);
            }
            
            if (blockedNodes.length > 0) {
                console.log(`  🚫 Blocked nodes: ${blockedNodes.join(', ')}`);
            }
        }

        console.log('\n🔧 CAPABILITY MAPPING SUGGESTIONS');
        console.log('─────────────────────────────────');

        // Check for potential mappings
        const suggestions = this.generateMappingSuggestions(jobTypes, nodeCapabilities);
        if (suggestions.length > 0) {
            suggestions.forEach(suggestion => {
                console.log(`• ${suggestion}`);
            });
        } else {
            console.log('No obvious capability mapping issues found');
        }

        // Check server capability mapping
        console.log('\n🖥️  SERVER CAPABILITY MAPPING');
        console.log('─────────────────────────────');
        await this.checkServerCapabilityMapping();
    }

    async getJobTypes() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT type, COUNT(*) as count
                FROM jobs 
                WHERE status = 'pending'
                GROUP BY type
                ORDER BY count DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async getNodeCapabilities() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT nodeId, capabilities, flags
                FROM nodes
                WHERE lastSeen > strftime('%s', 'now') - 3600
                ORDER BY nodeId
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    generateMappingSuggestions(jobTypes, nodeCapabilities) {
        const suggestions = [];
        
        jobTypes.forEach(job => {
            const possibleCapabilities = this.capabilityMappings[job.type] || [job.type];
            let hasDirectMatch = false;
            
            nodeCapabilities.forEach(node => {
                const caps = JSON.parse(node.capabilities || '[]');
                if (possibleCapabilities.some(cap => caps.includes(cap))) {
                    hasDirectMatch = true;
                }
            });
            
            if (!hasDirectMatch) {
                // Look for potential alternatives
                nodeCapabilities.forEach(node => {
                    const caps = JSON.parse(node.capabilities || '[]');
                    const nodeIdShort = node.nodeId.substring(0, 8);
                    
                    if (job.type === 'ocr' && caps.includes('tesseract')) {
                        suggestions.push(`Map 'ocr' jobs to 'tesseract' capability (node ${nodeIdShort})`);
                    } else if (job.type === 'pdf-extract' && caps.includes('tesseract')) {
                        suggestions.push(`Consider if 'tesseract' can handle 'pdf-extract' jobs (node ${nodeIdShort})`);
                    }
                });
            }
        });
        
        return [...new Set(suggestions)]; // Remove duplicates
    }

    async checkServerCapabilityMapping() {
        // Check if server.js has capability mappings
        const fs = require('fs');
        const path = require('path');
        
        try {
            const serverPath = path.join(process.cwd(), 'server.js');
            const serverCode = fs.readFileSync(serverPath, 'utf8');
            
            if (serverCode.includes('capabilityAliases') || serverCode.includes('capability') && serverCode.includes('alias')) {
                console.log('✅ Server has capability mapping logic');
                
                // Try to extract the mappings
                const aliasMatches = serverCode.match(/capabilityAliases\s*[=:]\s*{([^}]+)}/);
                if (aliasMatches) {
                    console.log('📝 Found mappings in server code:');
                    console.log(aliasMatches[0]);
                }
            } else {
                console.log('⚠️  No capability mapping found in server.js');
                console.log('   Suggestion: Add capability aliases to map job types to node capabilities');
            }
            
        } catch (error) {
            console.log('❓ Could not read server.js file');
        }
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// CLI execution
if (require.main === module) {
    const mapper = new CapabilityMapper();
    
    mapper.init().then(() => {
        mapper.close();
        console.log('\n🏁 Capability mapping analysis complete');
        process.exit(0);
    }).catch((error) => {
        console.error('❌ Capability mapping failed:', error);
        mapper.close();
        process.exit(1);
    });
}

module.exports = CapabilityMapper;