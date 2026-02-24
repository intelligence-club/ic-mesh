#!/usr/bin/env node
/**
 * meshctl — IC Mesh Node Control CLI
 * 
 * Manage what your node offers, how much, and when.
 * Your hardware, your rules.
 * 
 * Usage:
 *   node meshctl.js status              — show current node config & state
 *   node meshctl.js enable <cap>        — enable a capability (whisper, stable-diffusion, ollama, ffmpeg)
 *   node meshctl.js disable <cap>       — disable a capability
 *   node meshctl.js limit <key> <val>   — set a resource limit
 *   node meshctl.js pause               — stop accepting jobs (stay registered)
 *   node meshctl.js resume              — start accepting jobs again
 *   node meshctl.js schedule <on|off>   — toggle schedule-based availability
 *   node meshctl.js earnings            — show compute credits earned
 *   node meshctl.js config              — print full config
 *   node meshctl.js init                — create default config file
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(__dirname, 'node-config.json');
const STATE_PATH = path.join(__dirname, 'data', 'node-state.json');

// ===== Config Management =====

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { paused: false, nodeId: null, jobsCompleted: 0, creditsEarned: 0 }; }
}

function saveState(state) {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function initConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    console.log('Config already exists at', CONFIG_PATH);
    console.log('Edit it directly or use meshctl commands.');
    return;
  }
  
  const example = path.join(__dirname, 'node-config.example.json');
  if (fs.existsSync(example)) {
    fs.copyFileSync(example, CONFIG_PATH);
  } else {
    const defaultConfig = {
      node: { name: os.hostname(), owner: os.userInfo().username, region: 'unknown' },
      server: { url: 'https://moilol.com:8333' },
      capabilities: {
        whisper: { enabled: true, models: ['base'], maxConcurrent: 1 },
        'stable-diffusion': { enabled: false, url: 'http://localhost:7860', maxConcurrent: 1 },
        ollama: { enabled: true, models: [], maxConcurrent: 2 },
        ffmpeg: { enabled: true, maxConcurrent: 2 }
      },
      limits: { maxCpuPercent: 80, maxRamPercent: 70, maxConcurrentJobs: 3, maxFileSizeMB: 50 },
      schedule: { enabled: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, available: [] },
      pricing: { multiplier: 1.0 }
    };
    saveConfig(defaultConfig);
  }
  console.log('✓ Created config at', CONFIG_PATH);
  console.log('  Edit it to set your node name, capabilities, and limits.');
}

// ===== Commands =====

function showStatus() {
  const config = loadConfig();
  const state = loadState();
  
  if (!config) {
    console.log('No config found. Run: node meshctl.js init');
    return;
  }
  
  console.log('');
  console.log('┌──────────────────────────────────┐');
  console.log('│  ◉ IC MESH — Node Control        │');
  console.log('└──────────────────────────────────┘');
  console.log('');
  console.log(`  Node:     ${config.node.name}`);
  console.log(`  Owner:    ${config.node.owner}`);
  console.log(`  Region:   ${config.node.region}`);
  console.log(`  Server:   ${config.server.url}`);
  console.log(`  Status:   ${state.paused ? '⏸️  PAUSED' : '▶️  ACTIVE'}`);
  console.log(`  Node ID:  ${state.nodeId || 'not registered yet'}`);
  console.log('');
  
  console.log('  Capabilities:');
  for (const [cap, settings] of Object.entries(config.capabilities)) {
    const status = settings.enabled ? '✅' : '❌';
    const extra = settings.models?.length ? ` (models: ${settings.models.join(', ')})` : '';
    const concurrent = settings.maxConcurrent ? ` [max ${settings.maxConcurrent} concurrent]` : '';
    console.log(`    ${status} ${cap}${extra}${concurrent}`);
  }
  console.log('');
  
  console.log('  Limits:');
  console.log(`    CPU: ${config.limits.maxCpuPercent}% max`);
  console.log(`    RAM: ${config.limits.maxRamPercent}% max`);
  console.log(`    Concurrent jobs: ${config.limits.maxConcurrentJobs}`);
  console.log(`    Max file size: ${config.limits.maxFileSizeMB}MB`);
  console.log('');
  
  if (config.schedule.enabled) {
    console.log('  Schedule: ON');
    console.log(`    Timezone: ${config.schedule.timezone}`);
    for (const slot of config.schedule.available) {
      console.log(`    ${slot.days.join(',')} ${slot.start}–${slot.end}`);
    }
  } else {
    console.log('  Schedule: OFF (available 24/7)');
  }
  console.log('');
  
  console.log(`  Earnings: ${state.creditsEarned?.toFixed(2) || 0} compute credits`);
  console.log(`  Jobs completed: ${state.jobsCompleted || 0}`);
  console.log('');
}

function enableCap(cap) {
  const config = loadConfig();
  if (!config) { console.log('No config. Run: node meshctl.js init'); return; }
  
  if (!config.capabilities[cap]) {
    config.capabilities[cap] = { enabled: true, maxConcurrent: 1 };
  } else {
    config.capabilities[cap].enabled = true;
  }
  saveConfig(config);
  console.log(`✅ Enabled: ${cap}`);
  console.log('  Restart the client to apply changes.');
}

function disableCap(cap) {
  const config = loadConfig();
  if (!config) { console.log('No config. Run: node meshctl.js init'); return; }
  
  if (config.capabilities[cap]) {
    config.capabilities[cap].enabled = false;
    saveConfig(config);
    console.log(`❌ Disabled: ${cap}`);
    console.log('  Restart the client to apply changes.');
  } else {
    console.log(`Unknown capability: ${cap}`);
    console.log(`Available: ${Object.keys(config.capabilities).join(', ')}`);
  }
}

function setLimit(key, value) {
  const config = loadConfig();
  if (!config) { console.log('No config. Run: node meshctl.js init'); return; }
  
  const validKeys = Object.keys(config.limits);
  if (!validKeys.includes(key)) {
    console.log(`Unknown limit: ${key}`);
    console.log(`Available: ${validKeys.join(', ')}`);
    return;
  }
  
  config.limits[key] = parseInt(value);
  saveConfig(config);
  console.log(`✓ Set ${key} = ${value}`);
  console.log('  Restart the client to apply changes.');
}

function setPaused(paused) {
  const state = loadState();
  state.paused = paused;
  saveState(state);
  console.log(paused ? '⏸️  Node paused — will not accept new jobs.' : '▶️  Node resumed — accepting jobs.');
  console.log('  Takes effect within 60 seconds (next heartbeat).');
}

function showEarnings() {
  const state = loadState();
  const config = loadConfig();
  
  console.log('');
  console.log(`  Node: ${config?.node?.name || 'unknown'}`);
  console.log(`  Credits earned: ${state.creditsEarned?.toFixed(4) || 0}`);
  console.log(`  Jobs completed: ${state.jobsCompleted || 0}`);
  
  if (state.nodeId && config?.server?.url) {
    // Try to fetch from server
    fetch(`${config.server.url}/ledger/${state.nodeId}`)
      .then(r => r.json())
      .then(d => {
        console.log(`  Server balance: ${d.balance?.toFixed(4) || 0} credits`);
        console.log(`  Total earned: ${d.earned?.toFixed(4) || 0}`);
        console.log(`  Total spent: ${d.spent?.toFixed(4) || 0}`);
      })
      .catch(() => console.log('  (Could not reach server for balance)'));
  }
  console.log('');
}

function showConfig() {
  const config = loadConfig();
  if (!config) { console.log('No config. Run: node meshctl.js init'); return; }
  console.log(JSON.stringify(config, null, 2));
}

// ===== Main =====

const [,, cmd, ...args] = process.argv;

switch(cmd) {
  case 'status': case undefined: showStatus(); break;
  case 'enable': enableCap(args[0]); break;
  case 'disable': disableCap(args[0]); break;
  case 'limit': setLimit(args[0], args[1]); break;
  case 'pause': setPaused(true); break;
  case 'resume': setPaused(false); break;
  case 'earnings': showEarnings(); break;
  case 'config': showConfig(); break;
  case 'init': initConfig(); break;
  case 'schedule':
    const config = loadConfig();
    if (!config) { console.log('No config. Run: node meshctl.js init'); break; }
    config.schedule.enabled = args[0] === 'on';
    saveConfig(config);
    console.log(`Schedule: ${config.schedule.enabled ? 'ON' : 'OFF'}`);
    break;
  default:
    console.log('Unknown command:', cmd);
    console.log('Commands: status, enable, disable, limit, pause, resume, schedule, earnings, config, init');
}
