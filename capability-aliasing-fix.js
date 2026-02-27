#!/usr/bin/env node
/**
 * Dynamic Capability System Fix
 * Replaces hardcoded capability mapping with intelligent validation
 * 
 * Addresses vulnerability in serve.js lines 163-172
 */

const Database = require('better-sqlite3');
const path = require('path');

class CapabilityManager {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.setupCapabilityAliases();
  }

  /**
   * Set up capability alias mappings in database
   * This replaces the hardcoded capMap in serve.js
   */
  setupCapabilityAliases() {
    // Create capability_aliases table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS capability_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL,
        capability TEXT NOT NULL,
        priority INTEGER DEFAULT 1,
        description TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        UNIQUE(job_type, capability)
      )
    `);

    // Insert standard aliases (idempotent)
    const aliases = [
      { job_type: 'transcribe', capability: 'whisper', priority: 1, description: 'Audio transcription via Whisper' },
      { job_type: 'transcribe', capability: 'transcription', priority: 2, description: 'Legacy transcription capability' },
      { job_type: 'transcription', capability: 'whisper', priority: 1, description: 'Transcription jobs use Whisper' },
      { job_type: 'transcription', capability: 'transcription', priority: 2, description: 'Direct transcription capability match' },
      { job_type: 'ffmpeg', capability: 'ffmpeg', priority: 1, description: 'Video processing' },
      { job_type: 'generate-image', capability: 'stable-diffusion', priority: 1, description: 'Image generation' },
      { job_type: 'inference', capability: 'ollama', priority: 1, description: 'LLM inference' },
      { job_type: 'inference', capability: 'gpu-metal', priority: 2, description: 'GPU-accelerated inference' },
      { job_type: 'ocr', capability: 'tesseract', priority: 1, description: 'Optical character recognition' },
      { job_type: 'pdf-extract', capability: 'tesseract', priority: 1, description: 'PDF text extraction' }
    ];

    const insertAlias = this.db.prepare(`
      INSERT OR IGNORE INTO capability_aliases 
      (job_type, capability, priority, description) 
      VALUES (?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((aliases) => {
      for (const alias of aliases) {
        insertAlias.run(alias.job_type, alias.capability, alias.priority, alias.description);
      }
    });

    transaction(aliases);
  }

  /**
   * Get active capabilities from nodes currently online
   */
  getActiveCapabilities() {
    const cutoff = Date.now() - (10 * 60 * 1000); // 10 minutes ago
    const activeNodes = this.db.prepare(`
      SELECT nodeId, capabilities, lastSeen 
      FROM nodes 
      WHERE lastSeen > ? AND flags NOT LIKE '%quarantined%'
    `).all(cutoff);

    const capabilities = new Set();
    
    activeNodes.forEach(node => {
      try {
        const nodeCaps = JSON.parse(node.capabilities || '[]');
        nodeCaps.forEach(cap => capabilities.add(cap));
      } catch (err) {
        console.error(`⚠️  Invalid capabilities JSON for node ${node.nodeId}: ${node.capabilities}`);
      }
    });

    return Array.from(capabilities);
  }

  /**
   * Resolve job type to best available capability
   * Returns null if no capability can handle the job type
   */
  resolveCapability(jobType) {
    const activeCapabilities = this.getActiveCapabilities();
    
    // Get possible capabilities for this job type, ordered by priority
    const possibleCaps = this.db.prepare(`
      SELECT capability, priority 
      FROM capability_aliases 
      WHERE job_type = ? 
      ORDER BY priority ASC
    `).all(jobType);

    // Find first available capability
    for (const row of possibleCaps) {
      if (activeCapabilities.includes(row.capability)) {
        return {
          capability: row.capability,
          activeNodes: this.getNodesWithCapability(row.capability),
          matchType: 'direct'
        };
      }
    }

    // No direct match - check for fuzzy matches
    const fuzzyMatch = this.findFuzzyMatch(jobType, activeCapabilities);
    if (fuzzyMatch) {
      return {
        capability: fuzzyMatch,
        activeNodes: this.getNodesWithCapability(fuzzyMatch),
        matchType: 'fuzzy'
      };
    }

    return null; // No capability can handle this job type
  }

  /**
   * Find fuzzy capability matches for unknown job types
   */
  findFuzzyMatch(jobType, activeCapabilities) {
    const lower = jobType.toLowerCase();
    
    // Common patterns
    if (lower.includes('transcrib') || lower.includes('speech') || lower.includes('audio')) {
      return activeCapabilities.find(cap => cap.includes('whisper') || cap.includes('transcription'));
    }
    
    if (lower.includes('image') || lower.includes('generate') || lower.includes('draw')) {
      return activeCapabilities.find(cap => cap.includes('stable-diffusion') || cap.includes('image'));
    }
    
    if (lower.includes('text') || lower.includes('llm') || lower.includes('chat')) {
      return activeCapabilities.find(cap => cap.includes('ollama') || cap.includes('gpu-metal'));
    }

    if (lower.includes('ocr') || lower.includes('extract') || lower.includes('pdf')) {
      return activeCapabilities.find(cap => cap.includes('tesseract'));
    }

    return null;
  }

  /**
   * Get nodes that have a specific capability
   */
  getNodesWithCapability(capability) {
    const cutoff = Date.now() - (10 * 60 * 1000); // 10 minutes ago
    const nodes = this.db.prepare(`
      SELECT nodeId, name, capabilities, lastSeen 
      FROM nodes 
      WHERE lastSeen > ? AND flags NOT LIKE '%quarantined%'
    `).all(cutoff);

    return nodes.filter(node => {
      try {
        const nodeCaps = JSON.parse(node.capabilities || '[]');
        return nodeCaps.includes(capability);
      } catch (err) {
        return false;
      }
    });
  }

  /**
   * Validate job submission and provide detailed feedback
   */
  validateJobSubmission(jobType, showDetails = false) {
    const result = this.resolveCapability(jobType);
    
    if (!result) {
      const activeCapabilities = this.getActiveCapabilities();
      return {
        valid: false,
        error: `No active nodes can handle job type "${jobType}"`,
        activeCapabilities,
        suggestion: `Available capabilities: ${activeCapabilities.join(', ') || 'none'}`
      };
    }

    if (result.matchType === 'fuzzy' && showDetails) {
      console.log(`⚠️  Fuzzy match: "${jobType}" → "${result.capability}"`);
    }

    return {
      valid: true,
      capability: result.capability,
      matchType: result.matchType,
      availableNodes: result.activeNodes.length,
      nodeDetails: showDetails ? result.activeNodes : undefined
    };
  }

  /**
   * Add new capability alias
   */
  addAlias(jobType, capability, priority = 1, description = '') {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO capability_aliases 
      (job_type, capability, priority, description) 
      VALUES (?, ?, ?, ?)
    `);
    
    insert.run(jobType, capability, priority, description);
    console.log(`✅ Added alias: "${jobType}" → "${capability}" (priority ${priority})`);
  }

  /**
   * Get diagnostic report
   */
  getDiagnosticReport() {
    const activeCapabilities = this.getActiveCapabilities();
    const aliases = this.db.prepare('SELECT * FROM capability_aliases ORDER BY job_type, priority').all();
    
    console.log('🔍 Capability System Diagnostic Report\n');
    console.log(`Active capabilities (${activeCapabilities.length}): ${activeCapabilities.join(', ') || 'none'}\n`);
    
    console.log('📋 Job type mappings:');
    const jobTypes = [...new Set(aliases.map(a => a.job_type))];
    
    jobTypes.forEach(jobType => {
      const jobAliases = aliases.filter(a => a.job_type === jobType);
      console.log(`\n  ${jobType}:`);
      
      jobAliases.forEach(alias => {
        const available = activeCapabilities.includes(alias.capability);
        const status = available ? '✅' : '❌';
        console.log(`    ${status} ${alias.capability} (priority ${alias.priority}) - ${alias.description}`);
      });
      
      // Test resolution
      const resolution = this.resolveCapability(jobType);
      if (resolution) {
        console.log(`    → Resolves to: ${resolution.capability} (${resolution.activeNodes.length} nodes)`);
      } else {
        console.log(`    → ❌ NO RESOLUTION AVAILABLE`);
      }
    });
  }

  close() {
    this.db.close();
  }
}

/**
 * Generate replacement code for serve.js
 */
function generateServeJsReplacement() {
  return `
  // ===== DYNAMIC CAPABILITY RESOLUTION SYSTEM =====
  // Replaces hardcoded capMap with database-driven validation
  
  const type = jobType || 'transcribe';
  
  // Initialize capability manager (cached instance recommended)
  if (!global.capabilityManager) {
    const meshDbPath = path.join(__dirname, '..', 'ic-mesh', 'data', 'mesh.db');
    global.capabilityManager = new CapabilityManager(meshDbPath);
  }
  
  // Validate and resolve capability
  const resolution = global.capabilityManager.validateJobSubmission(type, true);
  
  if (!resolution.valid) {
    console.error(\`❌ Job submission failed: \${resolution.error}\`);
    console.error(\`💡 \${resolution.suggestion}\`);
    
    // Return error to client instead of proceeding with invalid capability
    res.writeHead(400, {'Content-Type': 'application/json'});
    return res.end(JSON.stringify({
      error: resolution.error,
      suggestion: resolution.suggestion,
      activeCapabilities: resolution.activeCapabilities
    }));
  }
  
  const capability = resolution.capability;
  
  if (resolution.matchType === 'fuzzy') {
    console.log(\`⚠️  Fuzzy capability match: "\${type}" → "\${capability}"\`);
  }
  
  console.log(\`◉ Submitting mesh job: type=\${type}, capability=\${capability} (\${resolution.availableNodes} nodes available)\`);
  
  // ===== END DYNAMIC CAPABILITY SYSTEM =====
  `;
}

// CLI interface
if (require.main === module) {
  const action = process.argv[2];
  const dbPath = process.argv[3] || path.join(__dirname, '../intelligence-club-site/ic-mesh/data/mesh.db');
  
  const manager = new CapabilityManager(dbPath);
  
  switch (action) {
    case 'diagnose':
    case 'diagnostic':
      manager.getDiagnosticReport();
      break;
      
    case 'test':
      const testTypes = ['transcribe', 'transcription', 'unknown-type', 'speech-to-text', 'generate-image'];
      console.log('🧪 Testing job type resolutions:\n');
      
      testTypes.forEach(jobType => {
        console.log(`Testing "${jobType}":`);
        const result = manager.validateJobSubmission(jobType, true);
        if (result.valid) {
          console.log(`  ✅ ${result.capability} (${result.availableNodes} nodes, ${result.matchType} match)\n`);
        } else {
          console.log(`  ❌ ${result.error}\n`);
        }
      });
      break;
      
    case 'add-alias':
      const [jobType, capability, priority] = process.argv.slice(4);
      if (!jobType || !capability) {
        console.error('Usage: add-alias <job_type> <capability> [priority]');
        process.exit(1);
      }
      manager.addAlias(jobType, capability, parseInt(priority) || 1);
      break;
      
    case 'generate-replacement':
      console.log('📝 Replacement code for serve.js:');
      console.log(generateServeJsReplacement());
      break;
      
    default:
      console.log(`Usage: ${process.argv[1]} <action> [dbPath]
      
Actions:
  diagnose        - Show diagnostic report
  test           - Test capability resolution 
  add-alias      - Add new job type alias
  generate-replacement - Show serve.js replacement code
      `);
  }
  
  manager.close();
}

module.exports = { CapabilityManager };