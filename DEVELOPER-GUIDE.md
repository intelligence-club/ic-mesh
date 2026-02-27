# IC Mesh Developer Guide
*Building and Extending the Distributed Compute Network*

This guide covers how to develop for, extend, and contribute to the IC Mesh distributed computing platform.

## Architecture Overview

IC Mesh is a peer-to-peer network where nodes contribute compute resources and earn payment for completed work. The system has three main layers:

### 1. Network Layer (Coordination)
- **Mesh Hub** (`server.js`) — Central coordinator for job distribution
- **Node Discovery** — Automatic registration and heartbeat system  
- **Load Balancing** — Intelligent job routing based on capabilities
- **Payment System** — Automatic compensation via Ints currency

### 2. Execution Layer (Processing)
- **Handler Runtime** (`lib/handler-runtime.js`) — Sandboxed job execution
- **Resource Management** — CPU, memory, and storage limits
- **Process Isolation** — Secure execution of untrusted code
- **Output Streaming** — Real-time job progress and results

### 3. Application Layer (Services)
- **Built-in Handlers** — AI inference, transcription, image generation
- **Custom Handlers** — User-defined processing capabilities
- **API Gateway** — HTTP/WebSocket interfaces for client applications
- **Storage Abstraction** — File upload/download with multiple backends

## Setting Up Development Environment

### Prerequisites
```bash
# Node.js 18+ required
node --version  # Should be v18.0.0 or higher

# SQLite for database
apt install sqlite3  # Ubuntu/Debian
brew install sqlite3 # macOS

# Optional: Docker for containerized development
docker --version
```

### Clone and Setup
```bash
git clone https://github.com/intelligence-club/ic-mesh.git
cd ic-mesh
npm install

# Copy environment template
cp .env.example .env

# Initialize database
node scripts/init-db.js

# Run tests to verify setup
npm test
```

### Environment Configuration
Essential variables for development:

```bash
# Database
DATABASE_FILE=mesh.db

# Network  
PORT=8333
NODE_ENV=development

# Storage (optional - will use local filesystem)
DO_SPACES_KEY=your_spaces_key
DO_SPACES_SECRET=your_spaces_secret
DO_SPACES_BUCKET=ic-mesh-dev
DO_SPACES_REGION=sfo3

# Payment (for testing)
STRIPE_SECRET_KEY=sk_test_...
ADMIN_KEY=dev-admin-key

# Logging
LOG_LEVEL=debug
LOG_FILE=logs/ic-mesh.log
```

## Extending IC Mesh

### Adding New Handler Types

Handlers are the core processing units of IC Mesh. Here's how to add a new capability:

#### 1. Define Handler Specification
Create a new handler spec in `handlers/` directory:

```javascript
// handlers/text-analysis.js
module.exports = {
  name: 'text-analysis',
  description: 'Analyze text for sentiment, keywords, and readability',
  
  // Resource requirements
  requirements: {
    capability: 'nlp',
    minRAM: 512,  // MB
    models: ['sentiment-analysis', 'keyword-extraction']
  },
  
  // Input validation
  validateInput: (payload) => {
    if (!payload.text || typeof payload.text !== 'string') {
      throw new Error('payload.text must be a non-empty string');
    }
    if (payload.text.length > 50000) {
      throw new Error('Text too long (max 50,000 characters)');
    }
    return true;
  },
  
  // Handler execution
  async execute(payload, context) {
    const { text, options = {} } = payload;
    const { workDir, logger } = context;
    
    // Your processing logic here
    const sentiment = await analyzeSentiment(text);
    const keywords = await extractKeywords(text);
    const readability = calculateReadability(text);
    
    return {
      success: true,
      result: {
        sentiment,
        keywords,
        readability,
        processed_chars: text.length
      },
      computeTime: Date.now() - context.startTime
    };
  }
};
```

#### 2. Register Handler
Add your handler to the runtime in `server.js`:

```javascript
const textAnalysisHandler = require('./handlers/text-analysis');

// Register with runtime
runtime.registerHandler('text-analysis', textAnalysisHandler);
```

#### 3. Add Tests
Create comprehensive tests in `test/handlers/`:

```javascript
// test/handlers/text-analysis.test.js
const test = require('ava');
const textAnalysisHandler = require('../../handlers/text-analysis');

test('validates input correctly', t => {
  // Valid input
  t.true(textAnalysisHandler.validateInput({ 
    text: 'Hello world!' 
  }));
  
  // Invalid inputs
  t.throws(() => textAnalysisHandler.validateInput({}));
  t.throws(() => textAnalysisHandler.validateInput({ text: 123 }));
});

test('processes text successfully', async t => {
  const result = await textAnalysisHandler.execute(
    { text: 'This is a great product! I love it.' },
    { 
      workDir: '/tmp/test',
      logger: console,
      startTime: Date.now()
    }
  );
  
  t.true(result.success);
  t.is(typeof result.result.sentiment, 'object');
  t.true(Array.isArray(result.result.keywords));
});
```

### Adding Storage Backends

IC Mesh supports multiple storage backends through a unified interface.

#### 1. Implement Storage Provider
```javascript
// lib/storage/providers/s3-compatible.js
class S3CompatibleStorage {
  constructor(options) {
    this.endpoint = options.endpoint;
    this.bucket = options.bucket;
    this.credentials = options.credentials;
    this.client = new AWS.S3({
      endpoint: this.endpoint,
      credentials: this.credentials
    });
  }
  
  async uploadFile(buffer, filename, mimeType) {
    const key = `jobs/${Date.now()}/${filename}`;
    
    const result = await this.client.upload({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ACL: 'private'
    }).promise();
    
    return {
      url: result.Location,
      key: key,
      size: buffer.length
    };
  }
  
  async getSignedUrl(key, expiresIn = 3600) {
    return this.client.getSignedUrl('getObject', {
      Bucket: this.bucket,
      Key: key,
      Expires: expiresIn
    });
  }
  
  async deleteFile(key) {
    await this.client.deleteObject({
      Bucket: this.bucket,
      Key: key
    }).promise();
  }
}

module.exports = S3CompatibleStorage;
```

#### 2. Register Provider
Add to the storage factory in `lib/storage.js`:

```javascript
const S3CompatibleStorage = require('./storage/providers/s3-compatible');

function createStorageProvider() {
  if (process.env.S3_ENDPOINT) {
    return new S3CompatibleStorage({
      endpoint: process.env.S3_ENDPOINT,
      bucket: process.env.S3_BUCKET,
      credentials: {
        accessKeyId: process.env.S3_KEY,
        secretAccessKey: process.env.S3_SECRET
      }
    });
  }
  
  // Fallback to existing providers...
}
```

### Creating Custom Client Libraries

IC Mesh provides a RESTful API that can be used from any language:

#### Python Client Example
```python
import requests
import time

class ICMeshClient:
    def __init__(self, base_url, api_key):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update({
            'X-Api-Key': api_key,
            'Content-Type': 'application/json'
        })
    
    def submit_job(self, job_type, payload, requirements=None):
        """Submit a job to the mesh network"""
        data = {
            'type': job_type,
            'payload': payload
        }
        if requirements:
            data['requirements'] = requirements
            
        response = self.session.post(f'{self.base_url}/jobs', json=data)
        response.raise_for_status()
        return response.json()
    
    def get_job_status(self, job_id):
        """Get job status and results"""
        response = self.session.get(f'{self.base_url}/jobs/{job_id}')
        response.raise_for_status()
        return response.json()
    
    def wait_for_completion(self, job_id, timeout=300, poll_interval=2):
        """Wait for job to complete"""
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            status = self.get_job_status(job_id)
            
            if status['status'] in ['completed', 'failed']:
                return status
                
            time.sleep(poll_interval)
            
        raise TimeoutError(f'Job {job_id} did not complete within {timeout}s')

# Usage
client = ICMeshClient('https://moilol.com/mesh', 'your-api-key')

# Submit transcription job
job = client.submit_job('transcribe', {
    'audio_url': 'https://example.com/audio.wav'
})

# Wait for completion
result = client.wait_for_completion(job['job']['jobId'])
print(result['result'])
```

## Development Workflows

### Testing
```bash
# Run all tests
npm test

# Run specific test file
npm test test/handlers/transcribe.test.js

# Run with coverage
npm run test:coverage

# Run integration tests (requires running server)
npm run test:integration
```

### Code Quality
```bash
# Lint code
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Check for security vulnerabilities
npm audit

# Update dependencies
npm update
```

### Debugging
```bash
# Run in debug mode
NODE_ENV=development DEBUG=ic-mesh:* npm start

# Debug specific module
DEBUG=ic-mesh:storage npm start

# Debug with Node.js inspector
node --inspect server.js
```

## Contributing Guidelines

### Code Standards
- **ES6+** syntax preferred
- **Consistent formatting** via Prettier
- **Comprehensive tests** for new features
- **Clear documentation** with examples
- **Structured logging** instead of console.log

### Commit Messages
Follow conventional commit format:

```
feat: add text analysis handler
fix: resolve storage timeout issue
docs: update API documentation
refactor: improve error handling
test: add integration tests for job queue
```

### Pull Request Process
1. **Fork** the repository
2. **Create feature branch** (`git checkout -b feature/amazing-feature`)
3. **Write tests** for new functionality
4. **Update documentation** as needed
5. **Submit pull request** with clear description

### Security Considerations
- **Input validation** for all external data
- **Resource limits** to prevent DoS attacks
- **Process isolation** for untrusted code
- **Secure defaults** in configuration
- **Regular security audits** of dependencies

## Performance Optimization

### Node Performance
```javascript
// Good: Efficient job processing
class OptimizedHandler {
  constructor() {
    this.cache = new Map();
    this.pool = new WorkerPool(4);
  }
  
  async execute(payload) {
    // Check cache first
    const cacheKey = this.getCacheKey(payload);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // Use worker pool for CPU-intensive tasks
    const result = await this.pool.exec(payload);
    
    // Cache result
    this.cache.set(cacheKey, result);
    return result;
  }
}
```

### Database Optimization
```sql
-- Add indexes for common queries
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created ON jobs(created);
CREATE INDEX idx_nodes_active ON nodes(lastSeen) WHERE active = 1;

-- Use prepared statements (already implemented)
const stmt = db.prepare('SELECT * FROM jobs WHERE nodeId = ? AND status = ?');
```

### Memory Management
```javascript
// Clean up resources explicitly
class ResourceManager {
  constructor() {
    this.activeJobs = new Map();
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredJobs();
    }, 60000); // Every minute
  }
  
  cleanupExpiredJobs() {
    const expired = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    
    for (const [jobId, job] of this.activeJobs) {
      if (job.created < expired) {
        this.cleanup(jobId);
        this.activeJobs.delete(jobId);
      }
    }
  }
}
```

## Deployment

### Production Checklist
- [ ] **Environment variables** configured correctly
- [ ] **Database backups** scheduled
- [ ] **SSL certificates** installed and auto-renewing
- [ ] **Monitoring** and alerting setup
- [ ] **Log rotation** configured
- [ ] **Resource limits** set appropriately
- [ ] **Security updates** automated

### Scaling Considerations
- **Horizontal scaling** — Run multiple mesh nodes
- **Load balancing** — Use job affinity for efficiency  
- **Database sharding** — Split by node or job type
- **Caching layer** — Redis for job queues and results
- **CDN integration** — For file storage and delivery

This guide provides the foundation for extending and contributing to IC Mesh. For specific implementation questions, check the existing code patterns in the `lib/` and `handlers/` directories.

---

*Happy coding! The mesh grows stronger with every contribution.*