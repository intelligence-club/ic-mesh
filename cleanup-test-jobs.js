#!/usr/bin/env node
/**
 * Cleanup Test Job Pollution Script
 * Removes TEST_MODE jobs that cannot be processed by any active node
 * and provides capacity analysis after cleanup
 */

const Database = require('better-sqlite3');
const path = require('path');

// Database connection
const dbPath = path.join(__dirname, 'data', 'mesh.db');
const db = new Database(dbPath);

console.log('🧹 IC Mesh Test Job Cleanup');
console.log('=======================================\n');

function analyzeJobQueue() {
    console.log('📊 Current Job Queue Analysis:');
    console.log('───────────────────────────────');
    
    // Get job counts by status
    const statusCounts = db.prepare(`
        SELECT status, COUNT(*) as count 
        FROM jobs 
        GROUP BY status 
        ORDER BY count DESC
    `).all();
    
    statusCounts.forEach(row => {
        console.log(`  ${row.status}: ${row.count} jobs`);
    });
    
    // Get pending jobs by capability requirement
    console.log('\n📋 Pending Jobs by Required Capability:');
    console.log('─────────────────────────────────────');
    
    const pendingByCapability = db.prepare(`
        SELECT 
            JSON_EXTRACT(requirements, '$.capability') as required_capability,
            COUNT(*) as count 
        FROM jobs 
        WHERE status = 'pending'
        GROUP BY required_capability 
        ORDER BY count DESC
    `).all();
    
    pendingByCapability.forEach(row => {
        const capability = row.required_capability || 'none';
        console.log(`  ${capability}: ${row.count} jobs`);
    });
    
    return {
        statusCounts,
        pendingByCapability
    };
}

function analyzeNodeCapabilities() {
    console.log('\n🖥️ Active Node Capabilities:');
    console.log('────────────────────────────');
    
    const activeNodes = db.prepare(`
        SELECT 
            nodeId, 
            name, 
            capabilities,
            flags,
            jobsCompleted,
            CASE 
                WHEN (julianday('now') * 24 * 60 - julianday(lastSeen / 1000, 'unixepoch') * 24 * 60) <= 5 
                THEN 'online'
                WHEN (julianday('now') * 24 * 60 - julianday(lastSeen / 1000, 'unixepoch') * 24 * 60) <= 60 
                THEN 'recent'
                ELSE 'offline'
            END as status
        FROM nodes 
        WHERE lastSeen IS NOT NULL
        ORDER BY lastSeen DESC
    `).all();
    
    const capabilityAliases = {
        'transcription': 'whisper',
        'transcribe': 'whisper', 
        'ocr': 'tesseract',
        'pdf-extract': 'tesseract',
        'inference': 'ollama',
        'generate-image': 'stable-diffusion'
    };
    
    activeNodes.forEach(node => {
        const flags = JSON.parse(node.flags || '{}');
        const isQuarantined = flags.quarantined;
        const capabilities = JSON.parse(node.capabilities || '[]');
        
        console.log(`  ${node.name} (${node.nodeId.substring(0, 8)}...)`);
        console.log(`    Status: ${node.status}${isQuarantined ? ' [QUARANTINED]' : ''}`);
        console.log(`    Capabilities: [${capabilities.join(', ')}]`);
        console.log(`    Jobs completed: ${node.jobsCompleted}`);
        
        // Show effective capabilities including aliases
        const effectiveCapabilities = [...capabilities];
        Object.entries(capabilityAliases).forEach(([required, provided]) => {
            if (capabilities.includes(provided) && !effectiveCapabilities.includes(required)) {
                effectiveCapabilities.push(`${required} (via ${provided})`);
            }
        });
        console.log(`    Effective capabilities: [${effectiveCapabilities.join(', ')}]`);
        console.log('');
    });
    
    return activeNodes;
}

function identifyTestJobPollution() {
    console.log('🧪 Test Job Pollution Analysis:');
    console.log('──────────────────────────────');
    
    const testJobs = db.prepare(`
        SELECT jobId, type, requirements, createdAt
        FROM jobs 
        WHERE status = 'pending' 
        AND JSON_EXTRACT(requirements, '$.capability') = 'TEST_MODE'
        ORDER BY createdAt DESC
    `).all();
    
    console.log(`Found ${testJobs.length} TEST_MODE jobs:`);
    testJobs.forEach(job => {
        const createdDate = new Date(job.createdAt).toISOString();
        console.log(`  ${job.jobId}: ${job.type} (created ${createdDate})`);
    });
    
    return testJobs;
}

function cleanupTestJobs(dryRun = true) {
    console.log('\n🚮 Test Job Cleanup:');
    console.log('───────────────────');
    
    if (dryRun) {
        console.log('DRY RUN MODE - No jobs will be deleted');
    }
    
    const testJobs = db.prepare(`
        SELECT jobId FROM jobs 
        WHERE status = 'pending' 
        AND JSON_EXTRACT(requirements, '$.capability') = 'TEST_MODE'
    `).all();
    
    if (testJobs.length === 0) {
        console.log('✅ No TEST_MODE jobs found to clean up');
        return 0;
    }
    
    console.log(`Found ${testJobs.length} TEST_MODE jobs to clean up`);
    
    if (!dryRun) {
        const deleteStmt = db.prepare(`
            DELETE FROM jobs 
            WHERE status = 'pending' 
            AND JSON_EXTRACT(requirements, '$.capability') = 'TEST_MODE'
        `);
        
        const result = deleteStmt.run();
        console.log(`✅ Deleted ${result.changes} TEST_MODE jobs`);
        return result.changes;
    }
    
    console.log('  (Run with --execute to actually delete these jobs)');
    return 0;
}

function analyzeRemainingCapacityNeeds() {
    console.log('\n🎯 Remaining Capacity Analysis:');
    console.log('─────────────────────────────');
    
    // Get non-TEST_MODE pending jobs
    const realPendingJobs = db.prepare(`
        SELECT 
            type,
            JSON_EXTRACT(requirements, '$.capability') as required_capability,
            COUNT(*) as count
        FROM jobs 
        WHERE status = 'pending'
        AND (JSON_EXTRACT(requirements, '$.capability') != 'TEST_MODE' OR JSON_EXTRACT(requirements, '$.capability') IS NULL)
        GROUP BY type, required_capability
        ORDER BY count DESC
    `).all();
    
    if (realPendingJobs.length === 0) {
        console.log('✅ No real pending jobs - capacity crisis resolved!');
        return;
    }
    
    console.log('Real pending jobs requiring attention:');
    realPendingJobs.forEach(job => {
        console.log(`  ${job.type}: ${job.count} jobs (requires ${job.required_capability || 'default'})`);
    });
    
    // Check which nodes can handle these
    const activeNodes = db.prepare(`
        SELECT nodeId, name, capabilities, flags
        FROM nodes 
        WHERE (julianday('now') * 24 * 60 - julianday(lastSeen / 1000, 'unixepoch') * 24 * 60) <= 60
    `).all();
    
    console.log('\nCapability coverage for real jobs:');
    
    const capabilityAliases = {
        'transcription': 'whisper',
        'transcribe': 'whisper', 
        'ocr': 'tesseract',
        'pdf-extract': 'tesseract',
        'inference': 'ollama',
        'generate-image': 'stable-diffusion'
    };
    
    realPendingJobs.forEach(job => {
        const requiredCap = job.required_capability;
        const aliasedCap = capabilityAliases[requiredCap] || requiredCap;
        
        const capableNodes = activeNodes.filter(node => {
            const flags = JSON.parse(node.flags || '{}');
            if (flags.quarantined) return false;
            
            const capabilities = JSON.parse(node.capabilities || '[]');
            return capabilities.includes(aliasedCap);
        });
        
        const quarantinedCapableNodes = activeNodes.filter(node => {
            const flags = JSON.parse(node.flags || '{}');
            if (!flags.quarantined) return false;
            
            const capabilities = JSON.parse(node.capabilities || '[]');
            return capabilities.includes(aliasedCap);
        });
        
        console.log(`  ${requiredCap}:`);
        if (capableNodes.length > 0) {
            console.log(`    ✅ ${capableNodes.length} active nodes can handle: ${capableNodes.map(n => n.name).join(', ')}`);
        } else {
            console.log(`    ❌ No active nodes can handle this capability`);
        }
        
        if (quarantinedCapableNodes.length > 0) {
            console.log(`    ⚠️  ${quarantinedCapableNodes.length} quarantined nodes could handle: ${quarantinedCapableNodes.map(n => n.name).join(', ')}`);
        }
    });
}

function generateRecommendations() {
    console.log('\n💡 Recommendations:');
    console.log('──────────────────');
    
    // Check if frigg is quarantined and needed
    const friggQuarantined = db.prepare(`
        SELECT nodeId, name, capabilities, flags
        FROM nodes 
        WHERE name = 'frigg' AND JSON_EXTRACT(flags, '$.quarantined') = 1
    `).get();
    
    if (friggQuarantined) {
        const capabilities = JSON.parse(friggQuarantined.capabilities || '[]');
        console.log('🔧 URGENT: frigg node is quarantined but has critical capabilities:');
        console.log(`   Capabilities: [${capabilities.join(', ')}]`);
        console.log('   Actions:');
        console.log('   1. SSH to frigg node and check transcribe handler logs');
        console.log('   2. Test transcribe handler manually with sample file');
        console.log('   3. Check whisper/ffmpeg dependencies');
        console.log('   4. Consider temporarily unquarantining for critical jobs');
    }
    
    // Check for capacity gaps
    const pendingJobsWithoutCapacity = db.prepare(`
        SELECT DISTINCT JSON_EXTRACT(requirements, '$.capability') as required_capability
        FROM jobs 
        WHERE status = 'pending'
        AND JSON_EXTRACT(requirements, '$.capability') != 'TEST_MODE'
    `).all();
    
    if (pendingJobsWithoutCapacity.length > 0) {
        console.log('\n🚀 Capacity expansion needed:');
        pendingJobsWithoutCapacity.forEach(job => {
            console.log(`   - Recruit nodes with ${job.required_capability} capability`);
        });
    }
    
    console.log('\n📋 Immediate actions:');
    console.log('   1. Clean up TEST_MODE job pollution');
    console.log('   2. Address frigg node quarantine (repair or replace capacity)');
    console.log('   3. Monitor real job processing rate');
    console.log('   4. Set up capacity alerting for future issues');
}

// Main execution
function main() {
    const args = process.argv.slice(2);
    const executeCleanup = args.includes('--execute');
    
    try {
        console.log(`Database: ${dbPath}\n`);
        
        // Initial analysis
        analyzeJobQueue();
        analyzeNodeCapabilities();
        
        // Identify and potentially clean up test job pollution
        identifyTestJobPollution();
        const cleanedJobs = cleanupTestJobs(!executeCleanup);
        
        if (cleanedJobs > 0) {
            console.log('\n📊 Post-cleanup analysis:');
            console.log('─────────────────────────');
            analyzeJobQueue();
        }
        
        // Analyze remaining capacity needs
        analyzeRemainingCapacityNeeds();
        
        // Generate actionable recommendations
        generateRecommendations();
        
        console.log('\n✅ Capacity analysis complete!');
        
    } catch (error) {
        console.error('❌ Error during analysis:', error.message);
        process.exit(1);
    } finally {
        db.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    analyzeJobQueue,
    analyzeNodeCapabilities,
    cleanupTestJobs,
    analyzeRemainingCapacityNeeds
};