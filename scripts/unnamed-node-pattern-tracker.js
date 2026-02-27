#!/usr/bin/env node

/**
 * Unnamed Node Pattern Tracker
 * Analyzes the connection patterns of the unnamed node (5ef95d69...) 
 * to help predict reconnection windows and service availability cycles.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../data/mesh.db');

function analyzeUnnamedNodePattern() {
    console.log('📊 Unnamed Node Pattern Analysis');
    console.log('══════════════════════════════════════');
    
    const db = new Database(DB_PATH);
    
    try {
        // Get the unnamed node ID
        const unnamedNode = db.prepare(`
            SELECT nodeId, name, jobsCompleted, lastSeen, registeredAt 
            FROM nodes 
            WHERE nodeId LIKE '5ef95d69%'
        `).get();
        
        if (!unnamedNode) {
            console.log('❌ Unnamed node (5ef95d69...) not found in database');
            return;
        }
        
        console.log(`🔍 Analyzing node: ${unnamedNode.name} (${unnamedNode.nodeId.slice(0, 8)}...)`);
        console.log(`📊 Total jobs completed: ${unnamedNode.jobsCompleted}`);
        console.log(`📅 Last seen: ${new Date(unnamedNode.lastSeen).toISOString()}`);
        console.log('');
        
        // Analyze job completion patterns to understand activity cycles
        const recentJobs = db.prepare(`
            SELECT 
                datetime(completedAt/1000, 'unixepoch') as completed,
                completedAt,
                type,
                computeMs
            FROM jobs 
            WHERE claimedBy = ? AND status = 'completed'
            ORDER BY completedAt DESC 
            LIMIT 20
        `).all(unnamedNode.nodeId);
        
        if (recentJobs.length === 0) {
            console.log('📝 No completed jobs found for this node');
            return;
        }
        
        console.log('🕐 Recent Activity Pattern:');
        console.log('────────────────────────────');
        
        let lastCompletionTime = null;
        const gaps = [];
        
        recentJobs.forEach((job, index) => {
            const timeAgo = Math.round((Date.now() - job.completedAt) / (1000 * 60));
            console.log(`  ${job.completed} | ${job.type.padEnd(12)} | ${timeAgo}m ago`);
            
            if (index > 0 && lastCompletionTime) {
                const gapMinutes = Math.round((lastCompletionTime - job.completedAt) / (1000 * 60));
                if (gapMinutes > 0) {
                    gaps.push(gapMinutes);
                }
            }
            lastCompletionTime = job.completedAt;
        });
        
        console.log('');
        
        // Analyze gaps between activity bursts
        if (gaps.length > 0) {
            const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
            const maxGap = Math.max(...gaps);
            const minGap = Math.min(...gaps);
            
            console.log('📈 Connection Pattern Analysis:');
            console.log('─────────────────────────────');
            console.log(`  Average gap: ${Math.round(avgGap)} minutes`);
            console.log(`  Longest gap: ${maxGap} minutes`);
            console.log(`  Shortest gap: ${minGap} minutes`);
            console.log('');
        }
        
        // Current status and prediction
        const currentGap = Math.round((Date.now() - unnamedNode.lastSeen) / (1000 * 60));
        console.log('🔮 Current Status & Prediction:');
        console.log('────────────────────────────────');
        console.log(`  Current offline time: ${currentGap} minutes`);
        
        if (gaps.length > 0) {
            const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
            if (currentGap < avgGap) {
                console.log(`  Status: Within normal range (avg: ${Math.round(avgGap)}m)`);
                console.log(`  Prediction: May reconnect in ${Math.round(avgGap - currentGap)} minutes`);
            } else {
                console.log(`  Status: Longer than average offline time`);
                console.log(`  Prediction: Overdue for reconnection, monitor actively`);
            }
        }
        
        // Service impact assessment
        const pendingTranscribeJobs = db.prepare(`
            SELECT COUNT(*) as count 
            FROM jobs 
            WHERE status = 'pending' AND type = 'transcribe'
        `).get().count;
        
        console.log('');
        console.log('💼 Business Impact:');
        console.log('───────────────────');
        console.log(`  Pending transcribe jobs: ${pendingTranscribeJobs}`);
        console.log(`  Revenue waiting: $${(pendingTranscribeJobs * 0.3).toFixed(2)}-$${(pendingTranscribeJobs * 0.8).toFixed(2)}`);
        
        if (pendingTranscribeJobs > 0) {
            console.log(`  Impact: HIGH - Customer jobs waiting for processing`);
        } else {
            console.log(`  Impact: LOW - No customer jobs blocked`);
        }
        
    } catch (error) {
        console.error('❌ Database error:', error.message);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    analyzeUnnamedNodePattern();
}

module.exports = { analyzeUnnamedNodePattern };