#!/usr/bin/env node

/**
 * OpenClaw Earnings Report - Monitor your IC Mesh income
 * 
 * Shows earnings, job completion stats, and projections
 * for OpenClaw operators participating in IC Mesh
 */

const fs = require('fs');
const axios = require('axios').default;

// Load configuration
let config;
try {
  config = JSON.parse(fs.readFileSync('node-config.json', 'utf8'));
} catch (error) {
  console.error('❌ Cannot load node-config.json');
  console.error('Run: cp node-config.example.json node-config.json');
  process.exit(1);
}

async function getNodeStats() {
  try {
    const response = await axios.get(`${config.serverUrl}/api/nodes/stats`, {
      params: { nodeId: config.nodeId },
      timeout: 5000
    });
    return response.data;
  } catch (error) {
    throw new Error(`Cannot fetch stats from ${config.serverUrl}: ${error.message}`);
  }
}

async function getJobHistory() {
  try {
    const response = await axios.get(`${config.serverUrl}/api/jobs/history`, {
      params: { 
        nodeId: config.nodeId,
        limit: 100 
      },
      timeout: 5000
    });
    return response.data.jobs || [];
  } catch (error) {
    // Non-critical - return empty if endpoint doesn't exist yet
    return [];
  }
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

async function main() {
  console.log('🤝 OpenClaw IC Mesh Earnings Report');
  console.log(`📍 Node: ${config.nodeId}\n`);
  
  try {
    // Get current stats
    const stats = await getNodeStats();
    const jobHistory = await getJobHistory();
    
    // Calculate earnings
    const totalJobs = stats.jobsCompleted || 0;
    const totalEarnings = stats.totalEarnings || 0;
    const todayEarnings = stats.todayEarnings || 0;
    const weekEarnings = stats.weekEarnings || 0;
    
    // Basic stats
    console.log('💰 Earnings Summary');
    console.log('━'.repeat(40));
    console.log(`Today:          ${formatCurrency(todayEarnings)}`);
    console.log(`This Week:      ${formatCurrency(weekEarnings)}`);
    console.log(`Total:          ${formatCurrency(totalEarnings)}`);
    console.log(`Jobs Completed: ${totalJobs}`);
    
    if (totalJobs > 0) {
      console.log(`Avg per Job:    ${formatCurrency(totalEarnings / totalJobs)}`);
    }
    
    // Node performance
    console.log('\n🖥️  Node Performance');
    console.log('━'.repeat(40));
    console.log(`Status:         ${stats.status || 'Online'}`);
    console.log(`Uptime:         ${formatDuration(stats.uptimeSeconds || 0)}`);
    console.log(`Success Rate:   ${Math.round((stats.successfulJobs / totalJobs) * 100) || 0}%`);
    console.log(`Capabilities:   ${config.capabilities.join(', ')}`);
    
    // Recent activity (if available)
    if (jobHistory.length > 0) {
      console.log('\n📊 Recent Jobs');
      console.log('━'.repeat(40));
      
      const recent = jobHistory.slice(0, 5);
      for (const job of recent) {
        const status = job.status === 'completed' ? '✅' : job.status === 'failed' ? '❌' : '🔄';
        const earnings = job.earnings ? formatCurrency(job.earnings) : '$0.00';
        const time = new Date(job.completedAt || job.createdAt).toLocaleTimeString();
        
        console.log(`${status} ${job.type.padEnd(15)} ${earnings.padStart(8)} ${time}`);
      }
      
      if (jobHistory.length > 5) {
        console.log(`   ... and ${jobHistory.length - 5} more`);
      }
    }
    
    // Earnings breakdown by job type
    const jobTypes = {};
    for (const job of jobHistory) {
      if (job.status === 'completed' && job.earnings) {
        if (!jobTypes[job.type]) {
          jobTypes[job.type] = { count: 0, earnings: 0 };
        }
        jobTypes[job.type].count++;
        jobTypes[job.type].earnings += job.earnings;
      }
    }
    
    if (Object.keys(jobTypes).length > 0) {
      console.log('\n💼 Earnings by Job Type');
      console.log('━'.repeat(40));
      
      for (const [type, data] of Object.entries(jobTypes)) {
        const avg = data.earnings / data.count;
        console.log(`${type.padEnd(15)} ${data.count.toString().padStart(3)} jobs  ${formatCurrency(data.earnings).padStart(8)}  (avg: ${formatCurrency(avg)})`);
      }
    }
    
    // Projections
    const hoursOnline = (stats.uptimeSeconds || 0) / 3600;
    if (hoursOnline > 1 && totalEarnings > 0) {
      console.log('\n📈 Earnings Projections');
      console.log('━'.repeat(40));
      
      const hourlyRate = totalEarnings / hoursOnline;
      const dailyProjection = hourlyRate * 24;
      const monthlyProjection = dailyProjection * 30;
      
      console.log(`Hourly Rate:    ${formatCurrency(hourlyRate)}`);
      console.log(`Daily (24/7):   ${formatCurrency(dailyProjection)}`);
      console.log(`Monthly (24/7): ${formatCurrency(monthlyProjection)}`);
      
      // Realistic projections (assuming 50% uptime)
      console.log('\nRealistic (12h/day):');
      console.log(`Daily:          ${formatCurrency(dailyProjection * 0.5)}`);
      console.log(`Monthly:        ${formatCurrency(monthlyProjection * 0.5)}`);
    }
    
    // Tips for earning more
    console.log('\n💡 Tips to Increase Earnings');
    console.log('━'.repeat(40));
    
    if (config.capabilities.length < 3) {
      console.log('• Add more capabilities (transcribe, ollama, stable-diffusion)');
    }
    
    if (!config.capabilities.includes('gpu-metal') && !config.capabilities.includes('gpu-cuda')) {
      console.log('• Enable GPU capabilities for 5-10x higher rates');
    }
    
    if (stats.uptimePercentage < 90) {
      console.log('• Improve uptime - reliable nodes get priority');
    }
    
    if (stats.successfulJobs < stats.totalJobs * 0.95) {
      console.log('• Debug job failures to improve success rate');
    }
    
    console.log('• Join during peak hours (US business hours)');
    console.log('• Monitor #ic-mesh Discord for high-demand periods');
    
    // Cashout info
    if (totalEarnings >= 5) {
      console.log('\n💸 Ready to Cash Out!');
      console.log('━'.repeat(40));
      console.log('You have enough to cash out (minimum $5)');
      console.log('Visit: https://moilol.com/account');
      console.log('Link your bank account via Stripe Connect');
    } else if (totalEarnings > 0) {
      const needed = 5 - totalEarnings;
      console.log(`\n💰 ${formatCurrency(needed)} more to cash out (minimum $5)`);
    }
    
  } catch (error) {
    console.error('❌ Error fetching earnings data:', error.message);
    console.error('\nTroubleshooting:');
    console.error('• Check your internet connection');
    console.error('• Verify serverUrl in node-config.json');
    console.error('• Make sure your node is registered on the network');
    process.exit(1);
  }
}

// Handle CLI arguments
if (process.argv.includes('--json')) {
  // JSON output for scripts/automation
  getNodeStats()
    .then(stats => {
      console.log(JSON.stringify(stats, null, 2));
    })
    .catch(error => {
      console.error(JSON.stringify({ error: error.message }));
      process.exit(1);
    });
} else {
  main();
}