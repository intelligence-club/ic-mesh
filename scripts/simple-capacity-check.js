#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();

console.log('🔍 Simple Capacity Check');
console.log('========================');

const db = new sqlite3.Database('data/mesh.db', (err) => {
    if (err) {
        console.error('❌ Database connection failed:', err.message);
        process.exit(1);
    } else {
        console.log('✅ Connected to database');
    }
});

// Check job status
db.all(`SELECT status, COUNT(*) as count FROM jobs GROUP BY status`, (err, rows) => {
    if (err) {
        console.error('❌ Job query failed:', err);
        return;
    }
    
    console.log('\n📋 JOB STATUS:');
    rows.forEach(row => {
        console.log(`  ${row.status}: ${row.count}`);
    });
});

// Check nodes
db.all(`SELECT COUNT(*) as total, 
    SUM(CASE WHEN lastSeen > strftime('%s', 'now') - 300 THEN 1 ELSE 0 END) as active
    FROM nodes`, (err, rows) => {
    if (err) {
        console.error('❌ Node query failed:', err);
        return;
    }
    
    const result = rows[0];
    console.log('\n🖥️  NODE STATUS:');
    console.log(`  Total: ${result.total}`);
    console.log(`  Active (5min): ${result.active}`);
    
    db.close();
});