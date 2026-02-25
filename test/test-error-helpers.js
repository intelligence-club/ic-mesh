/**
 * Tests for Enhanced Error Handling System
 * Can be run with: node test/test-error-helpers.js
 * Or with test frameworks like mocha/jest
 */

const assert = require('assert');
const { MeshError, ErrorClassifier, JobValidator, ErrorFormatter } = require('../lib/error-helpers');

// Export test functions for external test runners
const testFunctions = {
  testMeshError() {
    const error = new MeshError('HANDLER_NOT_FOUND', { type: 'missing' });
    assert.strictEqual(error.message, 'Job type not supported');
    assert.strictEqual(error.code, 'HANDLER_NOT_FOUND');
    assert.strictEqual(error.recoverable, false);
    assert.ok(error.hint.includes('Check available capabilities'));

    const json = error.toJSON();
    assert.strictEqual(json.error, 'Job type not supported');
    assert.strictEqual(json.code, 'HANDLER_NOT_FOUND');
    assert.ok(json.timestamp);
  },

  testErrorClassifier() {
    // Test timeout classification
    const timeoutError = new Error('Command timed out after 300s');
    const classified = ErrorClassifier.classify(timeoutError, { timeout: 300 });
    assert.strictEqual(classified.code, 'HANDLER_TIMEOUT');
    assert.strictEqual(classified.recoverable, true);

    // Test memory classification
    const memError = new Error('Out of memory');
    const memClassified = ErrorClassifier.classify(memError);
    assert.strictEqual(memClassified.code, 'INSUFFICIENT_MEMORY');

    // Test network classification
    const netError = new Error('getaddrinfo ENOTFOUND example.com');
    const netClassified = ErrorClassifier.classify(netError, { url: 'https://example.com/file' });
    assert.strictEqual(netClassified.code, 'DOWNLOAD_FAILED');
    assert.ok(netClassified.details.suggestion.includes('hostname'));

    // Test retryable detection
    const retryableError = new MeshError('HANDLER_OVERLOADED');
    const nonRetryableError = new MeshError('INVALID_URL');
    assert.strictEqual(ErrorClassifier.isRetryable(retryableError), true);
    assert.strictEqual(ErrorClassifier.isRetryable(nonRetryableError), false);
  },

  testJobValidator() {
    // Test valid job
    const validJob = {
      type: 'transcribe',
      payload: { url: 'https://example.com/audio.mp3' }
    };
    const validErrors = JobValidator.validateJob(validJob);
    assert.strictEqual(validErrors.length, 0);

    // Test missing job type
    const invalidJob = { payload: {} };
    const invalidErrors = JobValidator.validateJob(invalidJob);
    assert.strictEqual(invalidErrors.length, 1);
    assert.strictEqual(invalidErrors[0].code, 'INVALID_JOB_TYPE');

    // Test invalid URL
    const urlJob = {
      type: 'test',
      payload: { url: 'not-a-url' }
    };
    const urlErrors = JobValidator.validateJob(urlJob);
    assert.strictEqual(urlErrors.length, 1);
    assert.strictEqual(urlErrors[0].code, 'INVALID_URL');

    // Test URL validation
    assert.strictEqual(JobValidator.isValidUrl('https://example.com'), true);
    assert.strictEqual(JobValidator.isValidUrl('http://localhost:8080'), true);
    assert.strictEqual(JobValidator.isValidUrl('ftp://example.com'), false);
    assert.strictEqual(JobValidator.isValidUrl('not-a-url'), false);

    // Test suggestions
    const available = ['transcribe', 'translate', 'summarize'];
    const suggestion = JobValidator.suggestJobType('transcrib', available);
    assert.ok(suggestion.includes('transcribe'));
  },

  testErrorFormatter() {
    // Test API formatting
    const error = new MeshError('HANDLER_TIMEOUT', { timeout: 300 });
    const apiResponse = ErrorFormatter.forAPI(error);
    assert.strictEqual(apiResponse.error, 'Job timed out');
    assert.strictEqual(apiResponse.code, 'HANDLER_TIMEOUT');
    assert.strictEqual(apiResponse.recoverable, true);
    assert.ok(apiResponse.hint);

    // Test log formatting
    const logMessage = ErrorFormatter.forLog(error, { jobId: 'test-123' });
    assert.ok(logMessage.includes('test-123'));
    assert.ok(logMessage.includes('HANDLER_TIMEOUT'));

    // Test user formatting
    const userMessage = ErrorFormatter.forUser(error);
    assert.ok(userMessage.includes('Job timed out'));

    // Test non-MeshError handling
    const genericError = new Error('Generic error message');
    const genericResponse = ErrorFormatter.forAPI(genericError);
    assert.strictEqual(genericResponse.error, 'Generic error message');
    assert.strictEqual(genericResponse.code, 'UNKNOWN_ERROR');
  },

  testIntegrationScenarios() {
    // Complete workflow test
    const originalError = new Error('Handler timed out after 300s');
    const classified = ErrorClassifier.classify(originalError, { 
      jobId: 'test-job-123',
      timeout: 300 
    });
    const apiResponse = ErrorFormatter.forAPI(classified);
    
    assert.strictEqual(apiResponse.code, 'HANDLER_TIMEOUT');
    assert.strictEqual(apiResponse.recoverable, true);
    assert.ok(apiResponse.hint.includes('Try with smaller input'));

    // Test actionable error messages
    const scenarios = [
      {
        error: new Error('getaddrinfo ENOTFOUND badhost.example'),
        context: { url: 'https://badhost.example/file' },
        expectedHint: /hostname.*correct/i
      },
      {
        error: new Error('ECONNREFUSED'),
        context: { url: 'https://example.com/file' },
        expectedHint: /try again later/i
      }
    ];

    scenarios.forEach(({ error, context, expectedHint }) => {
      const classified = ErrorClassifier.classify(error, context);
      const apiResponse = ErrorFormatter.forAPI(classified);
      assert.ok(expectedHint.test(apiResponse.hint), 
        `Expected hint pattern not found in: ${apiResponse.hint}`);
    });
  }
};

// Run tests if this file is executed directly
if (require.main === module) {
  console.log('🧪 Running Enhanced Error Handling Tests...\n');
  
  let passed = 0;
  let failed = 0;

  const runTest = (name, testFn) => {
    try {
      testFn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${name} - ${error.message}`);
      failed++;
    }
  };

  console.log('📋 Testing MeshError...');
  runTest('MeshError creation and properties', testFunctions.testMeshError);

  console.log('\n📋 Testing ErrorClassifier...');
  runTest('Error classification and retry detection', testFunctions.testErrorClassifier);

  console.log('\n📋 Testing JobValidator...');
  runTest('Job validation and URL checking', testFunctions.testJobValidator);

  console.log('\n📋 Testing ErrorFormatter...');
  runTest('Error formatting for different contexts', testFunctions.testErrorFormatter);

  console.log('\n📋 Testing Integration Scenarios...');
  runTest('Complete error workflow', testFunctions.testIntegrationScenarios);

  console.log(`\n📊 Test Results:`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  const successRate = failed === 0 ? 100 : Math.round(passed/(passed+failed)*100);
  console.log(`📈 Success Rate: ${successRate}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! Enhanced error handling system is working correctly.');
    console.log('💡 Integration ready: Use lib/error-helpers.js in your handler runtime.');
    console.log('📖 See examples/enhanced-error-integration.js for usage examples.');
  } else {
    console.log('\n⚠️  Some tests failed. Check error messages above.');
    process.exit(1);
  }
}

// For test frameworks like mocha/jest
if (typeof describe !== 'undefined') {
  describe('Enhanced Error Handling', () => {
    
    describe('MeshError', () => {
      it('should create error with user-friendly message', testFunctions.testMeshError);
    });

    describe('ErrorClassifier', () => {
      it('should classify errors correctly', testFunctions.testErrorClassifier);
    });

    describe('JobValidator', () => {
      it('should validate jobs and URLs', testFunctions.testJobValidator);
    });

    describe('ErrorFormatter', () => {
      it('should format errors for different contexts', testFunctions.testErrorFormatter);
    });

    describe('Integration scenarios', () => {
      it('should handle complete error workflows', testFunctions.testIntegrationScenarios);
    });
  });
}

module.exports = testFunctions;