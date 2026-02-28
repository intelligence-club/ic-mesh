#!/usr/bin/env node

/**
 * Test: Duplicate Email Prevention in Founding Operators
 * 
 * Verifies that the same email cannot create multiple Stripe accounts
 * through the founding operator onboarding flow.
 */

const Database = require('better-sqlite3');
const { validateDbPath } = require('./lib/db-utils');

const DB_PATH = './mesh.db';
const validDbPath = validateDbPath(DB_PATH);

if (!validDbPath) {
  console.error('🚨 SECURITY: Invalid database path provided');
  process.exit(1);
}

const db = new Database(validDbPath);

console.log('🧪 Testing Duplicate Email Prevention for Founding Operators\n');

// Test data
const testEmail = 'test-operator@example.com';
const node1 = 'node-test-1';
const node2 = 'node-test-2';

try {
  // Clean up any existing test data
  db.prepare('DELETE FROM founding_operators WHERE email = ?').run(testEmail);
  
  // Test 1: First node with email should succeed
  console.log('Test 1: First node registration with email');
  try {
    db.prepare(`
      INSERT INTO founding_operators (nodeId, slot_number, joined_at, email, benefits)
      VALUES (?, ?, ?, ?, '{"multiplier": 2.0, "priority_routing": true}')
    `).run(node1, 1, Math.floor(Date.now() / 1000), testEmail);
    
    console.log('✅ PASS: First node registered successfully');
  } catch (error) {
    console.log('❌ FAIL: First node registration failed:', error.message);
    process.exit(1);
  }

  // Test 2: Second node with same email should fail
  console.log('\nTest 2: Second node registration with same email');
  try {
    db.prepare(`
      INSERT INTO founding_operators (nodeId, slot_number, joined_at, email, benefits)
      VALUES (?, ?, ?, ?, '{"multiplier": 2.0, "priority_routing": true}')
    `).run(node2, 2, Math.floor(Date.now() / 1000), testEmail);
    
    console.log('❌ FAIL: Second node with same email should have been rejected');
    process.exit(1);
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed: founding_operators.email')) {
      console.log('✅ PASS: Duplicate email correctly rejected');
    } else {
      console.log('❌ FAIL: Unexpected error:', error.message);
      process.exit(1);
    }
  }

  // Test 3: Verify only one record exists for the email
  console.log('\nTest 3: Verify email uniqueness in database');
  const records = db.prepare('SELECT COUNT(*) as count FROM founding_operators WHERE email = ?').get(testEmail);
  
  if (records.count === 1) {
    console.log('✅ PASS: Only one record exists for the email');
  } else {
    console.log(`❌ FAIL: Expected 1 record, found ${records.count}`);
    process.exit(1);
  }

  // Test 4: Different email should work fine
  console.log('\nTest 4: Different email registration');
  const differentEmail = 'different@example.com';
  try {
    db.prepare(`
      INSERT INTO founding_operators (nodeId, slot_number, joined_at, email, benefits)
      VALUES (?, ?, ?, ?, '{"multiplier": 2.0, "priority_routing": true}')
    `).run(node2, 2, Math.floor(Date.now() / 1000), differentEmail);
    
    console.log('✅ PASS: Different email registered successfully');
  } catch (error) {
    console.log('❌ FAIL: Different email registration failed:', error.message);
    process.exit(1);
  }

  console.log('\n🎉 All tests passed! Duplicate email prevention is working correctly.');
  
  // Show final state
  const finalRecords = db.prepare('SELECT nodeId, email FROM founding_operators WHERE email IN (?, ?)').all(testEmail, differentEmail);
  console.log('\n📊 Final state:');
  finalRecords.forEach(record => {
    console.log(`  - ${record.nodeId}: ${record.email}`);
  });

  // Cleanup test data
  db.prepare('DELETE FROM founding_operators WHERE email IN (?, ?)').run(testEmail, differentEmail);
  console.log('\n🧹 Test data cleaned up');

} catch (error) {
  console.error('🚨 Test suite failed:', error.message);
  process.exit(1);
} finally {
  db.close();
}