#!/usr/bin/env node
// cleanup-test-nodes.js - Remove test and duplicate nodes from database

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'mesh.db');

function cleanupTestNodes() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath);
        
        console.log('🧹 Starting test node cleanup...');
        
        // Find test nodes to remove
        const testNodePatterns = [
            'test-node-%',
            'claiming-node-%', 
            'completion-node-%',
            'duplicate-node-%',
            '%probe%',
            'unnamed',
            'local-node-%'
        ];
        
        let totalRemoved = 0;
        let completed = 0;
        
        testNodePatterns.forEach(pattern => {
            // First show what we'll remove
            db.all('SELECT nodeId, name, owner FROM nodes WHERE name LIKE ? OR nodeId LIKE ?', 
                [pattern, pattern], 
                (err, rows) => {
                    if (err) {
                        console.error(`Error finding nodes for pattern ${pattern}:`, err);
                        return;
                    }
                    
                    if (rows.length > 0) {
                        console.log(`\n🎯 Found ${rows.length} test nodes matching "${pattern}":`);
                        rows.forEach(row => {
                            console.log(`  - ${row.name} (${row.nodeId}) owner: ${row.owner || 'unknown'}`);
                        });
                        
                        // Remove nodes matching this pattern
                        db.run('DELETE FROM nodes WHERE name LIKE ? OR nodeId LIKE ?',
                            [pattern, pattern],
                            function(err) {
                                if (err) {
                                    console.error(`Error removing nodes for pattern ${pattern}:`, err);
                                } else {
                                    const removed = this.changes;
                                    totalRemoved += removed;
                                    console.log(`✅ Removed ${removed} nodes matching "${pattern}"`);
                                }
                                
                                completed++;
                                if (completed === testNodePatterns.length) {
                                    finishCleanup();
                                }
                            }
                        );
                    } else {
                        completed++;
                        if (completed === testNodePatterns.length) {
                            finishCleanup();
                        }
                    }
                }
            );
        });
        
        function finishCleanup() {
            // Also clean up any test jobs
            db.run('DELETE FROM jobs WHERE jobType LIKE "%test%" OR description LIKE "%test%"',
                function(err) {
                    if (err) {
                        console.error('Error cleaning test jobs:', err);
                    } else {
                        console.log(`\n🗑️  Removed ${this.changes} test jobs`);
                    }
                    
                    // Get final counts
                    db.get('SELECT COUNT(*) as count FROM nodes', (err, row) => {
                        if (!err) {
                            console.log(`\n📊 Final node count: ${row.count} nodes remaining`);
                        }
                        
                        console.log(`\n✨ Cleanup complete! Removed ${totalRemoved} test nodes total.`);
                        db.close();
                        resolve();
                    });
                }
            );
        }
    });
}

if (require.main === module) {
    cleanupTestNodes().catch(console.error);
}

module.exports = { cleanupTestNodes };