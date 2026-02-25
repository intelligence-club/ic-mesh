#!/usr/bin/env node

/**
 * Test suite for ErrorReporter utility
 */

const fs = require('fs');
const path = require('path');
const { ErrorReporter } = require('../lib/error-reporter');

class ErrorReporterTester {
  constructor() {
    this.testResults = [];
    this.tempDir = '/tmp/error-reporter-test';
    
    // Clean up and create temp directory
    if (fs.existsSync(this.tempDir)) {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.tempDir, { recursive: true });
  }
  
  async runTest(testName, testFn) {
    console.log(`🔍 Testing: ${testName}`);
    
    try {
      const startTime = Date.now();
      const result = await testFn();
      const duration = Date.now() - startTime;
      
      this.testResults.push({
        name: testName,
        status: 'PASSED',
        duration,
        result
      });
      
      console.log(`✅ ${testName} - PASSED (${duration}ms)`);
      return result;
    } catch (error) {
      this.testResults.push({
        name: testName,
        status: 'FAILED',
        error: error.message
      });
      
      console.log(`❌ ${testName} - FAILED: ${error.message}`);
      throw error;
    }
  }
  
  async testBasicErrorReporting() {
    return this.runTest('Basic error reporting', async () => {
      const reporter = new ErrorReporter({
        logDir: this.tempDir,
        enableConsole: false,
        enableFile: true
      });
      
      const testError = new Error('Test error message');
      const context = {
        endpoint: '/test',
        method: 'GET',
        userId: 'user123'
      };
      
      const errorId = reporter.reportError(testError, context);
      
      // Verify error ID is returned
      if (!errorId || typeof errorId !== 'string') {
        throw new Error('Should return error ID');
      }
      
      // Check if log file was created
      const logFile = path.join(this.tempDir, 'errors.jsonl');
      if (!fs.existsSync(logFile)) {
        throw new Error('Log file should be created');
      }
      
      // Verify log content
      const logContent = fs.readFileSync(logFile, 'utf8');
      const logEntry = JSON.parse(logContent.trim());
      
      if (logEntry.message !== 'Test error message') {
        throw new Error('Log entry should contain error message');
      }
      
      if (logEntry.context.endpoint !== '/test') {
        throw new Error('Log entry should contain context');
      }
      
      return { errorId, logEntry };
    });
  }
  
  async testErrorCategorization() {
    return this.runTest('Error categorization', async () => {
      const reporter = new ErrorReporter({
        logDir: this.tempDir,
        enableConsole: false,
        enableFile: false
      });
      
      const testCases = [
        { error: new TypeError('Invalid type'), expectedCode: 'TYPE_ERROR' },
        { error: new ReferenceError('Undefined variable'), expectedCode: 'REFERENCE_ERROR' },
        { error: new Error('Custom error'), context: { code: 'CUSTOM_ERROR' }, expectedCode: 'CUSTOM_ERROR' }
      ];
      
      const results = [];
      
      for (const testCase of testCases) {
        const errorId = reporter.reportError(testCase.error, testCase.context || {});
        const errorInfo = reporter.formatError(testCase.error, testCase.context || {});
        
        if (errorInfo.code !== testCase.expectedCode) {
          throw new Error(`Expected code ${testCase.expectedCode}, got ${errorInfo.code}`);
        }
        
        results.push({ errorId, code: errorInfo.code });
      }
      
      return results;
    });
  }
  
  async testErrorFrequencyTracking() {
    return this.runTest('Error frequency tracking', async () => {
      const reporter = new ErrorReporter({
        enableConsole: false,
        enableFile: false
      });
      
      // Report same error multiple times
      const testError = new Error('Repeated error');
      const context = { endpoint: '/repeat' };
      
      reporter.reportError(testError, context);
      reporter.reportError(testError, context);
      reporter.reportError(testError, context);
      
      const stats = reporter.getStats();
      
      if (stats.totalErrors !== 3) {
        throw new Error(`Expected 3 total errors, got ${stats.totalErrors}`);
      }
      
      if (stats.uniqueErrors !== 1) {
        throw new Error(`Expected 1 unique error, got ${stats.uniqueErrors}`);
      }
      
      if (stats.topErrors[0].count !== 3) {
        throw new Error(`Expected top error count of 3, got ${stats.topErrors[0].count}`);
      }
      
      return stats;
    });
  }
  
  async testMiddlewareIntegration() {
    return this.runTest('Express middleware integration', async () => {
      const reporter = new ErrorReporter({
        enableConsole: false,
        enableFile: false
      });
      
      const middleware = reporter.middleware();
      
      // Mock Express request/response
      const req = {
        path: '/api/test',
        method: 'POST',
        ip: '127.0.0.1',
        headers: { 'user-agent': 'test-client' },
        user: { id: 'user456' }
      };
      
      const res = {
        headers: {},
        set: function(key, value) {
          this.headers[key] = value;
        }
      };
      
      const testError = new Error('Middleware test error');
      let nextCalled = false;
      
      const next = (error) => {
        nextCalled = true;
        if (error !== testError) {
          throw new Error('Should pass original error to next()');
        }
      };
      
      // Call middleware
      middleware(testError, req, res, next);
      
      if (!nextCalled) {
        throw new Error('Should call next()');
      }
      
      if (!res.headers['X-Error-ID']) {
        throw new Error('Should set X-Error-ID header');
      }
      
      return { errorId: res.headers['X-Error-ID'] };
    });
  }
  
  async testWebSocketErrorHandling() {
    return this.runTest('WebSocket error handling', async () => {
      const reporter = new ErrorReporter({
        enableConsole: false,
        enableFile: false
      });
      
      // Mock WebSocket
      const mockMessages = [];
      const ws = {
        OPEN: 1,
        readyState: 1,
        send: function(message) {
          mockMessages.push(JSON.parse(message));
        },
        nodeId: 'test-node'
      };
      
      const testError = new Error('WebSocket test error');
      const context = { connectionId: 'conn123' };
      
      const errorId = reporter.handleWebSocketError(testError, ws, context);
      
      if (!errorId) {
        throw new Error('Should return error ID');
      }
      
      if (mockMessages.length !== 1) {
        throw new Error('Should send error message to WebSocket client');
      }
      
      const sentMessage = mockMessages[0];
      if (sentMessage.type !== 'error' || sentMessage.errorId !== errorId) {
        throw new Error('Should send proper error message format');
      }
      
      return { errorId, sentMessage };
    });
  }
  
  async testDatabaseErrorHandling() {
    return this.runTest('Database error handling', async () => {
      const reporter = new ErrorReporter({
        enableConsole: false,
        enableFile: false
      });
      
      const testError = new Error('SQLITE_BUSY: database is locked');
      const query = 'SELECT * FROM jobs WHERE status = ?';
      const context = { table: 'jobs', operation: 'SELECT' };
      
      const errorId = reporter.handleDatabaseError(testError, query, context);
      
      if (!errorId) {
        throw new Error('Should return error ID');
      }
      
      return { errorId };
    });
  }
  
  async testJobErrorHandling() {
    return this.runTest('Job error handling', async () => {
      const reporter = new ErrorReporter({
        enableConsole: false,
        enableFile: false
      });
      
      const testError = new Error('Handler execution failed');
      const jobId = 'job-123';
      const handlerName = 'transcribe';
      const context = { nodeId: 'node-456' };
      
      const errorId = reporter.handleJobError(testError, jobId, handlerName, context);
      
      if (!errorId) {
        throw new Error('Should return error ID');
      }
      
      return { errorId };
    });
  }
  
  async runAllTests() {
    console.log('🧪 Starting ErrorReporter Test Suite');
    console.log('=====================================');
    
    try {
      await this.testBasicErrorReporting();
      await this.testErrorCategorization();
      await this.testErrorFrequencyTracking();
      await this.testMiddlewareIntegration();
      await this.testWebSocketErrorHandling();
      await this.testDatabaseErrorHandling();
      await this.testJobErrorHandling();
      
    } catch (error) {
      // Continue with remaining tests
      console.log(`Test failed, continuing...`);
    }
    
    this.printSummary();
  }
  
  printSummary() {
    console.log('\n📊 ErrorReporter Test Results');
    console.log('==============================');
    
    const passed = this.testResults.filter(r => r.status === 'PASSED').length;
    const failed = this.testResults.filter(r => r.status === 'FAILED').length;
    const total = this.testResults.length;
    
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed} ✅`);
    console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
    
    if (failed > 0) {
      console.log('\nFailed Tests:');
      this.testResults
        .filter(r => r.status === 'FAILED')
        .forEach(test => {
          console.log(`- ${test.name}: ${test.error}`);
        });
    }
    
    console.log(`\nSuccess Rate: ${(passed/total*100).toFixed(1)}%`);
    
    // Clean up
    this.cleanup();
    
    return failed === 0;
  }
  
  cleanup() {
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn(`Warning: Could not clean up temp directory: ${error.message}`);
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new ErrorReporterTester();
  tester.runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = ErrorReporterTester;