#!/usr/bin/env node
/**
 * Test Transcription Path Fix
 * Verifies that the macOS path issue has been resolved
 */

const sqlite3 = require('sqlite3');
const os = require('os');
const { executeFromSpec, loadHandlerSpecs } = require('./lib/handler-loader');

async function testTranscriptionFix() {
  console.log('🧪 Testing Transcription Path Fix');
  console.log('=================================');
  console.log(`Platform: ${process.platform}`);
  console.log(`os.tmpdir(): ${os.tmpdir()}`);
  console.log(`TMPDIR: ${process.env.TMPDIR || 'not set'}`);
  console.log(`TMP: ${process.env.TMP || 'not set'}`);
  console.log(`TEMP: ${process.env.TEMP || 'not set'}`);
  
  // Test 1: Check that path fix is applied
  console.log('\n1. Testing handler-loader.js fix:');
  try {
    const specs = loadHandlerSpecs();
    const whisperSpec = specs.whisper;
    
    if (whisperSpec) {
      console.log('   ✅ Whisper spec found');
      
      // Test job with URL that would previously fail
      const testJob = {
        jobId: 'fix-test-' + Date.now(),
        type: 'transcribe', 
        payload: { 
          url: 'http://localhost:8333/files/benchmark-whisper-5sec.wav',
          model: 'base',
          language: 'en'
        }
      };
      
      console.log('   🔄 Testing transcription with fixed paths...');
      const result = await executeFromSpec(whisperSpec, testJob);
      
      if (result.success || result.output) {
        console.log('   ✅ Transcription test PASSED - no macOS path errors');
      } else {
        console.log('   ❌ Transcription test failed:', result);
      }
    } else {
      console.log('   ⚠️  Whisper spec not found, testing fallback transcribe handler');
    }
  } catch (error) {
    if (error.message.includes('/var/folders/')) {
      console.log('   ❌ FAILED - macOS paths still being used:', error.message);
    } else {
      console.log('   ⚠️  Test failed with different error:', error.message);
    }
  }
  
  // Test 2: Check database job status
  console.log('\n2. Checking database job status:');
  const db = new sqlite3.Database('./data/mesh.db');
  
  const stats = await new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        status,
        COUNT(*) as count
      FROM jobs 
      WHERE type = 'transcribe'
      GROUP BY status
      ORDER BY status
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  
  console.log('   Transcription job status:');
  let totalJobs = 0;
  let failedJobs = 0;
  stats.forEach(row => {
    console.log(`   ${row.status}: ${row.count}`);
    totalJobs += row.count;
    if (row.status === 'failed') failedJobs += row.count;
  });
  
  if (totalJobs > 0) {
    const failureRate = ((failedJobs / totalJobs) * 100).toFixed(1);
    console.log(`   Total failure rate: ${failureRate}%`);
    
    if (failureRate < 10) {
      console.log('   ✅ Failure rate acceptable (< 10%)');
    } else {
      console.log('   ⚠️  High failure rate detected');
    }
  }
  
  // Test 3: Check for recent macOS path failures
  const recentFails = await new Promise((resolve, reject) => {
    db.all(`
      SELECT jobId, result, createdAt
      FROM jobs 
      WHERE type = 'transcribe' 
      AND status = 'failed' 
      AND result LIKE '%/var/folders/%'
      AND createdAt > ${Date.now() - 300000}
      ORDER BY createdAt DESC
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  
  console.log(`\n3. Recent macOS path failures (last 5 min): ${recentFails.length}`);
  if (recentFails.length === 0) {
    console.log('   ✅ No recent macOS path failures detected');
  } else {
    console.log('   ❌ Recent failures still occurring:');
    recentFails.forEach((job, i) => {
      console.log(`   ${i + 1}. ${job.jobId} - ${new Date(job.createdAt).toISOString()}`);
    });
  }
  
  db.close();
  
  console.log('\n🎯 SUMMARY:');
  console.log('===========');
  console.log(`Platform detection: ${process.platform === 'linux' ? '✅' : '⚠️'} Linux`);
  console.log(`Environment fix: ${process.env.TMPDIR === '/tmp' ? '✅' : '⚠️'} TMPDIR set to /tmp`);
  console.log(`Recent failures: ${recentFails.length === 0 ? '✅' : '❌'} No macOS path errors`);
  console.log(`Overall status: ${recentFails.length === 0 && process.env.TMPDIR === '/tmp' ? '✅ FIXED' : '⚠️ NEEDS ATTENTION'}`);
}

testTranscriptionFix().catch(console.error);