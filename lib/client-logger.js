/**
 * Specialized Logger for IC Mesh Client
 * 
 * Provides structured logging for job processing, WebSocket communication,
 * and performance monitoring in the client nodes.
 */

const { createLogger } = require('./enhanced-logger');

class ClientLogger {
  constructor(nodeId, nodeName) {
    this.baseLogger = createLogger('client', {
      context: { nodeId, nodeName }
    });
    
    // Specialized loggers for different client operations
    this.job = this.baseLogger.child({ component: 'job-processor' });
    this.websocket = this.baseLogger.child({ component: 'websocket' });
    this.heartbeat = this.baseLogger.child({ component: 'heartbeat' });
    this.capability = this.baseLogger.child({ component: 'capability' });
    this.performance = this.baseLogger.child({ component: 'performance' });
  }
  
  // Job processing logs
  jobClaimed(jobId, jobType, metadata = {}) {
    this.job.info(`Job claimed: ${jobType}`, { 
      jobId, 
      jobType, 
      ...metadata 
    });
  }
  
  jobStarted(jobId, command, metadata = {}) {
    this.job.info(`Job started`, { 
      jobId, 
      command: command.substring(0, 100), // Truncate long commands
      ...metadata 
    });
  }
  
  jobCompleted(jobId, duration, outputSize = 0, metadata = {}) {
    this.job.info(`Job completed successfully`, {
      jobId,
      duration_ms: Math.round(duration),
      output_size_bytes: outputSize,
      ...metadata
    });
  }
  
  jobFailed(jobId, error, duration = 0, metadata = {}) {
    this.job.error(`Job failed`, {
      jobId,
      error: error.message || error,
      duration_ms: Math.round(duration),
      ...metadata
    });
  }
  
  jobTimeout(jobId, timeoutMs, metadata = {}) {
    this.job.warn(`Job timed out`, {
      jobId,
      timeout_ms: timeoutMs,
      ...metadata
    });
  }
  
  // WebSocket communication logs
  wsConnected(serverUrl) {
    this.websocket.info('WebSocket connected', { serverUrl });
  }
  
  wsDisconnected(code, reason) {
    this.websocket.info('WebSocket disconnected', { code, reason });
  }
  
  wsReconnecting(attempt, maxAttempts) {
    this.websocket.info('WebSocket reconnecting', { attempt, maxAttempts });
  }
  
  wsMessageReceived(type, data = {}) {
    this.websocket.debug('WebSocket message received', { 
      messageType: type, 
      dataKeys: Object.keys(data)
    });
  }
  
  wsError(error, metadata = {}) {
    this.websocket.error('WebSocket error', { 
      error: error.message || error,
      ...metadata 
    });
  }
  
  // Heartbeat and registration
  heartbeatSent(status, metadata = {}) {
    this.heartbeat.debug('Heartbeat sent', { status, ...metadata });
  }
  
  heartbeatFailed(error) {
    this.heartbeat.warn('Heartbeat failed', { 
      error: error.message || error 
    });
  }
  
  registrationSuccess(nodeData) {
    this.heartbeat.info('Node registration successful', {
      capabilities: nodeData.capabilities,
      region: nodeData.region
    });
  }
  
  registrationFailed(error) {
    this.heartbeat.error('Node registration failed', {
      error: error.message || error
    });
  }
  
  // Capability detection and management
  capabilityDetected(capability, version = null) {
    this.capability.info('Capability detected', { capability, version });
  }
  
  capabilityMissing(capability, suggestion = null) {
    this.capability.warn('Capability missing', { capability, suggestion });
  }
  
  capabilityScanCompleted(capabilities) {
    this.capability.info('Capability scan completed', { 
      count: capabilities.length,
      capabilities 
    });
  }
  
  // Performance and resource monitoring
  resourceUsage(cpu, memory, disk) {
    this.performance.debug('Resource usage', {
      cpu_percent: Math.round(cpu * 100) / 100,
      memory_mb: Math.round(memory / 1024 / 1024),
      disk_available_gb: Math.round(disk / 1024 / 1024 / 1024)
    });
  }
  
  performanceWarning(metric, value, threshold) {
    this.performance.warn(`Performance warning: ${metric}`, {
      metric,
      value,
      threshold,
      severity: value > threshold * 1.5 ? 'high' : 'medium'
    });
  }
  
  // System events
  startup(version, config) {
    this.baseLogger.info('Client starting up', {
      version,
      server: config.meshServer,
      capabilities: config.capabilities?.length || 0
    });
  }
  
  shutdown(reason) {
    this.baseLogger.info('Client shutting down', { reason });
  }
  
  // Error patterns
  criticalError(error, context) {
    this.baseLogger.error('Critical error - client may need restart', {
      error: error.message || error,
      stack: error.stack,
      context
    });
  }
  
  // Migration helpers for existing console.log calls
  info(message, metadata = {}) {
    this.baseLogger.info(message, metadata);
  }
  
  error(message, metadata = {}) {
    this.baseLogger.error(message, metadata);
  }
  
  warn(message, metadata = {}) {
    this.baseLogger.warn(message, metadata);
  }
  
  debug(message, metadata = {}) {
    this.baseLogger.debug(message, metadata);
  }
}

module.exports = { ClientLogger };