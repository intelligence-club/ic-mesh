/**
 * Enhanced Error Messages — IC Mesh
 * 
 * Provides contextual, helpful error messages with actionable suggestions
 * and debugging information to improve developer and operator experience.
 */

class EnhancedErrorMessage {
  /**
   * Create enhanced error response for common IC Mesh scenarios
   * @param {string} errorType - The type of error (validation, auth, resource, etc.)
   * @param {string} message - Brief error description
   * @param {Object} options - Additional context and suggestions
   */
  static create(errorType, message, options = {}) {
    const {
      detail = null,
      suggestion = null,
      context = {},
      httpStatus = 400,
      errorCode = null,
      documentationUrl = null,
      examples = null,
      troubleshooting = null
    } = options;

    const errorResponse = {
      error: message,
      type: errorType,
      timestamp: new Date().toISOString(),
      request_id: context.requestId || null,
    };

    // Add optional detailed information
    if (detail) errorResponse.detail = detail;
    if (suggestion) errorResponse.suggestion = suggestion;
    if (errorCode) errorResponse.error_code = errorCode;
    if (documentationUrl) errorResponse.documentation = documentationUrl;
    if (examples) errorResponse.examples = examples;
    if (troubleshooting) errorResponse.troubleshooting = troubleshooting;

    // Add context information
    if (Object.keys(context).length > 0) {
      errorResponse.context = context;
    }

    return {
      response: errorResponse,
      httpStatus
    };
  }

  /**
   * Authentication and Authorization Errors
   */
  static authenticationRequired(context = {}) {
    return this.create('authentication_required', 'Authentication required', {
      detail: 'API requests require authentication via API key',
      suggestion: 'Include your API key in the X-Api-Key header or Authorization: Bearer <key>',
      examples: {
        'curl_header': 'curl -H "X-Api-Key: your-api-key" https://moilol.com/api/...',
        'fetch_example': 'fetch(url, { headers: { "X-Api-Key": "your-key" } })'
      },
      troubleshooting: [
        'Get an API key from https://moilol.com/account.html',
        'Check that your key is correctly formatted (starts with "sk_")',
        'Verify the key hasn\'t been revoked or expired'
      ],
      context,
      httpStatus: 401,
      documentationUrl: 'https://github.com/intelligence-club/ic-mesh#authentication'
    });
  }

  static invalidApiKey(apiKey, context = {}) {
    return this.create('invalid_api_key', 'Invalid API key', {
      detail: `The provided API key "${apiKey?.slice(0, 12)}..." is not valid`,
      suggestion: 'Check your API key for typos or get a new one from your account',
      troubleshooting: [
        'Verify the key starts with "sk_" prefix',
        'Check for extra whitespace or special characters',
        'Generate a new API key if this one was compromised',
        'Contact support if you believe this is an error'
      ],
      context: { ...context, api_key_prefix: apiKey?.slice(0, 8) },
      httpStatus: 401,
      errorCode: 'INVALID_API_KEY'
    });
  }

  /**
   * Job Submission Errors
   */
  static invalidJobType(providedType, validTypes, context = {}) {
    return this.create('invalid_job_type', 'Invalid job type', {
      detail: `Job type "${providedType}" is not supported`,
      suggestion: `Use one of the supported job types: ${validTypes.join(', ')}`,
      examples: {
        transcribe: { type: 'transcribe', payload: { audio_url: 'https://example.com/audio.wav' }},
        ocr: { type: 'ocr', payload: { image_url: 'https://example.com/document.jpg' }},
        inference: { type: 'inference', payload: { model: 'llama2', prompt: 'Hello' }}
      },
      context: { ...context, provided_type: providedType, valid_types: validTypes },
      httpStatus: 400,
      errorCode: 'INVALID_JOB_TYPE',
      documentationUrl: 'https://github.com/intelligence-club/ic-mesh#job-types'
    });
  }

  static missingJobPayload(jobType, context = {}) {
    const payloadExamples = {
      transcribe: { audio_url: 'https://example.com/audio.wav', language: 'auto' },
      ocr: { image_url: 'https://example.com/document.jpg' },
      'pdf-extract': { pdf_url: 'https://example.com/document.pdf' },
      inference: { model: 'llama2', prompt: 'Explain quantum computing' },
      'generate-image': { prompt: 'A sunset over mountains', model: 'stable-diffusion' },
      ffmpeg: { input_url: 'https://example.com/video.mp4', format: 'mp3' }
    };

    return this.create('missing_job_payload', 'Job payload required', {
      detail: `Jobs of type "${jobType}" require a payload object with specific parameters`,
      suggestion: 'Include a payload field with the required parameters for your job type',
      examples: {
        [jobType]: payloadExamples[jobType] || { note: 'Check documentation for required parameters' }
      },
      troubleshooting: [
        'Ensure payload is a valid JSON object',
        'Check that all required fields are included',
        'Verify URLs are accessible and properly formatted'
      ],
      context: { ...context, job_type: jobType },
      httpStatus: 400,
      errorCode: 'MISSING_JOB_PAYLOAD'
    });\n  }\n\n  /**\n   * Resource and Network Errors\n   */\n  static jobNotFound(jobId, context = {}) {\n    return this.create('job_not_found', 'Job not found', {\n      detail: `No job exists with ID '${jobId}'`,\n      suggestion: 'Check the job ID for typos or submit a new job if needed',\n      troubleshooting: [\n        'Verify the job ID is correct (should be 16 hex characters)',\n        'Check if the job was submitted successfully',\n        'Jobs may be automatically cleaned up after completion'\n      ],\n      context: { ...context, job_id: jobId },\n      httpStatus: 404,\n      errorCode: 'JOB_NOT_FOUND'\n    });\n  }\n\n  static jobNotClaimable(jobId, jobStatus, context = {}) {\n    const statusMessages = {\n      completed: 'Job has already been completed',\n      claimed: 'Job is currently being processed by another node',\n      failed: 'Job has failed and cannot be claimed'\n    };\n\n    return this.create('job_not_claimable', 'Job not available for claiming', {\n      detail: statusMessages[jobStatus] || `Job status is '${jobStatus}'`,\n      suggestion: jobStatus === 'completed' \n        ? 'Retrieve the job result using GET /jobs/{id}'\n        : 'Wait for the job to become available or submit a new job',\n      troubleshooting: [\n        'Check job status with GET /jobs/{id}',\n        'Ensure your node has the required capabilities',\n        'Verify your node is not quarantined due to poor performance'\n      ],\n      context: { ...context, job_id: jobId, job_status: jobStatus },\n      httpStatus: 409,\n      errorCode: 'JOB_NOT_CLAIMABLE'\n    });\n  }\n\n  static noCapableNodes(jobType, requirements, context = {}) {\n    return this.create('no_capable_nodes', 'No nodes available for job', {\n      detail: `No active nodes can handle '${jobType}' jobs with the specified requirements`,\n      suggestion: 'Wait for nodes with the required capabilities to come online, or modify job requirements',\n      troubleshooting: [\n        'Check network status at /status endpoint',\n        'Verify job requirements are not too restrictive',\n        'Consider joining the network as a node operator',\n        'Contact support if this persists'\n      ],\n      examples: {\n        check_network: 'GET /status - shows active nodes and capabilities'\n      },\n      context: { ...context, job_type: jobType, requirements },\n      httpStatus: 503,\n      errorCode: 'NO_CAPABLE_NODES'\n    });\n  }\n\n  /**\n   * File Upload Errors\n   */\n  static fileUploadError(reason, context = {}) {\n    const suggestions = {\n      'file_too_large': 'Reduce file size to under 50MB or use presigned uploads for larger files',\n      'invalid_format': 'Ensure file is properly formatted and Content-Type is multipart/form-data',\n      'storage_error': 'Try again in a moment, or contact support if this persists'\n    };\n\n    return this.create('file_upload_error', 'File upload failed', {\n      detail: `Upload failed: ${reason}`,\n      suggestion: suggestions[reason] || 'Check file format and try again',\n      troubleshooting: [\n        'Verify file is under size limit (50MB for direct upload)',\n        'Check Content-Type header is multipart/form-data',\n        'For large files, use POST /upload/presign for direct-to-storage upload',\n        'Ensure file is not corrupted'\n      ],\n      examples: {\n        curl_upload: 'curl -F \"file=@yourfile.wav\" https://moilol.com/upload',\n        presigned_upload: 'POST /upload/presign -> PUT to returned upload_url'\n      },\n      context: { ...context, reason },\n      httpStatus: 400,\n      errorCode: 'FILE_UPLOAD_ERROR'\n    });\n  }\n\n  /**\n   * Rate Limiting Errors\n   */\n  static rateLimitExceeded(clientIp, retryAfter, requestType, context = {}) {\n    return this.create('rate_limit_exceeded', 'Too many requests', {\n      detail: `Rate limit exceeded for IP ${clientIp} on ${requestType} requests`,\n      suggestion: `Wait ${retryAfter} seconds before retrying, or implement exponential backoff`,\n      troubleshooting: [\n        'Reduce request frequency',\n        'Implement proper retry logic with exponential backoff',\n        'Consider upgrading to a higher tier for increased limits',\n        'Use batch operations when possible'\n      ],\n      context: { \n        ...context, \n        client_ip: clientIp, \n        retry_after: retryAfter,\n        request_type: requestType \n      },\n      httpStatus: 429,\n      errorCode: 'RATE_LIMIT_EXCEEDED'\n    });\n  }\n\n  /**\n   * Node Registration Errors\n   */\n  static nodeRegistrationError(reason, nodeId, context = {}) {\n    const suggestions = {\n      'missing_capabilities': 'Include at least one capability in your node registration',\n      'invalid_nodeId': 'Provide a valid node ID (should be unique identifier)',\n      'quarantined': 'Your node has been quarantined due to poor performance - contact support'\n    };\n\n    return this.create('node_registration_error', 'Node registration failed', {\n      detail: `Registration failed: ${reason}`,\n      suggestion: suggestions[reason] || 'Check node configuration and try again',\n      troubleshooting: [\n        'Verify node-config.json has required fields',\n        'Check that capabilities list is not empty',\n        'Ensure nodeId is unique and properly formatted',\n        'Run diagnostic tools to check node health'\n      ],\n      examples: {\n        valid_registration: {\n          nodeId: 'node-12345',\n          capabilities: ['transcribe', 'whisper'],\n          resources: { cpu: 4, memory: 8192, gpu: true }\n        }\n      },\n      context: { ...context, node_id: nodeId, reason },\n      httpStatus: 400,\n      errorCode: 'NODE_REGISTRATION_ERROR'\n    });\n  }\n\n  /**\n   * Database and Internal Errors\n   */\n  static internalServerError(error, context = {}) {\n    return this.create('internal_server_error', 'Internal server error', {\n      detail: 'An unexpected error occurred while processing your request',\n      suggestion: 'Try again in a moment. Contact support if this persists',\n      troubleshooting: [\n        'Wait a moment and retry the request',\n        'Check server status and recent announcements',\n        'Contact support with the request ID if available'\n      ],\n      context: { \n        ...context, \n        error_type: error?.name,\n        timestamp: new Date().toISOString()\n      },\n      httpStatus: 500,\n      errorCode: 'INTERNAL_SERVER_ERROR'\n    });\n  }\n\n  /**\n   * Service Unavailable Errors\n   */\n  static serviceUnavailable(service, context = {}) {\n    const services = {\n      'storage': 'File storage service is currently unavailable',\n      'database': 'Database service is temporarily down',\n      'network': 'Mesh network is experiencing issues'\n    };\n\n    return this.create('service_unavailable', 'Service temporarily unavailable', {\n      detail: services[service] || `${service} service is not available`,\n      suggestion: 'Try again in a few minutes. Check status page for updates',\n      troubleshooting: [\n        'Wait a few minutes and retry',\n        'Check https://moilol.com/status for service status',\n        'Try alternative methods if available',\n        'Contact support for extended outages'\n      ],\n      context: { ...context, service },\n      httpStatus: 503,\n      errorCode: 'SERVICE_UNAVAILABLE'\n    });\n  }\n}\n\nmodule.exports = EnhancedErrorMessage;"