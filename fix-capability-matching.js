#!/usr/bin/env node

/**
 * Capability Matching Fix
 * Fixes job requirement format mismatches and test pollution
 */

const sqlite3 = require('sqlite3').verbose();

class CapabilityMatchingFix {
    constructor() {
        this.db = new sqlite3.Database('data/mesh.db');
        this.fixes = [];
    }

    async fix() {
        console.log('🔧 FIXING CAPABILITY MATCHING ISSUES');
        console.log('====================================\n');
        
        await this.analyzeCurrentState();
        await this.removeTestPollution();
        await this.fixRequirementFormat();
        await this.verifyFixes();
        
        this.displayResults();
        this.db.close();
    }

    analyzeCurrentState() {
        return new Promise((resolve) => {
            console.log('📊 CURRENT STATE ANALYSIS');
            
            // Check job requirements
            this.db.all(`
                SELECT requirements, COUNT(*) as count
                FROM jobs 
                WHERE type = 'transcribe' AND status = 'pending'
                GROUP BY requirements
            `, (err, reqs) => {
                if (err) { console.error('Error:', err); resolve(); return; }
                
                console.log('   Job Requirements Distribution:');
                reqs.forEach(req => {
                    console.log(`     "${req.requirements}": ${req.count} jobs`);
                });
                
                // Check node capabilities
                this.db.all(`
                    SELECT capabilities, COUNT(*) as count
                    FROM nodes 
                    WHERE lastSeen > ?
                    GROUP BY capabilities
                `, [Date.now() - (10 * 60 * 1000)], (err, caps) => {
                    if (err) { console.error('Error:', err); resolve(); return; }
                    
                    console.log('   Node Capabilities Distribution:');
                    caps.forEach(cap => {
                        console.log(`     ${cap.capabilities}: ${cap.count} nodes`);
                    });
                    
                    resolve();
                });
            });
        });
    }

    removeTestPollution() {
        return new Promise((resolve) => {
            console.log('\n🧹 REMOVING TEST POLLUTION');
            
            // Remove test mode jobs
            // First count, then delete
            this.db.all(`
                SELECT COUNT(*) as count
                FROM jobs 
                WHERE type = 'transcribe' 
                AND status = 'pending' 
                AND requirements LIKE '%TEST_MODE%'
            `, (err, result) => {
                if (err) {
                    console.error('   Error counting test jobs:', err);
                    resolve();
                    return;
                }
                
                const testCount = result[0]?.count || 0;
                
                if (testCount === 0) {
                    console.log('   ✅ No TEST_MODE jobs to remove');
                    resolve();
                    return;
                }
                
                // Now delete them
                this.db.run(`
                    DELETE FROM jobs 
                    WHERE type = 'transcribe' 
                    AND status = 'pending' 
                    AND requirements LIKE '%TEST_MODE%'
                `, (err) => {
                    if (err) {
                        console.error('   Error removing test jobs:', err);
                    } else {
                        console.log(`   ✅ Removed ${testCount} TEST_MODE jobs`);
                        this.fixes.push(`Removed ${testCount} test pollution jobs`);
                    }
                    resolve();
                });
            });
        });
    }

    fixRequirementFormat() {
        return new Promise((resolve) => {
            console.log('\n🎯 FIXING REQUIREMENT FORMAT');
            
            // First count, then update
            this.db.all(`
                SELECT COUNT(*) as count
                FROM jobs 
                WHERE type = 'transcribe' 
                AND status = 'pending' 
                AND requirements = '{"capability":"transcription"}'
            `, (err, result) => {
                if (err) {
                    console.error('   Error counting requirements to fix:', err);
                    resolve();
                    return;
                }
                
                const fixCount = result[0]?.count || 0;
                
                if (fixCount === 0) {
                    console.log('   ✅ No requirements to simplify');
                    resolve();
                    return;
                }
                
                // Now update them
                this.db.run(`
                    UPDATE jobs 
                    SET requirements = '' 
                    WHERE type = 'transcribe' 
                    AND status = 'pending' 
                    AND requirements = '{"capability":"transcription"}'
                `, (err) => {
                    if (err) {
                        console.error('   Error fixing requirements:', err);
                    } else {
                        console.log(`   ✅ Simplified requirements for ${fixCount} jobs`);
                        this.fixes.push(`Simplified requirements for ${fixCount} jobs`);
                    }
                    resolve();
                });
            });
        });
    }

    verifyFixes() {
        return new Promise((resolve) => {
            console.log('\n✅ VERIFYING FIXES');
            
            // Check remaining pending jobs
            this.db.all(`
                SELECT COUNT(*) as count, requirements
                FROM jobs 
                WHERE type = 'transcribe' AND status = 'pending'
                GROUP BY requirements
            `, (err, remaining) => {
                if (err) { console.error('Error:', err); resolve(); return; }
                
                const total = remaining.reduce((sum, row) => sum + row.count, 0);
                console.log(`   Total Pending Jobs After Fix: ${total}`);
                
                remaining.forEach(row => {
                    const req = row.requirements || '(no requirements)';
                    console.log(`     ${req}: ${row.count} jobs`);
                });
                
                // Check if any jobs can now be claimed
                this.db.all(`
                    SELECT COUNT(*) as claimable
                    FROM jobs 
                    WHERE type = 'transcribe' 
                    AND status = 'pending' 
                    AND (requirements = '' OR requirements IS NULL)
                `, (err, claimable) => {
                    if (err) { console.error('Error:', err); resolve(); return; }
                    
                    console.log(`   Jobs Now Claimable: ${claimable[0].claimable}`);
                    
                    if (claimable[0].claimable > 0) {
                        this.fixes.push(`${claimable[0].claimable} jobs now claimable by active nodes`);
                    }
                    
                    resolve();
                });
            });
        });
    }

    displayResults() {
        console.log('\n' + '='.repeat(40));
        console.log('📊 CAPABILITY MATCHING FIX RESULTS');
        console.log('='.repeat(40));
        
        if (this.fixes.length > 0) {
            console.log('\n✅ FIXES APPLIED:');
            this.fixes.forEach(fix => console.log(`   • ${fix}`));
        } else {
            console.log('\n✅ No fixes needed - system already optimized');
        }
        
        console.log('\n💡 NEXT STEPS:');
        console.log('   1. Wait 1-2 minutes for active nodes to claim available jobs');
        console.log('   2. Run transcription-service-monitor.js to verify improvement');
        console.log('   3. Monitor processing rate to confirm capacity restoration');
        
        console.log(`\n⏰ Fix completed: ${new Date().toISOString()}`);
    }
}

// Run if called directly
if (require.main === module) {
    const fixer = new CapabilityMatchingFix();
    fixer.fix().catch(console.error);
}

module.exports = CapabilityMatchingFix;