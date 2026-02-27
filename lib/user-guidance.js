/**
 * User Guidance System
 * Provides contextual tips and guidance for common scenarios
 */

class UserGuidance {
  static getOnboardingTips() {
    return [
      {
        icon: '💡',
        title: 'Maximize Earnings',
        message: 'Install Ollama with popular models (llama3.1, mistral) for highest earning potential'
      },
      {
        icon: '🔄',
        title: 'Stay Online',
        message: 'Keep your node running 24/7 to capture jobs and build reputation'
      },
      {
        icon: '📊',
        title: 'Monitor Performance',
        message: 'Check your earnings at https://moilol.com/account regularly'
      },
      {
        icon: '🚀',
        title: 'GPU Boost',
        message: 'GPU acceleration can double your earnings from AI inference jobs'
      },
      {
        icon: '🔧',
        title: 'Capability Expansion',
        message: 'Add Whisper (transcription) and FFmpeg (media) for more job opportunities'
      }
    ];
  }

  static getPerformanceTips() {
    const os = require('os');
    const totalRAM = Math.round(os.totalmem() / 1024 / 1024 / 1024);
    const cpuCount = os.cpus().length;
    
    const tips = [];
    
    if (totalRAM < 8) {
      tips.push({
        icon: '💾',
        priority: 'high',
        message: 'Consider upgrading RAM to 8GB+ for better performance with AI models'
      });
    }
    
    if (cpuCount < 4) {
      tips.push({
        icon: '⚡',
        priority: 'medium',
        message: 'Multi-core CPU recommended for concurrent job processing'
      });
    }
    
    tips.push({
      icon: '🌐',
      priority: 'high',
      message: 'Ensure stable internet connection (broadband recommended)'
    });
    
    tips.push({
      icon: '🔋',
      priority: 'medium',
      message: 'Use wired connection and prevent system sleep for reliability'
    });
    
    return tips;
  }

  static showWelcomeMessage(nodeConfig) {
    console.log('\n🌟 Welcome to IC Mesh!');
    console.log('======================\n');
    
    if (nodeConfig?.node?.name) {
      console.log(`👋 Hello, ${nodeConfig.node.name}!`);
      console.log(`📧 Contact: ${nodeConfig.node.owner}`);
      console.log('');
    }
    
    const tips = this.getOnboardingTips();
    console.log('💡 Quick Tips for Success:');
    tips.forEach((tip, index) => {
      console.log(`   ${tip.icon} ${tip.title}: ${tip.message}`);
    });
    console.log('');
  }

  static showPerformanceAnalysis() {
    const tips = this.getPerformanceTips();
    const highPriority = tips.filter(tip => tip.priority === 'high');
    
    if (highPriority.length > 0) {
      console.log('⚡ Performance Recommendations:');
      highPriority.forEach(tip => {
        console.log(`   ${tip.icon} ${tip.message}`);
      });
      console.log('');
    }
  }

  static showQuickStart() {
    console.log('🚀 Quick Start Checklist:');
    console.log('   □ Install dependencies: npm install');
    console.log('   □ Configure node: node scripts/operator-setup.js');
    console.log('   □ Start earning: node scripts/smart-start.js');
    console.log('   □ Monitor progress: https://moilol.com/account');
    console.log('');
  }

  static showTroubleshootingHelp() {
    console.log('🔧 Common Issues & Solutions:');
    console.log('   • Connection problems → Check internet and firewall');
    console.log('   • No jobs received → Verify capabilities are enabled');
    console.log('   • Low earnings → Install more capabilities (Ollama, Whisper)');
    console.log('   • Performance issues → Close other applications, check RAM');
    console.log('');
    console.log('📖 Full documentation: https://github.com/intelligence-club/ic-mesh');
    console.log('');
  }
}

module.exports = UserGuidance;
