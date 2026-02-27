#!/usr/bin/env node

/**
 * Regenerative Network Health Monitor
 * 
 * Monitors the Intelligence Club Mesh using biological health indicators
 * inspired by Korean Natural Farming and ecosystem health principles.
 * 
 * Usage:
 *   node scripts/regenerative-health-monitor.js [--detailed] [--bioregion=name]
 */

const fs = require('fs').promises;
const path = require('path');
const { performance } = require('perf_hooks');

class RegenerativeHealthMonitor {
  constructor() {
    this.startTime = performance.now();
    this.healthMetrics = {
      diversity: 0,
      activity: 0,
      resilience: 0,
      circulation: 0,
      adaptation: 0,
      cooperation: 0,
      regeneration: 0
    };
    this.bioregionalData = new Map();
    this.alerts = [];
  }

  /**
   * Main health assessment - like testing soil health
   */
  async assessNetworkHealth(options = {}) {
    console.log('🌱 Regenerative Network Health Assessment');
    console.log('━'.repeat(50));
    
    try {
      // Collect network data
      const networkData = await this.collectNetworkData();
      
      // Run health assessments
      await this.assessDiversity(networkData);
      await this.assessActivity(networkData);
      await this.assessResilience(networkData);
      await this.assessValueCirculation(networkData);
      await this.assessLocalAdaptation(networkData);
      await this.assessCooperation(networkData);
      await this.assessRegeneration(networkData);
      
      // Calculate overall health score
      const overallHealth = this.calculateOverallHealth();
      
      // Generate report
      this.generateHealthReport(overallHealth, options);
      
      // Check for critical issues
      this.checkForCriticalIssues();
      
      return {
        health: overallHealth,
        metrics: this.healthMetrics,
        alerts: this.alerts,
        recommendations: this.generateRecommendations()
      };
      
    } catch (error) {
      console.error('🚨 Error assessing network health:', error.message);
      return { error: error.message };
    }
  }

  /**
   * Assess network diversity - like measuring biodiversity
   */
  async assessDiversity(networkData) {
    const diversity = {
      nodeTypes: new Set(),
      capabilities: new Set(),
      bioregions: new Set(),
      workloadTypes: new Set()
    };

    // Count different types of nodes and capabilities
    networkData.nodes.forEach(node => {
      diversity.nodeTypes.add(node.type);
      diversity.bioregions.add(node.bioregion || 'unknown');
      
      if (node.capabilities) {
        node.capabilities.forEach(cap => diversity.capabilities.add(cap));
      }
    });

    networkData.jobs.forEach(job => {
      diversity.workloadTypes.add(job.type);
    });

    // Calculate diversity index (similar to Shannon diversity)
    const totalElements = diversity.nodeTypes.size + diversity.capabilities.size + 
                         diversity.bioregions.size + diversity.workloadTypes.size;
    
    this.healthMetrics.diversity = Math.min(100, (totalElements / 20) * 100); // Assume 20+ is excellent diversity

    console.log(`🌿 Diversity Score: ${this.healthMetrics.diversity.toFixed(1)}/100`);
    console.log(`   Node Types: ${diversity.nodeTypes.size}`);
    console.log(`   Capabilities: ${diversity.capabilities.size}`);
    console.log(`   Bioregions: ${diversity.bioregions.size}`);
    console.log(`   Workload Types: ${diversity.workloadTypes.size}`);

    if (this.healthMetrics.diversity < 40) {
      this.alerts.push({
        type: 'diversity',
        severity: 'warning',
        message: 'Low network diversity may reduce resilience',
        recommendation: 'Recruit nodes with different capabilities and from different regions'
      });
    }
  }

  /**
   * Assess network activity - like measuring soil biological activity
   */
  async assessActivity(networkData) {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * oneHour;

    // Count recent activity
    const recentJobs = networkData.jobs.filter(job => 
      (now - job.completed) < oneHour
    ).length;

    const dailyJobs = networkData.jobs.filter(job => 
      (now - job.completed) < oneDay
    ).length;

    const activeNodes = networkData.nodes.filter(node => 
      node.lastSeen && (now - node.lastSeen) < oneHour
    ).length;

    // Calculate activity score
    const jobActivityScore = Math.min(100, (recentJobs / networkData.nodes.length) * 100);
    const nodeActivityScore = (activeNodes / networkData.nodes.length) * 100;
    
    this.healthMetrics.activity = (jobActivityScore + nodeActivityScore) / 2;

    console.log(`🔄 Activity Score: ${this.healthMetrics.activity.toFixed(1)}/100`);
    console.log(`   Jobs (last hour): ${recentJobs}`);
    console.log(`   Jobs (last day): ${dailyJobs}`);
    console.log(`   Active nodes: ${activeNodes}/${networkData.nodes.length}`);

    if (this.healthMetrics.activity < 30) {
      this.alerts.push({
        type: 'activity',
        severity: 'warning',
        message: 'Low network activity detected',
        recommendation: 'Check for connectivity issues or promote network usage'
      });
    }
  }

  /**
   * Assess network resilience - like testing soil structure
   */
  async assessResilience(networkData) {
    // Count redundancy and connections
    const totalNodes = networkData.nodes.length;
    const connectedNodes = networkData.nodes.filter(node => 
      node.connections && node.connections.length > 0
    ).length;

    const averageConnections = networkData.nodes.reduce((sum, node) => 
      sum + (node.connections ? node.connections.length : 0), 0
    ) / totalNodes;

    // Check for single points of failure
    const criticalNodes = networkData.nodes.filter(node => 
      node.connections && node.connections.length > averageConnections * 2
    ).length;

    // Calculate resilience score
    const connectionScore = Math.min(100, (averageConnections / 5) * 100); // Assume 5+ connections is excellent
    const redundancyScore = Math.max(0, 100 - (criticalNodes / totalNodes * 100));
    
    this.healthMetrics.resilience = (connectionScore + redundancyScore) / 2;

    console.log(`🛡️  Resilience Score: ${this.healthMetrics.resilience.toFixed(1)}/100`);
    console.log(`   Connected nodes: ${connectedNodes}/${totalNodes}`);
    console.log(`   Avg connections: ${averageConnections.toFixed(1)}`);
    console.log(`   Critical nodes: ${criticalNodes}`);

    if (criticalNodes / totalNodes > 0.2) {
      this.alerts.push({
        type: 'resilience',
        severity: 'critical',
        message: 'High concentration of critical nodes creates single points of failure',
        recommendation: 'Distribute connections more evenly across the network'
      });
    }
  }

  /**
   * Assess value circulation - like measuring nutrient cycling
   */
  async assessValueCirculation(networkData) {
    const totalValue = networkData.jobs.reduce((sum, job) => sum + (job.value || 0), 0);
    const reinvestedValue = networkData.nodes.reduce((sum, node) => 
      sum + (node.reinvestedValue || 0), 0);

    const valueRetained = networkData.nodes.reduce((sum, node) => 
      sum + (node.accumulatedValue || 0), 0);

    // Calculate circulation efficiency
    const circulationRatio = totalValue > 0 ? (reinvestedValue / totalValue) * 100 : 0;
    const retentionRatio = totalValue > 0 ? (valueRetained / totalValue) * 100 : 0;
    
    // Healthy circulation should reinvest significant portion while retaining some
    const optimalCirculation = 60; // 60% circulation is healthy
    const circulationScore = Math.max(0, 100 - Math.abs(circulationRatio - optimalCirculation));
    
    this.healthMetrics.circulation = circulationScore;

    console.log(`💫 Value Circulation Score: ${this.healthMetrics.circulation.toFixed(1)}/100`);
    console.log(`   Total value generated: ${totalValue.toFixed(2)}`);
    console.log(`   Value reinvested: ${reinvestedValue.toFixed(2)} (${circulationRatio.toFixed(1)}%)`);
    console.log(`   Value retained by nodes: ${valueRetained.toFixed(2)} (${retentionRatio.toFixed(1)}%)`);

    if (circulationRatio < 30) {
      this.alerts.push({
        type: 'circulation',
        severity: 'warning',
        message: 'Low value circulation may limit network growth',
        recommendation: 'Implement incentives for value reinvestment in network improvements'
      });
    }
  }

  /**
   * Assess local adaptation - like measuring soil-plant relationships
   */
  async assessLocalAdaptation(networkData) {
    const bioregions = new Map();
    
    // Group nodes by bioregion
    networkData.nodes.forEach(node => {
      const region = node.bioregion || 'unknown';
      if (!bioregions.has(region)) {
        bioregions.set(region, { nodes: [], specializations: new Set() });
      }
      
      const regionData = bioregions.get(region);
      regionData.nodes.push(node);
      
      if (node.specializations) {
        node.specializations.forEach(spec => regionData.specializations.add(spec));
      }
    });

    // Calculate adaptation score based on regional specialization
    let totalAdaptationScore = 0;
    let regionCount = 0;

    for (const [region, data] of bioregions.entries()) {
      if (region === 'unknown') continue;
      
      regionCount++;
      const nodeCount = data.nodes.length;
      const specializationCount = data.specializations.size;
      
      // Well-adapted regions have specialized capabilities
      const regionAdaptation = Math.min(100, (specializationCount / Math.max(1, nodeCount)) * 100);
      totalAdaptationScore += regionAdaptation;
      
      this.bioregionalData.set(region, {
        nodeCount,
        specializations: Array.from(data.specializations),
        adaptationScore: regionAdaptation
      });
    }

    this.healthMetrics.adaptation = regionCount > 0 ? totalAdaptationScore / regionCount : 0;

    console.log(`🌍 Local Adaptation Score: ${this.healthMetrics.adaptation.toFixed(1)}/100`);
    console.log(`   Bioregions: ${regionCount}`);
    
    for (const [region, data] of this.bioregionalData.entries()) {
      console.log(`   ${region}: ${data.nodeCount} nodes, ${data.specializations.length} specializations`);
    }

    if (this.healthMetrics.adaptation < 50) {
      this.alerts.push({
        type: 'adaptation',
        severity: 'info',
        message: 'Low bioregional adaptation - opportunities for local specialization',
        recommendation: 'Encourage nodes to develop region-specific capabilities'
      });
    }
  }

  /**
   * Assess cooperation patterns - like measuring symbiotic relationships
   */
  async assessCooperation(networkData) {
    const cooperativeJobs = networkData.jobs.filter(job => 
      job.collaboratingNodes && job.collaboratingNodes.length > 1
    );

    const soloJobs = networkData.jobs.filter(job => 
      !job.collaboratingNodes || job.collaboratingNodes.length <= 1
    );

    const cooperationRatio = networkData.jobs.length > 0 ? 
      (cooperativeJobs.length / networkData.jobs.length) * 100 : 0;

    // Measure success rates of cooperative vs solo work
    const cooperativeSuccessRate = cooperativeJobs.length > 0 ?
      (cooperativeJobs.filter(job => job.success).length / cooperativeJobs.length) * 100 : 0;

    const soloSuccessRate = soloJobs.length > 0 ?
      (soloJobs.filter(job => job.success).length / soloJobs.length) * 100 : 0;

    // Healthy networks show benefits from cooperation
    const cooperationBenefit = cooperativeSuccessRate - soloSuccessRate;
    
    this.healthMetrics.cooperation = Math.max(0, Math.min(100, 
      (cooperationRatio * 0.7) + (Math.max(0, cooperationBenefit) * 0.3)
    ));

    console.log(`🤝 Cooperation Score: ${this.healthMetrics.cooperation.toFixed(1)}/100`);
    console.log(`   Cooperative jobs: ${cooperativeJobs.length} (${cooperationRatio.toFixed(1)}%)`);
    console.log(`   Cooperative success rate: ${cooperativeSuccessRate.toFixed(1)}%`);
    console.log(`   Solo success rate: ${soloSuccessRate.toFixed(1)}%`);
    console.log(`   Cooperation benefit: ${cooperationBenefit.toFixed(1)}%`);

    if (cooperationRatio < 20) {
      this.alerts.push({
        type: 'cooperation',
        severity: 'info',
        message: 'Low cooperation levels - network may benefit from more collaborative work',
        recommendation: 'Create incentives for nodes to collaborate on complex tasks'
      });
    }
  }

  /**
   * Assess regeneration - like measuring soil health improvement over time
   */
  async assessRegeneration(networkData) {
    // Compare current state to historical data
    const historicalData = await this.loadHistoricalData();
    
    if (!historicalData || historicalData.length < 2) {
      this.healthMetrics.regeneration = 50; // Neutral when no history
      console.log(`🌱 Regeneration Score: 50/100 (insufficient historical data)`);
      return;
    }

    // Calculate trends over time
    const latest = historicalData[historicalData.length - 1];
    const previous = historicalData[historicalData.length - 2];

    const improvements = {
      nodeGrowth: (networkData.nodes.length - previous.nodeCount) / previous.nodeCount,
      activityGrowth: (this.healthMetrics.activity - previous.activity) / previous.activity,
      diversityGrowth: (this.healthMetrics.diversity - previous.diversity) / previous.diversity,
      valueGrowth: (networkData.totalValue - previous.totalValue) / previous.totalValue
    };

    // Calculate regeneration score based on positive trends
    const improvementScore = Object.values(improvements).reduce((sum, improvement) => {
      return sum + Math.max(0, Math.min(25, improvement * 100));
    }, 0);

    this.healthMetrics.regeneration = improvementScore;

    console.log(`🌱 Regeneration Score: ${this.healthMetrics.regeneration.toFixed(1)}/100`);
    console.log(`   Node growth: ${(improvements.nodeGrowth * 100).toFixed(1)}%`);
    console.log(`   Activity trend: ${(improvements.activityGrowth * 100).toFixed(1)}%`);
    console.log(`   Diversity trend: ${(improvements.diversityGrowth * 100).toFixed(1)}%`);
    console.log(`   Value trend: ${(improvements.valueGrowth * 100).toFixed(1)}%`);
  }

  /**
   * Calculate overall health score
   */
  calculateOverallHealth() {
    const weights = {
      diversity: 0.15,
      activity: 0.15,
      resilience: 0.20,
      circulation: 0.15,
      adaptation: 0.10,
      cooperation: 0.10,
      regeneration: 0.15
    };

    const weightedScore = Object.entries(this.healthMetrics).reduce((sum, [metric, score]) => {
      return sum + (score * (weights[metric] || 0));
    }, 0);

    return Math.round(weightedScore);
  }

  /**
   * Generate health report
   */
  generateHealthReport(overallHealth, options) {
    console.log('\n' + '━'.repeat(50));
    console.log('📊 NETWORK HEALTH SUMMARY');
    console.log('━'.repeat(50));

    // Health level interpretation
    let healthLevel, emoji;
    if (overallHealth >= 80) {
      healthLevel = 'Thriving';
      emoji = '🌳';
    } else if (overallHealth >= 60) {
      healthLevel = 'Healthy';
      emoji = '🌿';
    } else if (overallHealth >= 40) {
      healthLevel = 'Stable';
      emoji = '🌱';
    } else if (overallHealth >= 20) {
      healthLevel = 'Struggling';
      emoji = '🥀';
    } else {
      healthLevel = 'Critical';
      emoji = '🚨';
    }

    console.log(`${emoji} Overall Health: ${overallHealth}/100 (${healthLevel})`);
    console.log('');

    // Detailed metrics if requested
    if (options.detailed) {
      console.log('Detailed Metrics:');
      Object.entries(this.healthMetrics).forEach(([metric, score]) => {
        const bar = '█'.repeat(Math.floor(score / 5)) + '░'.repeat(20 - Math.floor(score / 5));
        console.log(`  ${metric.padEnd(12)}: ${score.toFixed(1).padStart(5)}/100 ${bar}`);
      });
      console.log('');
    }

    // Show alerts
    if (this.alerts.length > 0) {
      console.log('⚠️  Alerts:');
      this.alerts.forEach(alert => {
        const severityEmoji = {
          critical: '🚨',
          warning: '⚠️',
          info: 'ℹ️'
        };
        console.log(`  ${severityEmoji[alert.severity]} ${alert.message}`);
      });
    }

    console.log('\n⏱️  Assessment completed in', 
      `${((performance.now() - this.startTime) / 1000).toFixed(2)}s`);
  }

  /**
   * Check for critical issues that need immediate attention
   */
  checkForCriticalIssues() {
    const criticalAlerts = this.alerts.filter(alert => alert.severity === 'critical');
    
    if (criticalAlerts.length > 0) {
      console.log('\n🚨 CRITICAL ISSUES DETECTED:');
      criticalAlerts.forEach(alert => {
        console.log(`   ${alert.message}`);
        console.log(`   Recommendation: ${alert.recommendation}`);
      });
    }
  }

  /**
   * Generate actionable recommendations
   */
  generateRecommendations() {
    const recommendations = [];

    // Add recommendations based on metrics
    if (this.healthMetrics.diversity < 50) {
      recommendations.push('Recruit nodes with diverse capabilities and from different geographic regions');
    }

    if (this.healthMetrics.resilience < 60) {
      recommendations.push('Improve network redundancy by encouraging more inter-node connections');
    }

    if (this.healthMetrics.circulation < 50) {
      recommendations.push('Create mechanisms for value reinvestment in network improvements');
    }

    if (this.healthMetrics.cooperation < 40) {
      recommendations.push('Design incentives for collaborative problem-solving');
    }

    return recommendations;
  }

  /**
   * Collect network data (mock implementation)
   * In real implementation, this would query the actual mesh network
   */
  async collectNetworkData() {
    // This would connect to the actual IC Mesh network
    // For now, we'll create sample data structure
    return {
      nodes: [
        { 
          id: 'node1', 
          type: 'computational', 
          capabilities: ['machine-learning', 'data-processing'],
          bioregion: 'pacific-northwest',
          connections: ['node2', 'node3'],
          lastSeen: Date.now() - 30000,
          reinvestedValue: 15.50,
          accumulatedValue: 125.75,
          specializations: ['climate-modeling']
        }
        // ... more nodes would be loaded from actual network
      ],
      jobs: [
        {
          id: 'job1',
          type: 'transcription',
          completed: Date.now() - 15000,
          value: 2.50,
          success: true,
          collaboratingNodes: ['node1']
        }
        // ... more jobs would be loaded from actual network
      ],
      totalValue: 1250.00
    };
  }

  /**
   * Load historical health data
   */
  async loadHistoricalData() {
    try {
      const dataPath = path.join(__dirname, '../data/health-history.json');
      const data = await fs.readFile(dataPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      // No historical data yet
      return null;
    }
  }

  /**
   * Save current health snapshot for historical tracking
   */
  async saveHealthSnapshot() {
    const snapshot = {
      timestamp: Date.now(),
      ...this.healthMetrics,
      nodeCount: (await this.collectNetworkData()).nodes.length,
      totalValue: (await this.collectNetworkData()).totalValue
    };

    try {
      const dataPath = path.join(__dirname, '../data/health-history.json');
      let history = [];
      
      try {
        const existingData = await fs.readFile(dataPath, 'utf8');
        history = JSON.parse(existingData);
      } catch (error) {
        // File doesn't exist yet, start fresh
      }

      history.push(snapshot);
      
      // Keep only last 30 snapshots
      if (history.length > 30) {
        history = history.slice(-30);
      }

      await fs.mkdir(path.dirname(dataPath), { recursive: true });
      await fs.writeFile(dataPath, JSON.stringify(history, null, 2));
      
    } catch (error) {
      console.warn('Could not save health snapshot:', error.message);
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options = {
    detailed: args.includes('--detailed'),
    bioregion: args.find(arg => arg.startsWith('--bioregion='))?.split('=')[1]
  };

  const monitor = new RegenerativeHealthMonitor();
  const results = await monitor.assessNetworkHealth(options);
  
  // Save snapshot for historical tracking
  if (!results.error) {
    await monitor.saveHealthSnapshot();
  }

  // Exit with appropriate code
  if (results.error) {
    process.exit(1);
  } else if (results.alerts.some(alert => alert.severity === 'critical')) {
    process.exit(2);
  } else {
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Monitor failed:', error.message);
    process.exit(1);
  });
}

module.exports = RegenerativeHealthMonitor;