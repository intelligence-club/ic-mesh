#!/usr/bin/env node
/**
 * Capacity Crisis Resolution Monitoring
 * Tracks job processing after interventions
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'mesh.db');

function monitorJobQueue() {
    const db = new Database(dbPath);
    
    console.log('📊 Real-time Job Queue Monitor');
    console.log('==============================');
    console.log(`Time: ${new Date().toISOString()}\n`);
    
    // Get current job status
    const statusCounts = db.prepare(`
        SELECT status, COUNT(*) as count 
        FROM jobs 
        GROUP BY status 
        ORDER BY count DESC
    `).all();
    
    console.log('Job Status Summary:');
    statusCounts.forEach(row => {
        console.log(`  ${row.status}: ${row.count} jobs`);
    });
    
    // Get pending jobs by capability
    const pendingByCapability = db.prepare(`
        SELECT 
            type,
            JSON_EXTRACT(requirements, '$.capability') as capability,
            COUNT(*) as count,
            MIN(createdAt) as oldest_created,
            MAX(createdAt) as newest_created
        FROM jobs 
        WHERE status = 'pending'
        GROUP BY type, capability
        ORDER BY count DESC
    `).all();
    
    console.log('\n📋 Pending Jobs by Type & Capability:');
    if (pendingByCapability.length === 0) {
        console.log('  ✅ No pending jobs - all clear!');
    } else {
        pendingByCapability.forEach(row => {
            const oldestDate = new Date(row.oldest_created).toISOString();
            const newestDate = new Date(row.newest_created).toISOString();
            console.log(`  ${row.type} (${row.capability}): ${row.count} jobs`);
            console.log(`    Age range: ${oldestDate} to ${newestDate}`);
        });
    }
    
    // Check node quarantine status
    const quarantinedNodes = db.prepare(`
        SELECT nodeId, name, flags, lastSeen
        FROM nodes 
        WHERE JSON_EXTRACT(flags, '$.quarantined') = 1
    `).all();
    
    console.log('\n🚫 Quarantined Nodes:');
    if (quarantinedNodes.length === 0) {
        console.log('  ✅ No nodes currently quarantined');
    } else {
        quarantinedNodes.forEach(node => {
            const lastSeen = new Date(node.lastSeen).toISOString();
            console.log(`  ${node.name} (${node.nodeId.substring(0, 8)}...) - Last seen: ${lastSeen}`);
        });
    }
    
    // Check recent job completions
    const recentCompletions = db.prepare(`
        SELECT 
            type,
            JSON_EXTRACT(requirements, '$.capability') as capability,
            claimedBy,
            (completedAt - claimedAt) as processing_time_ms,
            CASE 
                WHEN status = 'completed' THEN 'success'
                WHEN status = 'failed' THEN 'failure'
                ELSE status
            END as result
        FROM jobs 
        WHERE completedAt > (strftime('%s', 'now') - 300) * 1000  -- Last 5 minutes
        ORDER BY completedAt DESC
        LIMIT 10
    `).all();
    
    console.log('\n⏱️ Recent Job Activity (last 5 minutes):');
    if (recentCompletions.length === 0) {
        console.log('  📭 No recent job completions');
    } else {
        recentCompletions.forEach(job => {
            const processingTime = Math.round(job.processing_time_ms / 1000);
            const nodeId = job.claimedBy ? job.claimedBy.substring(0, 8) + '...' : 'unknown';
            console.log(`  ${job.result}: ${job.type} (${job.capability}) by ${nodeId} in ${processingTime}s`);
        });
    }
    
    // Active nodes summary
    const activeNodes = db.prepare(`
        SELECT 
            nodeId,
            name,
            capabilities,
            JSON_EXTRACT(flags, '$.quarantined') as is_quarantined,
            jobsCompleted,
            CASE 
                WHEN (julianday('now') * 24 * 60 - julianday(lastSeen / 1000, 'unixepoch') * 24 * 60) <= 5 
                THEN 'online'
                WHEN (julianday('now') * 24 * 60 - julianday(lastSeen / 1000, 'unixepoch') * 24 * 60) <= 30 
                THEN 'recent'
                ELSE 'offline'
            END as status
        FROM nodes 
        WHERE status != 'offline'
        ORDER BY lastSeen DESC
    `).all();
    
    console.log('\n🖥️ Active Node Summary:');
    activeNodes.forEach(node => {
        const capabilities = JSON.parse(node.capabilities || '[]');
        const quarantined = node.is_quarantined ? ' [QUARANTINED]' : '';
        console.log(`  ${node.name} (${node.status}${quarantined}): ${capabilities.length} capabilities, ${node.jobsCompleted} jobs completed`);
    });
    
    db.close();
    
    return {
        statusCounts,
        pendingByCapability,
        quarantinedNodes,
        recentCompletions,
        activeNodes
    };
}

function watchJobProcessing(intervalMs = 30000) {
    console.log(`\n⏰ Starting job processing watch (${intervalMs/1000}s intervals)`);
    console.log('Press Ctrl+C to stop\n');
    
    let lastPendingCount = 0;
    
    const interval = setInterval(() => {
        console.log('\n' + '='.repeat(50));
        const status = monitorJobQueue();
        
        const pendingCount = status.pendingByCapability.reduce((sum, job) => sum + job.count, 0);
        
        if (pendingCount !== lastPendingCount) {
            const change = pendingCount - lastPendingCount;
            const direction = change > 0 ? '📈' : '📉';
            console.log(`\n${direction} Queue changed: ${lastPendingCount} → ${pendingCount} pending jobs (${change > 0 ? '+' : ''}${change})`);
            lastPendingCount = pendingCount;
        }
        
        console.log('\n⏳ Next check in 30 seconds...');
    }, intervalMs);
    
    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
        console.log('\n\n✋ Stopping monitor...');
        clearInterval(interval);
        process.exit(0);
    });
}

// Main execution
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--watch')) {
        watchJobProcessing();
    } else {
        monitorJobQueue();
    }
}

module.exports = { monitorJobQueue, watchJobProcessing };