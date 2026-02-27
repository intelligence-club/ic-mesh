#!/usr/bin/env node

/**
 * Quick Status Summary
 * 
 * Provides a one-line status summary perfect for work pulse monitoring
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function getQuickSummary() {
  try {
    const { stdout } = await execPromise('node capacity-status-check.js');
    
    // Extract key metrics
    const totalMatch = stdout.match(/TOTAL:\s*(\d+)/);
    const activeMatch = stdout.match(/⚡ Status:\s*(\d+)\/(\d+)\s*nodes active/);
    const transcribeMatch = stdout.match(/transcribe:\s*(\d+)/);
    const ocrMatch = stdout.match(/ocr:\s*(\d+)/);
    const pdfMatch = stdout.match(/pdf-extract:\s*(\d+)/);
    
    const totalJobs = totalMatch ? parseInt(totalMatch[1]) : 0;
    const activeNodes = activeMatch ? parseInt(activeMatch[1]) : 0;
    const totalNodes = activeMatch ? parseInt(activeMatch[2]) : 0;
    const transcribe = transcribeMatch ? parseInt(transcribeMatch[1]) : 0;
    const ocr = ocrMatch ? parseInt(ocrMatch[1]) : 0;
    const pdf = pdfMatch ? parseInt(pdfMatch[1]) : 0;
    
    // Service status indicators
    const transcribeOK = stdout.includes('🟢 transcribe');
    const ocrBlocked = stdout.includes('🔴 pdf-extract') || stdout.includes('🟡 ocr');
    const pdfBlocked = stdout.includes('🔴 pdf-extract');
    
    // Generate summary
    const serviceStatus = transcribeOK ? '✅T' : '❌T';
    const blockStatus = ocrBlocked || pdfBlocked ? '❌O/P' : '✅O/P';
    const nodeStatus = activeNodes > 0 ? `${activeNodes}/${totalNodes}` : '0/0';
    
    const summary = `IC Mesh: ${totalJobs}j pending | ${nodeStatus} nodes | ${serviceStatus} ${blockStatus} | ${transcribe}t ${ocr}o ${pdf}p`;
    
    return {
      summary,
      metrics: { totalJobs, activeNodes, totalNodes, transcribe, ocr, pdf },
      services: { transcribeOK, ocrBlocked, pdfBlocked }
    };
    
  } catch (error) {
    return {
      summary: `IC Mesh: ERROR - ${error.message}`,
      metrics: null,
      services: null
    };
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const result = await getQuickSummary();
  
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (args.includes('--metrics')) {
    console.log(JSON.stringify(result.metrics, null, 2));
  } else {
    console.log(result.summary);
  }
}

if (require.main === module) {
  main().catch(error => console.error('Error:', error.message));
}

module.exports = { getQuickSummary };