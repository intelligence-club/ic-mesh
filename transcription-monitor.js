#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Simple transcription service monitor
function checkTranscriptionHealth() {
    const db = new sqlite3.Database(path.join(__dirname, 'data/mesh.db'));
    
    db.all(`
        SELECT 
            COUNT(*) as pending
        FROM jobs 
        WHERE type = 'transcribe' AND status = 'pending'
    `, (err, pendingResult) => {
        if (err) {
            console.error('❌ Database error:', err);
            db.close();
            return;
        }

        db.all(`
            SELECT 
                COUNT(*) as processing
            FROM jobs 
            WHERE type = 'transcribe' AND status = 'claimed'
        `, (err, processingResult) => {
            if (err) {
                console.error('❌ Database error:', err);
                db.close();
                return;
            }

            db.all(`
                SELECT 
                    COUNT(*) as completed_last_hour
                FROM jobs 
                WHERE type = 'transcribe' 
                  AND status = 'completed' 
                  AND completedAt > (strftime('%s', 'now') * 1000 - 3600000)
            `, (err, completedResult) => {
                if (err) {
                    console.error('❌ Database error:', err);
                    db.close();
                    return;
                }

                // Check active nodes with transcription capability
                db.all(`
                    SELECT 
                        COUNT(*) as active_transcription_nodes
                    FROM nodes 
                    WHERE (strftime('%s', 'now') * 1000 - lastSeen) < 120000
                      AND capabilities LIKE '%transcription%'
                `, (err, nodeResult) => {
                    if (err) {
                        console.error('❌ Database error:', err);
                        db.close();
                        return;
                    }

                    const pending = pendingResult[0].pending;
                    const processing = processingResult[0].processing;
                    const completedLastHour = completedResult[0].completed_last_hour;
                    const activeNodes = nodeResult[0].active_transcription_nodes;

                    console.log('🎙️  TRANSCRIPTION SERVICE MONITOR');
                    console.log('═══════════════════════════════════════');
                    console.log(`📊 Queue: ${pending} pending, ${processing} processing`);
                    console.log(`🖥️  Active nodes: ${activeNodes}`);
                    console.log(`✅ Completed last hour: ${completedLastHour}`);
                    
                    // Health assessment
                    if (activeNodes === 0) {
                        console.log('🚨 CRITICAL: No active transcription nodes!');
                    } else if (pending > 50) {
                        console.log('⚠️  WARNING: High backlog (>50 jobs)');
                    } else if (pending > 20) {
                        console.log('🧡 NOTICE: Moderate backlog (>20 jobs)');
                    } else if (completedLastHour > 0) {
                        console.log('🟢 HEALTHY: Processing active');
                    } else {
                        console.log('🟡 IDLE: No recent completions');
                    }

                    // Processing rate estimate
                    if (completedLastHour > 0 && pending > 0) {
                        const hoursToComplete = Math.ceil(pending / completedLastHour);
                        console.log(`⏱️  Estimated time to clear backlog: ${hoursToComplete}h`);
                    }

                    db.close();
                });
            });
        });
    });
}

// Run check
checkTranscriptionHealth();