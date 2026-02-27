#!/usr/bin/env node
/**
 * FFmpeg Service — HTTP API for safe media processing
 * Runs on port 7880 (configurable via FFMPEG_PORT)
 * 
 * Same pattern as Ollama (11434) and A1111 (7860):
 * - Nodes auto-detect on startup
 * - Client talks to it over HTTP, never shells out
 * - All operations are predefined — no arbitrary command execution
 * 
 * Endpoints:
 *   GET  /                          → health check
 *   GET  /api/capabilities          → list supported operations + formats
 *   POST /api/compress              → compress video/audio
 *   POST /api/convert               → convert between formats
 *   POST /api/extract-audio         → extract audio from video
 *   POST /api/trim                  → trim media by time range
 *   POST /api/thumbnail             → extract thumbnail frame
 *   POST /api/info                  → get media info (duration, codec, etc.)
 *   GET  /api/progress/:id          → poll job progress
 */

const http = require('http');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = parseInt(process.env.FFMPEG_PORT || '7880');
const MAX_FILE_SIZE = parseInt(process.env.FFMPEG_MAX_SIZE || String(500 * 1024 * 1024)); // 500MB
const WORK_DIR = path.join(os.tmpdir(), 'ffmpeg-service');
fs.mkdirSync(WORK_DIR, { recursive: true });

// Active jobs for progress tracking
const jobs = new Map();

// ===== Allowed values (whitelist-only) =====
const ALLOWED_CODECS = {
  video: ['libx264', 'libx265', 'libvpx', 'libvpx-vp9', 'copy', 'mpeg4', 'libsvtav1'],
  audio: ['aac', 'libmp3lame', 'libopus', 'libvorbis', 'copy', 'flac', 'pcm_s16le']
};
const ALLOWED_FORMATS = ['mp4', 'webm', 'mkv', 'mov', 'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'gif', 'avi'];
const ALLOWED_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
const MAX_DIMENSION = 7680; // 8K max
const MAX_CRF = 51;

// ===== Helpers =====
function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1024 * 100) reject(new Error('Body too large')); });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
  });
}

function jobDir(id) {
  const d = path.join(WORK_DIR, id);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function validateNumber(val, min, max, defaultVal) {
  const n = parseFloat(val);
  if (isNaN(n)) return defaultVal;
  return Math.max(min, Math.min(max, n));
}

function validateTime(t) {
  // Accept "HH:MM:SS", "MM:SS", or seconds
  if (typeof t === 'number') return Math.max(0, t);
  if (typeof t === 'string' && /^\d{1,2}(:\d{2}){0,2}(\.\d+)?$/.test(t)) return t;
  return null;
}

// Get media info via ffprobe (safe — no user input in command)
function probe(filePath) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath
    ], { timeout: 30000 }, (err, stdout) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });
}

// Run ffmpeg with args array (safe — no shell interpretation)
function runFFmpeg(args, jobId) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      // Parse progress from stderr
      const match = stderr.match(/time=(\d{2}):(\d{2}):(\d{2})/);
      if (match && jobId && jobs.has(jobId)) {
        const secs = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
        const job = jobs.get(jobId);
        job.progress = secs;
        job.progressStr = `${match[1]}:${match[2]}:${match[3]}`;
      }
    });
    
    proc.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
    
    proc.on('error', reject);
    
    // Timeout: 10 minutes max
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} reject(new Error('FFmpeg timeout (600s)')); }, 600000);
  });
}

// Download file safely
async function downloadFile(url, destPath) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL must be http or https');
  if (parsed.pathname.includes('..')) throw new Error('Invalid URL path');
  
  const mod = parsed.protocol === 'https:' ? require('https') : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      
      let size = 0;
      const ws = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_FILE_SIZE) { req.destroy(); ws.destroy(); reject(new Error('File too large')); }
      });
      res.pipe(ws);
      ws.on('finish', () => resolve(size));
      ws.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
  });
}

// ===== Operations =====

async function compress(data) {
  const id = crypto.randomBytes(8).toString('hex');
  const dir = jobDir(id);
  jobs.set(id, { status: 'downloading', progress: 0 });
  
  const ext = path.extname(new URL(data.url).pathname) || '.mp4';
  const inputFile = path.join(dir, `input${ext}`);
  await downloadFile(data.url, inputFile);
  
  jobs.get(id).status = 'processing';
  
  const outputFormat = ALLOWED_FORMATS.includes(data.format) ? data.format : 'mp4';
  const outputFile = path.join(dir, `output.${outputFormat}`);
  
  const args = ['-i', inputFile, '-y'];
  
  // Video codec
  const vcodec = ALLOWED_CODECS.video.includes(data.videoCodec) ? data.videoCodec : 'libx264';
  args.push('-c:v', vcodec);
  
  // CRF (quality)
  const crf = validateNumber(data.crf, 0, MAX_CRF, 28);
  args.push('-crf', String(crf));
  
  // Preset
  const preset = ALLOWED_PRESETS.includes(data.preset) ? data.preset : 'medium';
  args.push('-preset', preset);
  
  // Audio codec
  const acodec = ALLOWED_CODECS.audio.includes(data.audioCodec) ? data.audioCodec : 'aac';
  args.push('-c:a', acodec);
  
  // Resolution (optional)
  if (data.width || data.height) {
    const w = validateNumber(data.width, 1, MAX_DIMENSION, -2);
    const h = validateNumber(data.height, 1, MAX_DIMENSION, -2);
    args.push('-vf', `scale=${Math.round(w)}:${Math.round(h)}`);
  }
  
  args.push(outputFile);
  
  await runFFmpeg(args, id);
  
  const stat = fs.statSync(outputFile);
  jobs.get(id).status = 'done';
  
  return { id, outputFile, outputFormat, sizeBytes: stat.size };
}

async function convert(data) {
  const id = crypto.randomBytes(8).toString('hex');
  const dir = jobDir(id);
  jobs.set(id, { status: 'downloading', progress: 0 });
  
  const ext = path.extname(new URL(data.url).pathname) || '.mp4';
  const inputFile = path.join(dir, `input${ext}`);
  await downloadFile(data.url, inputFile);
  
  jobs.get(id).status = 'processing';
  
  const outputFormat = ALLOWED_FORMATS.includes(data.format) ? data.format : 'mp4';
  const outputFile = path.join(dir, `output.${outputFormat}`);
  
  const args = ['-i', inputFile, '-y', outputFile];
  await runFFmpeg(args, id);
  
  const stat = fs.statSync(outputFile);
  jobs.get(id).status = 'done';
  
  return { id, outputFile, outputFormat, sizeBytes: stat.size };
}

async function extractAudio(data) {
  const id = crypto.randomBytes(8).toString('hex');
  const dir = jobDir(id);
  jobs.set(id, { status: 'downloading', progress: 0 });
  
  const ext = path.extname(new URL(data.url).pathname) || '.mp4';
  const inputFile = path.join(dir, `input${ext}`);
  await downloadFile(data.url, inputFile);
  
  jobs.get(id).status = 'processing';
  
  const audioFormat = ALLOWED_FORMATS.includes(data.format) ? data.format : 'mp3';
  const outputFile = path.join(dir, `output.${audioFormat}`);
  
  const acodec = ALLOWED_CODECS.audio.includes(data.audioCodec) ? data.audioCodec : 'libmp3lame';
  const args = ['-i', inputFile, '-vn', '-c:a', acodec, '-y', outputFile];
  await runFFmpeg(args, id);
  
  const stat = fs.statSync(outputFile);
  jobs.get(id).status = 'done';
  
  return { id, outputFile, outputFormat: audioFormat, sizeBytes: stat.size };
}

async function trim(data) {
  const id = crypto.randomBytes(8).toString('hex');
  const dir = jobDir(id);
  jobs.set(id, { status: 'downloading', progress: 0 });
  
  const ext = path.extname(new URL(data.url).pathname) || '.mp4';
  const inputFile = path.join(dir, `input${ext}`);
  await downloadFile(data.url, inputFile);
  
  jobs.get(id).status = 'processing';
  
  const outputFormat = ALLOWED_FORMATS.includes(data.format) ? data.format : ext.slice(1);
  const outputFile = path.join(dir, `output.${outputFormat}`);
  
  const args = ['-i', inputFile];
  const start = validateTime(data.start);
  const end = validateTime(data.end);
  const duration = validateTime(data.duration);
  if (start !== null) args.push('-ss', String(start));
  if (end !== null) args.push('-to', String(end));
  else if (duration !== null) args.push('-t', String(duration));
  args.push('-c', 'copy', '-y', outputFile);
  
  await runFFmpeg(args, id);
  
  const stat = fs.statSync(outputFile);
  jobs.get(id).status = 'done';
  
  return { id, outputFile, outputFormat, sizeBytes: stat.size };
}

async function thumbnail(data) {
  const id = crypto.randomBytes(8).toString('hex');
  const dir = jobDir(id);
  jobs.set(id, { status: 'downloading', progress: 0 });
  
  const ext = path.extname(new URL(data.url).pathname) || '.mp4';
  const inputFile = path.join(dir, `input${ext}`);
  await downloadFile(data.url, inputFile);
  
  jobs.get(id).status = 'processing';
  
  const outputFile = path.join(dir, 'thumbnail.jpg');
  const time = validateTime(data.time) || '00:00:01';
  
  const args = ['-i', inputFile, '-ss', String(time), '-vframes', '1', '-q:v', '2', '-y', outputFile];
  await runFFmpeg(args, id);
  
  const stat = fs.statSync(outputFile);
  jobs.get(id).status = 'done';
  
  return { id, outputFile, outputFormat: 'jpg', sizeBytes: stat.size };
}

async function info(data) {
  const id = crypto.randomBytes(8).toString('hex');
  const dir = jobDir(id);
  
  const ext = path.extname(new URL(data.url).pathname) || '.mp4';
  const inputFile = path.join(dir, `input${ext}`);
  await downloadFile(data.url, inputFile);
  
  const probeData = await probe(inputFile);
  
  // Cleanup
  try { fs.rmSync(dir, { recursive: true }); } catch {}
  
  return {
    duration: parseFloat(probeData.format?.duration || 0),
    size: parseInt(probeData.format?.size || 0),
    format: probeData.format?.format_name,
    streams: (probeData.streams || []).map(s => ({
      type: s.codec_type,
      codec: s.codec_name,
      width: s.width,
      height: s.height,
      fps: s.r_frame_rate,
      bitrate: parseInt(s.bit_rate || 0),
      sampleRate: parseInt(s.sample_rate || 0),
      channels: s.channels
    }))
  };
}

// ===== Cleanup old jobs =====
setInterval(() => {
  const cutoff = Date.now() - 3600000; // 1 hour
  for (const [id, job] of jobs) {
    if (job.created < cutoff) {
      jobs.delete(id);
      try { fs.rmSync(path.join(WORK_DIR, id), { recursive: true }); } catch {}
    }
  }
}, 300000);

// ===== HTTP Server =====
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  
  try {
    // Health check
    if (req.method === 'GET' && pathname === '/') {
      return json(res, { status: 'ok', service: 'ffmpeg', version: '1.0.0' });
    }
    
    // HEAD health check (for auto-detection)
    if (req.method === 'HEAD' && pathname === '/') {
      res.writeHead(200);
      return res.end();
    }
    
    // Capabilities
    if (req.method === 'GET' && pathname === '/api/capabilities') {
      // Get ffmpeg version
      let version = 'unknown';
      try {
        const { execFileSync } = require('child_process');
        const out = execFileSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5000 });
        version = out.split('\n')[0];
      } catch {}
      
      return json(res, {
        operations: ['compress', 'convert', 'extract-audio', 'trim', 'thumbnail', 'info'],
        formats: { input: ALLOWED_FORMATS, output: ALLOWED_FORMATS },
        codecs: ALLOWED_CODECS,
        presets: ALLOWED_PRESETS,
        maxFileSize: MAX_FILE_SIZE,
        maxDimension: MAX_DIMENSION,
        ffmpegVersion: version
      });
    }
    
    // Progress
    if (req.method === 'GET' && pathname.startsWith('/api/progress/')) {
      const id = pathname.split('/').pop();
      const job = jobs.get(id);
      if (!job) return json(res, { error: 'Job not found' }, 404);
      return json(res, { id, ...job });
    }
    
    // Operations
    const ops = {
      '/api/compress': compress,
      '/api/convert': convert,
      '/api/extract-audio': extractAudio,
      '/api/trim': trim,
      '/api/thumbnail': thumbnail,
      '/api/info': info
    };
    
    if (req.method === 'POST' && ops[pathname]) {
      const data = await parseBody(req);
      if (!data.url) return json(res, { error: 'url is required' }, 400);
      
      const result = await ops[pathname](data);
      return json(res, { success: true, ...result });
    }
    
    json(res, { error: 'Not found' }, 404);
  } catch (e) {
    console.error(`Error on ${pathname}:`, e.message);
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`🎬 FFmpeg Service running on port ${PORT}`);
  console.log(`   Operations: compress, convert, extract-audio, trim, thumbnail, info`);
  console.log(`   Max file size: ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)}MB`);
});
