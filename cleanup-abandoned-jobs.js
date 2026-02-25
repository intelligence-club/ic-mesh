#!/usr/bin/env node
/**
 * Cleanup abandoned jobs - jobs claimed by disconnected nodes
 */

const Database = require('better-sqlite3');
const db = new Database('mesh.db');

// Find abandoned jobs - claimed by nodes that haven't sent heartbeat in 5+ minutes
const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
const abandonedJobs = db.prepare(`
    SELECT 
        j.jobId,
        j.claimedBy,
        j.status,
        j.claimedAt,
        n.lastHeartbeat
    FROM jobs j
    LEFT JOIN nodes n ON j.claimedBy = n.nodeId
    WHERE j.status = 'claimed' AND (n.lastHeartbeat < ? OR n.lastHeartbeat IS NULL)
`).all(fiveMinutesAgo);

console.log(`Found ${abandonedJobs.length} abandoned jobs`);

if (abandonedJobs.length > 0) {
    // Mark them as failed
    const updateStmt = db.prepare(`
        UPDATE jobs 
        SET status = 'failed', 
            failedAt = datetime('now'),
            error = 'Node disconnected while processing job'
        WHERE jobId = ?
    `);

    let cleaned = 0;
    abandonedJobs.forEach(job => {
        updateStmt.run(job.jobId);
        console.log(`✅ Marked job ${job.jobId.substring(0, 8)} as failed (node ${job.claimedBy?.substring(0, 8)} disconnected)`);
        cleaned++;
    });

    console.log(`🧹 Cleaned up ${cleaned} abandoned jobs`);
} else {
    console.log('✅ No abandoned jobs found');
}

db.close();