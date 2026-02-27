/**
 * Performance Optimizer for IC Mesh
 * Automatically optimizes system settings for better performance
 */

class PerformanceOptimizer {
  static optimizeNodeJS() {
    // Increase event listener limit
    require('events').EventEmitter.defaultMaxListeners = 20;
    
    // Optimize garbage collection
    if (!process.env.NODE_OPTIONS) {
      process.env.NODE_OPTIONS = '--max-old-space-size=2048 --optimize-for-size';
    }
    
    // Increase UV thread pool for better I/O
    if (!process.env.UV_THREADPOOL_SIZE) {
      process.env.UV_THREADPOOL_SIZE = '8';
    }
  }

  static detectOptimalSettings() {
    const os = require('os');
    const totalRAM = Math.round(os.totalmem() / 1024 / 1024); // MB
    const cpuCount = os.cpus().length;
    const platform = os.platform();
    
    const recommendations = {
      maxConcurrentJobs: Math.min(Math.floor(cpuCount / 2), 4),
      maxMemoryUsage: Math.floor(totalRAM * 0.7), // Use 70% of available RAM
      jobTimeout: platform === 'darwin' ? 600000 : 300000, // macOS gets longer timeout
      checkInterval: totalRAM > 8000 ? 30000 : 60000, // Faster polling with more RAM
      enableGPU: this.detectGPU()
    };

    console.log('\n⚡ Performance Recommendations:');
    console.log(`   Max concurrent jobs: ${recommendations.maxConcurrentJobs}`);
    console.log(`   Memory limit: ${Math.round(recommendations.maxMemoryUsage/1024)}GB`);
    console.log(`   GPU acceleration: ${recommendations.enableGPU ? 'Enabled' : 'Not available'}`);
    
    return recommendations;
  }

  static detectGPU() {
    const { execSync } = require('child_process');
    
    try {
      // NVIDIA check
      execSync('nvidia-smi -q', { stdio: 'pipe' });
      return 'nvidia';
    } catch {}
    
    try {
      // Apple Silicon check
      const output = execSync('system_profiler SPDisplaysDataType', { encoding: 'utf8' });
      if (output.includes('Metal')) {
        return 'metal';
      }
    } catch {}
    
    return false;
  }

  static applyOptimizations(config) {
    const recommendations = this.detectOptimalSettings();
    
    // Apply to config if not already set
    if (!config.node) config.node = {};
    if (!config.performance) config.performance = {};
    
    config.node.maxConcurrentJobs = config.node.maxConcurrentJobs || recommendations.maxConcurrentJobs;
    config.performance.maxMemoryMB = config.performance.maxMemoryMB || recommendations.maxMemoryUsage;
    config.performance.jobTimeoutMs = config.performance.jobTimeoutMs || recommendations.jobTimeout;
    config.performance.checkIntervalMs = config.performance.checkIntervalMs || recommendations.checkInterval;
    
    if (recommendations.enableGPU && !config.capabilities) {
      config.capabilities = config.capabilities || [];
      const gpuCap = `gpu-${recommendations.enableGPU}`;
      if (!config.capabilities.includes(gpuCap)) {
        config.capabilities.push(gpuCap);
      }
    }
    
    return config;
  }

  static monitorPerformance() {
    const monitoring = {
      startTime: Date.now(),
      jobsCompleted: 0,
      errorsEncountered: 0,
      avgProcessingTime: 0,
      memoryUsage: process.memoryUsage()
    };
    
    // Update every 5 minutes
    setInterval(() => {
      const currentMemory = process.memoryUsage();
      const uptime = Date.now() - monitoring.startTime;
      
      console.log(`\n📊 Performance Summary (${Math.round(uptime/60000)}m uptime):`);
      console.log(`   Memory: ${Math.round(currentMemory.heapUsed/1024/1024)}MB used`);
      console.log(`   Jobs completed: ${monitoring.jobsCompleted}`);
      if (monitoring.errorsEncountered > 0) {
        console.log(`   Errors: ${monitoring.errorsEncountered}`);
      }
      
    }, 300000); // 5 minutes
    
    return monitoring;
  }
}

module.exports = PerformanceOptimizer;
