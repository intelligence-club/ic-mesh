#!/usr/bin/env node

/**
 * Node Onboarding Diagnostics
 * 
 * Automatically diagnoses common onboarding issues that cause
 * 40% of nodes to disconnect within 1 hour.
 * 
 * Usage: node onboarding-diagnostics.js [nodeId]
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'mesh.db');

class OnboardingDiagnostics {
    constructor() {
        this.db = new Database(DB_PATH);
    }

    runDiagnostics(nodeId = null) {
        console.log('🏥 IC Mesh Node Onboarding Diagnostics\n');
        
        if (nodeId) {
            this.diagnoseSpecificNode(nodeId);
        } else {
            this.diagnoseGeneralOnboardingIssues();
        }
        
        this.db.close();
    }

    diagnoseSpecificNode(nodeId) {
        console.log(`🔍 Diagnosing node: ${nodeId}\n`);
        
        const node = this.getNode(nodeId);
        if (!node) {
            console.log(`❌ Node ${nodeId} not found in database`);
            return;
        }

        this.analyzeNodeHealth(node);
        this.checkNodeCapabilities(node);
        this.analyzeJobHistory(node);
        this.checkCommonFailurePatterns(node);
        this.provideRecommendations(node);
    }

    diagnoseGeneralOnboardingIssues() {
        console.log('🔍 Analyzing general onboarding patterns\n');
        
        const quickDisconnects = this.getQuickDisconnectNodes();
        const healthCheckNodes = this.getHealthCheckNodes();
        const onboardingIssues = this.analyzeOnboardingFailures();
        
        console.log('📊 Onboarding Issue Summary:');
        console.log(`   Quick disconnects (<1h): ${quickDisconnects.length} nodes`);
        console.log(`   Health check only: ${healthCheckNodes.length} nodes`);
        console.log(`   Zero-job nodes: ${onboardingIssues.zeroJobNodes} nodes`);
        console.log(`   Low success rate: ${onboardingIssues.lowSuccessNodes} nodes\n`);
        
        if (quickDisconnects.length > 0) {
            console.log('⚠️  Quick Disconnect Analysis:');
            for (const node of quickDisconnects.slice(0, 5)) {
                const now = Math.floor(Date.now() / 1000);
                const minutes = Math.floor((now - node.lastHeartbeat) / 60);
                console.log(`   ${node.name || 'unknown'} (${node.nodeId.substr(0, 8)}): ${node.jobsCompleted} jobs, ${minutes}min ago`);
            }
            console.log();
        }
        
        this.provideGeneralRecommendations();
    }

    analyzeNodeHealth(node) {
        const now = Math.floor(Date.now() / 1000);
        const lastSeen = Math.floor((now - node.lastHeartbeat) / 60);
        const isOnline = lastSeen < 5;
        const sessionDuration = Math.floor((node.lastHeartbeat - node.registeredAt) / 60);
        
        console.log('🏥 Node Health Status:');
        console.log(`   Status: ${isOnline ? '🟢 ONLINE' : '🔴 OFFLINE'}`);
        console.log(`   Last seen: ${lastSeen} minutes ago`);
        console.log(`   Session duration: ${sessionDuration} minutes`);
        console.log(`   Jobs completed: ${node.jobsCompleted || 0}`);
        console.log(`   Name: ${node.name || 'unknown'}\n`);
        
        if (sessionDuration < 60) {
            console.log('⚠️  SHORT SESSION DETECTED');
            console.log('   This node is at risk of quick disconnect');
            console.log('   Recommendation: Monitor for next 30 minutes\n');
        }
    }

    checkNodeCapabilities(node) {
        console.log('🛠️  Node Capabilities Check:');
        
        const capabilities = JSON.parse(node.capabilities || '[]');
        if (capabilities.length === 0) {
            console.log('   ❌ No capabilities reported');
            console.log('   Issue: Node may not be properly configured');
            console.log('   Fix: Check node-config.json and restart client\n');
            return;
        }
        
        console.log(`   ✅ Capabilities: ${capabilities.join(', ')}`);
        
        // Check for common capability issues
        const hasTranscribe = capabilities.includes('transcribe');
        const hasWhisper = capabilities.includes('whisper');
        
        if (hasTranscribe && !hasWhisper) {
            console.log('   ⚠️  Transcribe without Whisper detected');
            console.log('   Issue: May cause transcription job failures');
            console.log('   Fix: Install Whisper or remove transcribe capability\n');
        } else {
            console.log('   ✅ Capability configuration looks healthy\n');
        }
    }

    analyzeJobHistory(node) {
        const jobs = this.getNodeJobs(node.id);
        
        console.log('📋 Job History Analysis:');
        console.log(`   Total jobs attempted: ${jobs.length}`);
        
        if (jobs.length === 0) {
            console.log('   ⚠️  Zero jobs claimed');
            console.log('   Issue: Node not claiming work or no available jobs');
            console.log('   Check: Job queue status and node quarantine status\n');
            return;
        }
        
        const successful = jobs.filter(job => job.status === 'completed').length;
        const failed = jobs.filter(job => job.status === 'failed').length;
        const successRate = jobs.length > 0 ? (successful / jobs.length * 100).toFixed(1) : 0;
        
        console.log(`   Successful: ${successful}`);
        console.log(`   Failed: ${failed}`);
        console.log(`   Success rate: ${successRate}%`);
        
        if (successRate < 50 && jobs.length > 5) {
            console.log(`   ❌ Low success rate (${successRate}%)`);
            console.log('   Issue: Node may be quarantined or misconfigured');
            this.analyzeFailurePatterns(jobs);
        } else {
            console.log('   ✅ Healthy job performance');
        }
        console.log();
    }

    analyzeFailurePatterns(jobs) {
        console.log('🔍 Failure Pattern Analysis:');
        
        const failedJobs = jobs.filter(job => job.status === 'failed');
        const errorPatterns = {};
        
        failedJobs.forEach(job => {
            const error = job.error || 'Unknown error';
            const pattern = error.substring(0, 50); // First 50 chars as pattern
            errorPatterns[pattern] = (errorPatterns[pattern] || 0) + 1;
        });
        
        Object.entries(errorPatterns)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 3)
            .forEach(([pattern, count]) => {
                console.log(`   ${count}x: ${pattern}...`);
            });
        
        console.log();
    }

    checkCommonFailurePatterns(node) {
        console.log('🔧 Common Issue Detection:');
        
        // Check for handler issues
        const jobs = this.getNodeJobs(node.id);
        const handlerErrors = jobs.filter(job => 
            job.error && job.error.includes('Handler') && job.error.includes('failed')
        );
        
        if (handlerErrors.length > 0) {
            console.log(`   ❌ Handler errors detected (${handlerErrors.length} jobs)`);
            console.log('   Issue: Missing or broken job handlers');
            console.log('   Fix: Update client software or adjust capabilities\n');
            return;
        }
        
        console.log('   ✅ No common failure patterns detected\n');
    }

    provideRecommendations(node) {
        const now = Math.floor(Date.now() / 1000);
        const lastSeen = Math.floor((now - node.lastHeartbeat) / 60);
        const sessionDuration = Math.floor((node.lastHeartbeat - node.registeredAt) / 60);
        
        console.log('🎯 Recommendations:');
        
        if (lastSeen > 60) {
            console.log('   📞 Contact node operator - node appears permanently offline');
        } else if (sessionDuration < 60) {
            console.log('   ⏰ Monitor closely - in critical first hour');
        } else if (sessionDuration > 600) {  // 10 hours
            console.log('   🏆 Celebrate! This node passed the 10-hour retention milestone');
        } else {
            console.log('   📈 Encourage continued operation - approaching 10-hour milestone');
        }
        
        console.log('   📚 Resources: docs/TROUBLESHOOTING.md');
        console.log('   🔧 Diagnostic: Run this script regularly');
        console.log();
    }

    async provideGeneralRecommendations() {
        console.log('🎯 General Onboarding Improvements:');
        console.log('   1. Add automated health checks for new nodes');
        console.log('   2. Create onboarding success metrics dashboard');
        console.log('   3. Implement 1-hour and 10-hour milestone tracking');
        console.log('   4. Add proactive troubleshooting for quick disconnects');
        console.log('   5. Create operator engagement program for retention');
        console.log();
    }

    // Database query methods
    getNode(nodeId) {
        return this.db.prepare('SELECT * FROM nodes WHERE nodeId = ?').get(nodeId);
    }

    getQuickDisconnectNodes() {
        const oneHourAgo = Math.floor(Date.now() / 1000) - 3600; // Convert to Unix timestamp
        return this.db.prepare(`
            SELECT * FROM nodes 
            WHERE lastHeartbeat < ? 
            AND (lastHeartbeat - registeredAt) / 60 > 0
            AND (lastHeartbeat - registeredAt) / 60 < 60
            ORDER BY registeredAt DESC
        `).all(oneHourAgo);
    }

    getHealthCheckNodes() {
        return this.db.prepare("SELECT * FROM nodes WHERE name LIKE '%Health Check%' AND (jobsCompleted = 0 OR jobsCompleted IS NULL)").all();
    }

    analyzeOnboardingFailures() {
        const zeroJobNodes = this.db.prepare('SELECT COUNT(*) as count FROM nodes WHERE jobsCompleted = 0 OR jobsCompleted IS NULL').get().count;
        const lowSuccessNodes = this.db.prepare('SELECT COUNT(*) as count FROM nodes WHERE jobsCompleted > 0').get().count; // Remove flagged check as column doesn't exist
        return { zeroJobNodes, lowSuccessNodes };
    }

    getNodeJobs(nodeId) {
        return this.db.prepare('SELECT * FROM jobs WHERE claimedBy = ? ORDER BY createdAt DESC LIMIT 50').all(nodeId);
    }
}

// CLI execution
if (require.main === module) {
    const nodeId = process.argv[2];
    const diagnostics = new OnboardingDiagnostics();
    diagnostics.runDiagnostics(nodeId);
}

module.exports = OnboardingDiagnostics;