/**
 * IC Mesh — Declarative Handler Loader v1.0
 * 
 * Scans handlers/ directory for YAML capability specs.
 * Detects available capabilities, discovers models, builds rich manifests.
 * Executes jobs using invocation specs from YAML.
 * 
 * Drop a YAML file → get a capability. No code changes needed.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');
const YAML = require('yaml');
const logger = require('./logger');

const HANDLERS_DIR = path.join(__dirname, '..', 'handlers');

// Extend PATH with common binary locations (fixes SSH sessions with minimal PATH)
const EXTRA_PATHS = ['/usr/local/bin', '/opt/homebrew/bin', '/opt/local/bin', `${os.homedir()}/bin`, `${os.homedir()}/.local/bin`];
const currentPath = process.env.PATH || '';
const missingPaths = EXTRA_PATHS.filter(p => !currentPath.includes(p) && fs.existsSync(p));
if (missingPaths.length > 0) {
  process.env.PATH = [...missingPaths, currentPath].join(':');
}

/**
 * Load all handler YAML files from handlers/ directory
 * @returns {Object<string, Object>} Map of capability name → parsed spec
 */
function loadHandlerSpecs(handlersDir = HANDLERS_DIR) {
  const specs = {};
  if (!fs.existsSync(handlersDir)) return specs;

  for (const file of fs.readdirSync(handlersDir)) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    try {
      const raw = fs.readFileSync(path.join(handlersDir, file), 'utf8');
      const spec = YAML.parse(raw);
      if (!spec?.capability) {
        console.warn(`  ⚠ ${file}: missing 'capability' field, skipping`);
        continue;
      }
      specs[spec.capability] = { ...spec, _file: file };
    } catch (err) {
      console.warn(`  ⚠ Failed to parse ${file}: ${err.message}`);
    }
  }
  return specs;
}

/**
 * Run detection checks for a single handler spec
 * @returns {boolean} true if capability is available on this node
 */
function detectCapability(spec) {
  const d = spec.detect;
  if (!d) return true; // No detect block = always available

  // Binary check
  if (d.binary) {
    const binaries = [d.binary, ...(d.fallback_binaries || [])];
    const found = binaries.some(bin => {
      try { execSync(`which ${bin}`, { encoding: 'utf8', timeout: 3000, stdio: 'pipe' }); return true; } catch { return false; }
    });
    if (!found) return false;
  }

  // Probe command
  if (d.probe_cmd) {
    try { execSync(d.probe_cmd, { encoding: 'utf8', timeout: 5000, stdio: 'pipe' }); } catch { return false; }
  }

  // HTTP probe
  const urls = [d.probe_url, ...(d.fallback_urls || [])].filter(Boolean);
  if (urls.length > 0) {
    const ok = urls.some(url => {
      try {
        const code = execSync(`curl -s -o /dev/null -w "%{http_code}" "${url}" --max-time 2`, { encoding: 'utf8', timeout: 5000, stdio: 'pipe' }).trim();
        return code === '200';
      } catch { return false; }
    });
    if (!ok) return false;
  }

  // File existence checks
  if (d.files) {
    for (const f of d.files) {
      const expanded = f.replace(/^~/, os.homedir());
      if (!fs.existsSync(expanded)) return false;
    }
  }

  // Environment variable checks
  if (d.env) {
    for (const e of d.env) {
      if (!process.env[e]) return false;
    }
  }

  return true;
}

/**
 * Discover models for a handler spec
 * @returns {string[]} List of model names
 */
function discoverModels(spec) {
  const m = spec.models;
  if (!m) return [];
  const models = [];

  // Command-based listing
  if (m.list_cmd) {
    try {
      const out = execSync(m.list_cmd, { encoding: 'utf8', timeout: 10000, stdio: 'pipe' });
      models.push(...out.split('\n').map(l => l.trim()).filter(Boolean));
    } catch {}
  }

  // Directory scanning
  if (m.scan_dirs) {
    const pattern = m.pattern ? new RegExp(m.pattern.replace(/\*/g, '.*').replace(/\?/g, '.')) : null;
    const nameRegex = m.parse_name ? new RegExp(m.parse_name) : null;

    for (const dir of m.scan_dirs) {
      const expanded = dir.replace(/^~/, os.homedir());
      try {
        const files = fs.readdirSync(expanded);
        for (const f of files) {
          if (pattern && !pattern.test(f)) continue;
          if (nameRegex) {
            const match = f.match(nameRegex);
            if (match?.groups?.name) models.push(match.groups.name);
            else if (match?.[1]) models.push(match[1]);
          } else {
            models.push(f);
          }
        }
      } catch {}
    }
  }

  return [...new Set(models)];
}

/**
 * Find the resolved binary path for a handler
 */
function resolveBinary(spec) {
  const d = spec.detect;
  if (!d?.binary) return null;
  const binaries = [d.binary, ...(d.fallback_binaries || [])];
  for (const bin of binaries) {
    try {
      return execSync(`which ${bin}`, { encoding: 'utf8', timeout: 3000, stdio: 'pipe' }).trim();
    } catch {}
  }
  return null;
}

/**
 * Get software version from probe_cmd output
 */
function getVersion(spec) {
  if (spec.version) return spec.version;
  const d = spec.detect;
  if (!d?.probe_cmd) return null;
  try {
    const out = execSync(d.probe_cmd, { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
    // Try to extract version-like pattern
    const match = out.match(/(\d+\.\d+(?:\.\d+)?)/);
    return match ? match[1] : null;
  } catch { return null; }
}

/**
 * Detect GPU backend
 */
function detectBackend() {
  const backends = [];
  try {
    if (execSync('uname -m', { encoding: 'utf8', timeout: 3000 }).trim() === 'arm64' && process.platform === 'darwin')
      backends.push('metal');
  } catch {}
  try { execSync('which nvidia-smi', { encoding: 'utf8', timeout: 3000, stdio: 'pipe' }); backends.push('cuda'); } catch {}
  if (backends.length === 0) backends.push('cpu');
  return backends;
}

/**
 * Build a rich capability manifest from a handler spec
 * This is what gets sent to the hub on registration
 */
function buildManifest(spec) {
  const models = discoverModels(spec);
  const binary = resolveBinary(spec);
  const version = getVersion(spec);
  const backends = detectBackend();

  return {
    capability: spec.capability,
    namespace: spec.namespace || null,
    aliases: spec.aliases || [],
    description: spec.description || null,
    version: version,
    binary: binary,
    backends: backends,
    models: models.map(name => ({ name })),
    resources: spec.resources || {},
    storage: spec.storage || null,
    pricing: spec.pricing || null,
    benchmark: spec.benchmark ? { configured: true } : null,
    _specFile: spec._file
  };
}

/**
 * Scan handlers/ directory, detect capabilities, return manifests
 * @returns {{ capabilities: string[], manifests: Object<string, Object> }}
 */
function scanCapabilities(handlersDir = HANDLERS_DIR) {
  const specs = loadHandlerSpecs(handlersDir);
  const capabilities = [];
  const manifests = {};
  const skipped = [];

  for (const [name, spec] of Object.entries(specs)) {
    if (detectCapability(spec)) {
      capabilities.push(name);
      // Also register aliases
      for (const alias of (spec.aliases || [])) {
        capabilities.push(alias);
      }
      manifests[name] = buildManifest(spec);
    } else {
      skipped.push(name);
    }
  }

  return {
    capabilities: [...new Set(capabilities)],
    manifests,
    skipped,
    specsLoaded: Object.keys(specs).length
  };
}

/**
 * Expand template variables in a string
 */
// SECURITY: Shell-escape a value to prevent command injection
function shellEscape(val) {
  if (typeof val !== 'string') return String(val || '');
  // Only allow safe characters — alphanumeric, dots, dashes, underscores, slashes (for paths)
  // Everything else gets stripped
  return val.replace(/[^a-zA-Z0-9._\-\/: ]/g, '');
}

function expandTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = vars[key];
    if (val === undefined) return `{${key}}`;
    // Path variables (input, output_dir) are internally generated — safe
    if (['input', 'output_dir'].includes(key)) return val;
    // Everything else gets shell-escaped
    return shellEscape(val);
  });
}

/**
 * Execute a job using the handler's invoke spec
 * @returns {Promise<Object>} Job result
 */
async function executeFromSpec(spec, job, options = {}) {
  const invoke = spec.invoke;
  if (!invoke?.cmd) throw new Error(`Handler ${spec.capability} has no invoke.cmd`);

  const timeoutMs = (spec.resources?.timeout || 300) * 1000;
    // IC_MESH_TMPDIR_FIX: Force correct temp directory on Linux
  const getCorrectTempDir = () => process.platform === 'linux' ? '/tmp' : os.tmpdir();
  const tmpDir = path.join(getCorrectTempDir(), `ic-handler-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const threads = Math.max(1, os.cpus().length - 1);
  
  // Find model path if needed
  let modelPath = '';
  let modelName = job.payload?.model || '';
  if (spec.models?.scan_dirs && modelName) {
    for (const dir of spec.models.scan_dirs) {
      const expanded = dir.replace(/^~/, os.homedir());
      try {
        const files = fs.readdirSync(expanded);
        const match = files.find(f => f.includes(modelName));
        if (match) { modelPath = path.join(expanded, match); break; }
      } catch {}
    }
  }

  // Download input if URL provided
  let inputFile = '';
  if (job.payload?.url) {
    let parsedUrl;
    try { parsedUrl = new URL(job.payload.url); } catch { throw new Error('Invalid URL'); }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('URL must be http(s)');
    
    // SECURITY: Block SSRF — no internal IPs, metadata services, or localhost
    const hostname = parsedUrl.hostname;
    const blockedPatterns = [
      /^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
      /^169\.254\./, /^0\./, /^::1$/, /^fc00/i, /^fe80/i, /^fd/i,
      /metadata\.google/, /metadata\.aws/, /instance-data/
    ];
    if (blockedPatterns.some(p => p.test(hostname))) {
      throw new Error('URL blocked: internal/private addresses not allowed');
    }
    
    // SECURITY: Sanitize URL to prevent command injection via shell
    const safeUrl = parsedUrl.href.replace(/[;&|`$(){}!#]/g, '');
    
    const ext = path.extname(parsedUrl.pathname) || '.bin';
    inputFile = path.join(tmpDir, `input${ext}`);
    execSync(`curl -sL --max-filesize ${(spec.resources?.max_input_mb || 500) * 1048576} -o "${inputFile}" "${safeUrl}"`, { timeout: 120000 });
  }

  // Template vars
  const vars = {
    input: inputFile,
    output_dir: tmpDir,
    model_path: modelPath,
    model_name: modelName,
    threads: String(threads),
    job_id: job.jobId || '',
    job_type: job.type || spec.capability
  };

  const cmd = expandTemplate(invoke.cmd, vars);

  // Build env
  const env = { ...process.env, HANDLER_OUTPUT_DIR: tmpDir, HANDLER_TEMP_DIR: tmpDir };
  if (invoke.env) {
    for (const [k, v] of Object.entries(invoke.env)) {
      env[k] = expandTemplate(String(v), vars);
    }
  }
  if (job.payload) {
    // SECURITY: Only pass safe, serialized payload — never individual fields as env vars
    // (prevents injection via model names, commands, or other user-controlled fields)
    env.JOB_PAYLOAD = JSON.stringify(job.payload);
    env.JOB_ID = shellEscape(job.jobId || '');
    env.JOB_TYPE = shellEscape(job.type || '');
  }

  try {
    const output = await new Promise((resolve, reject) => {
      const proc = spawn('bash', ['-c', cmd], { env, timeout: timeoutMs, cwd: path.join(__dirname, '..') });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => stdout += d);
      proc.stderr.on('data', d => { stderr += d; process.stderr.write(d); });
      proc.on('close', code => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`Exit ${code}: ${stderr.slice(-500)}`));
      });
      proc.on('error', reject);
      
      // Pipe stdin if configured
      if (invoke.stdin === 'json' && job.payload) {
        proc.stdin.write(JSON.stringify(job.payload));
        proc.stdin.end();
      } else if (invoke.stdin === 'raw' && job.payload?.prompt) {
        proc.stdin.write(job.payload.prompt);
        proc.stdin.end();
      } else {
        proc.stdin.end();
      }
    });

    // Read result based on output config
    let result;
    if (invoke.output === 'file') {
      const outFile = expandTemplate(invoke.output_file || `${tmpDir}/output.txt`, vars);
      // Try the exact path and common variations
      const candidates = [outFile, outFile.replace('.txt', '')];
      let content = null;
      for (const f of candidates) {
        try { 
          content = fs.readFileSync(f, 'utf8'); 
          break; 
        } catch (e) {
          logger.debug('Output file not found', { file: f, capability: spec.capability });
        }
      }
      if (content !== null) {
        result = { success: true, output: content.trim(), handler: spec.capability };
      } else {
        // Fall back to stdout
        result = { success: true, output: output.trim(), handler: spec.capability };
      }
    } else if (invoke.result_type === 'json') {
      try { result = JSON.parse(output.trim()); } catch { result = { success: true, output: output.trim() }; }
    } else {
      result = { success: true, output: output.trim(), handler: spec.capability };
    }

    return result;
  } finally {
    try { 
      fs.rmSync(tmpDir, { recursive: true }); 
    } catch (e) {
      logger.debug('Failed to cleanup temp directory', { tmpDir, error: e.message });
    }
  }
}

module.exports = {
  loadHandlerSpecs,
  detectCapability,
  discoverModels,
  buildManifest,
  scanCapabilities,
  executeFromSpec,
  expandTemplate,
  HANDLERS_DIR
};
