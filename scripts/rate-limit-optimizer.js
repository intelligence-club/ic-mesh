#!/usr/bin/env node
/**
 * Rate Limit Optimizer — Intelligent Rate Limit Adjustment
 * 
 * Analyzes traffic patterns and automatically suggests or applies
 * optimized rate limiting configurations. Uses machine learning-like
 * approaches to balance security with usability.
 * 
 * Usage:
 *   node scripts/rate-limit-optimizer.js              # Analyze and suggest
 *   node scripts/rate-limit-optimizer.js --apply      # Apply optimizations
 *   node scripts/rate-limit-optimizer.js --safe       # Conservative optimization
 *   node scripts/rate-limit-optimizer.js --aggressive # Aggressive optimization
 */

const fs = require('fs');
const path = require('path');
const EnhancedRateLimiter = require('../lib/enhanced-rate-limit');

class RateLimitOptimizer {
  constructor(options = {}) {
    this.limiter = new EnhancedRateLimiter({
      whitelistFile: './config/rate-limit-whitelist.json',
      logFile: './logs/rate-limits.log',
      enableLogging: true
    });

    this.mode = options.mode || 'suggest'; // suggest, safe, aggressive
    this.configFile = options.configFile || './config/optimized-rate-limits.json';
    this.backupFile = './config/rate-limits-backup.json';
  }

  /**
   * Analyze traffic patterns and generate optimization recommendations
   */
  async analyzeAndOptimize() {
    console.log('🔍 Analyzing traffic patterns...\n');
    
    const analysis = this.limiter.analyzePatterns();
    if (analysis.error) {
      console.log('❌ Error:', analysis.error);
      return null;
    }

    const currentLimits = this.limiter.limits;
    const optimizations = this.generateOptimizations(analysis, currentLimits);

    console.log('📊 OPTIMIZATION ANALYSIS');
    console.log('========================\n');

    console.log(`📈 Data Points: ${analysis.totalAnalyzed} requests analyzed`);
    console.log(`🚫 Rate Limiting: ${analysis.rateLimitEvents} events (${(analysis.rateLimitEvents / analysis.totalAnalyzed * 100).toFixed(2)}%)`);
    console.log(`🛡️  Whitelisted: ${analysis.whitelistBypasses} bypasses\n`);

    return { analysis, optimizations, currentLimits };
  }

  generateOptimizations(analysis, currentLimits) {
    const optimizations = {};
    const groupStats = this.calculateGroupStatistics(analysis);

    // Analyze each endpoint group
    Object.entries(currentLimits).forEach(([group, currentLimit]) => {
      const stats = groupStats[group] || { violations: 0, totalRequests: 0 };
      const violationRate = stats.totalRequests > 0 ? stats.violations / stats.totalRequests : 0;
      
      let recommendation = this.generateGroupRecommendation(group, currentLimit, violationRate, stats);
      
      if (recommendation) {
        optimizations[group] = recommendation;
      }
    });

    // Check for groups that might need limits
    analysis.topRateLimitedGroups?.forEach(([group, violations]) => {
      if (!currentLimits[group] && violations > 5) {
        optimizations[group] = {
          current: currentLimits.default,
          recommended: this.calculateRecommendedLimit(violations, 'new_group'),
          reason: 'New endpoint group with significant rate limiting',
          confidence: 'medium',
          action: 'add_limit'
        };
      }
    });

    return optimizations;
  }

  generateGroupRecommendation(group, currentLimit, violationRate, stats) {
    let recommended = currentLimit;
    let reason = 'No changes needed';
    let confidence = 'high';
    let action = 'maintain';

    // High violation rate - increase limit
    if (violationRate > 0.15) { // >15% violation rate
      recommended = this.calculateIncreasedLimit(currentLimit, violationRate);
      reason = `High violation rate (${(violationRate * 100).toFixed(1)}%) - increase limit`;
      confidence = violationRate > 0.3 ? 'high' : 'medium';
      action = 'increase';
    }
    // Very low violation rate - might decrease limit for security
    else if (violationRate < 0.01 && stats.violations === 0 && this.mode === 'aggressive') {
      recommended = Math.max(10, Math.floor(currentLimit * 0.8));
      reason = 'No violations detected - can decrease for better security';
      confidence = 'low';
      action = 'decrease';
    }
    // Specific group optimizations
    else if (group === 'health' && violationRate > 0.05) {
      recommended = currentLimit * 2; // Health checks should be more lenient
      reason = 'Health endpoint needs more frequent access';
      confidence = 'high';
      action = 'increase';
    }

    // Don't recommend changes if they're minimal
    if (Math.abs(recommended - currentLimit) < 3) {
      return null;
    }

    return {
      current: currentLimit,
      recommended: Math.round(recommended),
      reason,
      confidence,
      action,
      violationRate: (violationRate * 100).toFixed(2) + '%',
      violations: stats.violations
    };
  }

  calculateGroupStatistics(analysis) {
    const stats = {};
    
    // Initialize stats for known groups
    Object.keys(this.limiter.limits).forEach(group => {
      stats[group] = { violations: 0, totalRequests: 0 };
    });

    // Count violations by group
    if (analysis.topRateLimitedGroups) {
      analysis.topRateLimitedGroups.forEach(([group, violations]) => {
        if (!stats[group]) stats[group] = { violations: 0, totalRequests: 0 };
        stats[group].violations = violations;
      });
    }

    // Estimate total requests (this is an approximation)
    // In a real implementation, you'd track this more precisely
    const totalAnalyzed = analysis.totalAnalyzed;
    const groupCount = Object.keys(stats).length;
    
    Object.keys(stats).forEach(group => {
      // Rough estimate - distribute total requests among groups
      stats[group].totalRequests = Math.floor(totalAnalyzed / groupCount);
    });

    return stats;
  }

  calculateIncreasedLimit(currentLimit, violationRate) {
    // Increase limit based on violation rate
    if (violationRate > 0.5) return currentLimit * 3; // 50%+ violations - triple
    if (violationRate > 0.3) return currentLimit * 2.5; // 30%+ violations - 2.5x
    if (violationRate > 0.2) return currentLimit * 2; // 20%+ violations - double
    return currentLimit * 1.5; // 15%+ violations - 1.5x
  }

  calculateRecommendedLimit(violations, context = 'standard') {
    // Calculate a reasonable limit based on violation count
    if (context === 'new_group') {
      return Math.max(20, violations * 2); // Start conservative for new groups
    }
    return Math.max(10, violations * 1.5);
  }

  displayOptimizations(optimizations) {
    console.log('💡 OPTIMIZATION RECOMMENDATIONS');
    console.log('================================\n');

    if (Object.keys(optimizations).length === 0) {
      console.log('✅ No optimizations needed - current limits appear optimal!\n');
      return;
    }

    Object.entries(optimizations).forEach(([group, opt]) => {
      const actionIcon = {
        'increase': '📈',
        'decrease': '📉',
        'add_limit': '➕',
        'maintain': '➡️'
      }[opt.action] || '🔧';

      const confidenceIcon = {
        'high': '🟢',
        'medium': '🟡',
        'low': '🔴'
      }[opt.confidence] || '⚪';

      console.log(`${actionIcon} ${group.toUpperCase()}`);
      console.log(`   Current: ${opt.current}/min`);
      console.log(`   Recommended: ${opt.recommended}/min`);
      console.log(`   Confidence: ${confidenceIcon} ${opt.confidence}`);
      console.log(`   Reason: ${opt.reason}`);
      if (opt.violations > 0) {
        console.log(`   Violations: ${opt.violations} (${opt.violationRate})`);
      }
      console.log();
    });
  }

  async applyOptimizations(optimizations, mode = 'safe') {
    console.log(`🔧 Applying optimizations in ${mode.toUpperCase()} mode...\n`);

    // Backup current configuration
    await this.backupCurrentConfig();

    const appliedChanges = {};
    
    Object.entries(optimizations).forEach(([group, opt]) => {
      // In safe mode, only apply high-confidence increases
      if (mode === 'safe' && (opt.confidence !== 'high' || opt.action !== 'increase')) {
        console.log(`⏭️  Skipping ${group}: ${opt.reason} (${mode} mode)`);
        return;
      }

      // In aggressive mode, apply all recommendations
      // In suggest mode, don't apply anything
      if (mode === 'suggest') {
        return;
      }

      appliedChanges[group] = {
        old: opt.current,
        new: opt.recommended,
        reason: opt.reason
      };

      console.log(`✅ Updated ${group}: ${opt.current} → ${opt.recommended}/min`);
    });

    if (Object.keys(appliedChanges).length === 0) {
      console.log('ℹ️  No changes applied based on current mode and confidence levels');
      return null;
    }

    // Save optimized configuration
    const optimizedConfig = {
      ...this.limiter.limits,
      ...Object.fromEntries(
        Object.entries(appliedChanges).map(([group, change]) => [group, change.new])
      )
    };

    await this.saveOptimizedConfig(optimizedConfig, appliedChanges);
    
    console.log(`\n📁 Configuration saved to: ${this.configFile}`);
    console.log(`📁 Backup saved to: ${this.backupFile}`);
    
    return appliedChanges;
  }

  async backupCurrentConfig() {
    const backup = {
      timestamp: new Date().toISOString(),
      limits: this.limiter.limits,
      whitelist: this.limiter.whitelist
    };

    const backupDir = path.dirname(this.backupFile);
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    fs.writeFileSync(this.backupFile, JSON.stringify(backup, null, 2));
    console.log(`💾 Configuration backed up to ${this.backupFile}`);
  }

  async saveOptimizedConfig(optimizedConfig, changes) {
    const config = {
      timestamp: new Date().toISOString(),
      mode: this.mode,
      limits: optimizedConfig,
      changes: changes,
      instructions: 'To apply these limits, update your server configuration and restart'
    };

    const configDir = path.dirname(this.configFile);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2));
  }

  generateImplementationInstructions(optimizations) {
    console.log('📋 IMPLEMENTATION INSTRUCTIONS');
    console.log('==============================\n');

    console.log('To apply these optimizations:');
    console.log();
    console.log('1. 🔧 Update server configuration:');
    console.log('   Update the limits object in your rate limiter initialization');
    console.log();
    console.log('2. 📝 Example code changes:');
    console.log('   ```javascript');
    console.log('   const rateLimiter = new EnhancedRateLimiter({');
    console.log('     limits: {');
    
    Object.entries(optimizations).forEach(([group, opt]) => {
      console.log(`       ${group}: ${opt.recommended}, // was ${opt.current}`);
    });
    
    console.log('       // ... other limits');
    console.log('     }');
    console.log('   });');
    console.log('   ```');
    console.log();
    console.log('3. 🔄 Restart server to apply changes');
    console.log();
    console.log('4. 📊 Monitor results:');
    console.log('   Run this optimizer again in 24-48 hours to verify improvements');
    console.log();
    console.log('5. 📁 Configuration files created:');
    console.log(`   • Optimized config: ${this.configFile}`);
    console.log(`   • Backup: ${this.backupFile}`);
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  
  let mode = 'suggest';
  if (args.includes('--apply')) mode = 'apply';
  if (args.includes('--safe')) mode = 'safe';
  if (args.includes('--aggressive')) mode = 'aggressive';

  const optimizer = new RateLimitOptimizer({ mode });
  
  console.log('🚀 IC Mesh Rate Limit Optimizer\n');

  try {
    const result = await optimizer.analyzeAndOptimize();
    
    if (!result) {
      console.log('❌ Unable to analyze traffic patterns. Ensure the server is running and has traffic history.');
      process.exit(1);
    }

    const { analysis, optimizations, currentLimits } = result;

    // Display current configuration
    console.log('⚙️  CURRENT CONFIGURATION');
    console.log('=========================');
    Object.entries(currentLimits).forEach(([group, limit]) => {
      console.log(`   ${group}: ${limit}/minute`);
    });
    console.log();

    // Display optimizations
    optimizer.displayOptimizations(optimizations);

    // Apply optimizations if requested
    if (mode === 'apply' || mode === 'safe' || mode === 'aggressive') {
      const applied = await optimizer.applyOptimizations(optimizations, mode);
      
      if (applied) {
        console.log('\n🎉 Optimizations applied successfully!');
        console.log('\n⚠️  Remember to restart your server to activate the new limits.');
      }
    } else {
      // Generate implementation instructions
      if (Object.keys(optimizations).length > 0) {
        console.log();
        optimizer.generateImplementationInstructions(optimizations);
        
        console.log('\n💡 Run with --apply to automatically save configuration files');
        console.log('   or --safe to apply only high-confidence increases');
      }
    }

  } catch (error) {
    console.error('❌ Optimization failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = RateLimitOptimizer;