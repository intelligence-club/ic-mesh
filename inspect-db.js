#!/usr/bin/env node

const Database = require('better-sqlite3');
const db = new Database('./mesh.db');

// Check what tables exist
console.log('📋 Database Tables:');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
tables.forEach(table => {
  console.log(`  - ${table.name}`);
});

// Check table schemas
tables.forEach(table => {
  console.log(`\n🔍 Schema for ${table.name}:`);
  const schema = db.prepare(`PRAGMA table_info(${table.name})`).all();
  schema.forEach(col => {
    console.log(`  ${col.name}: ${col.type}${col.notnull ? ' NOT NULL' : ''}`);
  });
  
  // Get row count
  const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get().count;
  console.log(`  Rows: ${count}`);
});

db.close();