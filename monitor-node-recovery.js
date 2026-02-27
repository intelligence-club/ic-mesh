#!/usr/bin/env node

const http = require('http');

function checkNodeStatus() {
    return new Promise((resolve, reject) => {
        const req = http.get('http://localhost:8333/nodes', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    resolve(result);
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => reject(new Error('Timeout')));
    });
}

function checkJobsAvailable() {
    return new Promise((resolve, reject) => {
        const req = http.get('http://localhost:8333/jobs/available', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    resolve(result);
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => reject(new Error('Timeout')));
    });
}

async function monitor() {
    try {
        const nodes = await checkNodeStatus();
        const jobs = await checkJobsAvailable();
        
        const timestamp = new Date().toISOString();
        const activeNodes = Object.keys(nodes.nodes || {}).length;
        const availableJobs = jobs.count || 0;
        
        console.log(`[${timestamp}] Nodes: ${activeNodes}/${nodes.total || 0} active, Jobs: ${availableJobs} available`);
        
        if (activeNodes > 0 && availableJobs > 0) {
            console.log('🎉 RECOVERY DETECTED! Nodes active and jobs available');
            process.exit(0);
        } else if (activeNodes > 0) {
            console.log('📈 Partial recovery - nodes active but no jobs available');
        } else {
            console.log('⏳ Still waiting for node detection...');
        }
    } catch (error) {
        console.log(`[${new Date().toISOString()}] Error: ${error.message}`);
    }
}

// Run once for immediate check
monitor();

// Run every 30 seconds if needed for continuous monitoring
if (process.argv.includes('--watch')) {
    setInterval(monitor, 30000);
    console.log('Monitoring every 30 seconds... (Ctrl+C to stop)');
}