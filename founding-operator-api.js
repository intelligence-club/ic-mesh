#!/usr/bin/env node
/**
 * Founding Operator API Module
 * Manages founding operator program with 50 slots, 2x earnings, priority routing
 */

const Database = require('better-sqlite3');
const db = new Database('data/mesh.db');

// Initialize founding operator schema
function initializeFoundingOperatorSchema() {
    try {
        // Check if founding_operator column exists
        const columns = db.prepare("PRAGMA table_info(nodes)").all();
        const hasFoundingColumn = columns.some(col => col.name === 'founding_operator');
        
        if (!hasFoundingColumn) {
            console.log('🔧 Initializing founding operator schema...');
            
            // Add founding operator fields to nodes table
            db.exec(`
                ALTER TABLE nodes ADD COLUMN founding_operator BOOLEAN DEFAULT FALSE;
                ALTER TABLE nodes ADD COLUMN founding_slot INTEGER DEFAULT NULL;
                ALTER TABLE nodes ADD COLUMN founding_joined_at INTEGER DEFAULT NULL;
                ALTER TABLE nodes ADD COLUMN earning_multiplier REAL DEFAULT 1.0;
            `);
            
            // Create founding operator log table
            db.exec(`
                CREATE TABLE IF NOT EXISTS founding_operators (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nodeId TEXT NOT NULL,
                    email TEXT NOT NULL,
                    slot_number INTEGER NOT NULL,
                    joined_at INTEGER NOT NULL,
                    status TEXT DEFAULT 'active',
                    benefits TEXT DEFAULT '{"multiplier": 2.0, "priority_routing": true}',
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (nodeId) REFERENCES nodes(nodeId)
                );
                
                CREATE INDEX IF NOT EXISTS idx_founding_operators_slot ON founding_operators(slot_number);
                CREATE INDEX IF NOT EXISTS idx_founding_operators_status ON founding_operators(status);
                CREATE INDEX IF NOT EXISTS idx_nodes_founding ON nodes(founding_operator);
            `);
            
            console.log('✅ Founding operator schema initialized');
        }
    } catch (error) {
        console.error('❌ Error initializing founding operator schema:', error);
    }
}

// Get founding operator statistics
function getFoundingOperatorStats() {
    try {
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total_founding,
                COUNT(CASE WHEN n.lastSeen > ? THEN 1 END) as active_founding,
                MIN(fo.slot_number) as first_slot,
                MAX(fo.slot_number) as last_slot
            FROM founding_operators fo
            JOIN nodes n ON fo.nodeId = n.nodeId
            WHERE fo.status = 'active'
        `).get(Date.now() - 24 * 60 * 60 * 1000); // Active in last 24h
        
        return {
            slots_filled: stats.total_founding || 0,
            slots_available: 50 - (stats.total_founding || 0),
            active_operators: stats.active_founding || 0,
            next_slot: (stats.last_slot || 0) + 1
        };
    } catch (error) {
        console.error('Error getting founding operator stats:', error);
        return { slots_filled: 0, slots_available: 50, active_operators: 0, next_slot: 1 };
    }
}

// Promote node to founding operator
function promoteToFoundingOperator(nodeId, email) {
    const db_transaction = db.transaction(() => {
        // Check if already a founding operator
        const existing = db.prepare("SELECT founding_operator FROM nodes WHERE nodeId = ?").get(nodeId);
        if (!existing) {
            throw new Error('Node not found');
        }
        if (existing.founding_operator) {
            throw new Error('Node is already a founding operator');
        }
        
        // Check available slots
        const stats = getFoundingOperatorStats();
        if (stats.slots_available <= 0) {
            throw new Error('No founding operator slots available');
        }
        
        const now = Date.now();
        const slot_number = stats.next_slot;
        
        // Update nodes table
        db.prepare(`
            UPDATE nodes 
            SET founding_operator = TRUE,
                founding_slot = ?,
                founding_joined_at = ?,
                earning_multiplier = 2.0
            WHERE nodeId = ?
        `).run(slot_number, now, nodeId);
        
        // Insert into founding operators log
        db.prepare(`
            INSERT INTO founding_operators (nodeId, email, slot_number, joined_at, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(nodeId, email, slot_number, now, now);
        
        return { slot_number, joined_at: now };
    });
    
    return db_transaction();
}

// Get founding operator details
function getFoundingOperatorDetails(nodeId) {
    try {
        const result = db.prepare(`
            SELECT 
                n.nodeId,
                n.name,
                n.owner,
                n.founding_operator,
                n.founding_slot,
                n.founding_joined_at,
                n.earning_multiplier,
                fo.benefits,
                fo.status,
                n.jobsCompleted,
                n.computeMinutes,
                n.lastSeen
            FROM nodes n
            LEFT JOIN founding_operators fo ON n.nodeId = fo.nodeId
            WHERE n.nodeId = ?
        `).get(nodeId);
        
        return result;
    } catch (error) {
        console.error('Error getting founding operator details:', error);
        return null;
    }
}

// List all founding operators
function listFoundingOperators() {
    try {
        const operators = db.prepare(`
            SELECT 
                n.nodeId,
                n.name,
                n.owner,
                fo.slot_number,
                fo.email,
                fo.joined_at,
                n.jobsCompleted,
                n.computeMinutes,
                CASE WHEN n.lastSeen > ? THEN 'active' ELSE 'offline' END as activity_status
            FROM founding_operators fo
            JOIN nodes n ON fo.nodeId = n.nodeId
            WHERE fo.status = 'active'
            ORDER BY fo.slot_number
        `).all(Date.now() - 24 * 60 * 60 * 1000);
        
        return operators;
    } catch (error) {
        console.error('Error listing founding operators:', error);
        return [];
    }
}

// Apply founding operator benefits to earnings calculation
function calculateEarningsWithFoundingBenefits(nodeId, baseEarnings) {
    try {
        const node = db.prepare("SELECT earning_multiplier FROM nodes WHERE nodeId = ?").get(nodeId);
        const multiplier = node?.earning_multiplier || 1.0;
        return baseEarnings * multiplier;
    } catch (error) {
        console.error('Error calculating founding benefits:', error);
        return baseEarnings;
    }
}

// CLI commands
if (require.main === module) {
    const command = process.argv[2];
    
    switch (command) {
        case 'init':
            initializeFoundingOperatorSchema();
            break;
            
        case 'stats':
            console.log('📊 Founding Operator Statistics:');
            const stats = getFoundingOperatorStats();
            console.log(`  Slots filled: ${stats.slots_filled}/50`);
            console.log(`  Slots available: ${stats.slots_available}`);
            console.log(`  Active operators: ${stats.active_operators}`);
            console.log(`  Next slot: ${stats.next_slot}`);
            break;
            
        case 'list':
            console.log('👥 Founding Operators:');
            const operators = listFoundingOperators();
            operators.forEach(op => {
                console.log(`  #${op.slot_number}: ${op.name} (${op.owner}) - ${op.jobsCompleted} jobs, ${op.activity_status}`);
            });
            break;
            
        case 'promote':
            const nodeId = process.argv[3];
            const email = process.argv[4];
            if (!nodeId || !email) {
                console.log('Usage: node founding-operator-api.js promote <nodeId> <email>');
                process.exit(1);
            }
            try {
                const result = promoteToFoundingOperator(nodeId, email);
                console.log(`✅ Promoted ${nodeId} to founding operator slot #${result.slot_number}`);
            } catch (error) {
                console.error(`❌ Error: ${error.message}`);
            }
            break;
            
        case 'details':
            const detailNodeId = process.argv[3];
            if (!detailNodeId) {
                console.log('Usage: node founding-operator-api.js details <nodeId>');
                process.exit(1);
            }
            const details = getFoundingOperatorDetails(detailNodeId);
            if (details) {
                console.log('📋 Founding Operator Details:');
                console.log(`  Node: ${details.name} (${details.nodeId})`);
                console.log(`  Founding: ${details.founding_operator ? 'Yes' : 'No'}`);
                if (details.founding_operator) {
                    console.log(`  Slot: #${details.founding_slot}`);
                    console.log(`  Multiplier: ${details.earning_multiplier}x`);
                    console.log(`  Joined: ${new Date(details.founding_joined_at).toISOString()}`);
                }
            } else {
                console.log('❌ Node not found');
            }
            break;
            
        default:
            console.log('Usage: node founding-operator-api.js <command>');
            console.log('Commands:');
            console.log('  init     - Initialize founding operator schema');
            console.log('  stats    - Show founding operator statistics');
            console.log('  list     - List all founding operators');
            console.log('  promote <nodeId> <email> - Promote node to founding operator');
            console.log('  details <nodeId> - Show founding operator details');
    }
}

module.exports = {
    initializeFoundingOperatorSchema,
    getFoundingOperatorStats,
    promoteToFoundingOperator,
    getFoundingOperatorDetails,
    listFoundingOperators,
    calculateEarningsWithFoundingBenefits
};