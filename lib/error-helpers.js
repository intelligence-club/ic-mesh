/**
 * IC Mesh — Enhanced Error Handling & User Messages
 * 
 * Provides helpful, actionable error messages for common failure modes.
 * Converts technical errors into user-friendly guidance.
 */

/**
 * Common error codes and user-friendly messages
 */
const ERROR_MESSAGES = {
  // Handler errors
  HANDLER_NOT_FOUND: {
    message: 'Job type not supported',
    hint: 'Check available capabilities at /mesh/capabilities',
    recoverable: false
  },
  HANDLER_DISABLED: {
    message: 'Handler temporarily disabled',
    hint: 'This job type is currently unavailable. Try again later.',
    recoverable: true
  },
  HANDLER_OVERLOADED: {
    message: 'Node busy - too many concurrent jobs',
    hint: 'This node is processing other jobs. Try again in a few minutes.',
    recoverable: true
  },
  HANDLER_TIMEOUT: {
    message: 'Job timed out',
    hint: 'Processing took longer than expected. Try with smaller input or contact support.',
    recoverable: true
  },

  // Resource errors
  INSUFFICIENT_MEMORY: {
    message: 'Not enough memory available',
    hint: 'Node is low on RAM. Try again later or use a different node.',
    recoverable: true
  },
  INSUFFICIENT_DISK: {
    message: 'Not enough disk space',
    hint: 'Node storage is full. Try again later or use a different node.',
    recoverable: true
  },
  FILE_TOO_LARGE: {
    message: 'Input file too large',
    hint: 'Maximum file size is 50MB. Try compressing or splitting your file.',
    recoverable: false
  },

  // Network/download errors
  DOWNLOAD_FAILED: {
    message: 'Could not download input file',
    hint: 'Check that the URL is accessible and file is available.',
    recoverable: true
  },
  INVALID_URL: {
    message: 'Invalid or malformed URL',
    hint: 'Ensure URL starts with http:// or https:// and is properly encoded.',
    recoverable: false
  },

  // Job specification errors
  MISSING_PAYLOAD: {
    message: 'Job payload missing or invalid',
    hint: 'Jobs require a payload object with job-specific parameters.',
    recoverable: false
  },
  INVALID_JOB_TYPE: {
    message: 'Invalid job type',
    hint: 'Job type must be a string matching available handler capabilities.',
    recoverable: false
  },

  // System errors
  SPAWN_ERROR: {
    message: 'Could not start handler process',
    hint: 'Handler executable may be missing or system resources exhausted.',
    recoverable: true
  },
  PERMISSION_ERROR: {
    message: 'Permission denied',
    hint: 'Handler lacks required permissions for this operation.',
    recoverable: true
  },

  // Generic fallback
  UNKNOWN_ERROR: {
    message: 'Unexpected error occurred',
    hint: 'Please try again. If problem persists, contact support with job ID.',
    recoverable: true
  }
};

/**
 * Enhanced error class with user-friendly messages
 */
class MeshError extends Error {
  constructor(code, details = {}, cause = null) {
    const errorInfo = ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN_ERROR;
    super(errorInfo.message);
    
    this.name = 'MeshError';
    this.code = code;
    // Use specific suggestion if provided, otherwise use default hint
    this.hint = details.suggestion || errorInfo.hint;
    this.recoverable = errorInfo.recoverable;
    this.details = details;
    this.cause = cause;
    this.timestamp = Date.now();
  }

  /**
   * Convert to JSON for API responses
   */
  toJSON() {
    return {
      error: this.message,
      code: this.code,
      hint: this.hint,
      recoverable: this.recoverable,
      details: this.details,
      timestamp: this.timestamp
    };
  }

  /**
   * Get user-friendly error description
   */
  getUserMessage() {
    let message = this.message;
    if (this.hint) message += `. ${this.hint}`;
    if (this.details.suggestion) message += ` ${this.details.suggestion}`;
    return message;
  }
}

/**
 * Error classification helpers
 */
const ErrorClassifier = {
  /**
   * Classify raw error into MeshError with appropriate code
   */
  classify(error, context = {}) {
    const errorStr = error.message || error.toString();
    const lowerError = errorStr.toLowerCase();

    // Timeout detection
    if (lowerError.includes('timeout') || lowerError.includes('etimedout') || 
        lowerError.includes('timed out')) {
      return new MeshError('HANDLER_TIMEOUT', {
        originalError: errorStr,
        timeout: context.timeout
      }, error);
    }

    // Memory/resource errors
    if (lowerError.includes('memory') || lowerError.includes('out of memory')) {
      return new MeshError('INSUFFICIENT_MEMORY', {
        originalError: errorStr,
        availableMemory: context.availableMemory
      }, error);
    }

    // Disk space errors
    if (lowerError.includes('no space') || lowerError.includes('disk full')) {
      return new MeshError('INSUFFICIENT_DISK', {
        originalError: errorStr,
        availableSpace: context.availableSpace
      }, error);
    }

    // Download/network errors
    if (lowerError.includes('enotfound') || lowerError.includes('getaddrinfo failed')) {
      return new MeshError('DOWNLOAD_FAILED', {
        originalError: errorStr,
        url: context.url,
        suggestion: 'Verify the hostname is correct and accessible.'
      }, error);
    }

    if (lowerError.includes('econnrefused') || lowerError.includes('connection refused')) {
      return new MeshError('DOWNLOAD_FAILED', {
        originalError: errorStr,
        url: context.url,
        suggestion: 'Server is not responding. Try again later.'
      }, error);
    }

    // File size errors
    if (lowerError.includes('file too large') || (context.fileSize && context.fileSize > 50 * 1024 * 1024)) {
      return new MeshError('FILE_TOO_LARGE', {
        originalError: errorStr,
        fileSize: context.fileSize,
        maxSize: 50 * 1024 * 1024
      }, error);
    }

    // Permission errors
    if (lowerError.includes('eacces') || lowerError.includes('permission denied')) {
      return new MeshError('PERMISSION_ERROR', {
        originalError: errorStr,
        suggestion: 'Handler may need additional permissions for this file type.'
      }, error);
    }

    // Spawn/execution errors
    if (lowerError.includes('enoent') || lowerError.includes('command not found')) {
      return new MeshError('SPAWN_ERROR', {
        originalError: errorStr,
        command: context.command,
        suggestion: 'Required handler executable may not be installed.'
      }, error);
    }

    // Default classification
    return new MeshError('UNKNOWN_ERROR', {
      originalError: errorStr,
      context: context
    }, error);
  },

  /**
   * Check if error is likely recoverable by retrying
   */
  isRetryable(error) {
    if (error instanceof MeshError) {
      return error.recoverable;
    }
    
    const errorStr = error.message || error.toString();
    const retryablePatterns = [
      'timeout', 'connection refused', 'temporary', 'busy', 'overloaded',
      'try again', 'service unavailable', 'rate limit'
    ];
    
    return retryablePatterns.some(pattern => 
      errorStr.toLowerCase().includes(pattern)
    );
  }
};

/**
 * Job input validation helpers
 */
const JobValidator = {
  /**
   * Validate job input and return helpful errors for common mistakes
   */
  validateJob(job) {
    const errors = [];

    // Required fields
    if (!job.type || typeof job.type !== 'string') {
      errors.push(new MeshError('INVALID_JOB_TYPE', {
        provided: typeof job.type,
        suggestion: 'Job type must be a non-empty string.'
      }));
    }

    if (!job.payload || typeof job.payload !== 'object') {
      errors.push(new MeshError('MISSING_PAYLOAD', {
        provided: typeof job.payload,
        suggestion: 'Include a payload object with job parameters.'
      }));
    }

    // URL validation if provided
    if (job.payload?.url) {
      if (!this.isValidUrl(job.payload.url)) {
        errors.push(new MeshError('INVALID_URL', {
          url: job.payload.url,
          suggestion: 'URL must start with http:// or https:// and be properly encoded.'
        }));
      }
    }

    return errors;
  },

  /**
   * Simple URL validation
   */
  isValidUrl(str) {
    try {
      const url = new URL(str);
      return ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  },

  /**
   * Get helpful suggestions for job type
   */
  suggestJobType(attempted, available) {
    if (!attempted || !available.length) return null;
    
    // Simple string similarity for suggestions
    const similar = available.filter(type => 
      type.includes(attempted) || attempted.includes(type)
    );
    
    if (similar.length > 0) {
      return `Did you mean: ${similar.join(', ')}?`;
    }
    
    return `Available types: ${available.join(', ')}`;
  }
};

/**
 * Format errors for different contexts
 */
const ErrorFormatter = {
  /**
   * Format error for API response
   */
  forAPI(error, includeStack = false) {
    if (error instanceof MeshError) {
      const response = error.toJSON();
      if (includeStack && error.cause) {
        response.stack = error.cause.stack;
      }
      return response;
    }

    // Handle non-MeshError instances
    return {
      error: error.message || 'Unknown error',
      code: 'UNKNOWN_ERROR',
      hint: 'Please try again. If problem persists, contact support.',
      recoverable: true,
      timestamp: Date.now()
    };
  },

  /**
   * Format error for logging
   */
  forLog(error, context = {}) {
    const timestamp = new Date().toISOString();
    const jobId = context.jobId || 'unknown';
    
    if (error instanceof MeshError) {
      return `[${timestamp}] Job ${jobId}: ${error.code} - ${error.message} (${error.hint})`;
    }
    
    return `[${timestamp}] Job ${jobId}: ${error.message || error.toString()}`;
  },

  /**
   * Format error for user notification
   */
  forUser(error) {
    if (error instanceof MeshError) {
      return error.getUserMessage();
    }
    
    return `Job failed: ${error.message || 'Unknown error'}. Please try again or contact support.`;
  }
};

module.exports = {
  MeshError,
  ErrorClassifier,
  JobValidator,
  ErrorFormatter,
  ERROR_MESSAGES
};