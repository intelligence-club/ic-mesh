#!/usr/bin/env node
/**
 * IC Mesh — Node Client
 * 
 * Runs on each node (Mac Mini, laptop, server).
 * Checks in with the coordination server, picks up jobs, reports results.
 * 
 * Usage:
 *   IC_MESH_SERVER=https://moilol.com:8333 \
 *   IC_NODE_NAME=hilo-coffee-shop \
 *   IC_NODE_OWNER=drake \
 *   node client.js
 */

const os = require('os');
const { execSync } = require('child_process');

const MESH_SERVER = process.env.IC_MESH_SERVER || 'http://localhost:8333';
const NODE_NAME = process.env.IC_NODE_NAME || os.hostname();
const NODE_OWNER = process.env.IC_NODE_OWNER || os.userInfo().username;
const NODE_REGION = process.env.IC_NODE_REGION || 'unknown';
const CHECKIN_INTERVAL = 60000; // 60 seconds
const JOB_POLL_INTERVAL = 10000; // 10 seconds

let nodeId = null;

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
    gpuVRAM: 0 // TODO: detect GPU
  };
}

function getDiskFree() {
  try {
    if (process.platform === 'darwin') {
      const out = execSync("df -g / | tail -1 | awk '{print $4}'", { encoding: 'utf8' });
      return parseInt(out) || 0;
    }
    const out = execSync("df -BG / | tail -1 | awk '{print $4}'", { encoding: 'utf8' });
    return parseInt(out) || 0;
  } catch { return 0; }
}

function getCapabilities() {
  const caps = [];
  
  // Check for Ollama
  try { execSync('which ollama', { encoding: 'utf8' }); caps.push('ollama'); } catch {}
  
  // Check for Whisper
  try { execSync('which whisper', { encoding: 'utf8' }); caps.push('whisper'); } catch {}
  
  // Check for ffmpeg
  try { execSync('which ffmpeg', { encoding: 'utf8' }); caps.push('ffmpeg'); } catch {}
  
  // Check for GPU (nvidia)
  try { execSync('which nvidia-smi', { encoding: 'utf8' }); caps.push('gpu-nvidia'); } catch {}
  
  // Check for Metal (Apple Silicon)
  try {
    const arch = execSync('uname -m', { encoding: 'utf8' }).trim();
    if (arch === 'arm64' && process.platform === 'darwin') caps.push('gpu-metal');
  } catch {}

  // Check for Stable Diffusion (A1111 / ComfyUI)
  try {
    const resp = execSync('curl -s -o /dev/null -w "%{http_code}" http://localhost:7860/sdapi/v1/sd-models --max-time 2', { encoding: 'utf8' }).trim();
    if (resp === '200') caps.push('stable-diffusion');
  } catch {}

  // Check for ComfyUI
  try {
    const resp = execSync('curl -s -o /dev/null -w "%{http_code}" http://localhost:8188/system_stats --max-time 2', { encoding: 'utf8' }).trim();
    if (resp === '200') caps.push('comfyui');
  } catch {}
  
  return caps;
}

function getOllamaModels() {
  try {
    const out = execSync('ollama list 2>/dev/null', { encoding: 'utf8' });
    return out.split('\n').slice(1).filter(Boolean).map(line => line.split(/\s+/)[0]).filter(Boolean);
  } catch { return []; }
}

// ===== Network Communication =====

async function meshFetch(path, options = {}) {
  const url = `${MESH_SERVER}${path}`;
  try {
    const resp = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Node-Id': nodeId || '',
        ...options.headers
      }
    });
    return await resp.json();
  } catch (e) {
    console.error(`  ✗ Mesh server unreachable: ${e.message}`);
    return null;
  }
}

// ===== Core Loop =====

async function checkin() {
  const sysInfo = getSystemInfo();
  const capabilities = getCapabilities();
  const models = getOllamaModels();
  
  const data = {
    nodeId,
    name: NODE_NAME,
    owner: NODE_OWNER,
    region: NODE_REGION,
    capabilities,
    models,
    ...sysInfo
  };
  
  const result = await meshFetch('/nodes/register', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  
  if (result?.ok) {
    if (!nodeId) {
      nodeId = result.node.nodeId;
      console.log(`◉ Registered as node: ${nodeId}`);
      console.log(`  Name: ${NODE_NAME}`);
      console.log(`  Capabilities: ${capabilities.join(', ') || 'none detected'}`);
      console.log(`  Models: ${models.join(', ') || 'none'}`);
      console.log(`  RAM: ${sysInfo.ramMB}MB (${sysInfo.ramFreeMB}MB free)`);
      console.log(`  CPU: ${sysInfo.cpuCores} cores (${sysInfo.cpuIdle}% idle)`);
    }
  }
}

async function pollJobs() {
  if (!nodeId) return;
  
  const result = await meshFetch(`/jobs/available?nodeId=${nodeId}`);
  if (!result?.jobs?.length) return;
  
  for (const job of result.jobs) {
    console.log(`◉ Job available: ${job.type} (${job.jobId})`);
    
    // Claim it
    const claimed = await meshFetch(`/jobs/${job.jobId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ nodeId })
    });
    
    if (!claimed?.ok) {
      console.log(`  ✗ Failed to claim (someone else got it)`);
      continue;
    }
    
    console.log(`  ✓ Claimed. Executing...`);
    
    // Execute the job
    try {
      const result = await executeJob(job);
      
      // Retry completion POST up to 3 times
      let reported = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const resp = await meshFetch(`/jobs/${job.jobId}/complete`, {
          method: 'POST',
          body: JSON.stringify({ nodeId, data: result })
        });
        if (resp?.ok) { reported = true; break; }
        console.log(`  ⟳ Completion report attempt ${attempt}/3 failed, retrying in ${attempt * 2}s...`);
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
      
      console.log(`  ✓ Completed: ${job.type}${reported ? '' : ' (result not reported to server)'}`);
    } catch (e) {
      console.error(`  ✗ Job failed: ${e.message}`);
    }
  }
}

async function executeJob(job) {
  switch (job.type) {
    case 'inference':
      return await runInference(job.payload);
    case 'transcribe':
      return await runTranscribe(job.payload);
    case 'generate':
      return await runGenerate(job.payload);
    case 'ping':
      return { pong: true, node: NODE_NAME, time: Date.now() };
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function runInference(payload) {
  const model = payload.model || 'llama3.1:8b';
  const prompt = payload.prompt || '';
  
  try {
    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false })
    });
    const data = await resp.json();
    return { response: data.response, model, tokens: data.eval_count || 0 };
  } catch (e) {
    throw new Error(`Ollama inference failed: ${e.message}`);
  }
}

async function runGenerate(payload) {
  const SD_URL = process.env.IC_SD_URL || 'http://localhost:7860';
  
  const params = {
    prompt: payload.prompt || '',
    negative_prompt: payload.negative_prompt || '',
    width: payload.width || 1024,
    height: payload.height || 1024,
    steps: payload.steps || 30,
    cfg_scale: payload.cfg_scale || 5,
    sampler_name: payload.sampler || 'Euler a',
    seed: payload.seed || -1,
    batch_size: 1,
    n_iter: 1
  };

  // Optionally set the model
  if (payload.model) {
    console.log(`  ◉ Switching to model: ${payload.model}`);
    try {
      await fetch(`${SD_URL}/sdapi/v1/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sd_model_checkpoint: payload.model })
      });
    } catch (e) {
      console.log(`  ⚠ Model switch failed: ${e.message} (using current model)`);
    }
  }

  console.log(`  ◉ Generating image: "${params.prompt.slice(0, 80)}..." (${params.width}x${params.height}, ${params.steps} steps)`);

  const resp = await fetch(`${SD_URL}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`SD API error (${resp.status}): ${err.slice(0, 200)}`);
  }

  const data = await resp.json();

  if (!data.images || !data.images.length) {
    throw new Error('No images returned from SD API');
  }

  // Upload the image to the mesh hub for retrieval
  const imgBuffer = Buffer.from(data.images[0], 'base64');
  const filename = `gen-${Date.now()}.png`;
  
  // Try to upload to hub
  try {
    const boundary = '----ICMesh' + Date.now();
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, imgBuffer, footer]);
    
    const uploadResp = await fetch(`${MESH_SERVER}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    });
    const uploadResult = await uploadResp.json();
    
    if (uploadResult.url) {
      return {
        url: uploadResult.url,
        width: params.width,
        height: params.height,
        prompt: params.prompt,
        steps: params.steps,
        seed: data.parameters?.seed || params.seed,
        sizeBytes: imgBuffer.length
      };
    }
  } catch (e) {
    console.log(`  ⚠ Hub upload failed: ${e.message}, returning base64`);
  }

  // Fallback: return base64 (large but works)
  return {
    image_base64: data.images[0],
    width: params.width,
    height: params.height,
    prompt: params.prompt,
    steps: params.steps,
    seed: data.parameters?.seed || params.seed,
    sizeBytes: imgBuffer.length
  };
}

async function runTranscribe(payload) {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const url = payload.url;
  if (!url) throw new Error('No audio URL provided');

  // Download to temp file
  const tmpDir = path.join(os.tmpdir(), 'ic-mesh-jobs');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const ext = path.extname(new URL(url).pathname) || '.wav';
  const tmpFile = path.join(tmpDir, `transcribe-${Date.now()}${ext}`);

  console.log(`  ↓ Downloading: ${url}`);
  execSync(`curl -sL -o "${tmpFile}" "${url}"`, { timeout: 120000 });

  // Run whisper
  const model = payload.model || 'base';
  const language = payload.language || 'en';
  console.log(`  ◉ Transcribing with whisper (model: ${model})...`);

  const outDir = path.join(tmpDir, `out-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });

  execSync(`whisper "${tmpFile}" --model ${model} --language ${language} --output_dir "${outDir}" --output_format txt`, {
    timeout: 600000, // 10 min max
    encoding: 'utf8'
  });

  // Read result
  const txtFiles = fs.readdirSync(outDir).filter(f => f.endsWith('.txt'));
  const transcript = txtFiles.length
    ? fs.readFileSync(path.join(outDir, txtFiles[0]), 'utf8').trim()
    : '(no output)';

  // Cleanup
  try { fs.unlinkSync(tmpFile); fs.rmSync(outDir, { recursive: true }); } catch {}

  return { transcript, model, language, chars: transcript.length };
}

// ===== Main =====

async function main() {
  console.log('');
  console.log('┌──────────────────────────────────┐');
  console.log('│  ◉ IC MESH — Node Client v0.1.0  │');
  console.log('└──────────────────────────────────┘');
  console.log(`  Server: ${MESH_SERVER}`);
  console.log(`  Node:   ${NODE_NAME}`);
  console.log(`  Owner:  ${NODE_OWNER}`);
  console.log('');
  
  // Initial checkin
  await checkin();
  
  // Periodic checkin
  setInterval(checkin, CHECKIN_INTERVAL);
  
  // Poll for jobs
  setInterval(pollJobs, JOB_POLL_INTERVAL);
  
  console.log(`\n◉ Node running. Checking in every ${CHECKIN_INTERVAL/1000}s, polling jobs every ${JOB_POLL_INTERVAL/1000}s`);
  console.log('  Press Ctrl+C to leave the mesh.\n');
}

main().catch(console.error);
