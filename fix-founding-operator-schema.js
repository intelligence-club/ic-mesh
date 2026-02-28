#!/usr/bin/env node

/**
 * Fix founding operator schema inconsistency
 * 
 * Problem: Code refers to 'isActive' column but table uses 'status' column
 * Solution: Update SQL queries to use correct column/value syntax
 */

const fs = require('fs');
const path = require('path');

function fixFoundingOperatorQueries() {
  const serverPath = path.join(__dirname, 'server.js');
  let content = fs.readFileSync(serverPath, 'utf8');
  
  console.log('🔧 Fixing founding operator schema inconsistencies...');
  
  // Track changes
  let changeCount = 0;
  
  // Fix: WHERE isActive = 1 -> WHERE status = 'active'
  const originalQueries = [
    /WHERE isActive = 1/g,
    /WHERE nodeId = \? AND isActive = 1/g
  ];
  
  const replacements = [
    "WHERE status = 'active'",
    "WHERE nodeId = ? AND status = 'active'"
  ];
  
  originalQueries.forEach((pattern, i) => {
    const matches = content.match(pattern);
    if (matches) {
      console.log(`  ✅ Found ${matches.length} occurrence(s) of pattern: ${pattern.source}`);
      content = content.replace(pattern, replacements[i]);
      changeCount += matches.length;
    }
  });
  
  if (changeCount > 0) {
    // Create backup
    fs.writeFileSync(`${serverPath}.backup-${Date.now()}`, fs.readFileSync(serverPath));
    
    // Write fixed version
    fs.writeFileSync(serverPath, content);
    
    console.log(`✅ Fixed ${changeCount} founding operator schema references`);
    console.log('📁 Original backed up with timestamp');
    console.log('🔄 Restart server to apply changes');
    
    return true;
  } else {
    console.log('ℹ️  No schema inconsistencies found');
    return false;
  }
}

if (require.main === module) {
  const fixed = fixFoundingOperatorQueries();
  process.exit(fixed ? 0 : 1);
}

module.exports = { fixFoundingOperatorQueries };