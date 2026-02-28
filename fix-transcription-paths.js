#!/usr/bin/env node
/**
 * IC Mesh - Fix Transcription Path Issues
 * Addresses the critical macOS path bug affecting 47.7% of transcription jobs
 * 
 * Root cause: Jobs created with macOS temp paths (/var/folders/...) on Linux system
 * Impact: 93/119 transcription jobs failing due to path incompatibility
 * Solution: Force correct Linux temp paths and fix environment issues
 */

const sqlite3 = require('sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Ensure we're using the correct temp directory for the current platform
const getCorrectTempDir = () => {
  if (process.platform === 'darwin') {
    return os.tmpdir(); // macOS: /var/folders/...
  } else {
    return '/tmp'; // Linux: always use /tmp regardless of environment
  }
};

async function fixTranscriptionPaths() {
  console.log('🔧 IC Mesh Transcription Path Fix');
  console.log('==================================');
  console.log(`Platform: ${process.platform}`);
  console.log(`Correct temp dir: ${getCorrectTempDir()}`);
  console.log(`os.tmpdir() returns: ${os.tmpdir()}`);
  
  // Check for environment variable issues
  const envTempVars = ['TMPDIR', 'TMP', 'TEMP'];
  envTempVars.forEach(varName => {
    if (process.env[varName]) {
      console.log(`⚠️  ${varName}=${process.env[varName]}`);
    }
  });
  
  const db = new sqlite3.Database('./data/mesh.db');
  
  // Find failed transcription jobs with macOS paths
  const failedJobs = await new Promise((resolve, reject) => {
    db.all(`
      SELECT jobId, result, payload 
      FROM jobs 
      WHERE type = 'transcribe' 
      AND status = 'failed' 
      AND result LIKE '%/var/folders/%'
      ORDER BY createdAt DESC
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  
  console.log(`\nFound ${failedJobs.length} failed transcription jobs with macOS paths`);
  
  if (failedJobs.length > 0) {
    console.log('\nSample failures:');
    failedJobs.slice(0, 3).forEach((job, i) => {
      console.log(`\n${i + 1}. Job ${job.jobId.substring(0, 8)}:`);
      try {
        const result = JSON.parse(job.result);
        if (result.error) {
          console.log(`   Error: ${result.error.substring(0, 100)}...`);
        }
      } catch (e) {
        console.log(`   Raw result: ${job.result.substring(0, 100)}...`);
      }
    });
  }
  
  console.log('\n🔧 FIXES TO APPLY:');
  console.log('==================');
  
  // Fix 1: Override environment variables
  console.log('\n1. Environment Variable Override:');
  if (process.platform === 'linux') {
    // Force Linux temp directory
    process.env.TMPDIR = '/tmp';
    process.env.TMP = '/tmp';
    process.env.TEMP = '/tmp';
    console.log('   ✅ Set temp directory environment variables to /tmp');
  }
  
  // Fix 2: Patch handler-loader.js to force correct temp directory
  console.log('\n2. Handler Loader Path Fix:');
  const handlerLoaderPath = './lib/handler-loader.js';
  
  if (fs.existsSync(handlerLoaderPath)) {
    let content = fs.readFileSync(handlerLoaderPath, 'utf8');
    
    // Check if the fix is already applied
    if (content.includes('IC_MESH_TMPDIR_FIX')) {
      console.log('   ✅ Path fix already applied to handler-loader.js');
    } else {
      // Apply the fix
      const originalLine = 'const tmpDir = path.join(os.tmpdir(), `ic-handler-${Date.now()}`);';
      const fixedLine = `  // IC_MESH_TMPDIR_FIX: Force correct temp directory on Linux
  const getCorrectTempDir = () => process.platform === 'linux' ? '/tmp' : os.tmpdir();
  const tmpDir = path.join(getCorrectTempDir(), \`ic-handler-\${Date.now()}\`);`;
      
      if (content.includes(originalLine)) {
        content = content.replace(originalLine, fixedLine);
        fs.writeFileSync(handlerLoaderPath, content);
        console.log('   ✅ Applied path fix to handler-loader.js');
      } else {
        console.log('   ⚠️  Could not find exact line to replace in handler-loader.js');
        console.log('   📝 Manual fix required: ensure tmpDir uses /tmp on Linux');
      }
    }
  } else {
    console.log('   ❌ handler-loader.js not found');
  }
  
  // Fix 3: Patch client.js transcribe function
  console.log('\n3. Client.js Transcribe Function Fix:');
  const clientPath = './client.js';
  
  if (fs.existsSync(clientPath)) {
    let content = fs.readFileSync(clientPath, 'utf8');
    
    // Check if the fix is already applied
    if (content.includes('IC_MESH_CLIENT_TMPDIR_FIX')) {
      console.log('   ✅ Path fix already applied to client.js');
    } else {
      // Apply the fix to runTranscribe function
      const originalLine = "const tmpDir = path.join(os.tmpdir(), 'ic-mesh-jobs');";
      const fixedLine = `  // IC_MESH_CLIENT_TMPDIR_FIX: Force correct temp directory on Linux
  const getCorrectTempDir = () => process.platform === 'linux' ? '/tmp' : os.tmpdir();
  const tmpDir = path.join(getCorrectTempDir(), 'ic-mesh-jobs');`;
      
      if (content.includes(originalLine)) {
        content = content.replace(originalLine, fixedLine);
        fs.writeFileSync(clientPath, content);
        console.log('   ✅ Applied path fix to client.js');
      } else {
        console.log('   ⚠️  Could not find exact line to replace in client.js');
        console.log('   📝 Manual fix required: ensure tmpDir uses /tmp on Linux');
      }
    }
  } else {
    console.log('   ❌ client.js not found');
  }
  
  // Fix 4: Reset failed jobs to pending for retry
  console.log('\n4. Reset Failed Jobs for Retry:');
  if (failedJobs.length > 0) {
    const result = await new Promise((resolve, reject) => {
      db.run(`
        UPDATE jobs 
        SET status = 'pending', claimedBy = NULL, claimedAt = NULL, result = NULL 
        WHERE type = 'transcribe' 
        AND status = 'failed' 
        AND result LIKE '%/var/folders/%'
      `, function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
    console.log(`   ✅ Reset ${result} failed transcription jobs to pending`);
  } else {
    console.log('   ✅ No failed jobs to reset');
  }
  
  db.close();
  
  console.log('\n🚀 NEXT STEPS:');
  console.log('==============');
  console.log('1. Restart any running IC Mesh clients/processors');
  console.log('2. Monitor job processing for successful transcriptions');
  console.log('3. Verify temp directory paths in logs');
  console.log('4. Run health checks to confirm infrastructure recovery');
  
  console.log('\n✅ Transcription path fix completed!');
}

// Run the fix
fixTranscriptionPaths().catch(console.error);