# IC Mesh API Error Handling Guide

Comprehensive guide for handling errors when integrating with the IC Mesh API.

## Error Response Format

All IC Mesh API errors follow a consistent JSON structure:

```json
{
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_ERROR_CODE", 
  "details": {
    "field": "Additional context",
    "timestamp": "2026-02-25T06:30:00.000Z"
  }
}
```

## HTTP Status Codes

### 400 Bad Request
**Meaning:** The request was malformed or missing required parameters.

**Common error codes:**
- `VALIDATION_ERROR` - Required field missing or invalid
- `INVALID_JSON` - Request body is not valid JSON
- `INVALID_PARAMETER` - Parameter has wrong type or format
- `MISSING_CONTENT_TYPE` - Content-Type header required

**Examples:**
```json
{
  "error": "Missing required field: capabilities",
  "code": "VALIDATION_ERROR",
  "details": {
    "field": "capabilities",
    "expected": "array of strings",
    "received": "undefined"
  }
}
```

**Client handling:**
```javascript
async function registerNode(nodeConfig) {
  try {
    const response = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nodeConfig)
    });
    
    if (response.status === 400) {
      const error = await response.json();
      
      switch (error.code) {
        case 'VALIDATION_ERROR':
          console.error(`Missing field: ${error.details.field}`);
          // Show user-friendly validation message
          break;
        case 'INVALID_JSON':
          console.error('Request format error');
          // Fix JSON serialization
          break;
        default:
          console.error('Request error:', error.error);
      }
      return null;
    }
    
    return await response.json();
  } catch (err) {
    console.error('Network error:', err);
    return null;
  }
}
```

### 401 Unauthorized
**Meaning:** Authentication required or invalid credentials.

**Common error codes:**
- `MISSING_API_KEY` - Authorization header not provided
- `INVALID_API_KEY` - API key doesn't exist or expired
- `MALFORMED_AUTH_HEADER` - Authorization header format incorrect

**Examples:**
```json
{
  "error": "Invalid API key",
  "code": "INVALID_API_KEY",
  "details": {
    "keyId": "key_123abc",
    "reason": "expired"
  }
}
```

**Client handling:**
```javascript
class ICMeshClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  
  async request(endpoint, options = {}) {
    const response = await fetch(endpoint, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (response.status === 401) {
      const error = await response.json();
      
      if (error.code === 'INVALID_API_KEY') {
        // Trigger re-authentication flow
        await this.refreshApiKey();
        return this.request(endpoint, options); // Retry
      }
      
      throw new Error(`Authentication failed: ${error.error}`);
    }
    
    return response;
  }
}
```

### 403 Forbidden
**Meaning:** Valid authentication but insufficient permissions.

**Common error codes:**
- `INSUFFICIENT_CREDITS` - Not enough credits for operation
- `RATE_LIMIT_EXCEEDED` - Too many requests from this key
- `OPERATION_NOT_ALLOWED` - API key doesn't have required permissions

**Client handling:**
```javascript
async function submitJob(jobData) {
  try {
    const response = await icmesh.request('/jobs/submit', {
      method: 'POST',
      body: JSON.stringify(jobData)
    });
    
    if (response.status === 403) {
      const error = await response.json();
      
      switch (error.code) {
        case 'INSUFFICIENT_CREDITS':
          // Redirect to credit purchase
          window.location.href = '/buy-credits';
          break;
          
        case 'RATE_LIMIT_EXCEEDED':
          // Implement exponential backoff
          await new Promise(resolve => setTimeout(resolve, 5000));
          return submitJob(jobData); // Retry
          
        case 'OPERATION_NOT_ALLOWED':
          throw new Error('API key lacks required permissions');
      }
    }
    
    return await response.json();
  } catch (err) {
    console.error('Job submission failed:', err);
    throw err;
  }
}
```

### 404 Not Found
**Meaning:** The requested resource doesn't exist.

**Common error codes:**
- `NODE_NOT_FOUND` - Node ID doesn't exist
- `JOB_NOT_FOUND` - Job ID doesn't exist
- `ENDPOINT_NOT_FOUND` - API endpoint doesn't exist
- `FILE_NOT_FOUND` - Uploaded file not found

**Client handling:**
```javascript
async function getJobStatus(jobId) {
  const response = await icmesh.request(`/jobs/${jobId}/status`);
  
  if (response.status === 404) {
    const error = await response.json();
    
    if (error.code === 'JOB_NOT_FOUND') {
      console.warn(`Job ${jobId} no longer exists`);
      return { status: 'not_found' };
    }
  }
  
  return await response.json();
}
```

### 409 Conflict
**Meaning:** Request conflicts with current resource state.

**Common error codes:**
- `NODE_ALREADY_EXISTS` - Node ID already registered
- `JOB_ALREADY_CLAIMED` - Another node claimed this job
- `DUPLICATE_OPERATION` - Operation already performed

**Client handling:**
```javascript
async function registerWithRetry(nodeConfig) {
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      const response = await icmesh.request('/register', {
        method: 'POST',
        body: JSON.stringify(nodeConfig)
      });
      
      if (response.status === 409) {
        const error = await response.json();
        
        if (error.code === 'NODE_ALREADY_EXISTS') {
          // Generate new node ID and retry
          nodeConfig.nodeId = generateUniqueNodeId();
          attempts++;
          continue;
        }
      }
      
      return await response.json();
    } catch (err) {
      attempts++;
      if (attempts >= maxAttempts) throw err;
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
    }
  }
}
```

### 422 Unprocessable Entity
**Meaning:** Request was well-formed but semantically incorrect.

**Common error codes:**
- `INVALID_CAPABILITY` - Capability not supported
- `INVALID_HANDLER` - Handler doesn't exist
- `INCOMPATIBLE_INPUT` - Input format not supported by handler
- `VALIDATION_FAILED` - Business logic validation failed

**Client handling:**
```javascript
async function validateJobBeforeSubmit(jobData) {
  // Pre-validation to avoid 422 errors
  const capabilities = await icmesh.request('/capabilities');
  const availableCapabilities = await capabilities.json();
  
  if (!availableCapabilities.includes(jobData.handler)) {
    throw new Error(`Handler '${jobData.handler}' not available`);
  }
  
  // Check input format compatibility
  const handlers = await icmesh.request('/handlers');
  const handlerInfo = await handlers.json();
  const supportedFormats = handlerInfo[jobData.handler].supportedFormats;
  
  const inputFormat = getFileExtension(jobData.input);
  if (!supportedFormats.includes(inputFormat)) {
    throw new Error(`Format '${inputFormat}' not supported by ${jobData.handler}`);
  }
  
  return true;
}
```

### 429 Too Many Requests
**Meaning:** Rate limit exceeded.

**Common error codes:**
- `RATE_LIMIT_EXCEEDED` - General rate limiting
- `API_QUOTA_EXCEEDED` - Daily/monthly API quota reached
- `CONCURRENT_LIMIT_EXCEEDED` - Too many simultaneous requests

**Client handling with exponential backoff:**
```javascript
class RateLimitHandler {
  constructor() {
    this.retryDelays = [1000, 2000, 4000, 8000, 16000]; // Exponential backoff
  }
  
  async requestWithRetry(requestFn, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await requestFn();
        
        if (response.status === 429) {
          if (attempt === maxRetries) {
            throw new Error('Max retries exceeded for rate limited request');
          }
          
          const error = await response.json();
          const delay = this.retryDelays[attempt] || 16000;
          
          console.warn(`Rate limited, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        return response;
      } catch (err) {
        if (attempt === maxRetries) throw err;
        
        const delay = this.retryDelays[attempt] || 16000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}
```

### 500 Internal Server Error
**Meaning:** Unexpected server error occurred.

**Common error codes:**
- `DATABASE_ERROR` - Database connection or query failed
- `HANDLER_ERROR` - Job handler crashed or failed
- `NETWORK_ERROR` - External service unavailable
- `UNKNOWN_ERROR` - Unexpected internal error

**Client handling:**
```javascript
async function handleServerError(response) {
  const error = await response.json();
  
  // Log error for debugging
  console.error('Server error:', {
    code: error.code,
    message: error.error,
    timestamp: new Date().toISOString(),
    endpoint: response.url
  });
  
  // Different strategies based on error type
  switch (error.code) {
    case 'DATABASE_ERROR':
      // Temporary issue, retry after delay
      await new Promise(resolve => setTimeout(resolve, 5000));
      throw new Error('Service temporarily unavailable, please try again');
      
    case 'HANDLER_ERROR':
      // Job-specific error, don't retry
      throw new Error(`Processing failed: ${error.details?.reason || 'Unknown error'}`);
      
    case 'NETWORK_ERROR':
      // External dependency issue
      throw new Error('External service unavailable, try again later');
      
    default:
      // Unknown error, don't retry
      throw new Error('An unexpected error occurred');
  }
}
```

### 503 Service Unavailable
**Meaning:** Service temporarily overloaded or under maintenance.

**Client handling:**
```javascript
async function handleServiceUnavailable(response) {
  const error = await response.json();
  
  // Check for retry-after header
  const retryAfter = response.headers.get('Retry-After');
  const delay = retryAfter ? parseInt(retryAfter) * 1000 : 30000;
  
  console.warn(`Service unavailable, retrying in ${delay}ms`);
  
  // Return a promise that resolves after the delay
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error('Service temporarily unavailable'));
    }, delay);
  });
}
```

## Best Practices for Error Handling

### 1. Implement Comprehensive Error Handling

```javascript
class ICMeshAPIClient {
  async makeRequest(endpoint, options = {}) {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });
      
      // Handle different status codes
      switch (response.status) {
        case 200:
        case 201:
          return await response.json();
          
        case 400:
          await this.handleBadRequest(response);
          break;
          
        case 401:
          await this.handleUnauthorized(response);
          break;
          
        case 403:
          await this.handleForbidden(response);
          break;
          
        case 404:
          await this.handleNotFound(response);
          break;
          
        case 409:
          await this.handleConflict(response);
          break;
          
        case 429:
          return await this.handleRateLimit(response);
          
        case 500:
        case 503:
          await this.handleServerError(response);
          break;
          
        default:
          throw new Error(`Unexpected status code: ${response.status}`);
      }
    } catch (err) {
      // Handle network errors
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Network error: Unable to reach IC Mesh API');
      }
      throw err;
    }
  }
}
```

### 2. Implement Circuit Breaker Pattern

```javascript
class CircuitBreaker {
  constructor(threshold = 5, resetTimeout = 60000) {
    this.threshold = threshold;
    this.resetTimeout = resetTimeout;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.nextAttempt = Date.now();
  }
  
  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }
  
  onFailure() {
    this.failures++;
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
    }
  }
}
```

### 3. Logging and Monitoring

```javascript
class APIErrorLogger {
  constructor() {
    this.errors = [];
  }
  
  logError(error, context) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      error: {
        code: error.code,
        message: error.error,
        details: error.details
      },
      context: {
        endpoint: context.endpoint,
        method: context.method,
        userId: context.userId,
        sessionId: context.sessionId
      }
    };
    
    this.errors.push(logEntry);
    
    // Send to monitoring service
    this.sendToMonitoring(logEntry);
  }
  
  async sendToMonitoring(logEntry) {
    try {
      await fetch('/api/monitoring/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logEntry)
      });
    } catch (err) {
      console.error('Failed to send error to monitoring:', err);
    }
  }
}
```

### 4. User-Friendly Error Messages

```javascript
const ERROR_MESSAGES = {
  'INSUFFICIENT_CREDITS': 'You need to add credits to your account to continue.',
  'RATE_LIMIT_EXCEEDED': 'Too many requests. Please wait a moment and try again.',
  'NODE_NOT_FOUND': 'The requested node is no longer available.',
  'JOB_NOT_FOUND': 'This job has expired or been completed.',
  'VALIDATION_ERROR': 'Please check your input and try again.',
  'NETWORK_ERROR': 'Connection problem. Please check your internet connection.',
  'DATABASE_ERROR': 'Service is temporarily unavailable. Please try again in a few minutes.',
  'HANDLER_ERROR': 'Processing failed. Please try uploading a different file.'
};

function getUserFriendlyMessage(errorCode, fallback) {
  return ERROR_MESSAGES[errorCode] || fallback || 'An unexpected error occurred.';
}
```

### 5. Recovery Strategies

```javascript
class JobSubmissionRecovery {
  async submitWithRecovery(jobData) {
    try {
      return await this.submitJob(jobData);
    } catch (error) {
      return await this.recoverFromError(error, jobData);
    }
  }
  
  async recoverFromError(error, jobData) {
    switch (error.code) {
      case 'INSUFFICIENT_CREDITS':
        // Prompt user to buy credits
        const purchased = await this.promptCreditPurchase();
        if (purchased) {
          return await this.submitJob(jobData);
        }
        throw error;
        
      case 'NO_AVAILABLE_NODES':
        // Wait for nodes to become available
        await this.waitForNodes(jobData.handler);
        return await this.submitJob(jobData);
        
      case 'RATE_LIMIT_EXCEEDED':
        // Use exponential backoff
        await this.exponentialBackoff();
        return await this.submitJob(jobData);
        
      default:
        throw error;
    }
  }
}
```

## Testing Error Scenarios

### Unit Tests for Error Handling

```javascript
describe('IC Mesh API Error Handling', () => {
  let client;
  
  beforeEach(() => {
    client = new ICMeshAPIClient(mockApiKey);
  });
  
  test('handles 400 Bad Request with validation error', async () => {
    const mockResponse = {
      status: 400,
      json: () => Promise.resolve({
        error: 'Missing required field: capabilities',
        code: 'VALIDATION_ERROR',
        details: { field: 'capabilities' }
      })
    };
    
    fetch.mockResolvedValue(mockResponse);
    
    await expect(client.registerNode({}))
      .rejects
      .toThrow('Missing required field: capabilities');
  });
  
  test('implements exponential backoff for rate limiting', async () => {
    const mockRateLimitResponse = {
      status: 429,
      json: () => Promise.resolve({
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED'
      })
    };
    
    const mockSuccessResponse = {
      status: 200,
      json: () => Promise.resolve({ success: true })
    };
    
    fetch
      .mockResolvedValueOnce(mockRateLimitResponse)
      .mockResolvedValueOnce(mockRateLimitResponse) 
      .mockResolvedValueOnce(mockSuccessResponse);
    
    const result = await client.requestWithRetry(() => client.submitJob({}));
    
    expect(result).toEqual({ success: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
```

### Error Monitoring Dashboard

```javascript
// Simple error metrics collection
class ErrorMetrics {
  constructor() {
    this.metrics = {
      total: 0,
      byCode: {},
      byEndpoint: {},
      hourly: {}
    };
  }
  
  recordError(error, endpoint) {
    this.metrics.total++;
    
    // By error code
    this.metrics.byCode[error.code] = (this.metrics.byCode[error.code] || 0) + 1;
    
    // By endpoint
    this.metrics.byEndpoint[endpoint] = (this.metrics.byEndpoint[endpoint] || 0) + 1;
    
    // Hourly buckets
    const hour = new Date().toISOString().slice(0, 13);
    this.metrics.hourly[hour] = (this.metrics.hourly[hour] || 0) + 1;
  }
  
  getReport() {
    return {
      ...this.metrics,
      errorRate: this.calculateErrorRate(),
      topErrors: this.getTopErrors(),
      trend: this.getTrend()
    };
  }
}
```

## Summary

Effective error handling in IC Mesh API integration requires:

1. **Consistent error response parsing**
2. **Appropriate retry strategies** (exponential backoff, circuit breakers)
3. **User-friendly error messages**
4. **Comprehensive logging and monitoring**
5. **Graceful degradation** when possible
6. **Testing of error scenarios**

By implementing these patterns, your integration will be robust, reliable, and provide a better user experience even when errors occur.

---

*For additional help with error handling, see the [Troubleshooting Guide](../TROUBLESHOOTING.md) or contact [support](mailto:hello@moilol.com).*