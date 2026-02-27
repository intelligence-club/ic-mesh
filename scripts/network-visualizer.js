#!/usr/bin/env node

/**
 * IC Mesh Network Visualizer
 * 
 * Creates an interactive network visualization showing:
 * - Active nodes and their capabilities
 * - Job distribution across the network
 * - Real-time network health metrics
 * - Geographic distribution (if available)
 * - Performance statistics
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

// Configuration
const PORT = process.env.VIZ_PORT || 8334;
const MESH_SERVER = process.env.MESH_SERVER || 'http://localhost:8333';
const UPDATE_INTERVAL = process.env.UPDATE_INTERVAL || 5000; // 5 seconds

console.log('🕸️ IC Mesh Network Visualizer starting...');

// HTML template for the visualization
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>IC Mesh Network Visualizer</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0a0a0a;
    color: #e0e0e0;
    overflow: hidden;
  }
  
  #container {
    display: flex;
    height: 100vh;
  }
  
  #sidebar {
    width: 300px;
    background: #111;
    border-right: 1px solid #333;
    padding: 1rem;
    overflow-y: auto;
  }
  
  #main {
    flex: 1;
    position: relative;
  }
  
  #network {
    width: 100%;
    height: 100%;
    background: radial-gradient(circle at center, #0a0a0a 0%, #000 100%);
  }
  
  .header {
    margin-bottom: 1.5rem;
  }
  
  .header h1 {
    color: #4a9eff;
    font-size: 1.2rem;
    margin-bottom: 0.5rem;
  }
  
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }
  
  .stat {
    background: #1a1a1a;
    padding: 0.75rem;
    border-radius: 6px;
    border: 1px solid #333;
  }
  
  .stat-value {
    color: #4a9eff;
    font-size: 1.1rem;
    font-weight: 600;
  }
  
  .stat-label {
    color: #999;
    font-size: 0.8rem;
    margin-top: 0.25rem;
  }
  
  .section {
    margin-bottom: 1.5rem;
  }
  
  .section h3 {
    color: #ccc;
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  .node-list {
    space-y: 0.5rem;
  }
  
  .node-item {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 0.75rem;
    margin-bottom: 0.5rem;
  }
  
  .node-name {
    color: #4a9eff;
    font-weight: 500;
    font-size: 0.9rem;
  }
  
  .node-info {
    color: #999;
    font-size: 0.75rem;
    margin-top: 0.25rem;
  }
  
  .node-capabilities {
    display: flex;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }
  
  .capability-tag {
    background: #2a4a2a;
    color: #8fd38f;
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    font-size: 0.65rem;
    font-weight: 500;
  }
  
  .job-item {
    background: #1a1a1a;
    border: 1px solid #333;
    border-left: 3px solid #4a9eff;
    border-radius: 0 6px 6px 0;
    padding: 0.75rem;
    margin-bottom: 0.5rem;
  }
  
  .job-id {
    color: #4a9eff;
    font-weight: 500;
    font-size: 0.9rem;
  }
  
  .job-status {
    color: #999;
    font-size: 0.75rem;
    margin-top: 0.25rem;
  }
  
  .status-online { color: #8fd38f; }
  .status-busy { color: #ffb84a; }
  .status-offline { color: #ff6b6b; }
  
  .connection {
    stroke: #333;
    stroke-width: 1;
    opacity: 0.6;
  }
  
  .connection.active {
    stroke: #4a9eff;
    stroke-width: 2;
    opacity: 0.8;
  }
  
  .node-circle {
    cursor: pointer;
    transition: all 0.3s ease;
  }
  
  .node-circle:hover {
    stroke-width: 3;
  }
  
  .node-online {
    fill: #8fd38f;
    stroke: #6fb86f;
  }
  
  .node-busy {
    fill: #ffb84a;
    stroke: #e5a643;
  }
  
  .node-offline {
    fill: #ff6b6b;
    stroke: #e55a5a;
  }
  
  .node-label {
    fill: #e0e0e0;
    font-size: 10px;
    text-anchor: middle;
    pointer-events: none;
  }
  
  #status {
    position: absolute;
    top: 1rem;
    right: 1rem;
    background: rgba(0, 0, 0, 0.8);
    padding: 0.75rem;
    border-radius: 6px;
    border: 1px solid #333;
    font-size: 0.8rem;
  }
  
  .status-connected {
    color: #8fd38f;
  }
  
  .status-disconnected {
    color: #ff6b6b;
  }
</style>
</head>
<body>

<div id="container">
  <div id="sidebar">
    <div class="header">
      <h1>IC Mesh Network</h1>
      <div id="lastUpdate">Last update: --</div>
    </div>
    
    <div class="stats">
      <div class="stat">
        <div class="stat-value" id="nodeCount">--</div>
        <div class="stat-label">Active Nodes</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="jobCount">--</div>
        <div class="stat-label">Active Jobs</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="totalEarnings">--</div>
        <div class="stat-label">Total Earnings</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="networkHealth">--</div>
        <div class="stat-label">Network Health</div>
      </div>
    </div>
    
    <div class="section">
      <h3>Active Nodes</h3>
      <div id="nodeList" class="node-list"></div>
    </div>
    
    <div class="section">
      <h3>Recent Jobs</h3>
      <div id="jobList" class="job-list"></div>
    </div>
  </div>
  
  <div id="main">
    <div id="status">
      <span id="connectionStatus">Connecting...</span>
    </div>
    <svg id="network" width="100%" height="100%"></svg>
  </div>
</div>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
// Network visualization logic
let networkData = { nodes: [], jobs: [] };
let simulation;

// WebSocket connection for real-time updates
const ws = new WebSocket(\`ws://\${window.location.host}/ws\`);
const statusEl = document.getElementById('connectionStatus');

ws.onopen = () => {
  statusEl.textContent = 'Connected';
  statusEl.className = 'status-connected';
};

ws.onclose = () => {
  statusEl.textContent = 'Disconnected';
  statusEl.className = 'status-disconnected';
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  updateNetworkData(data);
};

// D3.js visualization setup
const svg = d3.select('#network');
const width = window.innerWidth - 300;
const height = window.innerHeight;

// Force simulation
function initializeVisualization() {
  simulation = d3.forceSimulation()
    .force('link', d3.forceLink().id(d => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(30));
}

function updateVisualization() {
  const nodes = networkData.nodes;
  const links = generateLinks(nodes);
  
  // Update simulation
  simulation.nodes(nodes);
  simulation.force('link').links(links);
  
  // Draw links
  const link = svg.selectAll('.connection')
    .data(links)
    .join('line')
    .attr('class', d => \`connection \${d.active ? 'active' : ''}\`);
  
  // Draw nodes
  const node = svg.selectAll('.node-circle')
    .data(nodes)
    .join('circle')
    .attr('class', d => \`node-circle node-\${d.status}\`)
    .attr('r', d => Math.max(15, Math.sqrt(d.jobs || 0) * 5 + 10))
    .call(drag());
  
  // Node labels
  const label = svg.selectAll('.node-label')
    .data(nodes)
    .join('text')
    .attr('class', 'node-label')
    .text(d => d.name || d.id.substring(0, 8));
  
  // Update positions on tick
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);
    
    node
      .attr('cx', d => d.x)
      .attr('cy', d => d.y);
    
    label
      .attr('x', d => d.x)
      .attr('y', d => d.y + 4);
  });
  
  simulation.alpha(0.3).restart();
}

function generateLinks(nodes) {
  // Generate links between nodes based on job sharing or geographical proximity
  const links = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (Math.random() > 0.7) { // Random connection for demo
        links.push({
          source: nodes[i],
          target: nodes[j],
          active: nodes[i].status === 'online' && nodes[j].status === 'online'
        });
      }
    }
  }
  return links;
}

function drag() {
  return d3.drag()
    .on('start', (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on('drag', (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on('end', (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });
}

function updateNetworkData(data) {
  networkData = data;
  
  // Update sidebar statistics
  document.getElementById('nodeCount').textContent = data.nodes.length;
  document.getElementById('jobCount').textContent = data.jobs?.length || 0;
  document.getElementById('totalEarnings').textContent = calculateTotalEarnings(data.nodes) + ' ints';
  document.getElementById('networkHealth').textContent = calculateNetworkHealth(data.nodes) + '%';
  document.getElementById('lastUpdate').textContent = 'Last update: ' + new Date().toLocaleTimeString();
  
  // Update node list
  updateNodeList(data.nodes);
  
  // Update job list
  updateJobList(data.jobs || []);
  
  // Update visualization
  updateVisualization();
}

function updateNodeList(nodes) {
  const nodeList = document.getElementById('nodeList');
  nodeList.innerHTML = '';
  
  nodes.forEach(node => {
    const nodeEl = document.createElement('div');
    nodeEl.className = 'node-item';
    nodeEl.innerHTML = \`
      <div class="node-name">\${node.name || node.id.substring(0, 12)}</div>
      <div class="node-info">
        <span class="status-\${node.status}">\${node.status.toUpperCase()}</span> &bull;
        \${node.jobs || 0} jobs &bull;
        \${node.earnings || 0} ints
      </div>
      <div class="node-capabilities">
        \${(node.capabilities || []).map(cap => 
          \`<span class="capability-tag">\${cap}</span>\`
        ).join('')}
      </div>
    \`;
    nodeList.appendChild(nodeEl);
  });
}

function updateJobList(jobs) {
  const jobList = document.getElementById('jobList');
  jobList.innerHTML = '';
  
  jobs.slice(0, 10).forEach(job => {
    const jobEl = document.createElement('div');
    jobEl.className = 'job-item';
    jobEl.innerHTML = \`
      <div class="job-id">Job \${job.id}</div>
      <div class="job-status">\${job.status} &bull; \${job.type}</div>
    \`;
    jobList.appendChild(jobEl);
  });
}

function calculateTotalEarnings(nodes) {
  return nodes.reduce((total, node) => total + (node.earnings || 0), 0);
}

function calculateNetworkHealth(nodes) {
  if (nodes.length === 0) return 0;
  const onlineNodes = nodes.filter(n => n.status === 'online').length;
  return Math.round((onlineNodes / nodes.length) * 100);
}

// Initialize visualization
initializeVisualization();

// Fetch initial data
fetch('/api/network-data')
  .then(res => res.json())
  .then(data => updateNetworkData(data))
  .catch(err => console.error('Failed to load initial data:', err));

// Handle window resize
window.addEventListener('resize', () => {
  const newWidth = window.innerWidth - 300;
  const newHeight = window.innerHeight;
  svg.attr('width', newWidth).attr('height', newHeight);
  simulation.force('center', d3.forceCenter(newWidth / 2, newHeight / 2));
  simulation.alpha(0.3).restart();
});
</script>
</body>
</html>`;

// Create HTTP server
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML_TEMPLATE);
  } else if (req.url === '/api/network-data') {
    fetchNetworkData()
      .then(data => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      })
      .catch(err => {
        console.error('Error fetching network data:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to fetch network data' }));
      });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

// WebSocket server for real-time updates
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('Client connected to visualizer');
  
  // Send initial data
  fetchNetworkData().then(data => {
    ws.send(JSON.stringify(data));
  });
  
  ws.on('close', () => {
    console.log('Client disconnected from visualizer');
  });
});

// Fetch network data from IC Mesh server
async function fetchNetworkData() {
  try {
    const nodesResponse = await fetch(`${MESH_SERVER}/nodes`);
    const nodes = await nodesResponse.json();
    
    let jobs = [];
    try {
      const jobsResponse = await fetch(`${MESH_SERVER}/jobs/available`);
      jobs = await jobsResponse.json();
    } catch (err) {
      console.warn('Could not fetch jobs data:', err.message);
    }
    
    // Enhance nodes with visualization data
    const enhancedNodes = nodes.map(node => ({
      ...node,
      status: getNodeStatus(node),
      capabilities: getNodeCapabilities(node),
      jobs: getNodeJobCount(node, jobs),
      earnings: node.balance_ints || 0
    }));
    
    return {
      nodes: enhancedNodes,
      jobs: jobs.slice(0, 50) // Limit for performance
    };
  } catch (error) {
    console.error('Error fetching network data:', error);
    return { nodes: [], jobs: [] };
  }
}

function getNodeStatus(node) {
  const lastSeen = new Date(node.last_seen);
  const minutesAgo = (Date.now() - lastSeen.getTime()) / 60000;
  
  if (minutesAgo > 10) return 'offline';
  if (node.current_jobs > 0) return 'busy';
  return 'online';
}

function getNodeCapabilities(node) {
  const caps = [];
  if (node.handler === 'whisper-transcription') caps.push('Transcription');
  if (node.handler === 'ollama-chat') caps.push('Chat');
  if (node.gpu_memory) caps.push('GPU');
  if (node.capabilities) caps.push(...node.capabilities);
  return [...new Set(caps)]; // Remove duplicates
}

function getNodeJobCount(node, jobs) {
  return jobs.filter(job => job.node_id === node.id).length;
}

// Broadcast network updates to all connected clients
async function broadcastUpdate() {
  try {
    const data = await fetchNetworkData();
    const message = JSON.stringify(data);
    
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  } catch (error) {
    console.error('Error broadcasting update:', error);
  }
}

// Start the server
server.listen(PORT, () => {
  console.log(`🕸️ Network Visualizer running at http://localhost:${PORT}`);
  console.log(`   Mesh server: ${MESH_SERVER}`);
  console.log(`   Update interval: ${UPDATE_INTERVAL}ms`);
});

// Broadcast updates at regular intervals
setInterval(broadcastUpdate, UPDATE_INTERVAL);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\\n🛑 Shutting down Network Visualizer...');
  server.close();
  process.exit(0);
});

// Helper function to fetch data (Node.js compatible)
function fetch(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let data = '';
      
      response.on('data', chunk => {
        data += chunk;
      });
      
      response.on('end', () => {
        try {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            json: () => Promise.resolve(JSON.parse(data))
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    
    request.on('error', reject);
  });
}