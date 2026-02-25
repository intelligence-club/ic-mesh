#!/usr/bin/env node
/**
 * IC Mesh Environment Checker
 * 
 * Validates configuration and dependencies for running IC Mesh
 */

const fs = require('fs');
const path = require('path');

function check(name, condition, required = false) {
  const status = condition ? '✓' : '✗';
  const level = required && !condition ? 'ERROR' : condition ? 'OK' : 'WARNING';
  const color = condition ? '\x1b[32m' : required ? '\x1b[31m' : '\x1b[33m';
  console.log(`${color}${status}\x1b[0m ${name} [${level}]`);
  return condition;
}

console.log('🔧 IC Mesh Environment Check\n');

// Core requirements
console.log('Core Requirements:');
const nodeVersion = process.version;
const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0]);
check(`Node.js ${nodeVersion} (>= 18)`, nodeMajor >= 18, true);

const hasNpm = (() => {
  try {
    require('child_process').execSync('npm --version', { stdio: 'ignore' });
    return true;
  } catch { return false; }
})();
check('npm available', hasNpm, true);

// Database
console.log('\nDatabase:');
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'mesh.db');
const dbDir = path.dirname(dbPath);
check(`Database directory writable (${dbDir})`, fs.existsSync(dbDir) || (() => {
  try { fs.mkdirSync(dbDir, { recursive: true }); return true; } catch { return false; }
})(), true);

// Optional services
console.log('\nOptional Services:');
check('DO_SPACES_KEY configured', !!process.env.DO_SPACES_KEY);
check('DO_SPACES_SECRET configured', !!process.env.DO_SPACES_SECRET);
check('STRIPE_SECRET_KEY configured', !!process.env.STRIPE_SECRET_KEY);
check('STRIPE_ENDPOINT_SECRET configured', !!process.env.STRIPE_ENDPOINT_SECRET);

// Network
console.log('\nNetwork:');
const port = process.env.PORT || 8333;
check(`Port ${port} available`, !(() => {
  try {
    const net = require('net');
    const server = net.createServer();
    server.listen(port, 'localhost');
    server.close();
    return false; // Port is free
  } catch {
    return true; // Port is occupied
  }
})());

// Dependencies
console.log('\nDependencies:');
const packagePath = path.join(__dirname, '..', 'package.json');
if (fs.existsSync(packagePath)) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  let allDepsPresent = true;
  
  for (const dep of Object.keys(pkg.dependencies || {})) {
    try {
      require.resolve(dep);
      check(dep, true);
    } catch {
      check(dep, false, true);
      allDepsPresent = false;
    }
  }
  
  if (!allDepsPresent) {
    console.log('\n💡 Run: npm install');
  }
} else {
  check('package.json found', false, true);
}

// Handler scripts
console.log('\nHandlers:');
const handlersDir = path.join(__dirname, '..', 'handlers');
if (fs.existsSync(handlersDir)) {
  const handlers = fs.readdirSync(handlersDir).filter(f => f.endsWith('.js'));
  check(`${handlers.length} handler scripts found`, handlers.length > 0);
  
  for (const handler of handlers.slice(0, 3)) {
    const handlerPath = path.join(handlersDir, handler);
    const isExecutable = fs.statSync(handlerPath).mode & parseInt('111', 8);
    check(`${handler} executable`, isExecutable);
  }
} else {
  check('handlers directory found', false);
}

console.log('\n🚀 IC Mesh ready for: npm start');