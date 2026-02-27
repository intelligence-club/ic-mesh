/**
 * User Feedback System
 * Provides real-time feedback and progress updates to users
 */

class UserFeedback {
  constructor() {
    this.lastUpdateTime = Date.now();
    this.stats = {
      jobsCompleted: 0,
      totalEarnings: 0,
      uptime: Date.now(),
      connectionStatus: 'connecting'
    };
  }

  updateConnectionStatus(status) {
    if (this.stats.connectionStatus !== status) {
      const statusMessages = {
        connected: '🟢 Connected to IC Mesh network',
        connecting: '🟡 Connecting to IC Mesh...',
        disconnected: '🔴 Disconnected from network',
        error: '❌ Connection error - retrying...'
      };
      
      console.log(`\n${statusMessages[status] || status}`);
      this.stats.connectionStatus = status;
    }
  }

  reportJobProgress(jobType, progress, details = '') {
    const progressBar = this.createProgressBar(progress, 30);
    const percentage = Math.round(progress * 100);
    
    process.stdout.write(`\r🔄 Processing ${jobType}: ${progressBar} ${percentage}% ${details}`);
    
    if (progress >= 1) {
      console.log(''); // New line when complete
    }
  }

  createProgressBar(progress, width = 20) {
    const filled = Math.round(progress * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  reportJobCompletion(jobId, jobType, earnings, duration) {
    this.stats.jobsCompleted++;
    this.stats.totalEarnings += earnings;
    
    const durationMs = Date.now() - duration;
    const durationStr = durationMs > 60000 ? 
      `${Math.round(durationMs/60000)}m` : 
      `${Math.round(durationMs/1000)}s`;
    
    console.log(`\n✅ Job completed: ${jobType}`);
    console.log(`   💰 Earned: ${earnings} ints`);
    console.log(`   ⏱️  Duration: ${durationStr}`);
    console.log(`   📊 Total: ${this.stats.jobsCompleted} jobs, ${this.stats.totalEarnings} ints`);
  }

  reportError(error, context, suggestion) {
    console.log(`\n❌ ${context}: ${error}`);
    if (suggestion) {
      console.log(`💡 Try: ${suggestion}`);
    }
  }

  showDailySummary() {
    const uptime = Date.now() - this.stats.uptime;
    const hours = Math.round(uptime / 3600000 * 10) / 10;
    const earningsPerHour = hours > 0 ? Math.round(this.stats.totalEarnings / hours * 100) / 100 : 0;
    
    console.log(`\n📈 Daily Summary:`);
    console.log(`   ⏰ Uptime: ${hours}h`);
    console.log(`   ✅ Jobs: ${this.stats.jobsCompleted}`);
    console.log(`   💰 Earnings: ${this.stats.totalEarnings} ints (${earningsPerHour}/h)`);
    console.log(`   💵 USD equivalent: $${(this.stats.totalEarnings/100).toFixed(2)}`);
    
    // Provide encouragement and tips
    if (this.stats.jobsCompleted === 0) {
      console.log(`\n💡 No jobs yet? Check your capabilities and network status.`);
    } else if (earningsPerHour < 1) {
      console.log(`\n🚀 Tip: Add more capabilities (Ollama, Whisper) to increase earnings.`);
    } else {
      console.log(`\n🎉 Great work! Keep your node online for consistent earnings.`);
    }
  }

  startPeriodicUpdates() {
    // Show summary every hour
    setInterval(() => {
      this.showDailySummary();
    }, 3600000);
    
    // Show mini-update every 15 minutes if active
    setInterval(() => {
      if (this.stats.connectionStatus === 'connected') {
        const uptime = Math.round((Date.now() - this.stats.uptime) / 60000);
        console.log(`\n💫 ${uptime}m online | ${this.stats.jobsCompleted} jobs | ${this.stats.totalEarnings} ints earned`);
      }
    }, 900000);
  }

  static createStartupMessage() {
    console.log('\n🌟 IC Mesh Node Starting...');
    console.log('==============================');
    console.log('💡 Tips:');
    console.log('   • Keep this window open to monitor progress');
    console.log('   • Check earnings at https://moilol.com/account');
    console.log('   • Press Ctrl+C to stop');
    console.log('');
  }
}

module.exports = UserFeedback;
