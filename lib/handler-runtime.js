/**
 * IC Mesh — Handler Runtime
 * 
 * Executes handler scripts with proper isolation, timeouts, 
 * input delivery, and output capture.
 * 
 * Contract:
 *   - Handler receives JSON on stdin
 *   - Handler writes JSON to stdout
 *   - Exit 0 = success, non-zero = failure
 *   - stderr is captured for logging
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const logger = require('./logger');

const JOBS_DIR = path.join(os.tmpdir(), 'ic-mesh', 'jobs');

class HandlerRuntime {
  constructor(config = {}) {
    this.handlers = config.handlers || {};
    this.activeJobs = new Map(); // jobId -> { process, handler, startTime }
    this.limits = config.limits || {
      maxCpuPercent: 80,
      maxRamPercent: 70,
      maxConcurrentJobs: 3,
      maxFileSizeMB: 50
    };
  }

  /**
   * List registered handler types
   */
  listHandlers() {
    const result = {};
    for (const [type, handler] of Object.entries(this.handlers)) {
      if (handler.enabled === false) continue;
      result[type] = {
        description: handler.description || '',
        accepts: handler.accepts || {},
        maxConcurrent: handler.resources?.maxConcurrent || 1
      };
    }
    return result;
  }

  /**
   * Get capability list for node registration
   */
  getCapabilities() {
    return Object.entries(this.handlers)
      .filter(([, h]) => h.enabled !== false)
      .map(([type]) => type);
  }

  /**
   * Check if we can accept a job of this type right now
   */
  canAccept(type) {
    const handler = this.handlers[type];
    if (!handler || handler.enabled === false) return false;

    // Check concurrent limit for this handler
    const activeOfType = [...this.activeJobs.values()].filter(j => j.type === type).length;
    const maxConcurrent = handler.resources?.maxConcurrent || 1;
    if (activeOfType >= maxConcurrent) return false;

    // Check global concurrent limit
    if (this.activeJobs.size >= this.limits.maxConcurrentJobs) return false;

    // Check system resources
    const freeMem = os.freemem() / os.totalmem();
    if ((1 - freeMem) * 100 > this.limits.maxRamPercent) return false;

    return true;
  }

  /**
   * Execute a job using the appropriate handler
   * Returns: { success, data, outputFiles, error, computeMs }
   */
  async execute(job) {
    const { jobId, type, payload } = job;
    const handler = this.handlers[type];

    if (!handler) {
      // Check for built-in ping
      if (type === 'ping') {
        return { success: true, data: { pong: true, node: os.hostname(), time: Date.now() }, computeMs: 0 };
      }
      return { success: false, error: `No handler for type: ${type}` };
    }

    if (handler.enabled === false) {
      return { success: false, error: `Handler disabled: ${type}` };
    }

    // Set up work directory
    const workDir = path.join(JOBS_DIR, jobId);
    const inputDir = path.join(workDir, 'input');
    const outputDir = path.join(workDir, 'output');
    fs.mkdirSync(inputDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    const startTime = Date.now();
    let inputFiles = [];

    try {
      // Download input files if URL provided
      if (payload?.url) {
        const filename = path.basename(new URL(payload.url).pathname) || 'input.bin';
        const filePath = path.join(inputDir, filename);
        await downloadFile(payload.url, filePath, this.limits.maxFileSizeMB);
        inputFiles.push(filePath);
      }

      // Build job input for handler
      const jobInput = {
        jobId,
        type,
        payload,
        workDir,
        inputFiles,
        outputDir
      };

      // Resolve command
      const command = handler.command;
      const timeout = (handler.resources?.timeout || 300) * 1000;

      // Build environment
      const env = {
        ...process.env,
        IC_JOB_ID: jobId,
        IC_JOB_TYPE: type,
        IC_WORK_DIR: workDir,
        IC_INPUT_DIR: inputDir,
        IC_OUTPUT_DIR: outputDir,
        ...(handler.env || {})
      };

      // Execute handler
      logger.info('Handler execution started', {
        jobId,
        type,
        command: command.split(' ')[0],
        workDir,
        timeout: timeout / 1000
      });
      const result = await this._spawn(command, jobInput, { env, cwd: workDir, timeout });

      // Process output files
      let outputFiles = [];
      if (result.outputFiles?.length) {
        outputFiles = result.outputFiles;
      } else {
        // Check if handler wrote any files to outputDir
        try {
          const files = fs.readdirSync(outputDir);
          outputFiles = files.map(f => path.join(outputDir, f));
        } catch {}
      }

      const computeMs = Date.now() - startTime;

      return {
        success: result.success !== false,
        data: result.data || result,
        outputFiles,
        computeMs,
        error: result.error
      };

    } catch (e) {
      const computeMs = Date.now() - startTime;
      return { success: false, error: e.message, computeMs };
    } finally {
      // Cleanup work directory
      this.activeJobs.delete(jobId);
      setTimeout(() => {
        try { 
          fs.rmSync(workDir, { recursive: true, force: true }); 
        } catch (e) {
          // Cleanup failure is non-critical, but log for monitoring
          logger.warn('Job cleanup failed', 'Failed to remove work directory', {
            workDir,
            jobId,
            error: e.message,
            cleanup_type: 'work_directory'
          });
        }
      }, 5000);
    }
  }

  /**
   * Spawn a handler process
   */
  _spawn(command, input, options) {
    return new Promise((resolve, reject) => {
      const parts = command.split(/\s+/);
      const cmd = parts[0];
      const args = parts.slice(1);

      const proc = spawn(cmd, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: options.timeout
      });

      // Track active job
      this.activeJobs.set(input.jobId, {
        process: proc,
        type: input.type,
        startTime: Date.now()
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', d => stdout += d);
      proc.stderr.on('data', d => {
        stderr += d;
        // Log stderr in real-time for visibility
        const lines = d.toString().trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            logger.info('Handler stderr output', {
              jobId: input.jobId,
              type: input.type,
              output: line
            });
          }
        }
      });

      proc.on('error', (err) => {
        if (err.code === 'ETIMEDOUT' || err.killed) {
          reject(new Error(`Handler timed out after ${options.timeout / 1000}s`));
        } else {
          reject(err);
        }
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Handler exited with code ${code}`));
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          // If stdout isn't JSON, wrap it
          resolve({
            success: true,
            data: { output: stdout.trim() }
          });
        }
      });

      // Send job input on stdin
      proc.stdin.write(JSON.stringify(input));
      proc.stdin.end();
    });
  }

  /**
   * Kill all active jobs (for graceful shutdown)
   */
  killAll() {
    for (const [jobId, { process, type }] of this.activeJobs) {
      logger.warn('Killing job for shutdown', {
        jobId,
        type,
        pid: process.pid
      });
      process.kill('SIGTERM');
      setTimeout(() => {
        try { process.kill('SIGKILL'); } catch {}
      }, 5000);
    }
  }
}

/**
 * Download a file from URL to local path
 */
async function downloadFile(url, destPath, maxSizeMB = 50) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);

  const contentLength = parseInt(resp.headers.get('content-length') || '0');
  if (contentLength > maxSizeMB * 1024 * 1024) {
    throw new Error(`File too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB (max ${maxSizeMB}MB)`);
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

module.exports = { HandlerRuntime };
