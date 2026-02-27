#!/usr/bin/env node

/**
 * Capacity Trend Monitor
 * 
 * Tracks capacity trends over time and generates insights
 * about queue growth patterns, node stability, and service health
 */

const fs = require('fs');
const path = require('path');

class CapacityTrendMonitor {
  constructor() {
    this.logFile = './capacity-trends.json';
    this.initializeLog();
  }
  
  initializeLog() {
    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, JSON.stringify({ entries: [] }, null, 2));
    }
  }
  
  async getCurrentCapacityData() {
    // Get current status using existing tools
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    try {
      const { stdout } = await execPromise('node capacity-status-check.js');
      
      // Parse the output to extract data
      const lines = stdout.split('\n');
      const pendingJobsLine = lines.find(l => l.includes('TOTAL:'));
      const activeNodesLine = lines.find(l => l.includes('Active Nodes'));
      
      const totalJobs = pendingJobsLine ? parseInt(pendingJobsLine.match(/TOTAL:\s*(\d+)/)?.[1] || '0') : 0;
      const activeNodes = stdout.match(/🟢 Active Nodes[^:]*:\s*([^\n]*)/)?.[1]?.split('\n').filter(l => l.trim()).length || 0;
      
      // Extract job type breakdown
      const ocrMatch = stdout.match(/ocr:\s*(\d+)/);
      const pdfMatch = stdout.match(/pdf-extract:\s*(\d+)/);
      const transcribeMatch = stdout.match(/transcribe:\s*(\d+)/);
      
      return {
        timestamp: Date.now(),
        totalPendingJobs: totalJobs,
        activeNodes,
        jobBreakdown: {
          ocr: ocrMatch ? parseInt(ocrMatch[1]) : 0,
          pdfExtract: pdfMatch ? parseInt(pdfMatch[1]) : 0,
          transcribe: transcribeMatch ? parseInt(transcribeMatch[1]) : 0
        },
        blockedServices: {
          ocr: stdout.includes('🔴 pdf-extract') || stdout.includes('🟡 ocr'),
          pdfExtract: stdout.includes('🔴 pdf-extract'),
          transcription: !stdout.includes('🟢 transcribe')
        }
      };
    } catch (error) {
      console.error('Error getting capacity data:', error.message);
      return null;
    }
  }
  
  logCapacitySnapshot() {
    return new Promise(async (resolve) => {
      const data = await this.getCurrentCapacityData();
      if (!data) {
        resolve(false);
        return;
      }
      
      // Read existing log
      const log = JSON.parse(fs.readFileSync(this.logFile, 'utf8'));
      
      // Add new entry
      log.entries.push(data);
      
      // Keep only last 1000 entries (roughly 83 hours at 5min intervals)
      if (log.entries.length > 1000) {
        log.entries = log.entries.slice(-1000);
      }
      
      // Write updated log
      fs.writeFileSync(this.logFile, JSON.stringify(log, null, 2));
      
      console.log(`✅ Logged capacity: ${data.totalPendingJobs} jobs, ${data.activeNodes} nodes`);
      resolve(true);
    });
  }
  
  generateTrendReport(hoursBack = 24) {
    const log = JSON.parse(fs.readFileSync(this.logFile, 'utf8'));
    const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
    const recentEntries = log.entries.filter(e => e.timestamp > cutoff);
    
    if (recentEntries.length === 0) {
      console.log('📊 No trend data available for the specified time period');
      return;
    }
    
    console.log('📈 CAPACITY TREND ANALYSIS');
    console.log('═'.repeat(50));
    console.log(`📊 Analyzing ${recentEntries.length} data points over ${hoursBack} hours`);
    console.log('');
    
    // Calculate trends
    const current = recentEntries[recentEntries.length - 1];
    const oldest = recentEntries[0];
    const jobGrowth = current.totalPendingJobs - oldest.totalPendingJobs;
    const nodeChange = current.activeNodes - oldest.activeNodes;
    
    console.log('🔢 QUEUE TRENDS');
    console.log('─'.repeat(30));
    console.log(`Current pending: ${current.totalPendingJobs} jobs`);
    console.log(`${hoursBack}h ago: ${oldest.totalPendingJobs} jobs`);
    console.log(`Change: ${jobGrowth > 0 ? '+' : ''}${jobGrowth} jobs`);
    console.log(`Trend: ${jobGrowth > 0 ? '📈 Growing' : jobGrowth < 0 ? '📉 Shrinking' : '➡️ Stable'}`);
    console.log('');
    
    console.log('🖥️  NODE TRENDS');
    console.log('─'.repeat(30));
    console.log(`Current active: ${current.activeNodes} nodes`);
    console.log(`${hoursBack}h ago: ${oldest.activeNodes} nodes`);
    console.log(`Change: ${nodeChange > 0 ? '+' : ''}${nodeChange} nodes`);
    console.log(`Trend: ${nodeChange > 0 ? '📈 Growing' : nodeChange < 0 ? '📉 Declining' : '➡️ Stable'}`);
    console.log('');
    
    // Job type analysis
    console.log('📋 JOB TYPE BREAKDOWN');
    console.log('─'.repeat(30));
    console.log(`OCR: ${oldest.jobBreakdown.ocr} → ${current.jobBreakdown.ocr} (${current.jobBreakdown.ocr - oldest.jobBreakdown.ocr > 0 ? '+' : ''}${current.jobBreakdown.ocr - oldest.jobBreakdown.ocr})`);
    console.log(`PDF: ${oldest.jobBreakdown.pdfExtract} → ${current.jobBreakdown.pdfExtract} (${current.jobBreakdown.pdfExtract - oldest.jobBreakdown.pdfExtract > 0 ? '+' : ''}${current.jobBreakdown.pdfExtract - oldest.jobBreakdown.pdfExtract})`);
    console.log(`Transcribe: ${oldest.jobBreakdown.transcribe} → ${current.jobBreakdown.transcribe} (${current.jobBreakdown.transcribe - oldest.jobBreakdown.transcribe > 0 ? '+' : ''}${current.jobBreakdown.transcribe - oldest.jobBreakdown.transcribe})`);
    console.log('');
    
    // Service health
    const blockedCount = Object.values(current.blockedServices).filter(blocked => blocked).length;
    console.log('🏥 SERVICE HEALTH');
    console.log('─'.repeat(30));
    console.log(`Services blocked: ${blockedCount}/3`);
    console.log(`OCR: ${current.blockedServices.ocr ? '❌ Blocked' : '✅ Operational'}`);
    console.log(`PDF Extract: ${current.blockedServices.pdfExtract ? '❌ Blocked' : '✅ Operational'}`);
    console.log(`Transcription: ${current.blockedServices.transcription ? '❌ Blocked' : '✅ Operational'}`);
    console.log('');
    
    // Insights and recommendations
    console.log('💡 INSIGHTS & RECOMMENDATIONS');
    console.log('─'.repeat(30));
    
    if (jobGrowth > 5) {
      console.log('🚨 Queue growing rapidly - immediate capacity intervention needed');
    } else if (jobGrowth > 0) {
      console.log('⚠️  Queue growing slowly - monitor for acceleration');
    } else if (jobGrowth === 0) {
      console.log('✅ Queue stable - current capacity meeting demand');
    } else {
      console.log('📉 Queue shrinking - processing exceeding new jobs (good)');
    }
    
    if (nodeChange < 0) {
      console.log('🚨 Node capacity declining - investigate disconnections');
    } else if (nodeChange === 0 && current.activeNodes < 2) {
      console.log('⚠️  Low node count - vulnerable to single point of failure');
    } else if (nodeChange > 0) {
      console.log('✅ Node capacity increasing - healthy network growth');
    }
    
    if (blockedCount > 0) {
      console.log(`🚨 ${blockedCount} services blocked - prioritize node operator contact`);
    }
    
    return {
      jobGrowth,
      nodeChange,
      blockedCount,
      current
    };
  }
  
  generateAlert() {
    const analysis = this.generateTrendReport(1); // Last 1 hour
    if (!analysis) return null;
    
    const { jobGrowth, nodeChange, blockedCount, current } = analysis;
    const shouldAlert = jobGrowth > 10 || nodeChange < 0 || blockedCount > 1;
    
    if (shouldAlert) {
      const alert = {
        timestamp: Date.now(),
        severity: jobGrowth > 20 ? 'critical' : 'warning',
        message: `Capacity alert: ${current.totalPendingJobs} jobs pending, ${current.activeNodes} nodes active`,
        details: {
          jobGrowth,
          nodeChange,
          blockedCount
        }
      };
      
      // Write alert file for other monitoring systems
      fs.writeFileSync('./capacity-trend-alert.json', JSON.stringify(alert, null, 2));
      console.log(`🚨 Alert generated: ${alert.severity.toUpperCase()} - ${alert.message}`);
      return alert;
    }
    
    return null;
  }
}

// Command line interface
async function main() {
  const monitor = new CapacityTrendMonitor();
  const args = process.argv.slice(2);
  
  if (args.includes('--log')) {
    await monitor.logCapacitySnapshot();
  } else if (args.includes('--alert')) {
    monitor.generateAlert();
  } else if (args.includes('--trend')) {
    const hours = args.includes('--hours') ? parseInt(args[args.indexOf('--hours') + 1]) || 24 : 24;
    monitor.generateTrendReport(hours);
  } else {
    // Default: log snapshot and show recent trend
    await monitor.logCapacitySnapshot();
    console.log('');
    monitor.generateTrendReport(6); // Last 6 hours
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = CapacityTrendMonitor;