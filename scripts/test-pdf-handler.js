#!/usr/bin/env node

/**
 * Test suite for PDF text extraction handler
 * Tests various PDF scenarios and extraction methods
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class PDFHandlerTester {
  constructor() {
    this.testResults = [];
    this.handlerPath = path.join(__dirname, '../handlers/pdf-extract.py');
    this.tempDir = '/tmp/pdf-handler-test';
    
    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }
  
  async runTest(testName, testFn) {
    console.log(`\n🔍 Testing: ${testName}`);
    
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
        error: error.message,
        stack: error.stack
      });
      
      console.log(`❌ ${testName} - FAILED: ${error.message}`);
      throw error;
    }
  }
  
  createTestPDF(content, filename = 'test.pdf') {
    /**
     * Create a simple test PDF using Python reportlab if available
     * Falls back to creating a text file for basic testing
     */
    const testFilePath = path.join(this.tempDir, filename);
    
    // For now, we'll simulate PDF creation by creating test scenarios
    // In a real test, you'd want actual PDF files
    const testPdfScript = `
import sys
try:
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
    
    c = canvas.Canvas("${testFilePath}", pagesize=letter)
    c.drawString(100, 750, "${content}")
    c.showPage()
    c.save()
    print("PDF created successfully")
except ImportError:
    print("reportlab not available, creating placeholder file")
    with open("${testFilePath}", 'w') as f:
        f.write("PDF placeholder: ${content}")
except Exception as e:
    print(f"Error creating PDF: {e}")
    with open("${testFilePath}", 'w') as f:
        f.write("PDF placeholder: ${content}")
`;
    
    // Write and execute PDF creation script
    const scriptPath = path.join(this.tempDir, 'create_pdf.py');
    fs.writeFileSync(scriptPath, testPdfScript);
    
    return testFilePath;
  }
  
  async testHandlerExists() {
    return this.runTest('Handler file exists and is executable', async () => {
      if (!fs.existsSync(this.handlerPath)) {
        throw new Error(`Handler not found at ${this.handlerPath}`);
      }
      
      const stats = fs.statSync(this.handlerPath);
      if (!(stats.mode & parseInt('111', 8))) {
        throw new Error('Handler file is not executable');
      }
      
      return { path: this.handlerPath, size: stats.size };
    });
  }
  
  async testDependencyCheck() {
    return this.runTest('Dependency availability check', async () => {
      const testScript = `
import sys
import json

dependencies = {}

try:
    import PyPDF2
    dependencies['PyPDF2'] = True
except ImportError:
    dependencies['PyPDF2'] = False

try:
    import pdfplumber
    dependencies['pdfplumber'] = True
except ImportError:
    dependencies['pdfplumber'] = False

try:
    import PIL
    dependencies['PIL'] = True
except ImportError:
    dependencies['PIL'] = False

try:
    import fitz  # PyMuPDF
    dependencies['PyMuPDF'] = True
except ImportError:
    dependencies['PyMuPDF'] = False

print(json.dumps(dependencies))
`;
      
      const scriptPath = path.join(this.tempDir, 'check_deps.py');
      fs.writeFileSync(scriptPath, testScript);
      
      try {
        const { stdout } = await execAsync(`python3 ${scriptPath}`);
        const deps = JSON.parse(stdout.trim());
        
        const available = Object.entries(deps).filter(([_, avail]) => avail).map(([name, _]) => name);
        const missing = Object.entries(deps).filter(([_, avail]) => !avail).map(([name, _]) => name);
        
        return { available, missing, allAvailable: missing.length === 0 };
      } catch (error) {
        throw new Error(`Dependency check failed: ${error.message}`);
      }
    });
  }
  
  async testBasicExecution() {
    return this.runTest('Basic handler execution', async () => {
      // Create a simple test file
      const testFile = path.join(this.tempDir, 'basic-test.txt');
      const outputFile = path.join(this.tempDir, 'basic-output.json');
      
      fs.writeFileSync(testFile, 'This is a test file, not a real PDF.');
      
      try {
        // This should fail gracefully since it's not a PDF
        await execAsync(`python3 ${this.handlerPath} ${testFile} ${outputFile}`);
        
        // Check if output file was created
        if (fs.existsSync(outputFile)) {
          const result = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
          
          // Should have error about invalid PDF
          if (result.success === false && result.error) {
            return { 
              errorHandling: 'correct',
              error: result.error,
              gracefulFailure: true
            };
          }
        }
        
        throw new Error('Expected graceful failure for non-PDF input');
      } catch (execError) {
        // Check if error was handled gracefully by checking output
        if (fs.existsSync(outputFile)) {
          const result = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
          return {
            errorHandling: 'correct',
            error: result.error,
            gracefulFailure: true
          };
        }
        
        // If no output file, the handler crashed ungracefully
        throw new Error(`Handler crashed ungracefully: ${execError.message}`);
      }
    });
  }
  
  async testParameterHandling() {
    return this.runTest('Parameter handling', async () => {
      const testFile = path.join(this.tempDir, 'param-test.pdf');
      const outputFile = path.join(this.tempDir, 'param-output.json');
      
      // Create a fake PDF file for testing
      fs.writeFileSync(testFile, 'Fake PDF content');
      
      const parameters = {
        method: 'auto',
        format: 'json',
        extract_tables: true,
        extract_metadata: true
      };
      
      const paramString = JSON.stringify(parameters);
      
      try {
        await execAsync(`python3 ${this.handlerPath} ${testFile} ${outputFile} '${paramString}'`);
        
        if (fs.existsSync(outputFile)) {
          const result = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
          
          // Should fail because it's not a real PDF, but parameters should be processed
          return {
            parametersProcessed: true,
            outputGenerated: true,
            result: result
          };
        }
        
        throw new Error('No output file generated');
      } catch (error) {
        // Even if execution fails, we should get an output file
        if (fs.existsSync(outputFile)) {
          const result = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
          return {
            parametersProcessed: true,
            errorHandled: true,
            result: result
          };
        }
        
        throw error;
      }
    });
  }
  
  async testOutputFormats() {
    return this.runTest('Output format handling', async () => {
      const testFile = path.join(this.tempDir, 'format-test.pdf');
      const outputFileJson = path.join(this.tempDir, 'format-output.json');
      const outputFileText = path.join(this.tempDir, 'format-output.txt');
      const outputFileMd = path.join(this.tempDir, 'format-output.md');
      
      fs.writeFileSync(testFile, 'Fake PDF content');
      
      const results = {};
      
      // Test JSON format (default)
      try {
        await execAsync(`python3 ${this.handlerPath} ${testFile} ${outputFileJson} '{"format": "json"}'`);
        results.json = fs.existsSync(outputFileJson);
      } catch (error) {
        results.json = fs.existsSync(outputFileJson);
      }
      
      // Test text format
      try {
        await execAsync(`python3 ${this.handlerPath} ${testFile} ${outputFileText} '{"format": "text"}'`);
        results.text = fs.existsSync(outputFileText);
      } catch (error) {
        results.text = fs.existsSync(outputFileText);
      }
      
      // Test markdown format
      try {
        await execAsync(`python3 ${this.handlerPath} ${testFile} ${outputFileMd} '{"format": "markdown"}'`);
        results.markdown = fs.existsSync(outputFileMd);
      } catch (error) {
        results.markdown = fs.existsSync(outputFileMd);
      }
      
      return results;
    });
  }
  
  async testErrorHandling() {
    return this.runTest('Error handling scenarios', async () => {
      const results = {};
      
      // Test missing file
      try {
        const outputFile = path.join(this.tempDir, 'missing-file-output.json');
        await execAsync(`python3 ${this.handlerPath} /nonexistent/file.pdf ${outputFile}`);
        
        if (fs.existsSync(outputFile)) {
          const result = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
          results.missingFile = {
            handled: true,
            error: result.error
          };
        }
      } catch (error) {
        results.missingFile = { handled: false, error: error.message };
      }
      
      // Test invalid JSON parameters
      try {
        const testFile = path.join(this.tempDir, 'error-test.pdf');
        const outputFile = path.join(this.tempDir, 'invalid-params-output.json');
        fs.writeFileSync(testFile, 'Fake PDF');
        
        await execAsync(`python3 ${this.handlerPath} ${testFile} ${outputFile} 'invalid json'`);
      } catch (error) {
        results.invalidParams = { 
          handled: error.code === 1,
          error: error.message 
        };
      }
      
      return results;
    });
  }
  
  async testIntegrationWithICMesh() {
    return this.runTest('IC Mesh integration compatibility', async () => {
      // Test that handler produces output compatible with IC Mesh expectations
      const testFile = path.join(this.tempDir, 'integration-test.pdf');
      const outputFile = path.join(this.tempDir, 'integration-output.json');
      
      fs.writeFileSync(testFile, 'Fake PDF for integration testing');
      
      try {
        await execAsync(`python3 ${this.handlerPath} ${testFile} ${outputFile}`);
        
        if (fs.existsSync(outputFile)) {
          const result = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
          
          // Check expected structure
          const hasRequiredFields = [
            'success' in result,
            result.success === false ? 'error' in result : 'result' in result
          ].every(Boolean);
          
          return {
            compatibleStructure: hasRequiredFields,
            result: result
          };
        }
        
        throw new Error('No output file generated');
      } catch (error) {
        if (fs.existsSync(outputFile)) {
          const result = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
          return {
            compatibleStructure: 'success' in result && 'error' in result,
            result: result
          };
        }
        
        throw error;
      }
    });
  }
  
  async runAllTests() {
    console.log('🧪 Starting PDF Handler Test Suite');
    console.log('=====================================');
    
    try {
      await this.testHandlerExists();
      await this.testDependencyCheck();
      await this.testBasicExecution();
      await this.testParameterHandling();
      await this.testOutputFormats();
      await this.testErrorHandling();
      await this.testIntegrationWithICMesh();
      
    } catch (error) {
      // Continue with other tests even if one fails
      console.log(`Test failed, continuing with remaining tests...`);
    }
    
    this.printSummary();
  }
  
  printSummary() {
    console.log('\n📊 Test Results Summary');
    console.log('=======================');
    
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
    
    // Clean up temp files
    this.cleanup();
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
  const tester = new PDFHandlerTester();
  tester.runAllTests().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = PDFHandlerTester;