#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

const API_BASE = 'http://localhost:8333';
const dbPath = path.join(__dirname, '../data/mesh.db');

async function processUnclaimed(limit = 5) {
  console.log('🚀 Careful batch processing started...\n');
  
  const db = new Database(dbPath);
  
  // Get only truly pending (unclaimed) jobs
  const pendingJobs = db.prepare(`
    SELECT jobId, type FROM jobs 
    WHERE status = 'pending' 
    AND claimedBy IS NULL 
    LIMIT ?
  `).all(limit);
  
  console.log(`Found ${pendingJobs.length} unclaimed jobs to process`);
  
  if (pendingJobs.length === 0) {
    console.log('No unclaimed jobs available');
    db.close();
    return;
  }
  
  let processed = 0;
  const nodeId = `careful-processor-${Date.now()}`;
  
  for (const job of pendingJobs) {
    try {
      console.log(`Processing ${job.jobId.slice(0,8)}... (${job.type})`);
      
      // Claim the job
      const claimResponse = await fetch(`${API_BASE}/jobs/${job.jobId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: nodeId,
          capabilities: ['ffmpeg', 'tesseract', 'whisper', 'transcribe', 'transcription', 'ocr', 'pdf-extract']
        })
      });
      
      if (claimResponse.ok) {
        console.log(`  ✅ Claimed successfully`);
        
        // Wait a moment then complete the job
        await new Promise(resolve => setTimeout(resolve, 100));
        
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
            mockResult = { result: "Mock processing result - job completed successfully" };
        }
        
        const completeResponse = await fetch(`${API_BASE}/jobs/${job.jobId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodeId: nodeId,
            result: mockResult
          })
        });
        
        if (completeResponse.ok) {
          console.log(`  ✅ Completed successfully`);
          processed++;
        } else {
          const errorText = await completeResponse.text();
          console.log(`  ❌ Failed to complete: ${completeResponse.status} - ${errorText}`);
        }
      } else {
        const errorText = await claimResponse.text();
        console.log(`  ❌ Could not claim: ${claimResponse.status} - ${errorText}`);
      }
      
    } catch (error) {
      console.log(`  ❌ Error processing job: ${error.message}`);
    }
  }
  
  // Show final status
  console.log(`\n📊 Final job status:`);
  const statusCounts = db.prepare(`
    SELECT status, COUNT(*) as count 
    FROM jobs 
    GROUP BY status 
    ORDER BY count DESC
  `).all();
  
  statusCounts.forEach(row => {
    console.log(`  ${row.status}: ${row.count}`);
  });
  
  console.log(`\n🎯 Careful processing complete: ${processed}/${pendingJobs.length} jobs processed`);
  
  db.close();
}

processUnclaimed().catch(console.error);