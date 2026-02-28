#!/usr/bin/env node

/**
 * Migration: Add email uniqueness constraint to founding_operators table
 * 
 * Security Fix: Prevents duplicate Stripe accounts for the same email
 * Issue: Multiple nodes can register with same email, creating compliance risk
 * Solution: One email = one Stripe account (linked nodes share account)
 */

const Database = require('better-sqlite3');
const { validateDbPath } = require('../lib/db-utils');

const DB_PATH = './mesh.db';
const validDbPath = validateDbPath(DB_PATH);

if (!validDbPath) {
  console.error('🚨 SECURITY: Invalid database path provided');
  process.exit(1);
}

const db = new Database(validDbPath);
db.pragma('journal_mode = WAL');

console.log('🔧 Migration: Adding email uniqueness constraint to founding_operators');

// Check if migration already applied
const hasUniqueConstraint = db.prepare(`
  SELECT sql FROM sqlite_master 
  WHERE type='table' AND name='founding_operators'
`).get()?.sql?.includes('email TEXT NOT NULL UNIQUE');

if (hasUniqueConstraint) {
  console.log('✅ Migration already applied - email uniqueness constraint exists');
  db.close();
  process.exit(0);
}

try {
  db.transaction(() => {
    // 1. Check for duplicate emails before migration
    const duplicates = db.prepare(`
      SELECT email, COUNT(*) as count, GROUP_CONCAT(nodeId) as nodeIds
      FROM founding_operators 
      GROUP BY email 
      HAVING COUNT(*) > 1
    `).all();

    if (duplicates.length > 0) {
      console.log('🚨 Found duplicate emails in founding_operators:');
      duplicates.forEach(dup => {
        console.log(`  - ${dup.email}: ${dup.count} nodes (${dup.nodeIds})`);
      });

      // Strategy: Keep the earliest registered node for each email
      console.log('📋 Migration strategy: Keep earliest node per email, mark others as inactive');

      for (const dup of duplicates) {
        const nodeIds = dup.nodeIds.split(',');
        
        // Find the earliest registered node
        const earliest = db.prepare(`
          SELECT nodeId, joined_at 
          FROM founding_operators 
          WHERE email = ? 
          ORDER BY joined_at ASC 
          LIMIT 1
        `).get(dup.email);

        // Mark all other nodes as inactive
        const otherNodes = nodeIds.filter(id => id !== earliest.nodeId);
        for (const nodeId of otherNodes) {
          db.prepare(`
            UPDATE founding_operators 
            SET status = 'migrated_duplicate' 
            WHERE nodeId = ?
          `).run(nodeId);
          
          console.log(`    - ${nodeId}: marked as migrated_duplicate`);
        }
        
        console.log(`    - ${earliest.nodeId}: kept active (earliest: ${new Date(earliest.joined_at * 1000).toISOString()})`);
      }
    }

    // 2. Create new table with email uniqueness constraint
    db.exec(`
      CREATE TABLE founding_operators_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nodeId TEXT NOT NULL UNIQUE,
        slot_number INTEGER NOT NULL UNIQUE,
        joined_at INTEGER NOT NULL,
        email TEXT NOT NULL UNIQUE,
        benefits TEXT DEFAULT '{}',
        status TEXT DEFAULT 'active',
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // 3. Migrate data (only active records with unique emails)
    db.exec(`
      INSERT INTO founding_operators_new 
        (id, nodeId, slot_number, joined_at, email, benefits, status, created_at)
      SELECT id, nodeId, slot_number, joined_at, email, benefits, status, created_at
      FROM founding_operators
      WHERE status = 'active'
    `);

    // 4. Drop old table and rename new one
    db.exec('DROP TABLE founding_operators');
    db.exec('ALTER TABLE founding_operators_new RENAME TO founding_operators');

    console.log('✅ Migration completed successfully');

  })();

  // 5. Verify the migration
  const newSchema = db.prepare(`
    SELECT sql FROM sqlite_master 
    WHERE type='table' AND name='founding_operators'
  `).get()?.sql;

  const finalCount = db.prepare('SELECT COUNT(*) as count FROM founding_operators').get().count;
  const uniqueEmails = db.prepare('SELECT COUNT(DISTINCT email) as count FROM founding_operators').get().count;

  console.log('📊 Migration Results:');
  console.log(`  - Total founding operators: ${finalCount}`);
  console.log(`  - Unique emails: ${uniqueEmails}`);
  console.log(`  - Email uniqueness: ${finalCount === uniqueEmails ? '✅ Enforced' : '🚨 Failed'}`);

  if (finalCount !== uniqueEmails) {
    throw new Error('Migration verification failed: duplicate emails still exist');
  }

} catch (error) {
  console.error('🚨 Migration failed:', error.message);
  db.close();
  process.exit(1);
}

db.close();
console.log('🎉 Migration completed: Email uniqueness constraint added to founding_operators');