#!/usr/bin/env node
/**
 * System Dashboard - Comprehensive health overview for IC Mesh
 * Provides a single command to check all system metrics and status
 */

const fs = require('fs');
const { execSync } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../mesh.db');

class SystemDashboard {
  constructor() {
    this.db = new sqlite3.Database(dbPath);
  }

  async generateDashboard() {
    console.log('📊 IC Mesh System Dashboard');
    console.log('═'.repeat(50));
    console.log(`Generated: ${new Date().toISOString()}\n`);
    
    const [system, network, queue, financial, performance] = await Promise.all([
      this.getSystemMetrics(),
      this.getNetworkStatus(),
      this.getQueueStatus(),
      this.getFinancialMetrics(),
      this.getPerformanceMetrics()
    ]);
    
    this.displaySystemHealth(system);
    this.displayNetworkStatus(network);
    this.displayQueueStatus(queue);
    this.displayFinancialMetrics(financial);
    this.displayPerformanceMetrics(performance);
    
    this.db.close();
  }

  async getSystemMetrics() {
    const os = require('os');
    
    return {
      uptime: Math.floor(os.uptime() / 3600), // hours
      platform: `${os.platform()} ${os.arch()}`,
      nodeVersion: process.version,
      memory: {
        total: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10, // GB
        free: Math.round(os.freemem() / 1024 / 1024 / 1024 * 10) / 10,
        usage: Math.round((1 - os.freemem() / os.totalmem()) * 100)
      },
      cpu: {
        cores: os.cpus().length,
        model: os.cpus()[0].model.split(' ').slice(0, 3).join(' '), // Shortened
        loadAvg: os.loadavg().map(l => Math.round(l * 100) / 100)
      },
      disk: await this.getDiskUsage()
    };
  }

  async getDiskUsage() {
    try {
      const df = execSync('df -h .', { encoding: 'utf8' });
      const lines = df.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        return {
          total: parts[1],
          used: parts[2],
          available: parts[3],
          usage: parseInt(parts[4])
        };
      }
    } catch (e) {
      return { error: 'Unable to get disk usage' };
    }
    return {};
  }

  async getNetworkStatus() {
    return new Promise((resolve, reject) => {
      const fiveMinAgo = Date.now() - (5 * 60 * 1000);
      
      this.db.all(
        `SELECT 
           nodeId, name, capabilities, cpuCores, ramMB, 
           lastHeartbeat, jobsCompleted, computeMinutes,
           (? - lastHeartbeat) / 60000 as minutesAgo
         FROM nodes 
         ORDER BY lastHeartbeat DESC`,
        [Date.now()],
        (err, nodes) => {
          if (err) reject(err);
          
          const active = nodes.filter(n => n.minutesAgo < 5);
          const recent = nodes.filter(n => n.minutesAgo >= 5 && n.minutesAgo < 60);
          const inactive = nodes.filter(n => n.minutesAgo >= 60);
          
          // Capability analysis
          const capabilities = new Set();
          active.forEach(node => {
            try {
              const caps = JSON.parse(node.capabilities || '[]');
              caps.forEach(cap => capabilities.add(cap));
            } catch (e) {}
          });
          
          resolve({
            total: nodes.length,
            active: active.length,
            recent: recent.length,
            inactive: inactive.length,
            capabilities: Array.from(capabilities),
            nodes: { active, recent, inactive },
            totalCapacity: {
              cores: active.reduce((sum, n) => sum + (n.cpuCores || 0), 0),
              ram: active.reduce((sum, n) => sum + (n.ramMB || 0), 0)
            }
          });
        }
      );
    });
  }

  async getQueueStatus() {
    return new Promise((resolve, reject) => {
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      
      // Get job counts by status
      this.db.all(
        `SELECT status, COUNT(*) as count 
         FROM jobs 
         GROUP BY status`,
        (err, statusCounts) => {
          if (err) reject(err);
          
          // Get job types for pending jobs
          this.db.all(
            `SELECT type, COUNT(*) as count 
             FROM jobs 
             WHERE status = 'pending' 
             GROUP BY type`,
            (err, pendingTypes) => {
              if (err) reject(err);
              
              // Get recent activity
              this.db.all(
                `SELECT 
                   COUNT(*) as recentJobs,
                   AVG(CASE WHEN completedAt IS NOT NULL 
                       THEN completedAt - createdAt ELSE NULL END) as avgProcessingTime
                 FROM jobs 
                 WHERE createdAt > ?`,
                [oneHourAgo],
                (err, activity) => {
                  if (err) reject(err);
                  
                  const status = {};
                  statusCounts.forEach(s => status[s.status] = s.count);
                  
                  resolve({
                    status,
                    pendingTypes: pendingTypes || [],
                    recentActivity: activity[0] || {},
                    totalPending: status.pending || 0,
                    totalCompleted: status.completed || 0,
                    totalFailed: status.failed || 0
                  });
                }
              );
            }
          );
        }
      );
    });
  }

  async getFinancialMetrics() {
    return new Promise((resolve, reject) => {
      // Get total credits and recent activity
      this.db.all(
        `SELECT 
           SUM(amount) as totalCredits,
           COUNT(*) as totalTransactions
         FROM credits`,
        (err, credits) => {
          if (err) {
            // Table might not exist
            resolve({ totalCredits: 0, totalTransactions: 0, recentRevenue: 0 });
            return;
          }
          
          const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
          
          this.db.all(
            `SELECT SUM(amount) as recentRevenue 
             FROM credits 
             WHERE createdAt > ?`,
            [oneWeekAgo],
            (err, recent) => {
              if (err) {
                resolve({ ...credits[0], recentRevenue: 0 });
              } else {
                resolve({ 
                  ...credits[0], 
                  recentRevenue: (recent[0] && recent[0].recentRevenue) || 0 
                });
              }
            }
          );
        }
      );
    });
  }

  async getPerformanceMetrics() {
    return new Promise((resolve, reject) => {
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      
      this.db.all(
        `SELECT 
           COUNT(CASE WHEN status = 'completed' THEN 1 END) as completedJobs,
           COUNT(CASE WHEN status = 'failed' THEN 1 END) as failedJobs,
           AVG(CASE WHEN status = 'completed' AND completedAt IS NOT NULL 
               THEN completedAt - createdAt ELSE NULL END) as avgCompletionTime,
           SUM(computeMinutes) as totalComputeMinutes
         FROM jobs 
         WHERE createdAt > ?`,
        [oneHourAgo],
        (err, rows) => {
          if (err) reject(err);
          
          const data = rows[0] || {};
          const successRate = data.completedJobs && data.failedJobs ? 
            (data.completedJobs / (data.completedJobs + data.failedJobs) * 100) : 0;
          
          resolve({
            ...data,
            successRate: Math.round(successRate * 10) / 10,
            avgCompletionTimeSeconds: data.avgCompletionTime ? 
              Math.round(data.avgCompletionTime / 1000) : 0
          });
        }
      );
    });
  }

  displaySystemHealth(system) {
    console.log('🖥️  SYSTEM HEALTH');
    console.log('─'.repeat(30));
    
    const memoryStatus = system.memory.usage > 90 ? '🔴' : 
                        system.memory.usage > 75 ? '🟡' : '✅';
    const diskStatus = system.disk.usage > 90 ? '🔴' : 
                      system.disk.usage > 80 ? '🟡' : '✅';
    
    console.log(`Platform: ${system.platform}`);
    console.log(`Node.js: ${system.nodeVersion}`);
    console.log(`Uptime: ${system.uptime}h`);
    console.log(`CPU: ${system.cpu.cores} cores (${system.cpu.model})`);
    console.log(`Load: ${system.cpu.loadAvg.join(', ')}`);
    console.log(`${memoryStatus} Memory: ${system.memory.free}GB free / ${system.memory.total}GB (${system.memory.usage}% used)`);
    
    if (system.disk.total) {
      console.log(`${diskStatus} Disk: ${system.disk.available} free / ${system.disk.total} (${system.disk.usage}% used)`);
    }
    
    console.log();
  }

  displayNetworkStatus(network) {
    console.log('🌐 NETWORK STATUS');
    console.log('─'.repeat(30));
    
    const networkHealth = network.active === 0 ? '🔴' : 
                         network.active < 3 ? '🟡' : '✅';
    
    console.log(`${networkHealth} Nodes: ${network.active} active, ${network.recent} recent, ${network.inactive} inactive`);
    console.log(`Total registered: ${network.total}`);
    console.log(`Capabilities: ${network.capabilities.join(', ') || 'none'}`);
    console.log(`Capacity: ${network.totalCapacity.cores} cores, ${Math.round(network.totalCapacity.ram / 1024)}GB RAM`);
    
    if (network.nodes.active.length > 0) {
      console.log('\nActive nodes:');
      network.nodes.active.slice(0, 5).forEach(node => {
        const name = node.name || 'unnamed';
        const cores = node.cpuCores || '?';
        const jobs = node.jobsCompleted || 0;
        console.log(`  • ${name} (${cores} cores, ${jobs} jobs completed)`);
      });
      
      if (network.nodes.active.length > 5) {
        console.log(`  • ...and ${network.nodes.active.length - 5} more`);
      }
    }
    
    console.log();
  }

  displayQueueStatus(queue) {
    console.log('📋 QUEUE STATUS');
    console.log('─'.repeat(30));
    
    const queueHealth = queue.totalPending === 0 ? '✅' : 
                       queue.totalPending < 10 ? '🟡' : '🔴';
    
    console.log(`${queueHealth} Pending: ${queue.totalPending} jobs`);
    console.log(`Completed: ${queue.totalCompleted || 0}`);
    console.log(`Failed: ${queue.totalFailed || 0}`);
    
    if (queue.pendingTypes.length > 0) {
      console.log('\nPending job types:');
      queue.pendingTypes.forEach(type => {
        console.log(`  • ${type.type}: ${type.count} jobs`);
      });
    }
    
    if (queue.recentActivity.recentJobs > 0) {
      const avgTime = queue.recentActivity.avgProcessingTime ? 
        Math.round(queue.recentActivity.avgProcessingTime / 1000) : 0;
      console.log(`\nRecent activity (1h): ${queue.recentActivity.recentJobs} jobs, avg ${avgTime}s`);
    }
    
    console.log();
  }

  displayFinancialMetrics(financial) {
    console.log('💰 FINANCIAL METRICS');
    console.log('─'.repeat(30));
    
    const credits = financial.totalCredits || 0;
    const recent = financial.recentRevenue || 0;
    const transactions = financial.totalTransactions || 0;
    
    console.log(`Total credits: $${credits.toFixed(2)}`);
    console.log(`Recent revenue (7d): $${recent.toFixed(2)}`);
    console.log(`Transactions: ${transactions}`);
    
    if (recent > 0) {
      const weeklyRun = (recent * 52).toFixed(2);
      console.log(`Annual run rate: $${weeklyRun}`);
    }
    
    console.log();
  }

  displayPerformanceMetrics(performance) {
    console.log('⚡ PERFORMANCE METRICS');
    console.log('─'.repeat(30));
    
    const completed = performance.completedJobs || 0;
    const failed = performance.failedJobs || 0;
    const successRate = performance.successRate || 0;
    const avgTime = performance.avgCompletionTimeSeconds || 0;
    const compute = performance.totalComputeMinutes || 0;
    
    const performanceHealth = successRate > 95 ? '✅' : 
                             successRate > 85 ? '🟡' : '🔴';
    
    console.log(`Jobs (1h): ${completed} completed, ${failed} failed`);
    console.log(`${performanceHealth} Success rate: ${successRate}%`);
    console.log(`Avg completion time: ${avgTime}s`);
    console.log(`Compute time: ${compute.toFixed(1)} minutes`);
    
    console.log();
  }

  async getOverallHealth() {
    const [system, network, queue] = await Promise.all([
      this.getSystemMetrics(),
      this.getNetworkStatus(),
      this.getQueueStatus()
    ]);
    
    // Calculate overall health score
    let score = 100;
    let issues = [];
    
    // System health deductions
    if (system.memory.usage > 90) {
      score -= 20;
      issues.push('High memory usage');
    } else if (system.memory.usage > 75) {
      score -= 10;
      issues.push('Elevated memory usage');
    }
    
    if (system.disk.usage > 90) {
      score -= 15;
      issues.push('Low disk space');
    }
    
    // Network health deductions  
    if (network.active === 0) {
      score -= 50;
      issues.push('No active nodes');
    } else if (network.active < 2) {
      score -= 20;
      issues.push('Low node count');
    }
    
    // Queue health deductions
    if (queue.totalPending > 50) {
      score -= 25;
      issues.push('Large job backlog');
    } else if (queue.totalPending > 20) {
      score -= 10;
      issues.push('Moderate job backlog');
    }
    
    return { score: Math.max(0, score), issues };
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const dashboard = new SystemDashboard();
  
  if (args.includes('--health-only')) {
    dashboard.getOverallHealth().then(health => {
      console.log(`Health Score: ${health.score}/100`);
      if (health.issues.length > 0) {
        console.log('Issues:', health.issues.join(', '));
      }
      dashboard.db.close();
    }).catch(console.error);
  } else {
    dashboard.generateDashboard().catch(console.error);
  }
}

module.exports = SystemDashboard;