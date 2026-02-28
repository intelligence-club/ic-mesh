#!/usr/bin/env node
/**
 * Demo: Enhanced Logging Integration
 * 
 * Shows how to integrate the enhanced logging system into existing IC Mesh code
 * This is a demonstration of migrating a portion of client.js to structured logging
 */

// Instead of scattered console.log statements, we use structured logging
const { ClientLogger } = require('./lib/client-logger');

// Example: Job Processing Function (modernized from client.js)
class EnhancedJobProcessor {
  constructor(nodeId, nodeName) {
    this.logger = new ClientLogger(nodeId, nodeName);
    this.activeJobs = new Map();
  }
  
  async claimAndProcessJob(availableJob) {
    const jobId = availableJob.id;
    const startTime = Date.now();
    
    try {
      // Old way: console.log('🎯 Claiming job:', jobId);
      // New way: Structured with metadata
      this.logger.jobClaimed(jobId, availableJob.task_type, {
        priority: availableJob.priority || 'normal',
        requiredCapabilities: availableJob.requirements || []
      });
      
      // Claim the job
      const claimResponse = await this.claimJob(jobId);
      if (!claimResponse.success) {
        this.logger.jobFailed(jobId, new Error('Job claim failed'), Date.now() - startTime);
        return false;
      }
      
      // Process the job
      this.logger.jobStarted(jobId, availableJob.command_template, {
        inputSize: availableJob.payload_size || 0
      });
      
      const result = await this.executeJob(availableJob);
      const duration = Date.now() - startTime;
      
      this.logger.jobCompleted(jobId, duration, result.output?.length || 0, {
        outputFormat: result.format,
        success: true
      });
      
      return result;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.jobFailed(jobId, error, duration, {
        phase: error.phase || 'execution',
        retryable: error.retryable !== false
      });
      throw error;
    }
  }
  
  async claimJob(jobId) {
    // Simulate API call
    return { success: true, claimedAt: Date.now() };
  }
  
  async executeJob(job) {
    // Simulate job execution
    await new Promise(resolve => setTimeout(resolve, 100));
    return { 
      output: 'Processed result data',
      format: 'text/plain'
    };
  }
}

// Example: WebSocket Handler (modernized approach)
class EnhancedWebSocketHandler {
  constructor(nodeId, nodeName) {
    this.logger = new ClientLogger(nodeId, nodeName);
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }
  
  connect(serverUrl) {
    try {
      this.ws = new (require('ws'))(serverUrl);
      
      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        // Old: console.log('✅ WebSocket connected to', serverUrl);
        // New: Structured with connection metadata
        this.logger.wsConnected(serverUrl);
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          // Old: console.log('📨 WebSocket message:', message.type);
          // New: Structured with message analysis
          this.logger.wsMessageReceived(message.type, {
            hasPayload: !!message.payload,
            payloadSize: message.payload ? JSON.stringify(message.payload).length : 0
          });
          
          this.handleMessage(message);
        } catch (error) {
          this.logger.wsError(error, { rawData: data.toString().substring(0, 100) });
        }
      });
      
      this.ws.on('close', (code, reason) => {
        // Old: console.log('❌ WebSocket closed:', code, reason);
        // New: Structured with reconnection logic
        this.logger.wsDisconnected(code, reason.toString());
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect(serverUrl);
        }
      });
      
      this.ws.on('error', (error) => {
        // Old: console.error('💥 WebSocket error:', error.message);
        // New: Structured with error context
        this.logger.wsError(error, {
          connected: this.ws?.readyState === 1,
          reconnectAttempts: this.reconnectAttempts
        });
      });
      
    } catch (error) {
      this.logger.wsError(error, { serverUrl });
    }
  }
  
  scheduleReconnect(serverUrl) {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    // Old: console.log('🔄 Reconnecting in', delay, 'ms. Attempt', this.reconnectAttempts);
    // New: Structured with exponential backoff info
    this.logger.wsReconnecting(this.reconnectAttempts, this.maxReconnectAttempts);
    
    setTimeout(() => {
      this.connect(serverUrl);
    }, delay);
  }
  
  handleMessage(message) {
    switch (message.type) {
      case 'job.dispatch':
        this.logger.info('New job dispatch received', {
          jobId: message.payload.id,
          jobType: message.payload.task_type
        });
        break;
      case 'mesh.stats':
        this.logger.debug('Mesh stats update', {
          activeNodes: message.payload.activeNodes,
          pendingJobs: message.payload.pendingJobs
        });
        break;
      default:
        this.logger.debug('Unknown message type', { type: message.type });
    }
  }
}

// Example: System Monitor (performance tracking)
class EnhancedSystemMonitor {
  constructor(nodeId, nodeName) {
    this.logger = new ClientLogger(nodeId, nodeName);
    this.monitoring = false;
    this.thresholds = {
      cpu: 80,      // 80%
      memory: 85,   // 85%
      disk: 90      // 90%
    };
  }
  
  startMonitoring(intervalMs = 60000) {
    if (this.monitoring) return;
    
    this.monitoring = true;
    this.logger.info('System monitoring started', { 
      interval_ms: intervalMs,
      thresholds: this.thresholds
    });
    
    this.monitoringInterval = setInterval(() => {
      this.checkSystemResources();
    }, intervalMs);
  }
  
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoring = false;
      this.logger.info('System monitoring stopped');
    }
  }
  
  async checkSystemResources() {
    try {
      const stats = await this.getSystemStats();
      
      // Old: console.log('System stats:', stats);
      // New: Structured with threshold checking
      this.logger.resourceUsage(stats.cpu, stats.memory, stats.disk);
      
      // Check thresholds and alert
      Object.entries(this.thresholds).forEach(([metric, threshold]) => {
        const value = stats[metric];
        if (value > threshold) {
          this.logger.performanceWarning(metric, value, threshold);
        }
      });
      
    } catch (error) {
      this.logger.error('System monitoring failed', { error: error.message });
    }
  }
  
  async getSystemStats() {
    const os = require('os');
    const fs = require('fs').promises;
    
    // CPU usage (simplified)
    const cpus = os.cpus();
    const cpuUsage = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      return acc + (cpu.times.idle / total);
    }, 0) / cpus.length;
    
    // Memory usage
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;
    
    // Disk usage (simplified - just available space)
    const stats = await fs.stat('.');
    const diskAvailable = stats.size || 1000 * 1024 * 1024 * 1024; // Default 1GB
    
    return {
      cpu: (1 - cpuUsage) * 100, // Convert to usage percentage
      memory: memoryUsage,
      disk: diskAvailable
    };
  }
}

// Demo: Show the enhanced logging in action
async function demonstrateEnhancedLogging() {
  console.log('🚀 Demonstrating Enhanced Logging Integration...\n');
  
  // Initialize components with structured logging
  const jobProcessor = new EnhancedJobProcessor('demo-node-456', 'demo-machine');
  const wsHandler = new EnhancedWebSocketHandler('demo-node-456', 'demo-machine');
  const sysMonitor = new EnhancedSystemMonitor('demo-node-456', 'demo-machine');
  
  // Simulate job processing
  console.log('1. Processing a job with structured logging:');
  const mockJob = {
    id: 'job-demo-123',
    task_type: 'transcription',
    command_template: 'whisper --output-format txt input.mp3',
    priority: 'high',
    requirements: ['whisper'],
    payload_size: 2048576
  };
  
  try {
    await jobProcessor.claimAndProcessJob(mockJob);
  } catch (error) {
    // Expected for demo
  }
  
  console.log('\n2. WebSocket communication with structured logging:');
  // Note: This would require actual WebSocket server for real demo
  wsHandler.logger.wsConnected('wss://demo-server.com/ws');
  wsHandler.logger.wsMessageReceived('job.dispatch', { 
    hasPayload: true, 
    payloadSize: 156 
  });
  
  console.log('\n3. System monitoring with structured logging:');
  const stats = await sysMonitor.getSystemStats();
  sysMonitor.logger.resourceUsage(stats.cpu, stats.memory, stats.disk);
  
  // Simulate a performance warning
  sysMonitor.logger.performanceWarning('cpu', 92, 80);
  
  console.log('\n✅ Enhanced logging demonstration completed!');
  console.log('\n📊 Benefits demonstrated:');
  console.log('  • Structured metadata for easy analysis');
  console.log('  • Contextual information (nodeId, jobId, etc.)');
  console.log('  • Performance timing and resource tracking');
  console.log('  • Consistent log levels and formatting');
  console.log('  • JSON output option for log aggregation');
}

if (require.main === module) {
  demonstrateEnhancedLogging().catch(console.error);
}

module.exports = {
  EnhancedJobProcessor,
  EnhancedWebSocketHandler,
  EnhancedSystemMonitor
};