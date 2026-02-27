#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

const API_BASE = 'http://localhost:5125';
const dbPath = path.join(__dirname, '../data/mesh.db');

async function processAvailableJobs(limit = 10) {
  console.log('🚀 Batch job processing started...\n');
  
  const db = new Database(dbPath);
  
  // Get a sample of pending jobs
  const pendingJobs = db.prepare("SELECT jobId, type FROM jobs WHERE status = 'pending' LIMIT ?").all(limit);
  console.log(`Found ${pendingJobs.length} pending jobs to process`);
  
  let processed = 0;
  
  for (const job of pendingJobs) {
    try {
      console.log(`Processing ${job.jobId.slice(0,8)}... (${job.type})`);
      
      // Claim the job
      const claimResponse = await fetch(`${API_BASE}/jobs/${job.jobId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: 'batch-processor-' + Date.now(),
          capabilities: ['ffmpeg', 'tesseract', 'whisper', 'transcribe', 'transcription']
        })
      });
      
      if (claimResponse.ok) {
        // Complete the job with a mock result
        let mockResult = {};
        switch (job.type) {
          case 'transcribe':
            mockResult = {
              text: "Mock transcription result - audio processed successfully",
              duration: 30,
              confidence: 0.95
            };
            break;
          case 'ocr':
            mockResult = {
              text: "Mock OCR result - image text extracted successfully",
              confidence: 0.98
            };
            break;
          case 'pdf-extract':
            mockResult = {
              text: "Mock PDF extraction result - document processed successfully",
              pages: 3
            };
            break;
          default:
            mockResult = { result: "Mock job completed successfully" };
        }
        
        const completeResponse = await fetch(`${API_BASE}/jobs/${job.jobId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            result: mockResult,
            computeMs: 2000
          })
        });
        
        if (completeResponse.ok) {
          console.log(`  ✅ Completed successfully`);
          processed++;
        } else {
          console.log(`  ❌ Failed to complete: ${completeResponse.status}`);
        }
      } else {
        console.log(`  ⚠️  Could not claim: ${claimResponse.status}`);
      }
      
      // Small delay between jobs
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.log(`  ❌ Error processing job: ${error.message}`);
    }
  }
  
  // Show updated stats
  const updatedStatus = db.prepare("SELECT status, COUNT(*) as count FROM jobs GROUP BY status").all();
  console.log('\n📊 Updated job status:');
  updatedStatus.forEach(row => console.log(`  ${row.status}: ${row.count}`));
  
  db.close();
  console.log(`\n🎯 Batch processing complete: ${processed}/${pendingJobs.length} jobs processed`);
}

// Run with command line argument for limit
const limit = parseInt(process.argv[2]) || 10;
processAvailableJobs(limit).catch(console.error);