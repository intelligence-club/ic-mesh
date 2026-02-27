#!/usr/bin/env node
/**
 * IC Mesh Retention Suite - Integrated Node Retention Tools
 * 
 * A comprehensive solution for addressing the 75% node churn rate through
 * automated onboarding, real-time monitoring, and proactive interventions.
 * 
 * This script provides a unified interface to all retention tools and 
 * automated workflows to maximize node success and network health.
 * 
 * Usage:
 *   ./retention-suite.js setup      # New operator complete setup
 *   ./retention-suite.js health     # Network retention health check
 *   ./retention-suite.js intervention # Automated intervention workflow  
 *   ./retention-suite.js insights   # Generate retention insights report
 */

const { execSync } = require('child_process');
const fs = require('fs');

class RetentionSuite {
  constructor() {
    this.tools = {
      onboard: './auto-onboard.js',
      retention: './node-retention-toolkit.js'
    };
  }

  // Complete new operator setup workflow
  runCompleteSetup() {
    console.log('🎯 IC Mesh Complete Node Setup Suite');
    console.log('═══════════════════════════════════\\n');

    console.log('This comprehensive setup will:');
    console.log('• Analyze your system capabilities');
    console.log('• Generate optimal configuration');
    console.log('• Set up automated onboarding');
    console.log('• Configure retention monitoring');
    console.log('• Provide earnings projections\\n');

    try {
      // Step 1: Automated onboarding
      console.log('🚀 Step 1: Running automated onboarding...');
      execSync(`node ${this.tools.onboard} new`, { stdio: 'inherit' });

      // Step 2: Initial health check
      console.log('\\n🔍 Step 2: Performing initial health check...');
      execSync(`node ${this.tools.retention} analyze`, { stdio: 'inherit' });

      console.log('\\n✅ Complete setup finished!');
      console.log('\\n📋 Next steps:');
      console.log('1. Start your node: node client.js');
      console.log('2. Monitor performance: ./retention-suite.js health');
      console.log('3. Get help if needed: ./retention-suite.js intervention');

    } catch (error) {
      console.log('\\n❌ Setup encountered an issue. Running diagnostics...');
      this.runDiagnostics();
    }
  }

  // Comprehensive network health check
  runHealthCheck() {
    console.log('📊 IC Mesh Network Retention Health Report');
    console.log('═════════════════════════════════════════\\n');

    try {
      // Current retention analysis
      console.log('🔍 Current Network State:');
      execSync(`node ${this.tools.retention} analyze`, { stdio: 'inherit' });

      console.log('\\n📈 Live Dashboard:');
      console.log('Starting real-time dashboard... (Ctrl+C to exit)\\n');
      execSync(`node ${this.tools.retention} dashboard`, { stdio: 'inherit' });

    } catch (error) {
      console.log('Health check failed. Running diagnostics...');
      this.runDiagnostics();
    }
  }

  // Automated intervention workflow
  runInterventionWorkflow() {
    console.log('🔧 Automated Retention Intervention Workflow');
    console.log('═══════════════════════════════════════════\\n');

    try {
      // Step 1: Identify at-risk nodes
      console.log('Step 1: Identifying at-risk nodes...');
      execSync(`node ${this.tools.retention} intervene`, { stdio: 'inherit' });

      // Step 2: Configuration validation for existing nodes  
      console.log('\\nStep 2: Validating node configurations...');
      execSync(`node ${this.tools.onboard} validate`, { stdio: 'inherit' });

      console.log('\\n✅ Intervention workflow complete!');
      console.log('Check the retention dashboard for real-time updates.');

    } catch (error) {
      console.log('\\nIntervention workflow encountered issues.');
      this.runDiagnostics();
    }
  }

  // Generate comprehensive insights report
  generateInsightsReport() {
    console.log('📈 IC Mesh Retention Insights Report');
    console.log('════════════════════════════════════\\n');

    const timestamp = new Date().toISOString().split('T')[0];
    const reportPath = `retention-report-${timestamp}.md`;

    try {
      // Gather data from all tools
      console.log('Gathering retention data...');
      
      const analysisOutput = execSync(`node ${this.tools.retention} analyze`, { encoding: 'utf8' });
      
      // Generate comprehensive report
      const report = this.generateMarkdownReport(analysisOutput);
      
      fs.writeFileSync(reportPath, report);
      console.log(`\\n📊 Report generated: ${reportPath}`);
      console.log('\\nKey insights:');
      console.log(analysisOutput);

    } catch (error) {
      console.log('Report generation failed.');
      this.runDiagnostics();
    }
  }

  generateMarkdownReport(analysisData) {
    const timestamp = new Date().toISOString();
    
    return `# IC Mesh Retention Report

**Generated:** ${timestamp}

## Executive Summary

${analysisData}

## Recommendations

Based on the analysis above, here are the key recommendations to improve retention:

### Immediate Actions
1. **Address churned nodes** - Follow up with nodes that disconnected recently
2. **Validate configurations** - Ensure all active nodes have optimal settings
3. **Monitor success patterns** - Replicate what works for successful nodes

### Strategic Improvements  
1. **Enhanced onboarding** - Use auto-onboard.js for new operators
2. **Proactive monitoring** - Regular health checks and interventions
3. **Success pattern analysis** - Study and replicate high-retention configurations

## Tools Used
- \`node-retention-toolkit.js\` - Comprehensive retention analysis
- \`auto-onboard.js\` - Automated onboarding system
- \`retention-suite.js\` - Integrated workflow management

## Next Review
Schedule next retention review in 7 days to track improvements.

---
*Generated by IC Mesh Retention Suite*`;
  }

  // Basic diagnostics for troubleshooting
  runDiagnostics() {
    console.log('\\n🔍 Running retention suite diagnostics...\\n');

    // Check if tools exist
    Object.entries(this.tools).forEach(([name, path]) => {
      if (fs.existsSync(path)) {
        console.log(`✅ ${name}: ${path} found`);
      } else {
        console.log(`❌ ${name}: ${path} missing`);
      }
    });

    // Check database
    if (fs.existsSync('./mesh.db')) {
      console.log('✅ Database: mesh.db found');
    } else {
      console.log('❌ Database: mesh.db missing - run npm run init-db');
    }

    // Check Node.js
    console.log(`✅ Node.js: ${process.version}`);

    // Basic system check
    const os = require('os');
    console.log(`✅ System: ${os.platform()}/${os.arch()}, ${os.cpus().length} CPUs`);

    console.log('\\n💡 If issues persist:');
    console.log('1. Ensure all retention tools are in place');
    console.log('2. Run: npm install');
    console.log('3. Check file permissions: chmod +x *.js');
    console.log('4. Verify database: ./manage-problematic-nodes.js --help');
  }
}

// CLI Interface
function main() {
  const suite = new RetentionSuite();
  const command = process.argv[2] || 'help';

  switch (command) {
    case 'setup':
      suite.runCompleteSetup();
      break;
    case 'health': 
      suite.runHealthCheck();
      break;
    case 'intervention':
      suite.runInterventionWorkflow();
      break;
    case 'insights':
      suite.generateInsightsReport();
      break;
    case 'diagnostics':
      suite.runDiagnostics();
      break;
    default:
      console.log('IC Mesh Retention Suite - Comprehensive Node Retention Solution\\n');
      console.log('Usage: ./retention-suite.js [command]\\n');
      console.log('Commands:');
      console.log('  setup        - Complete new operator setup (onboarding + config)');
      console.log('  health       - Network retention health check and dashboard');
      console.log('  intervention - Automated intervention for at-risk nodes');
      console.log('  insights     - Generate comprehensive retention insights report');
      console.log('  diagnostics  - Run system diagnostics for troubleshooting\\n');
      console.log('🎯 Start here if you\'re new: ./retention-suite.js setup');
      console.log('📊 Monitor network health: ./retention-suite.js health');
      console.log('🔧 Help struggling nodes: ./retention-suite.js intervention');
      console.log('\\n💡 These tools address the 75% node churn rate through:');
      console.log('   • Automated capability detection and configuration');
      console.log('   • Real-time monitoring and intervention');
      console.log('   • Success pattern analysis and replication');
      console.log('   • Comprehensive onboarding and support workflows');
  }
}

if (require.main === module) {
  main();
}

module.exports = RetentionSuite;