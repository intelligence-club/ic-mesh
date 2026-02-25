/**
 * Enhanced Error Integration Example
 * 
 * Shows how to integrate the error-helpers.js module with existing
 * handler runtime to provide better user experience.
 */

const { ErrorClassifier, JobValidator, ErrorFormatter, MeshError } = require('../lib/error-helpers');

/**
 * Example of enhanced execute method with improved error handling
 */
class EnhancedHandlerRuntime {
  constructor(config = {}) {
    // ... existing constructor code
    this.handlers = config.handlers || {};
    this.activeJobs = new Map();
    this.limits = config.limits || {
      maxCpuPercent: 80,
      maxRamPercent: 70,
      maxConcurrentJobs: 3,
      maxFileSizeMB: 50
    };
  }

  /**
   * Enhanced execute method with better error handling
   */
  async execute(job) {
    const { jobId, type, payload } = job;
    
    try {
      // 1. Validate job input early
      const validationErrors = JobValidator.validateJob(job);
      if (validationErrors.length > 0) {
        return {
          success: false,
          ...ErrorFormatter.forAPI(validationErrors[0])
        };
      }

      // 2. Check handler availability with helpful messages
      const availabilityCheck = this.checkHandlerAvailability(type);
      if (!availabilityCheck.available) {
        return {
          success: false,
          ...ErrorFormatter.forAPI(availabilityCheck.error)
        };
      }

      // 3. Execute with enhanced error context
      const result = await this.executeWithContext(job);
      return result;

    } catch (error) {
      // 4. Classify and format errors for users
      const context = {
        jobId,
        type,
        payload,
        timeout: this.handlers[type]?.resources?.timeout,
        url: payload?.url
      };
      
      const classifiedError = ErrorClassifier.classify(error, context);
      
      // Log for debugging
      console.error(ErrorFormatter.forLog(classifiedError, { jobId }));
      
      return {
        success: false,
        ...ErrorFormatter.forAPI(classifiedError),
        computeMs: Date.now() - (this.startTimes?.get(jobId) || Date.now())
      };
    }
  }

  /**
   * Check handler availability with detailed error messages
   */
  checkHandlerAvailability(type) {
    const handler = this.handlers[type];
    const availableTypes = Object.keys(this.handlers).filter(t => 
      this.handlers[t].enabled !== false
    );

    // Handler not found
    if (!handler) {
      const suggestion = JobValidator.suggestJobType(type, availableTypes);
      return {
        available: false,
        error: new MeshError('HANDLER_NOT_FOUND', {
          requestedType: type,
          suggestion
        })
      };
    }

    // Handler disabled
    if (handler.enabled === false) {
      return {
        available: false,
        error: new MeshError('HANDLER_DISABLED', {
          type,
          suggestion: `Try: ${availableTypes.join(', ')}`
        })
      };
    }

    // Check resource limits
    const resourceCheck = this.checkResourceAvailability(type);
    if (!resourceCheck.available) {
      return resourceCheck;
    }

    return { available: true };
  }

  /**
   * Check system resources with specific error messages
   */
  checkResourceAvailability(type) {
    const handler = this.handlers[type];
    
    // Check concurrent jobs for this handler type
    const activeOfType = [...this.activeJobs.values()].filter(j => j.type === type).length;
    const maxConcurrent = handler.resources?.maxConcurrent || 1;
    
    if (activeOfType >= maxConcurrent) {
      return {
        available: false,
        error: new MeshError('HANDLER_OVERLOADED', {
          type,
          currentJobs: activeOfType,
          maxConcurrent,
          suggestion: `This handler can run ${maxConcurrent} job(s) at a time. ${activeOfType} currently active.`
        })
      };
    }

    // Check global job limit
    if (this.activeJobs.size >= this.limits.maxConcurrentJobs) {
      return {
        available: false,
        error: new MeshError('HANDLER_OVERLOADED', {
          totalActiveJobs: this.activeJobs.size,
          maxJobs: this.limits.maxConcurrentJobs,
          suggestion: `Node can handle ${this.limits.maxConcurrentJobs} concurrent jobs. Currently processing ${this.activeJobs.size}.`
        })
      };
    }

    // Check memory
    const os = require('os');
    const freeMemPercent = (os.freemem() / os.totalmem()) * 100;
    const usedMemPercent = 100 - freeMemPercent;
    
    if (usedMemPercent > this.limits.maxRamPercent) {
      return {
        available: false,
        error: new MeshError('INSUFFICIENT_MEMORY', {
          usedMemPercent: Math.round(usedMemPercent),
          maxMemPercent: this.limits.maxRamPercent,
          availableMemory: `${Math.round(os.freemem() / 1024 / 1024)}MB`,
          suggestion: `Node memory usage is ${Math.round(usedMemPercent)}% (limit: ${this.limits.maxRamPercent}%). Try again in a few minutes.`
        })
      };
    }

    return { available: true };
  }

  /**
   * Execute with enhanced context tracking
   */
  async executeWithContext(job) {
    const { jobId, type, payload } = job;
    const startTime = Date.now();
    
    // Track start time for error reporting
    if (!this.startTimes) this.startTimes = new Map();
    this.startTimes.set(jobId, startTime);

    try {
      // ... existing execution logic ...
      const handler = this.handlers[type];
      
      // Enhanced file download with better error context
      if (payload?.url) {
        try {
          await this.downloadFileWithValidation(payload.url, jobId);
        } catch (downloadError) {
          const context = { url: payload.url, jobId };
          throw ErrorClassifier.classify(downloadError, context);
        }
      }

      // Execute handler with timeout context
      const timeout = (handler.resources?.timeout || 300) * 1000;
      const result = await this.executeHandler(job, { timeout });
      
      return {
        success: true,
        data: result.data,
        outputFiles: result.outputFiles || [],
        computeMs: Date.now() - startTime
      };

    } finally {
      this.startTimes?.delete(jobId);
    }
  }

  /**
   * Download file with enhanced validation and error reporting
   */
  async downloadFileWithValidation(url, jobId) {
    const https = require('https');
    const http = require('http');
    const fs = require('fs');
    const path = require('path');

    // Validate URL format first
    if (!JobValidator.isValidUrl(url)) {
      throw new MeshError('INVALID_URL', { url });
    }

    return new Promise((resolve, reject) => {
      const client = url.startsWith('https:') ? https : http;
      const maxSize = this.limits.maxFileSizeMB * 1024 * 1024;
      let downloadedBytes = 0;

      const request = client.get(url, (response) => {
        // Check response status
        if (response.statusCode !== 200) {
          reject(new MeshError('DOWNLOAD_FAILED', {
            url,
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            suggestion: response.statusCode === 404 
              ? 'File not found. Check the URL is correct.'
              : response.statusCode === 403 
              ? 'Access denied. File may require authentication.'
              : 'Server returned an error. Try again later.'
          }));
          return;
        }

        // Check content length
        const contentLength = parseInt(response.headers['content-length'] || '0');
        if (contentLength > maxSize) {
          reject(new MeshError('FILE_TOO_LARGE', {
            url,
            fileSize: contentLength,
            maxSize,
            suggestion: `File is ${Math.round(contentLength / 1024 / 1024)}MB, limit is ${this.limits.maxFileSizeMB}MB.`
          }));
          return;
        }

        // Set up download
        const outputPath = path.join(require('os').tmpdir(), 'ic-mesh', 'jobs', jobId, 'input', 'download');
        const writeStream = fs.createWriteStream(outputPath);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (downloadedBytes > maxSize) {
            writeStream.destroy();
            reject(new MeshError('FILE_TOO_LARGE', {
              url,
              downloadedBytes,
              maxSize
            }));
            return;
          }
        });

        response.pipe(writeStream);
        writeStream.on('finish', () => resolve(outputPath));
        writeStream.on('error', reject);
      });

      request.on('error', (error) => {
        const context = { url, jobId };
        reject(ErrorClassifier.classify(error, context));
      });

      request.setTimeout(30000, () => {
        request.destroy();
        reject(new MeshError('DOWNLOAD_FAILED', {
          url,
          suggestion: 'Download timed out after 30 seconds. Check network connection.'
        }));
      });
    });
  }
}

/**
 * Example API endpoint using enhanced error handling
 */
function createJobEndpointWithEnhancedErrors(runtime) {
  return async (req, res) => {
    try {
      const job = {
        jobId: require('crypto').randomUUID(),
        type: req.body.type,
        payload: req.body.payload || {}
      };

      const result = await runtime.execute(job);

      if (result.success) {
        res.json({
          success: true,
          jobId: job.jobId,
          data: result.data,
          computeMs: result.computeMs
        });
      } else {
        // Enhanced error response includes helpful information
        res.status(400).json({
          success: false,
          jobId: job.jobId,
          ...result // Includes error, code, hint, recoverable from ErrorFormatter.forAPI()
        });
      }

    } catch (error) {
      // Fallback error handling
      const fallbackError = ErrorClassifier.classify(error);
      res.status(500).json({
        success: false,
        ...ErrorFormatter.forAPI(fallbackError)
      });
    }
  };
}

/**
 * Example usage in Express app
 */
function setupEnhancedErrorEndpoints(app, runtime) {
  // Job submission with enhanced errors
  app.post('/jobs', createJobEndpointWithEnhancedErrors(runtime));

  // Capabilities endpoint with error context
  app.get('/capabilities', (req, res) => {
    try {
      const capabilities = runtime.listHandlers();
      res.json({ success: true, capabilities });
    } catch (error) {
      const enhancedError = ErrorClassifier.classify(error);
      res.status(500).json(ErrorFormatter.forAPI(enhancedError));
    }
  });

  // Health check with detailed error reporting
  app.get('/health', (req, res) => {
    try {
      const health = {
        status: 'healthy',
        activeJobs: runtime.activeJobs.size,
        capabilities: Object.keys(runtime.handlers).length,
        memory: {
          used: Math.round((1 - require('os').freemem() / require('os').totalmem()) * 100),
          limit: runtime.limits.maxRamPercent
        }
      };
      res.json({ success: true, health });
    } catch (error) {
      const enhancedError = ErrorClassifier.classify(error);
      res.status(503).json(ErrorFormatter.forAPI(enhancedError));
    }
  });
}

module.exports = {
  EnhancedHandlerRuntime,
  createJobEndpointWithEnhancedErrors,
  setupEnhancedErrorEndpoints
};