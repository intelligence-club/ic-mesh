#!/usr/bin/env node
/**
 * Capacity Optimizer - Intelligent job distribution and capacity planning
 * Analyzes network performance and suggests optimizations
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../mesh.db');

class CapacityOptimizer {
  constructor() {
    this.db = new sqlite3.Database(dbPath);
  }

  async analyzeCapacity() {
    console.log('🔍 IC Mesh Capacity Analysis\n');
    
    // Get current network state
    const nodes = await this.getNodes();
    const jobs = await this.getJobStats();
    const pending = await this.getPendingJobs();
    
    console.log('📊 Network Overview:');
    console.log(`  Active nodes: ${nodes.active.length}`);
    console.log(`  Total capacity: ${this.calculateTotalCapacity(nodes.active)} cores`);
    console.log(`  Pending jobs: ${pending.length}`);
    console.log(`  Processing rate: ${jobs.hourlyRate.toFixed(1)} jobs/hour\n`);
    
    // Capacity bottleneck analysis
    await this.analyzeBottlenecks(nodes, pending);
    
    // Capability gap analysis
    await this.analyzeCapabilityGaps(nodes.active, pending);
    
    // Performance recommendations
    await this.generateRecommendations(nodes, jobs, pending);
    
    this.db.close();
  }

  async getNodes() {
    return new Promise((resolve, reject) => {
      const now = Date.now();
      const fiveMinAgo = now - (5 * 60 * 1000);
      
      this.db.all(
        `SELECT nodeId, name, capabilities, cpuCores, ramMB, lastHeartbeat,
                jobsCompleted, computeMinutes
         FROM nodes 
         ORDER BY lastHeartbeat DESC`,
        (err, rows) => {
          if (err) reject(err);
          
          const active = rows.filter(n => n.lastHeartbeat > fiveMinAgo);
          const inactive = rows.filter(n => n.lastHeartbeat <= fiveMinAgo);
          
          resolve({ active, inactive, all: rows });
        }
      );
    });
  }

  async getJobStats() {
    return new Promise((resolve, reject) => {
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      
      this.db.all(
        `SELECT status, type, COUNT(*) as count,
                AVG(CASE WHEN completedAt IS NOT NULL THEN completedAt - createdAt ELSE NULL END) as avgDuration
         FROM jobs 
         WHERE createdAt > ? 
         GROUP BY status, type`,
        [oneHourAgo],
        (err, rows) => {
          if (err) reject(err);
          
          const completed = rows.filter(r => r.status === 'completed');
          const hourlyRate = completed.reduce((sum, r) => sum + r.count, 0);
          
          resolve({ hourlyRate, breakdown: rows });
        }
      );
    });
  }

  async getPendingJobs() {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT type, COUNT(*) as count, MIN(createdAt) as oldestJob
         FROM jobs 
         WHERE status = 'pending' 
         GROUP BY type`,
        (err, rows) => {
          if (err) reject(err);
          resolve(rows || []);
        }
      );
    });
  }

  calculateTotalCapacity(nodes) {
    return nodes.reduce((sum, node) => sum + (node.cpuCores || 1), 0);
  }

  async analyzeBottlenecks(nodes, pending) {
    console.log('🚨 Capacity Bottleneck Analysis:');
    
    if (nodes.active.length === 0) {
      console.log('  ❌ CRITICAL: No active nodes - zero processing capacity!');
      return;
    }
    
    if (pending.length === 0) {
      console.log('  ✅ No queue backlog - capacity is adequate');
      return;
    }
    
    const totalPendingJobs = pending.reduce((sum, p) => sum + p.count, 0);
    const avgCoresPerNode = this.calculateTotalCapacity(nodes.active) / nodes.active.length;
    
    // Estimate processing time based on job types
    let estimatedProcessingHours = 0;
    pending.forEach(p => {
      const timePerJob = this.getJobProcessingTime(p.type); // minutes
      estimatedProcessingHours += (p.count * timePerJob) / 60;
    });
    
    const parallelProcessingHours = estimatedProcessingHours / nodes.active.length;
    
    console.log(`  📋 ${totalPendingJobs} pending jobs across ${pending.length} types`);
    console.log(`  ⏱️  Estimated processing time: ${parallelProcessingHours.toFixed(1)}h with current capacity`);
    
    if (parallelProcessingHours > 2) {
      console.log('  ⚠️  HIGH BACKLOG: Consider adding nodes or investigating stalled jobs');
    } else if (parallelProcessingHours > 0.5) {
      console.log('  🟡 MODERATE BACKLOG: Monitor closely, may need scaling');
    } else {
      console.log('  ✅ MANAGEABLE BACKLOG: Current capacity should clear quickly');
    }
    
    console.log();
  }

  async analyzeCapabilityGaps(activeNodes, pending) {
    console.log('🎯 Capability Gap Analysis:');
    
    // Get capabilities from active nodes
    const availableCapabilities = new Set();
    activeNodes.forEach(node => {
      try {
        const caps = JSON.parse(node.capabilities || '[]');
        caps.forEach(cap => availableCapabilities.add(cap));
      } catch (e) {
        // Skip malformed capabilities
      }
    });
    
    console.log(`  Available capabilities: ${Array.from(availableCapabilities).join(', ') || 'none'}`);
    
    // Check if pending jobs have matching capabilities
    pending.forEach(p => {
      const needed = this.getRequiredCapability(p.type);
      const canProcess = availableCapabilities.has(needed);
      
      const status = canProcess ? '✅' : '❌';
      console.log(`  ${status} ${p.type} (${p.count} jobs) - needs '${needed}'`);
    });
    
    console.log();
  }

  async generateRecommendations(nodes, jobs, pending) {
    console.log('💡 Optimization Recommendations:\n');
    
    // Node scaling recommendations
    if (pending.length > 0 && nodes.active.length < 3) {
      console.log('🔄 **SCALING NEEDED:**');
      console.log('  • Recruit 2-3 additional operators to handle job variety');
      console.log('  • Focus on operators with GPU capabilities for transcription jobs');
      console.log('  • Consider node quarantine review - some capable nodes may be blocked\n');
    }
    
    // Performance optimization
    if (jobs.hourlyRate < 10 && pending.length > 20) {
      console.log('⚡ **PERFORMANCE OPTIMIZATION:**');
      console.log('  • Review job claiming logic - jobs may not be reaching capable nodes');
      console.log('  • Check for network connectivity issues');
      console.log('  • Verify node resource limits aren\'t too restrictive\n');
    }
    
    // Capability expansion
    const missingCapabilities = this.identifyMissingCapabilities(pending);
    if (missingCapabilities.length > 0) {
      console.log('🎯 **CAPABILITY EXPANSION:**');
      missingCapabilities.forEach(cap => {
        console.log(`  • Need operators with '${cap}' capability`);
      });
      console.log();
    }
    
    // Economic incentives
    if (nodes.active.length < 5) {
      console.log('💰 **ECONOMIC INCENTIVES:**');
      console.log('  • Early operator bonuses (2x rates) still active');
      console.log('  • Consider marketing push to OpenClaw community');
      console.log('  • Highlight earning potential in Reddit/Discord posts\n');
    }
    
    console.log('📊 **MONITORING:**');
    console.log('  • Run this analysis daily to track capacity trends');
    console.log('  • Monitor job completion rates vs new job submission rates');
    console.log('  • Set up alerts for >50 pending jobs or <2 active nodes');
  }

  getJobProcessingTime(jobType) {
    // Estimated processing time in minutes based on job type
    const times = {
      'transcribe': 2,    // Whisper is usually fast
      'ollama': 5,        // LLM inference varies
      'pdf-extract': 1,   // Usually quick
      'ocr': 3,          // Depends on image complexity
      'stable-diffusion': 15  // GPU intensive
    };
    return times[jobType] || 3; // Default 3 minutes
  }

  getRequiredCapability(jobType) {
    const mapping = {
      'transcribe': 'whisper',
      'ollama': 'ollama',
      'pdf-extract': 'pdf-extract',
      'ocr': 'ocr',
      'stable-diffusion': 'stable-diffusion'
    };
    return mapping[jobType] || jobType;
  }

  identifyMissingCapabilities(pending) {
    // This would need to be implemented based on actual network state
    // For now, return empty array
    return [];
  }
}

// CLI execution
if (require.main === module) {
  const optimizer = new CapacityOptimizer();
  optimizer.analyzeCapacity().catch(console.error);
}

module.exports = CapacityOptimizer;