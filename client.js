#!/usr/bin/env node
/**
 * IC Mesh — Node Client v0.2.0
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
      if (fileConfig.limits?.maxConcurrentJobs) config.maxConcurrentJobs = fileConfig.limits.maxConcurrentJobs;
      
      // Store complex config for advanced features
      config._complexConfig = fileConfig;
      console.log(`Loaded complex config from ${CONFIG_FILE}`);
    } else {
      // Simple flat format (sample.json style) 
      config = { ...config, ...fileConfig };
      console.log(`Loaded simple config from ${CONFIG_FILE}`);
    }
  } catch (err) {
    console.warn(`Failed to parse ${CONFIG_FILE}: ${err.message}`);
  }
}

// Environment variables override config file
const MESH_SERVER = process.env.IC_MESH_SERVER || config.meshServer;
const NODE_NAME = process.env.IC_NODE_NAME || config.nodeName || os.hostname();
const NODE_OWNER = process.env.IC_NODE_OWNER || config.nodeOwner || os.userInfo().username;
const NODE_REGION = process.env.IC_NODE_REGION || config.nodeRegion;
const CHECKIN_INTERVAL = config.checkinInterval;
const JOB_POLL_INTERVAL = config.jobPollInterval;
const UPDATE_CHECK_INTERVAL = config.updateCheckInterval;
const MAX_CONCURRENT_JOBS = config.maxConcurrentJobs || (config._complexConfig?.limits?.maxConcurrentJobs) || 3;
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
  const caps = [];
  const which = (cmd) => { try { execSync(`which ${cmd}`, { encoding: 'utf8', timeout: 3000 }); return true; } catch { return false; } };
  const httpOk = (url) => {
    try {
      return execSync(`curl -s -o /dev/null -w "%{http_code}" "${url}" --max-time 2`, { encoding: 'utf8', timeout: 5000 }).trim() === '200';
    } catch { return false; }
  };

  if (which('ollama')) caps.push('ollama');
  if (which('whisper')) caps.push('whisper');
  if (which('ffmpeg')) caps.push('ffmpeg');
  if (which('nvidia-smi')) caps.push('gpu-nvidia');

  try {
    if (execSync('uname -m', { encoding: 'utf8', timeout: 3000 }).trim() === 'arm64' && process.platform === 'darwin')
      caps.push('gpu-metal');
  } catch {}

  if (httpOk('http://localhost:7860/sdapi/v1/sd-models')) caps.push('stable-diffusion');
  if (httpOk('http://localhost:8188/system_stats')) caps.push('comfyui');

  return caps;
}

function getOllamaModels() {
  try {
    return execSync('ollama list 2>/dev/null', { encoding: 'utf8', timeout: 10000 })
      .split('\n').slice(1).filter(Boolean).map(l => l.split(/\s+/)[0]).filter(Boolean);
  } catch { return []; }
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
  if (job.payload?.timeout) return Math.min(job.payload.timeout * 1000, 1_800_000);
  return JOB_TIMEOUTS[job.type] || JOB_TIMEOUTS.default;
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

// ===== Job Handlers =====

async function executeJob(job) {
  switch (job.type) {
    case 'inference': return await runInference(job.payload, getJobTimeout(job));
    case 'transcribe': return await runTranscribe(job.payload, getJobTimeout(job));
    case 'generate': return await runGenerate(job.payload, getJobTimeout(job));
    case 'ping': return { pong: true, node: NODE_NAME, time: Date.now(), version: getLocalVersion() };
    default: throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function runInference(payload, timeoutMs) {
  const model = payload.model || 'llama3.1:8b';
  const prompt = payload.prompt || '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: controller.signal
    });
    const data = await resp.json();
    return { response: data.response, model, tokens: data.eval_count || 0 };
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

  try {
    const resp = await fetch(`${SD_URL}/sdapi/v1/txt2img`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params), signal: controller.signal
    });
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
  } finally { clearTimeout(timer); }
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
    await execWithTimeout(`whisper "${tmpFile}" --model ${model} --language ${language} --output_dir "${outDir}" --output_format txt`, timeoutMs);

    const txtFiles = fs.readdirSync(outDir).filter(f => f.endsWith('.txt'));
    const transcript = txtFiles.length ? fs.readFileSync(path.join(outDir, txtFiles[0]), 'utf8').trim() : '(no output)';
    return { transcript, model, language, chars: transcript.length };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
    try { fs.rmSync(outDir, { recursive: true }); } catch {}
  }
}

// ===== WebSocket Connection =====

function connectWebSocket() {
  if (isConnecting || (wsConnection && wsConnection.readyState === WebSocket.OPEN)) return;
  
  isConnecting = true;
  const wsUrl = MESH_SERVER.replace('http://', 'ws://').replace('https://', 'wss://') + `/ws?nodeId=${nodeId}`;
  
  console.log(`◉ Connecting via WebSocket: ${wsUrl}`);
  wsConnection = new WebSocket(wsUrl);
  
  wsConnection.on('open', () => {
    isConnecting = false;
    console.log(`◉ WebSocket connected — job polling disabled`);
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
    console.log(`  Falling back to HTTP polling...`);
    // Reconnect after 5 seconds
    setTimeout(connectWebSocket, 5000);
  });
  
  wsConnection.on('error', (err) => {
    isConnecting = false;
    console.error(`✗ WebSocket error: ${err.message}`);
  });
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

function canTakeJob(job) {
  if (currentJob) return false;
  if (!job.requirements) return true;
  
  const reqs = typeof job.requirements === 'string' ? JSON.parse(job.requirements) : job.requirements;
  const caps = getCapabilities();
  
  if (reqs.capabilities) {
    return reqs.capabilities.every(cap => caps.includes(cap));
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
  const models = getOllamaModels();

  const result = await meshFetch('/nodes/register', {
    method: 'POST',
    body: JSON.stringify({
      nodeId, name: NODE_NAME, owner: NODE_OWNER, region: NODE_REGION,
      capabilities, models, version: getLocalVersion(), ...sysInfo
    })
  });

  if (result?.ok) {
    if (!nodeId || nodeId !== result.node.nodeId) {
      nodeId = result.node.nodeId;
      saveNodeId(nodeId);
      console.log(`◉ Registered as node: ${nodeId}`);
      console.log(`  Name: ${NODE_NAME} | Caps: ${capabilities.join(', ') || 'none'}`);
      console.log(`  Models: ${models.join(', ') || 'none'}`);
      console.log(`  RAM: ${sysInfo.ramMB}MB (${sysInfo.ramFreeMB}MB free) | CPU: ${sysInfo.cpuCores}c ${sysInfo.cpuIdle}% idle`);
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
    jobRunning = false;
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
  
  // Show configuration source
  const configSources = [];
  if (fs.existsSync(CONFIG_FILE)) configSources.push('config-file');
  if (process.env.IC_MESH_SERVER) configSources.push('env-vars');
  if (configSources.length === 0) configSources.push('defaults');
  console.log(`  Config:  ${configSources.join(' + ')}`);
  
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

main().catch(console.error);
