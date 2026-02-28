#!/usr/bin/env node
/**
 * Test Enhanced Logging System
 * Verifies that the new logging infrastructure works correctly
 */

const { createLogger, createClientLogger, createServerLogger } = require('./lib/enhanced-logger');
const { ClientLogger } = require('./lib/client-logger');

function testBasicLogging() {
  console.log('\n🧪 Testing Basic Enhanced Logging...');
  
  const logger = createLogger('test-component');
  
  logger.info('This is an info message');
  logger.error('This is an error message', { errorCode: 'TEST_ERROR' });
  logger.warn('This is a warning', { warning: 'deprecated_api' });
  logger.debug('This is a debug message - should be hidden at info level');
  
  // Test with JSON format
  process.env.LOG_FORMAT = 'json';
  const jsonLogger = createLogger('json-test');
  jsonLogger.info('JSON formatted message', { userId: 123, action: 'login' });
  
  // Reset format
  process.env.LOG_FORMAT = 'human';
  console.log('✅ Basic logging test completed');
}

function testContextualLogging() {
  console.log('\n🧪 Testing Contextual Logging...');
  
  const logger = createLogger('parent-component');
  const childLogger = logger.child({ userId: 'user-123', sessionId: 'sess-456' });
  
  logger.info('Parent logger message');
  childLogger.info('Child logger message with context');
  childLogger.error('Child logger error', { errorType: 'validation' });
  
  console.log('✅ Contextual logging test completed');
}

function testPerformanceTiming() {
  console.log('\n🧪 Testing Performance Timing...');
  
  const logger = createLogger('perf-test');
  
  logger.time('database-query');
  // Simulate some work
  setTimeout(() => {
    logger.timeEnd('database-query', { query: 'SELECT * FROM jobs', rows: 42 });
    console.log('✅ Performance timing test completed');
  }, 50);
}

function testClientLogger() {
  console.log('\n🧪 Testing Specialized Client Logger...');
  
  const clientLogger = new ClientLogger('test-node-123', 'test-machine');
  
  // Test job logging
  clientLogger.jobClaimed('job-456', 'transcription', { audioLength: 120 });
  clientLogger.jobStarted('job-456', 'ffmpeg -i input.mp3 output.wav');
  clientLogger.jobCompleted('job-456', 2500, 1024 * 1024, { outputFormat: 'wav' });
  
  // Test WebSocket logging
  clientLogger.wsConnected('wss://moilol.com/ws');
  clientLogger.wsMessageReceived('job.dispatch', { jobId: 'job-789', type: 'ocr' });
  clientLogger.wsDisconnected(1000, 'Normal closure');
  
  // Test capability logging
  clientLogger.capabilityDetected('ffmpeg', '4.4.2');
  clientLogger.capabilityMissing('whisper', 'pip install openai-whisper');
  clientLogger.capabilityScanCompleted(['ffmpeg', 'tesseract', 'ollama']);
  
  // Test performance logging
  clientLogger.resourceUsage(45.2, 2048 * 1024 * 1024, 500 * 1024 * 1024 * 1024);
  clientLogger.performanceWarning('memory', 95, 80);
  
  console.log('✅ Client logger test completed');
}

function testLogLevels() {
  console.log('\n🧪 Testing Log Levels...');
  
  // Test different log levels
  const levels = ['error', 'warn', 'info', 'debug', 'trace'];
  
  levels.forEach(level => {
    console.log(`\nTesting LOG_LEVEL=${level}:`);
    process.env.LOG_LEVEL = level;
    const logger = createLogger('level-test');
    
    logger.error('Error message (should always show)');
    logger.warn('Warning message');
    logger.info('Info message');
    logger.debug('Debug message');
    logger.trace('Trace message');
  });
  
  // Reset to info
  process.env.LOG_LEVEL = 'info';
  console.log('\n✅ Log level test completed');
}

async function testErrorScenarios() {
  console.log('\n🧪 Testing Error Scenarios...');
  
  const logger = createLogger('error-test');
  
  // Test with Error objects
  try {
    throw new Error('Test error with stack trace');
  } catch (error) {
    logger.error('Caught an error', { 
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join('\n')
    });
  }
  
  // Test with undefined/null metadata
  logger.info('Message with undefined metadata', undefined);
  logger.info('Message with null metadata', null);
  logger.info('Message with empty metadata', {});
  
  console.log('✅ Error scenario test completed');
}

function benchmarkPerformance() {
  console.log('\n🧪 Benchmarking Logging Performance...');
  
  const logger = createLogger('benchmark');
  const iterations = 10000;
  
  // Benchmark enhanced logger
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    logger.info(`Benchmark message ${i}`, { iteration: i, data: 'test' });
  }
  const enhanced_duration = Number(process.hrtime.bigint() - start) / 1000000;
  
  // Benchmark console.log for comparison
  const consoleStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    console.log(`Benchmark message ${i}`, { iteration: i, data: 'test' });
  }
  const console_duration = Number(process.hrtime.bigint() - consoleStart) / 1000000;
  
  console.log(`\n📊 Performance Results (${iterations} messages):`);
  console.log(`Enhanced Logger: ${enhanced_duration.toFixed(2)}ms`);
  console.log(`Console.log: ${console_duration.toFixed(2)}ms`);
  console.log(`Overhead: ${((enhanced_duration / console_duration - 1) * 100).toFixed(1)}%`);
  console.log('✅ Performance benchmark completed');
}

async function runAllTests() {
  console.log('🚀 Starting Enhanced Logging System Tests...');
  
  testBasicLogging();
  testContextualLogging();
  
  // Wait for async timing test
  await new Promise(resolve => {
    testPerformanceTiming();
    setTimeout(resolve, 100);
  });
  
  testClientLogger();
  testLogLevels();
  await testErrorScenarios();
  benchmarkPerformance();
  
  console.log('\n🎉 All Enhanced Logging Tests Completed Successfully!');
  console.log('\n💡 Usage Examples:');
  console.log('  LOG_LEVEL=debug node your-app.js    # Enable debug logs');
  console.log('  LOG_FORMAT=json node your-app.js    # JSON structured output');
  console.log('  LOG_COLORS=false node your-app.js   # Disable colors');
}

if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { 
  testBasicLogging,
  testContextualLogging, 
  testClientLogger,
  benchmarkPerformance
};