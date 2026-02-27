#!/usr/bin/env node
/**
 * Demo: Before/After Logging Migration Example
 * 
 * This demonstrates the improvement from console.log to structured logging
 */

// BEFORE (old approach with console.log everywhere)
function processJobsOldWay() {
  console.log('Starting job processing...');
  console.log('Checking database connection');
  console.log('Found 23 pending jobs');
  console.log('Processing job:', { id: 123, type: 'transcribe' });
  console.log('❌ Job failed:', 'Network timeout');
  console.log('⚠️  Warning: Queue getting full');
  console.log('✅ Completed job processing in 2.3 seconds');
}

// AFTER (new structured logging approach)
const logger = require('./utils/logger');

function processJobsNewWay() {
  const jobLogger = logger.child({ module: 'job-processor' });
  
  jobLogger.info('Starting job processing');
  jobLogger.debug('Checking database connection');
  jobLogger.info('Found pending jobs', { count: 23 });
  jobLogger.info('Processing job', { jobId: 123, type: 'transcribe' });
  jobLogger.error('Job failed', { jobId: 123, reason: 'Network timeout' });
  jobLogger.warn('Queue getting full', { currentSize: 45, maxSize: 50 });
  jobLogger.info('Completed job processing', { duration: '2.3s', jobsProcessed: 23 });
}

// Performance timing example
function demonstrateTiming() {
  logger.time('database-query');
  
  // Simulate work
  setTimeout(() => {
    logger.timeEnd('database-query', { 
      query: 'SELECT * FROM jobs WHERE status = "pending"',
      resultCount: 23 
    });
  }, 100);
}

if (require.main === module) {
  console.log('🧪 Logging System Demo\n');
  
  console.log('📢 Old approach:');
  processJobsOldWay();
  
  console.log('\n✨ New structured approach:');
  processJobsNewWay();
  
  console.log('\n⏱  Performance timing:');
  demonstrateTiming();
}