#!/usr/bin/env node
// Fetch polyfill for Node.js < 18
if (!globalThis.fetch) {
  try { globalThis.fetch = require('node-fetch'); }
  catch(e) {
    console.error('❌ Node.js < 18 detected and node-fetch not installed.');
    console.error('   Run: npm install node-fetch@2');
    process.exit(1);
  }
}
/**
 * IC Mesh — Node Client v0.3.0
 * 
 * Runs on each node (Mac Mini, laptop, server).
 * Checks in with the coordination server, picks up jobs, reports results.
 * 
 * Safety-first design:
 * - All jobs run with hard timeouts (no zombies)
 * - Node ID persisted to disk (no duplicate registrations)
 * - Auto-updates from git (no manual SSH needed)
 * - Child processes tracked and killed on timeout
 * - Graceful shutdown on SIGINT/SIGTERM
 * - Failures reported to server for re-queue
 * 
 * Usage:
 *   IC_MESH_SERVER=https://moilol.com/mesh \
 *   IC_NODE_NAME=my-node \
 *   IC_NODE_OWNER=drake \
 *   node client.js
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const WebSocket = require('ws');
const { scanCapabilities, executeFromSpec, loadHandlerSpecs, detectCapability } = require('./lib/handler-loader');

// ===== Handler Specs (loaded once at startup) =====
let handlerScan = null; // populated in init()

// ===== Configuration =====

// Load config from node-config.json if it exists, with env var overrides
let config = {
  meshServer: 'http://localhost:8333',
  nodeName: null,
  nodeOwner: null,
  nodeRegion: 'unknown',
  sdUrl: 'http://localhost:7860',
  useWebSocket: true,
  checkinInterval: 60_000,
  jobPollInterval: 10_000,
  updateCheckInterval: 300_000,
  jobTimeouts: {
    ping: 5_000,
    inference: 300_000,
    transcribe: 600_000,
    generate: 900_000,
    default: 300_000
  },
  // New configuration options
  handlers: {},
  limits: {
    maxCpuPercent: 80,
    maxRamPercent: 70,
    maxConcurrentJobs: 3,
    maxFileSizeMB: 50
  },
  schedule: {
    enabled: false,
    timezone: null,
    available: []
  },
  pricing: {
    multiplier: 1.0
  }
};

const CONFIG_FILE = path.join(__dirname, 'node-config.json');
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    
    // Handle both simple flat format and complex nested format
    if (fileConfig.node || fileConfig.server) {
      // Complex nested format (example.json style)
      if (fileConfig.server?.url) config.meshServer = fileConfig.server.url;
      if (fileConfig.node?.name) config.nodeName = fileConfig.node.name;
      if (fileConfig.node?.owner) config.nodeOwner = fileConfig.node.owner;
      if (fileConfig.node?.region) config.nodeRegion = fileConfig.node.region;
      
      // Enhanced config loading
      if (fileConfig.limits) {
        config.limits = { ...config.limits, ...fileConfig.limits };
      }
      if (fileConfig.handlers) {
        config.handlers = fileConfig.handlers;
      }
      if (fileConfig.schedule) {
        config.schedule = { ...config.schedule, ...fileConfig.schedule };
      }
      if (fileConfig.pricing) {
        config.pricing = { ...config.pricing, ...fileConfig.pricing };
      }
      
      // Update job timeouts from handler config
      if (fileConfig.handlers) {
        for (const [handlerName, handlerConfig] of Object.entries(fileConfig.handlers)) {
          if (handlerConfig.resources?.timeout) {
            config.jobTimeouts[handlerName] = handlerConfig.resources.timeout * 1000; // Convert to ms
          }
        }
      }
      
      // WebSocket toggle from config
      if (fileConfig.useWebSocket !== undefined) config.useWebSocket = fileConfig.useWebSocket;
      
      // Store complete config for advanced features
      config._complexConfig = fileConfig;
      console.log(`◉ Loaded complex config from ${CONFIG_FILE}`);
      console.log(`  Handlers: ${Object.keys(config.handlers).filter(h => config.handlers[h].enabled !== false).length} enabled`);
      console.log(`  Limits: ${config.limits.maxCpuPercent}% CPU, ${config.limits.maxRamPercent}% RAM, ${config.limits.maxConcurrentJobs} concurrent jobs`);
      if (config.schedule.enabled) {
        console.log(`  Schedule: ${config.schedule.available?.length || 0} time windows (${config.schedule.timezone})`);
      }
    } else {
      // Simple flat format (sample.json style)
      // Support common alternate key names
      if (fileConfig.SERVER_HOST && !fileConfig.meshServer) {
        const port = fileConfig.SERVER_PORT || 8333;
        const protocol = port === 443 ? 'https' : 'http';
        fileConfig.meshServer = `${protocol}://${fileConfig.SERVER_HOST}:${port}`;
      }
      if (fileConfig.NODE_ID && !fileConfig.nodeName) fileConfig.nodeName = fileConfig.NODE_ID;
      config = { ...config, ...fileConfig };
      console.log(`◉ Loaded simple config from ${CONFIG_FILE}`);
    }
  } catch (err) {
    console.warn(`Failed to parse ${CONFIG_FILE}: ${err.message}`);
  }
} else {
  console.log(`◉ No config file found at ${CONFIG_FILE}, using defaults`);
}

// Environment variables override config file
const MESH_SERVER = process.env.IC_MESH_SERVER || config.meshServer;
const NODE_NAME = process.env.IC_NODE_NAME || config.nodeName || os.hostname();
const NODE_OWNER = process.env.IC_NODE_OWNER || config.nodeOwner || os.userInfo().username;

// Validate node owner - prevent "unknown" nodes from registering
if (!NODE_OWNER || NODE_OWNER === 'unknown' || NODE_OWNER.trim() === '') {
  console.error('❌ Node owner validation failed!');
  console.error('   Node owner cannot be empty or "unknown"');
  console.error('');
  console.error('   Fix this by setting one of:');
  console.error('   1. Environment variable: IC_NODE_OWNER=yourname');
  console.error('   2. Config file: { "nodeOwner": "yourname" }');
  console.error('   3. Ensure os.userInfo().username returns valid name');
  console.error('');
  console.error(`   Current owner value: "${NODE_OWNER}"`);
  process.exit(1);
}

const NODE_REGION = process.env.IC_NODE_REGION || config.nodeRegion;
const CHECKIN_INTERVAL = config.checkinInterval;
const JOB_POLL_INTERVAL = config.jobPollInterval;
const UPDATE_CHECK_INTERVAL = config.updateCheckInterval;
const MAX_CONCURRENT_JOBS = config.maxConcurrentJobs || (config._complexConfig?.limits?.maxConcurrentJobs) || 3;

// Auto-disable WebSocket for remote servers (proxy WS is unreliable)
if (config.useWebSocket && MESH_SERVER && !MESH_SERVER.includes('localhost') && !MESH_SERVER.includes('127.0.0.1')) {
  config.useWebSocket = false;
  console.log('◉ Remote server detected — using HTTP polling (more reliable than WS proxy)');
}
const NODE_ID_FILE = path.join(__dirname, '.node-id');

// Job timeout defaults (ms) — payload.timeout (seconds) overrides
const JOB_TIMEOUTS = config.jobTimeouts;

let nodeId = loadNodeId();
let currentJob = null;
let activeChildProcess = null;
let wsConnection = null;
let isConnecting = false;
let shuttingDown = false;
let jobRunning = false;
let pollInterval = null;
let currentJobId = null;

// ===== Node ID Persistence =====

function loadNodeId() {
  try {
    const id = fs.readFileSync(NODE_ID_FILE, 'utf8').trim();
    if (id && id.length >= 8) return id;
  } catch {}
  return null;
}

function saveNodeId(id) {
  try { fs.writeFileSync(NODE_ID_FILE, id); } catch {}
}

function getLocalVersion() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname, encoding: 'utf8', timeout: 5000 }).trim();
  } catch { return 'unknown'; }
}

// ===== System Info =====

function getSystemInfo() {
  const cpus = os.cpus();
  const totalMem = Math.round(os.totalmem() / 1024 / 1024);
  const freeMem = Math.round(os.freemem() / 1024 / 1024);
  const loadAvg = os.loadavg()[0];
  const cpuIdle = Math.max(0, Math.round((1 - loadAvg / cpus.length) * 100));

  return {
    cpuCores: cpus.length,
    cpuModel: cpus[0]?.model || 'unknown',
    ramMB: totalMem,
    ramFreeMB: freeMem,
    cpuIdle,
    diskFreeGB: getDiskFree(),
    gpuVRAM: 0
  };
}

function getDiskFree() {
  try {
    if (process.platform === 'darwin') {
      return parseInt(execSync("df -g / | tail -1 | awk '{print $4}'", { encoding: 'utf8', timeout: 5000 })) || 0;
    }
    return parseInt(execSync("df -BG / | tail -1 | awk '{print $4}'", { encoding: 'utf8', timeout: 5000 })) || 0;
  } catch { return 0; }
}

function getCapabilities() {
  // Primary: YAML handler specs (declarative)
  if (!handlerScan) {
    handlerScan = scanCapabilities();
    console.log(`◉ Handler scan: ${handlerScan.specsLoaded} specs loaded, ${Object.keys(handlerScan.manifests).length} detected, ${handlerScan.skipped.length} skipped`);
    if (handlerScan.skipped.length > 0) console.log(`  Skipped: ${handlerScan.skipped.join(', ')}`);
    for (const [name, manifest] of Object.entries(handlerScan.manifests)) {
      console.log(`  ✓ ${name}: ${manifest.models.length} models, backends: ${manifest.backends.join(',')}`);
    }
  }

  const caps = [...handlerScan.capabilities];

  // Legacy: hardcoded detection for capabilities without YAML specs
  const which = (cmd) => { try { execSync(`which ${cmd}`, { encoding: 'utf8', timeout: 3000, stdio: 'pipe' }); return true; } catch { return false; } };

  // ffmpeg and gpu detection don't have YAML specs yet — keep as legacy
  if (which('ffmpeg') && !caps.includes('ffmpeg')) caps.push('ffmpeg');
  if (which('nvidia-smi') && !caps.includes('gpu-nvidia')) caps.push('gpu-nvidia');
  try {
    if (execSync('uname -m', { encoding: 'utf8', timeout: 3000 }).trim() === 'arm64' && process.platform === 'darwin')
      if (!caps.includes('gpu-metal')) caps.push('gpu-metal');
  } catch {}

  // Add capabilities from node-config.json handlers (legacy config format)
  if (config.handlers) {
    for (const [handlerName, handlerConfig] of Object.entries(config.handlers)) {
      if (handlerConfig.enabled !== false && !caps.includes(handlerName)) {
        caps.push(handlerName);
      }
    }
  }

  // Always include ping
  if (!caps.includes('ping')) caps.push('ping');

  return [...new Set(caps)];
}

function getOllamaModels() {
  try {
    return execSync('ollama list 2>/dev/null', { encoding: 'utf8', timeout: 10000 })
      .split('\n').slice(1).filter(Boolean).map(l => l.split(/\s+/)[0]).filter(Boolean);
  } catch { return []; }
}

async function getSDModels() {
  const sdUrl = process.env.IC_SD_URL || config.sdUrl;
  if (!sdUrl) {
    // Try default ports
    for (const port of [7860, 7861]) {
      try {
        const r = await fetch(`http://localhost:${port}/sdapi/v1/sd-models`, { signal: AbortSignal.timeout(5000) });
        const models = await r.json();
        return models.map(m => m.model_name || m.title).filter(Boolean);
      } catch {}
    }
    return [];
  }
  try {
    const r = await fetch(`${sdUrl}/sdapi/v1/sd-models`, { signal: AbortSignal.timeout(5000) });
    const models = await r.json();
    return models.map(m => m.model_name || m.title).filter(Boolean);
  } catch { return []; }
}

function getWhisperModels() {
  // Check for whisper model files in common locations
  const models = [];
  const whisperPaths = [
    path.join(os.homedir(), '.cache', 'whisper'),
    path.join(os.homedir(), 'Library', 'Caches', 'whisper'),
    '/usr/local/share/whisper/models'
  ];
  for (const p of whisperPaths) {
    try {
      const files = fs.readdirSync(p).filter(f => f.endsWith('.bin') || f.endsWith('.pt'));
      for (const f of files) {
        const match = f.match(/(tiny|base|small|medium|large(?:-v[23])?)/);
        if (match) models.push(match[1]);
      }
    } catch {}
  }
  // Also check if whisper CLI reports models
  if (models.length === 0) {
    try {
      const out = execSync('whisper --help 2>&1 || true', { encoding: 'utf8', timeout: 5000 });
      const match = out.match(/model.*?{([^}]+)}/);
      if (match) models.push(...match[1].split(',').map(s => s.trim()));
    } catch {}
  }
  return [...new Set(models)];
}

// ===== Network Communication =====

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function meshFetch(urlPath, options = {}) {
  const url = `${MESH_SERVER}${urlPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Node-Id': nodeId || '', ...options.headers }
    });
    return await resp.json();
  } catch (e) {
    if (e.name !== 'AbortError') console.error(`  ✗ Mesh unreachable: ${e.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function meshFetchRetry(urlPath, options = {}, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    const result = await meshFetch(urlPath, options);
    if (result) return result;
    if (i < retries) {
      console.log(`  ⟳ Retry ${i}/${retries} in ${i * 2}s...`);
      await sleep(i * 2000);
    }
  }
  return null;
}

// ===== Job Execution with Timeout =====

function getJobTimeout(job) {
  // Job-specific timeout in payload takes precedence
  if (job.payload?.timeout) return Math.min(job.payload.timeout * 1000, 1_800_000);
  
  // Handler-specific timeout from config
  if (config.handlers?.[job.type]?.resources?.timeout) {
    return config.handlers[job.type].resources.timeout * 1000;
  }
  
  // Global job timeout config
  return config.jobTimeouts[job.type] || config.jobTimeouts.default;
}

/**
 * Run a shell command with a hard timeout.
 * Kills the process tree on timeout — no zombies.
 */
function execWithTimeout(cmd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', cmd], { detached: true });
    activeChildProcess = child;
    let stdout = '', stderr = '', killed = false;

    child.stdout?.on('data', d => { stdout += d; });
    child.stderr?.on('data', d => { stderr += d; });

    const timer = setTimeout(() => {
      killed = true;
      console.log(`  ⏰ Timeout (${Math.round(timeoutMs/1000)}s) — killing pid ${child.pid}`);
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      activeChildProcess = null;
      if (killed) reject(new Error(`Timed out after ${Math.round(timeoutMs/1000)}s`));
      else if (code !== 0) reject(new Error(`Exit code ${code}: ${stderr.slice(0, 500)}`));
      else resolve(stdout);
    });

    child.on('error', (e) => { clearTimeout(timer); activeChildProcess = null; reject(e); });
  });
}

async function executeJobSafe(job) {
  const timeoutMs = getJobTimeout(job);
  currentJob = job;
  try {
    return await Promise.race([
      executeJob(job),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`Master timeout (${Math.round(timeoutMs/1000)}s)`)), timeoutMs + 5000))
    ]);
  } finally {
    currentJob = null;
    if (activeChildProcess) { try { activeChildProcess.kill('SIGKILL'); } catch {} activeChildProcess = null; }
  }
}

async function runCustomHandler(job) {
  const handler = config.handlers[job.type];
  const timeoutMs = getJobTimeout(job);
  
  if (!handler.command) {
    throw new Error(`Handler ${job.type} has no command specified`);
  }
  
  console.log(`  ◉ Running custom handler: ${handler.command}`);
  
  // Prepare environment variables
  const env = { ...process.env };
  
  // Add handler-specific environment variables
  if (handler.env) {
    Object.assign(env, handler.env);
  }
  
  // Add job payload as environment variables
  if (job.payload) {
    env.JOB_PAYLOAD = JSON.stringify(job.payload);
    env.JOB_ID = job.jobId;
    env.JOB_TYPE = job.type;
    
    // Add specific payload fields as env vars
    for (const [key, value] of Object.entries(job.payload)) {
      if (typeof value === 'string' || typeof value === 'number') {
        env[`JOB_${key.toUpperCase()}`] = String(value);
      }
    }
  }
  
  // Create temporary directory for handler output
  const tmpDir = path.join(os.tmpdir(), `ic-mesh-handler-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  env.HANDLER_OUTPUT_DIR = tmpDir;
  env.HANDLER_TEMP_DIR = tmpDir;
  
  try {
    // Download input files if URL provided
    const inputFiles = [];
    if (job.payload?.url) {
      // Validate URL — must be http(s), no path traversal, no shell injection
      let parsedUrl;
      try { parsedUrl = new URL(job.payload.url); } catch { throw new Error('Invalid URL in payload'); }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('URL must be http or https');
      if (parsedUrl.pathname.includes('..')) throw new Error('Path traversal detected in URL');
      const safeUrl = parsedUrl.href.replace(/[;&|`$\\]/g, ''); // strip shell metacharacters
      
      const ext = path.extname(parsedUrl.pathname) || '.bin';
      const inputFile = path.join(tmpDir, `input${ext}`);
      await execWithTimeout(`curl -sL --max-filesize 500000000 -o "${inputFile}" "${safeUrl}"`, Math.min(timeoutMs, 120_000));
      inputFiles.push(inputFile);
    }
    
    // Prepare stdin data for handler
    const stdinData = JSON.stringify({
      ...job,
      inputFiles,
      outputDir: tmpDir
    });
    
    // Execute handler command with stdin and timeout
    const output = await new Promise((resolve, reject) => {
      const proc = require('child_process').spawn('bash', ['-c', handler.command], {
        env, cwd: path.join(__dirname),
        timeout: timeoutMs
      });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => stdout += d);
      proc.stderr.on('data', d => { stderr += d; process.stderr.write(d); });
      proc.on('close', code => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`Exit ${code}: ${stderr.slice(-500)}`));
      });
      proc.on('error', reject);
      proc.stdin.write(stdinData);
      proc.stdin.end();
    });
    
    // Try to parse output as JSON, fall back to plain text
    let result;
    try {
      result = JSON.parse(output.trim());
    } catch {
      result = { success: true, output: output.trim(), handler: job.type };
    }

    // Upload output files back to mesh server so consumers can download them
    if (result.outputFiles && Array.isArray(result.outputFiles)) {
      const uploadedUrls = [];
      for (const filePath of result.outputFiles) {
        if (fs.existsSync(filePath)) {
          try {
            const fileName = path.basename(filePath);
            const fileData = fs.readFileSync(filePath);
            const boundary = '----ICMeshUpload' + Date.now();
            const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
            const footer = `\r\n--${boundary}--\r\n`;
            const body = Buffer.concat([Buffer.from(header), fileData, Buffer.from(footer)]);
            
            const uploadRes = await fetch(`${MESH_SERVER}/upload`, {
              method: 'POST',
              headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
              body
            });
            const uploadData = await uploadRes.json();
            if (uploadData.ok && uploadData.url) {
              uploadedUrls.push(uploadData.url);
              console.log(`  ↑ Uploaded output: ${fileName} → ${uploadData.url}`);
            }
          } catch (e) {
            console.log(`  ⚠ Failed to upload ${filePath}: ${e.message}`);
          }
        }
      }
      if (uploadedUrls.length > 0) {
        result.output_url = uploadedUrls[0];
        result.outputUrls = uploadedUrls;
        delete result.outputFiles; // Remove local paths from result
      }
    }

    return result;
  } catch (error) {
    throw new Error(`Handler ${job.type} failed: ${error.message}`);
  } finally {
    // Cleanup temporary directory
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
}

// ===== Job Handlers =====

async function executeJob(job) {
  // Priority 1: YAML handler specs (declarative)
  if (handlerScan?.manifests) {
    // Direct match
    let spec = handlerScan.manifests[job.type];
    // Try alias match
    if (!spec) {
      for (const [name, manifest] of Object.entries(handlerScan.manifests)) {
        if (manifest.aliases?.includes(job.type)) {
          spec = loadHandlerSpecs()[name];
          break;
        }
      }
    }
    if (spec) {
      console.log(`  → YAML handler: ${spec.capability} (${spec._file})`);
      return await executeFromSpec(spec, job);
    }
  }

  // Priority 2: node-config.json custom handlers (legacy)
  if (config.handlers && config.handlers[job.type] && config.handlers[job.type].enabled !== false) {
    return await runCustomHandler(job);
  }
  
  // Priority 3: built-in handlers (hardcoded)
  switch (job.type) {
    case 'inference': return await runInference(job.payload, getJobTimeout(job));
    case 'transcribe': return await runTranscribe(job.payload, getJobTimeout(job));
    case 'ffmpeg': return await runFFmpegJob(job, getJobTimeout(job));
    case 'generate': case 'generate-image': return await runGenerate(job.payload, getJobTimeout(job));
    case 'ping': return { pong: true, node: NODE_NAME, time: Date.now(), version: getLocalVersion() };
    default: throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function runFFmpegJob(job, timeoutMs) {
  const payload = job.payload || {};
  const FFMPEG_SERVICE = 'http://localhost:7880';
  
  // Check if ffmpeg-service is available (preferred — no shell execution)
  let useService = false;
  try {
    const health = await fetch(`${FFMPEG_SERVICE}/`, { signal: AbortSignal.timeout(2000) });
    useService = health.ok;
  } catch {}
  
  if (useService) {
    console.log('  🎬 Using ffmpeg-service (safe API)');
    
    // Map job payload to service operation
    const operation = payload.operation || 'compress';
    const validOps = ['compress', 'convert', 'extract-audio', 'trim', 'thumbnail', 'info'];
    if (!validOps.includes(operation)) throw new Error(`Invalid ffmpeg operation: ${operation}. Valid: ${validOps.join(', ')}`);
    
    const servicePayload = { url: payload.url, ...payload };
    delete servicePayload.email;
    delete servicePayload.job_token;
    delete servicePayload.price_ints;
    
    const resp = await fetch(`${FFMPEG_SERVICE}/api/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(servicePayload),
      signal: AbortSignal.timeout(timeoutMs)
    });
    
    const result = await resp.json();
    if (!result.success && result.error) throw new Error(result.error);
    
    // Upload output file if present
    if (result.outputFile && fs.existsSync(result.outputFile)) {
      const fileName = path.basename(result.outputFile);
      const fileData = fs.readFileSync(result.outputFile);
      const boundary = '----ICMeshUpload' + Date.now();
      const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
      const footer = `\r\n--${boundary}--\r\n`;
      const body = Buffer.concat([Buffer.from(header), fileData, Buffer.from(footer)]);
      
      const uploadRes = await fetch(`${MESH_SERVER}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      });
      const uploadData = await uploadRes.json();
      if (uploadData.ok && uploadData.url) {
        result.output_url = uploadData.url;
        console.log(`  ↑ Uploaded: ${fileName} → ${uploadData.url}`);
      }
      delete result.outputFile;
    }
    
    return result;
  }
  
  // Fallback to custom handler (shell script — less safe but works without service)
  console.log('  ⚠ ffmpeg-service not running, falling back to shell handler');
  return await runCustomHandler(job, timeoutMs);
}

async function runInference(payload, timeoutMs) {
  const model = payload.model || 'llama3.1:8b';
  const prompt = payload.prompt || '';
  
  // Validate inputs
  if (!prompt.trim()) throw new Error('Empty prompt — please provide a question or instruction');
  
  // Check if model exists on this node
  const ollamaModels = getOllamaModels();
  if (ollamaModels.length > 0 && !ollamaModels.some(m => m === model || m.startsWith(model.split(':')[0]))) {
    throw new Error(`Model "${model}" not found. Available: ${ollamaModels.slice(0, 5).join(', ')}${ollamaModels.length > 5 ? '...' : ''}`);
  }
  
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Use streaming to avoid timeout on slow models — each chunk resets our activity timer
    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: true }),
      signal: controller.signal
    });
    
    if (!resp.ok) throw new Error(`Ollama returned ${resp.status}`);
    
    let fullResponse = '';
    let tokens = 0;
    let lastProgress = Date.now();
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer
      
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          if (chunk.response) fullResponse += chunk.response;
          if (chunk.eval_count) tokens = chunk.eval_count;
          
          // Report progress every 3s
          if (Date.now() - lastProgress > 3000 && currentJobId) {
            const wordCount = fullResponse.split(/\s+/).filter(Boolean).length;
            try {
              await fetch(`${MESH_SERVER}/jobs/${currentJobId}/progress`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pct: chunk.done ? 100 : 50, step: wordCount, steps: 0, eta: null, nodeId })
              });
            } catch {}
            lastProgress = Date.now();
          }
          
          // Reset timeout on each chunk — model is alive
          clearTimeout(timer);
          timer = setTimeout(() => controller.abort(), 120000);
        } catch {}
      }
    }
    
    return { response: fullResponse, model, tokens };
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `Inference timeout (${Math.round(timeoutMs/1000)}s)` : `Ollama failed: ${e.message}`);
  } finally { clearTimeout(timer); }
}

async function runGenerate(payload, timeoutMs) {
  const SD_URL = process.env.IC_SD_URL || config.sdUrl;
  const params = {
    prompt: payload.prompt || '', negative_prompt: payload.negative_prompt || '',
    width: payload.width || 1024, height: payload.height || 1024,
    steps: payload.steps || 30, cfg_scale: payload.cfg_scale || 5,
    sampler_name: payload.sampler || 'Euler a', seed: payload.seed || -1,
    batch_size: 1, n_iter: 1
  };

  if (payload.model) {
    console.log(`  ◉ Switching to model: ${payload.model}`);
    try {
      const c = new AbortController(); setTimeout(() => c.abort(), 30000);
      await fetch(`${SD_URL}/sdapi/v1/options`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sd_model_checkpoint: payload.model }), signal: c.signal
      });
    } catch (e) { console.log(`  ⚠ Model switch failed: ${e.message}`); }
  }

  console.log(`  ◉ Generating: "${params.prompt.slice(0, 80)}..." (${params.width}x${params.height}, ${params.steps} steps)`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Poll SD progress and report to mesh server
  const progressInterval = setInterval(async () => {
    try {
      const prog = await fetch(`${SD_URL}/sdapi/v1/progress`, { signal: AbortSignal.timeout(3000) });
      const p = await prog.json();
      if (p.progress > 0 && p.progress < 1) {
        const pct = Math.round(p.progress * 100);
        const step = p.state?.sampling_step || 0;
        const steps = p.state?.sampling_steps || params.steps;
        const eta = p.eta_relative ? Math.round(p.eta_relative) : null;
        const progressData = { pct, step, steps, eta, stage: 'generating' };
        console.log(`  ◉ Progress: ${pct}% (step ${step}/${steps}${eta ? ', ~' + eta + 's left' : ''})`);
        // Report to mesh server
        try {
          await fetch(`${MESH_SERVER}/jobs/${currentJobId}/progress`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodeId, progress: progressData }),
            signal: AbortSignal.timeout(3000)
          });
        } catch {}
      }
    } catch {}
  }, 2000);

  try {
    const resp = await fetch(`${SD_URL}/sdapi/v1/txt2img`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params), signal: controller.signal
    });
    clearInterval(progressInterval);
    if (!resp.ok) throw new Error(`SD API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data = await resp.json();
    if (!data.images?.length) throw new Error('No images returned');

    const imgBuffer = Buffer.from(data.images[0], 'base64');
    const filename = `gen-${Date.now()}.png`;

    // Try hub upload
    try {
      const boundary = '----ICMesh' + Date.now();
      const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`);
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const uploadResp = await fetch(`${MESH_SERVER}/upload`, {
        method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: Buffer.concat([header, imgBuffer, footer])
      });
      const u = await uploadResp.json();
      if (u.url) return { url: u.url, width: params.width, height: params.height, prompt: params.prompt, steps: params.steps, seed: data.parameters?.seed || params.seed, sizeBytes: imgBuffer.length };
    } catch (e) { console.log(`  ⚠ Upload failed: ${e.message}, returning base64`); }

    return { image_base64: data.images[0], width: params.width, height: params.height, prompt: params.prompt, steps: params.steps, seed: data.parameters?.seed || params.seed, sizeBytes: imgBuffer.length };
  } catch (e) {
    throw e.name === 'AbortError' ? new Error(`SD timeout (${Math.round(timeoutMs/1000)}s)`) : e;
  } finally { clearTimeout(timer); clearInterval(progressInterval); }
}

async function runTranscribe(payload, timeoutMs) {
  const url = payload.url;
  if (!url) throw new Error('No audio URL provided');

  const tmpDir = path.join(os.tmpdir(), 'ic-mesh-jobs');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const ext = path.extname(new URL(url).pathname) || '.wav';
  const tmpFile = path.join(tmpDir, `transcribe-${Date.now()}${ext}`);
  const outDir = path.join(tmpDir, `out-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });

  try {
    console.log(`  ↓ Downloading: ${url}`);
    await execWithTimeout(`curl -sL -o "${tmpFile}" "${url}"`, Math.min(timeoutMs, 120_000));

    const model = payload.model || 'base';
    const language = payload.language || 'en';
    console.log(`  ◉ Transcribing with whisper (model: ${model})...`);
    
    // Report progress during transcription
    const fileSizeMB = fs.statSync(tmpFile).size / (1024 * 1024);
    const estimatedSec = Math.max(10, fileSizeMB * 15); // rough: ~15s per MB
    const startTime = Date.now();
    const transcribeProgress = setInterval(async () => {
      const elapsed = (Date.now() - startTime) / 1000;
      const pct = Math.min(90, Math.round((elapsed / estimatedSec) * 100));
      const stage = elapsed < 5 ? 'loading model' : 'transcribing';
      try {
        await fetch(`${MESH_SERVER}/jobs/${currentJobId}/progress`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId, progress: { pct, stage, elapsed: Math.round(elapsed), estimatedTotal: Math.round(estimatedSec) } }),
          signal: AbortSignal.timeout(3000)
        });
      } catch {}
    }, 2000);
    
    try {
      await execWithTimeout(`whisper "${tmpFile}" --model ${model} --language ${language} --output_dir "${outDir}" --output_format txt`, timeoutMs);
    } finally {
      clearInterval(transcribeProgress);
    }

    const txtFiles = fs.readdirSync(outDir).filter(f => f.endsWith('.txt'));
    const transcript = txtFiles.length ? fs.readFileSync(path.join(outDir, txtFiles[0]), 'utf8').trim() : '(no output)';
    return { transcript, model, language, chars: transcript.length };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
    try { fs.rmSync(outDir, { recursive: true }); } catch {}
  }
}

// ===== WebSocket Connection =====
let wsFailCount = 0;
const WS_MAX_FAILURES = 3;

function connectWebSocket() {
  if (isConnecting || (wsConnection && wsConnection.readyState === WebSocket.OPEN)) return;
  
  // After repeated failures, give up on WS and stick with polling
  if (wsFailCount >= WS_MAX_FAILURES) {
    if (!pollInterval) {
      console.log(`◉ WebSocket failed ${wsFailCount} times — switching permanently to HTTP polling`);
      pollInterval = setInterval(pollJobs, JOB_POLL_INTERVAL);
    }
    return;
  }

  isConnecting = true;
  const wsUrl = MESH_SERVER.replace('http://', 'ws://').replace('https://', 'wss://') + `/ws?nodeId=${nodeId}`;
  
  console.log(`◉ Connecting via WebSocket: ${wsUrl}`);
  wsConnection = new WebSocket(wsUrl);
  
  wsConnection.on('open', () => {
    isConnecting = false;
    console.log(`◉ WebSocket connected — job polling disabled`);
    wsFailCount = 0; // Reset on successful connection
    // Stop HTTP polling fallback if running
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  });
  
  wsConnection.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleWebSocketMessage(msg);
    } catch (err) {
      console.error(`✗ WS message parse error: ${err.message}`);
    }
  });
  
  wsConnection.on('close', (code, reason) => {
    isConnecting = false;
    console.log(`◉ WebSocket disconnected: ${code} ${reason}`);
    wsFailCount++;
    console.log(`  Falling back to HTTP polling... (failure ${wsFailCount}/${WS_MAX_FAILURES})`);
    // Start HTTP polling as fallback while WS is down
    if (!pollInterval) {
      pollInterval = setInterval(pollJobs, JOB_POLL_INTERVAL);
    }
    // Reconnect after 5 seconds (unless max failures reached)
    if (wsFailCount < WS_MAX_FAILURES) {
      setTimeout(connectWebSocket, 5000);
    }
  });
  
  wsConnection.on('error', (err) => {
    isConnecting = false;
    console.error(`✗ WebSocket error: ${err.message}`);
  });
}

async function claimJob(jobId) {
  if (jobRunning) return false;
  
  console.log(`◉ Claiming job: ${jobId}`);
  const claimed = await meshFetch(`/jobs/${jobId}/claim`, {
    method: 'POST', body: JSON.stringify({ nodeId })
  });
  
  if (!claimed?.ok) { 
    console.log(`  ✗ Claim failed`); 
    return false; 
  }
  
  // Get full job details and execute
  const jobResult = await meshFetch(`/jobs/${jobId}`);
  if (jobResult?.ok && jobResult.data) {
    const job = jobResult.data;
    console.log(`  ✓ Claimed (timeout: ${Math.round(getJobTimeout(job)/1000)}s)`);
    jobRunning = true;
    currentJobId = job.jobId;
    
    // Execute job in background
    executeJob(job).catch(err => {
      console.error(`Job execution error: ${err.message}`);
      jobRunning = false;
    });
    return true;
  }
  
  return false;
}

function handleWebSocketMessage(msg) {
  switch (msg.type) {
    case 'job.dispatch':
      if (msg.job && canTakeJob(msg.job)) {
        claimJob(msg.job.jobId);
      }
      break;
    case 'jobs.available':
      if (msg.jobs && msg.jobs.length > 0) {
        const job = msg.jobs.find(canTakeJob);
        if (job) claimJob(job.jobId);
      }
      break;
    default:
      console.log(`◉ WS message: ${msg.type}`);
  }
}

function claimJob(jobId) {
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
    console.log(`✗ Cannot claim job - WebSocket not connected`);
    return;
  }
  
  wsConnection.send(JSON.stringify({
    type: 'job.claim',
    jobId: jobId
  }));
}

function checkResourceLimits() {
  const sysInfo = getSystemInfo();
  const cpuUsage = 100 - sysInfo.cpuIdle;
  const ramUsage = ((sysInfo.ramMB - sysInfo.ramFreeMB) / sysInfo.ramMB) * 100;
  
  return {
    cpuOk: cpuUsage <= config.limits.maxCpuPercent,
    ramOk: ramUsage <= config.limits.maxRamPercent,
    cpuUsage: Math.round(cpuUsage),
    ramUsage: Math.round(ramUsage)
  };
}

function isScheduleActive() {
  if (!config.schedule.enabled) return true;
  
  const now = new Date();
  const dayOfWeek = ['sun','mon','tue','wed','thu','fri','sat'][now.getDay()];
  const timeStr = now.toTimeString().slice(0, 5); // HH:MM format
  
  for (const window of config.schedule.available || []) {
    if (!window.days.includes(dayOfWeek)) continue;
    
    // Handle overnight schedules (end < start)
    if (window.end < window.start) {
      if (timeStr >= window.start || timeStr <= window.end) return true;
    } else {
      if (timeStr >= window.start && timeStr <= window.end) return true;
    }
  }
  
  return false;
}

function canTakeJob(job) {
  if (currentJob) return false;
  if (!job.requirements) return true;
  
  // Check schedule
  if (!isScheduleActive()) return false;
  
  // Check resource limits
  const resources = checkResourceLimits();
  if (!resources.cpuOk || !resources.ramOk) return false;
  
  const reqs = typeof job.requirements === 'string' ? JSON.parse(job.requirements) : job.requirements;
  const caps = getCapabilities();
  
  // Check capabilities
  if (reqs.capabilities) {
    if (!reqs.capabilities.every(cap => caps.includes(cap))) return false;
  }
  
  // Check handler-specific requirements
  if (config.handlers[job.type]) {
    const handler = config.handlers[job.type];
    
    // Check if handler is enabled
    if (handler.enabled === false) return false;
    
    // Check GPU requirements
    if (handler.resources?.requiresGPU) {
      const hasGPU = caps.some(cap => cap.includes('gpu'));
      if (!hasGPU) return false;
    }
    
    // Check file size limits
    if (job.payload?.fileSize && handler.accepts?.maxInputSizeMB) {
      const fileSizeMB = job.payload.fileSize / (1024 * 1024);
      if (fileSizeMB > handler.accepts.maxInputSizeMB) return false;
    }
  }
  
  return true;
}

// ===== Auto-Update =====

async function checkForUpdates() {
  if (shuttingDown) return;
  try {
    execSync('git fetch origin main --quiet 2>/dev/null', { cwd: __dirname, timeout: 15000 });
    const local = execSync('git rev-parse HEAD', { cwd: __dirname, encoding: 'utf8', timeout: 5000 }).trim();
    const remote = execSync('git rev-parse origin/main', { cwd: __dirname, encoding: 'utf8', timeout: 5000 }).trim();
    if (local === remote) return;

    console.log(`\n◉ Update available: ${local.slice(0,7)} → ${remote.slice(0,7)}`);
    if (currentJob) {
      console.log('  ⏳ Job running — will update after');
      setTimeout(checkForUpdates, 30000);
      return;
    }

    console.log('  ↓ Pulling...');
    execSync('git pull origin main --quiet', { cwd: __dirname, timeout: 30000 });
    console.log('  ✓ Updated. Restarting...\n');

    const child = spawn(process.argv[0], process.argv.slice(1), {
      cwd: process.cwd(), env: process.env, stdio: 'inherit', detached: true
    });
    child.unref();
    process.exit(0);
  } catch (e) {
    if (e.message && !e.message.includes('not a git repository'))
      console.error(`  ✗ Update check failed: ${e.message}`);
  }
}

// ===== Core Loop =====

async function checkin() {
  if (shuttingDown) return;
  const sysInfo = getSystemInfo();
  const capabilities = getCapabilities();
  const ollamaModels = getOllamaModels();
  const sdModels = await getSDModels();
  const whisperModels = getWhisperModels();
  const models = {
    ollama: ollamaModels,
    ...(sdModels.length > 0 ? { 'stable-diffusion': sdModels } : {}),
    ...(whisperModels.length > 0 ? { whisper: whisperModels } : {})
  };
  const resources = checkResourceLimits();
  const scheduleActive = isScheduleActive();

  // Build rich capability manifests from YAML specs
  const capabilityManifests = handlerScan?.manifests || {};

  const result = await meshFetch('/nodes/register', {
    method: 'POST',
    body: JSON.stringify({
      nodeId, name: NODE_NAME, owner: NODE_OWNER, region: NODE_REGION,
      capabilities, models, version: getLocalVersion(), 
      ...sysInfo,
      // Rich capability manifests (protocol v2)
      manifests: capabilityManifests,
      // Enhanced registration data
      config: {
        maxConcurrentJobs: config.limits.maxConcurrentJobs,
        resourceLimits: config.limits,
        scheduleEnabled: config.schedule.enabled,
        scheduleActive,
        pricingMultiplier: config.pricing.multiplier,
        handlersEnabled: Object.keys(config.handlers || {}).filter(h => config.handlers[h].enabled !== false)
      },
      status: {
        cpuUsage: resources.cpuUsage,
        ramUsage: resources.ramUsage,
        withinLimits: resources.cpuOk && resources.ramOk,
        acceptingJobs: scheduleActive && resources.cpuOk && resources.ramOk
      }
    })
  });

  if (result?.ok) {
    if (!nodeId || nodeId !== result.node.nodeId) {
      nodeId = result.node.nodeId;
      saveNodeId(nodeId);
      console.log(`◉ Registered as node: ${nodeId}`);
      console.log(`  Name: ${NODE_NAME} | Owner: ${NODE_OWNER} | Region: ${NODE_REGION}`);
      console.log(`  Caps: ${capabilities.join(', ') || 'none'}`);
      const modelSummary = Object.entries(models).filter(([k,v]) => v.length > 0).map(([k,v]) => `${k}: ${v.join(', ')}`).join(' | ');
      console.log(`  Models: ${modelSummary || 'none'}`);
      console.log(`  RAM: ${sysInfo.ramMB}MB (${sysInfo.ramFreeMB}MB free) | CPU: ${sysInfo.cpuCores}c ${sysInfo.cpuIdle}% idle`);
      console.log(`  Status: ${scheduleActive ? 'Active' : 'Scheduled Off'} | CPU ${resources.cpuUsage}%/${config.limits.maxCpuPercent}% | RAM ${resources.ramUsage}%/${config.limits.maxRamPercent}%`);
      if (Object.keys(config.handlers || {}).length > 0) {
        const enabledHandlers = Object.keys(config.handlers).filter(h => config.handlers[h].enabled !== false);
        console.log(`  Handlers: ${enabledHandlers.join(', ') || 'none enabled'}`);
      }
      
      // First-job guarantee for new nodes - request a ping test job to verify connectivity
      if (capabilities.includes('ping')) {
        setTimeout(async () => {
          console.log('  ◉ Requesting initial capability test job...');
          try {
            await meshFetch('/jobs', {
              method: 'POST',
              body: JSON.stringify({
                type: 'ping',
                payload: { message: `First job test for ${NODE_NAME}` },
                clientIp: '127.0.0.1',
                priority: 'high'
              })
            });
            console.log('  ✅ Initial test job submitted');
          } catch (err) {
            console.log(`  ⚠️  Could not submit test job: ${err.message}`);
          }
        }, 2000); // Wait 2s for full registration to complete
      }
    }
  }
}

async function pollJobs() {
  if (!nodeId || shuttingDown || jobRunning) return;

  const result = await meshFetch(`/jobs/available?nodeId=${nodeId}`);
  if (!result?.jobs?.length) return;

  const job = result.jobs[0]; // One at a time
  console.log(`◉ Job: ${job.type} (${job.jobId})`);

  const claimed = await meshFetch(`/jobs/${job.jobId}/claim`, {
    method: 'POST', body: JSON.stringify({ nodeId })
  });
  if (!claimed?.ok) { console.log(`  ✗ Claim failed`); return; }

  console.log(`  ✓ Claimed (timeout: ${Math.round(getJobTimeout(job)/1000)}s)`);
  jobRunning = true;
  currentJobId = job.jobId;

  // Mandatory heartbeat — tell server we're alive every 30s even if no real progress
  const jobHeartbeat = setInterval(async () => {
    try {
      await fetch(`${MESH_SERVER}/jobs/${job.jobId}/progress`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, progress: { stage: 'working', heartbeat: true, pct: 0 } }),
        signal: AbortSignal.timeout(5000)
      });
    } catch {}
  }, 30000);

  try {
    const result = await executeJobSafe(job);
    const resp = await meshFetchRetry(`/jobs/${job.jobId}/complete`, {
      method: 'POST', body: JSON.stringify({ nodeId, data: result })
    });
    console.log(`  ✓ Done: ${job.type}${resp?.ok ? '' : ' (not reported)'}`);
  } catch (e) {
    console.error(`  ✗ Failed: ${e.message}`);
    await meshFetchRetry(`/jobs/${job.jobId}/fail`, {
      method: 'POST', body: JSON.stringify({ nodeId, error: e.message })
    });
  } finally {
    clearInterval(jobHeartbeat);
    jobRunning = false;
    currentJobId = null;
  }
}

// ===== Graceful Shutdown =====

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n◉ ${signal} — shutting down...`);
  
  // Clean up WebSocket connection
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    wsConnection.close();
  }
  
  // Clean up active job process
  if (activeChildProcess) { 
    try { process.kill(-activeChildProcess.pid, 'SIGKILL'); } 
    catch { try { activeChildProcess.kill('SIGKILL'); } catch {} } 
  }
  
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => { console.error(`✗ Uncaught: ${e.message}\n${e.stack}`); });
process.on('unhandledRejection', (e) => { console.error(`✗ Unhandled: ${e}`); });

// ===== Main =====

async function main() {
  const version = getLocalVersion();
  console.log('');
  console.log('┌──────────────────────────────────────┐');
  console.log('│  ◉ IC MESH — Node Client v0.2.0      │');
  console.log('└──────────────────────────────────────┘');
  console.log(`  Server:  ${MESH_SERVER}`);
  console.log(`  Node:    ${NODE_NAME}`);
  console.log(`  Owner:   ${NODE_OWNER}`);
  console.log(`  Region:  ${NODE_REGION}`);
  console.log(`  Version: ${version}`);
  console.log(`  NodeID:  ${nodeId || '(new)'}`);
  
  // Show configuration source and status
  const configSources = [];
  if (fs.existsSync(CONFIG_FILE)) configSources.push('config-file');
  if (process.env.IC_MESH_SERVER) configSources.push('env-vars');
  if (configSources.length === 0) configSources.push('defaults');
  console.log(`  Config:  ${configSources.join(' + ')}`);
  
  // Show configuration summary
  if (Object.keys(config.handlers || {}).length > 0) {
    const enabledHandlers = Object.keys(config.handlers).filter(h => config.handlers[h].enabled !== false);
    console.log(`  Handlers: ${enabledHandlers.length}/${Object.keys(config.handlers).length} enabled`);
  }
  
  if (config.schedule.enabled) {
    console.log(`  Schedule: ${config.schedule.available?.length || 0} time windows (${config.schedule.timezone})`);
    console.log(`  Currently: ${isScheduleActive() ? 'Active' : 'Scheduled Off'}`);
  }
  
  console.log(`  Limits: ${config.limits.maxCpuPercent}% CPU, ${config.limits.maxRamPercent}% RAM, ${config.limits.maxConcurrentJobs} concurrent`);
  
  console.log('');

  await checkin();
  setInterval(checkin, CHECKIN_INTERVAL);
  
  if (config.useWebSocket) {
    console.log(`◉ WebSocket mode enabled`);
    connectWebSocket();
  } else {
    console.log(`◉ HTTP polling mode`);
    setInterval(pollJobs, JOB_POLL_INTERVAL);
  }
  
  setTimeout(checkForUpdates, 30_000);
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL);

  const mode = config.useWebSocket ? 'WebSocket' : `Poll ${JOB_POLL_INTERVAL/1000}s`;
  console.log(`◉ Running. Checkin ${CHECKIN_INTERVAL/1000}s | Jobs: ${mode} | Updates ${UPDATE_CHECK_INTERVAL/1000}s`);
  console.log('  Ctrl+C to leave.\n');
}

// === --check mode: validate everything without connecting ===
if (process.argv.includes('--check')) {
  (async () => {
    console.log('\n🔍 IC Mesh Node Check\n');
    
    // Node.js version
    const nodeVer = process.version;
    const major = parseInt(nodeVer.slice(1));
    console.log(`  ${major >= 16 ? '✅' : '❌'} Node.js ${nodeVer} (minimum: v16)`);
    
    // Fetch
    console.log(`  ${globalThis.fetch ? '✅' : '❌'} fetch: ${major >= 18 ? 'native' : 'polyfilled via node-fetch'}`);
    
    // Config
    console.log(`  ${fs.existsSync(CONFIG_FILE) ? '✅' : '⚠️'} Config: ${fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : 'using defaults'}`);
    console.log(`     Server: ${MESH_SERVER}`);
    console.log(`     Name: ${NODE_NAME}`);
    console.log(`     Owner: ${NODE_OWNER}`);
    
    // Server reachable
    try {
      const resp = await fetch(`${MESH_SERVER}/status`);
      const data = await resp.json();
      console.log(`  ✅ Server: ${MESH_SERVER} reachable (${data.nodes?.active || 0} active nodes)`);
    } catch (e) {
      console.log(`  ❌ Server: ${MESH_SERVER} unreachable — ${e.message}`);
    }
    
    // Capabilities
    const scan = scanCapabilities();
    console.log(`  📦 Handler specs: ${scan.specsLoaded} loaded`);
    for (const [name, manifest] of Object.entries(scan.manifests)) {
      const models = manifest.models?.length || 0;
      console.log(`  ✅ ${name}: ${manifest.binary || 'detected'} (${models} models, ${manifest.backends.join('/')})`);
    }
    for (const s of scan.skipped) {
      console.log(`  ⬚  ${s}: not detected`);
    }
    
    // Legacy capabilities
    const caps = getCapabilities();
    const yamlCaps = scan.capabilities;
    const legacyOnly = caps.filter(c => !yamlCaps.includes(c));
    if (legacyOnly.length > 0) {
      console.log(`  ℹ️  Legacy-detected: ${legacyOnly.join(', ')}`);
    }
    
    console.log(`\n  Total capabilities: ${caps.length} → ${caps.join(', ')}`);
    console.log(`  ${caps.length > 0 ? '✅ Ready to connect. Run: node client.js' : '❌ No capabilities detected.'}\n`);
  })();
} else {
  main().catch(console.error);
}
