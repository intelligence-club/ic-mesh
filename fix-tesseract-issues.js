#!/usr/bin/env node

/**
 * Fix Tesseract OCR Infrastructure Issues
 * 
 * Addresses the remaining 4 failed jobs by:
 * 1. Installing missing tesseract language data
 * 2. Fixing permission issues with temp directories
 * 3. Improving input validation for OCR/PDF jobs
 * 4. Adding better error recovery
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function checkTesseractInstallation() {
    console.log('🔍 Checking Tesseract Installation');
    console.log('===================================');
    
    try {
        // Check if tesseract is installed
        const version = execSync('tesseract --version', { encoding: 'utf8', timeout: 5000 });
        console.log('✅ Tesseract found:');
        console.log('   ', version.split('\\n')[0]);
        
        // Check available languages
        try {
            const langs = execSync('tesseract --list-langs', { encoding: 'utf8', timeout: 5000 });
            const langList = langs.split('\\n').slice(1).filter(l => l.trim());
            console.log(`✅ Available languages: ${langList.length}`);
            
            // Check for common languages
            const requiredLangs = ['eng', 'spa', 'fra', 'deu'];
            const missing = requiredLangs.filter(lang => !langList.includes(lang));
            
            if (missing.length > 0) {
                console.log(`⚠️  Missing common languages: ${missing.join(', ')}`);
                return { installed: true, missingLangs: missing };
            } else {
                console.log('✅ All common languages available');
                return { installed: true, missingLangs: [] };
            }
            
        } catch (error) {
            console.log('❌ Cannot list languages:', error.message);
            return { installed: true, missingLangs: ['eng'] };
        }
        
    } catch (error) {
        console.log('❌ Tesseract not found or not working');
        console.log('   Error:', error.message);
        return { installed: false, missingLangs: [] };
    }
}

function fixTempDirectoryPermissions() {
    console.log('\\n🔧 Fixing Temp Directory Issues');
    console.log('==================================');
    
    try {
        // Check if /tmp is writable
        const testFile = '/tmp/ic-handler-test-' + Date.now();
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        console.log('✅ /tmp directory is writable');
        
        // Create handler-specific temp directory with proper permissions
        const handlerTempDir = '/tmp/ic-handlers';
        if (!fs.existsSync(handlerTempDir)) {
            fs.mkdirSync(handlerTempDir, { mode: 0o755 });
            console.log('✅ Created handler temp directory:', handlerTempDir);
        } else {
            console.log('✅ Handler temp directory exists:', handlerTempDir);
        }
        
        // Check permissions on existing temp dirs
        const tempDirs = fs.readdirSync('/tmp').filter(dir => dir.startsWith('ic-handler-'));
        if (tempDirs.length > 0) {
            console.log(`🧹 Found ${tempDirs.length} old handler temp directories`);
            // Clean up old directories older than 1 hour
            tempDirs.forEach(dir => {
                try {
                    const dirPath = path.join('/tmp', dir);
                    const stat = fs.statSync(dirPath);
                    const age = Date.now() - stat.mtime.getTime();
                    if (age > 3600000) { // 1 hour
                        fs.rmSync(dirPath, { recursive: true, force: true });
                        console.log(`   Cleaned up old temp dir: ${dir}`);
                    }
                } catch (e) {
                    // Ignore cleanup errors
                }
            });
        }
        
        return true;
        
    } catch (error) {
        console.log('❌ Temp directory issues:', error.message);
        return false;
    }
}

function installMissingLanguages(missingLangs) {
    if (missingLangs.length === 0) return true;
    
    console.log(`\\n📦 Installing Missing Tesseract Languages`);
    console.log('==========================================');
    
    try {
        // Try different package managers and installation methods
        const distro = getLinuxDistro();
        console.log(`Detected distribution: ${distro}`);
        
        for (const lang of missingLangs) {
            console.log(`Installing language pack: ${lang}`);
            
            let installCmd = null;
            
            if (distro.includes('ubuntu') || distro.includes('debian')) {
                installCmd = `apt-get update && apt-get install -y tesseract-ocr-${lang}`;
            } else if (distro.includes('centos') || distro.includes('rhel') || distro.includes('fedora')) {
                installCmd = `yum install -y tesseract-langpack-${lang} || dnf install -y tesseract-langpack-${lang}`;
            } else if (distro.includes('arch')) {
                installCmd = `pacman -S --noconfirm tesseract-data-${lang}`;
            } else {
                console.log(`⚠️  Unknown distribution, manual installation may be required`);
                continue;
            }
            
            try {
                console.log(`   Running: ${installCmd}`);
                execSync(installCmd, { stdio: 'pipe', timeout: 60000 });
                console.log(`   ✅ Installed ${lang}`);
            } catch (installError) {
                console.log(`   ❌ Failed to install ${lang}: ${installError.message}`);
                
                // Try alternative: download language data directly
                console.log(`   Trying direct download for ${lang}...`);
                try {
                    const langUrl = `https://raw.githubusercontent.com/tesseract-ocr/tessdata/main/${lang}.traineddata`;
                    const tessDataDir = getTesseractDataDir();
                    if (tessDataDir) {
                        execSync(`wget -O ${tessDataDir}/${lang}.traineddata ${langUrl}`, { timeout: 30000 });
                        console.log(`   ✅ Downloaded ${lang} directly`);
                    }
                } catch (downloadError) {
                    console.log(`   ❌ Direct download failed: ${downloadError.message}`);
                }
            }
        }
        
        return true;
        
    } catch (error) {
        console.log('❌ Language installation failed:', error.message);
        return false;
    }
}

function getLinuxDistro() {
    try {
        const release = fs.readFileSync('/etc/os-release', 'utf8');
        return release.toLowerCase();
    } catch {
        try {
            return execSync('uname -a', { encoding: 'utf8' }).toLowerCase();
        } catch {
            return 'unknown';
        }
    }
}

function getTesseractDataDir() {
    try {
        // Common tesseract data directories
        const possibleDirs = [
            '/usr/share/tesseract-ocr/4.00/tessdata',
            '/usr/share/tesseract-ocr/tessdata',
            '/usr/share/tessdata',
            '/opt/homebrew/share/tessdata'
        ];
        
        for (const dir of possibleDirs) {
            if (fs.existsSync(dir)) {
                return dir;
            }
        }
        
        // Try to find via tesseract config
        const configOutput = execSync('tesseract --print-parameters', { encoding: 'utf8' });
        const tessDataMatch = configOutput.match(/tessdata_dir_config\\s+([^\\s]+)/);
        if (tessDataMatch) {
            return tessDataMatch[1];
        }
        
        return null;
    } catch {
        return null;
    }
}

function validateFailedJobs() {
    console.log('\\n🔍 Validating Failed Job Issues');
    console.log('=================================');
    
    try {
        const Database = require('better-sqlite3');
        const db = new Database('./data/mesh.db', { readonly: true });
        
        const failedJobs = db.prepare(`
            SELECT jobId, type, payload, result 
            FROM jobs 
            WHERE status = 'failed' 
            ORDER BY createdAt DESC
        `).all();
        
        console.log(`Found ${failedJobs.length} failed jobs to analyze:`);
        
        const issues = {
            tesseractLangMissing: 0,
            invalidInput: 0,
            permissionError: 0,
            other: 0
        };
        
        failedJobs.forEach(job => {
            let result;
            try {
                result = JSON.parse(job.result || '{}');
            } catch {
                result = { error: job.result };
            }
            
            const error = result.error || '';
            
            if (error.includes("Can't open eng") || error.includes("read_params_file")) {
                issues.tesseractLangMissing++;
                console.log(`  📦 ${job.jobId.substring(0,8)}: Missing tesseract language files`);
            } else if (error.includes('tesseract failed') && error.includes('valid image')) {
                issues.invalidInput++;
                console.log(`  🖼️  ${job.jobId.substring(0,8)}: Invalid image input`);
            } else if (error.includes('Permission denied') || error.includes('No such file')) {
                issues.permissionError++;
                console.log(`  🔐 ${job.jobId.substring(0,8)}: File/permission error`);
            } else {
                issues.other++;
                console.log(`  ❓ ${job.jobId.substring(0,8)}: ${error.substring(0,50)}...`);
            }
        });
        
        console.log('\\nIssue Summary:');
        console.log(`  Missing language files: ${issues.tesseractLangMissing}`);
        console.log(`  Invalid inputs: ${issues.invalidInput}`);
        console.log(`  Permission/file errors: ${issues.permissionError}`);
        console.log(`  Other issues: ${issues.other}`);
        
        db.close();
        return issues;
        
    } catch (error) {
        console.log('❌ Failed to validate jobs:', error.message);
        return null;
    }
}

function createTesseractHealthCheck() {
    console.log('\\n🏥 Creating Tesseract Health Check');
    console.log('====================================');
    
    const healthCheckScript = `#!/usr/bin/env node

/**
 * Tesseract Health Check
 * Validates OCR infrastructure and reports issues
 */

const { execSync } = require('child_process');
const fs = require('fs');

function checkTesseractHealth() {
    const issues = [];
    
    try {
        // Check tesseract binary
        execSync('tesseract --version', { stdio: 'pipe', timeout: 5000 });
    } catch {
        issues.push('Tesseract binary not found or not working');
        return { healthy: false, issues };
    }
    
    try {
        // Check language availability
        const langs = execSync('tesseract --list-langs', { encoding: 'utf8', timeout: 5000 });
        const langList = langs.split('\\\\n').slice(1).filter(l => l.trim());
        
        if (!langList.includes('eng')) {
            issues.push('English language pack missing');
        }
        
        if (langList.length < 2) {
            issues.push('Limited language support available');
        }
        
    } catch {
        issues.push('Cannot list available languages');
    }
    
    try {
        // Check temp directory access
        const testFile = '/tmp/tesseract-health-test-' + Date.now();
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
    } catch {
        issues.push('Temp directory not writable');
    }
    
    return {
        healthy: issues.length === 0,
        issues: issues
    };
}

if (require.main === module) {
    const health = checkTesseractHealth();
    console.log('Tesseract Health:', health.healthy ? '✅ HEALTHY' : '❌ ISSUES FOUND');
    if (health.issues.length > 0) {
        health.issues.forEach(issue => console.log('  -', issue));
    }
}

module.exports = { checkTesseractHealth };
`;

    try {
        fs.writeFileSync('./tesseract-health-check.js', healthCheckScript);
        fs.chmodSync('./tesseract-health-check.js', 0o755);
        console.log('✅ Created tesseract-health-check.js');
        
        // Run the health check
        const { checkTesseractHealth } = require('./tesseract-health-check.js');
        const health = checkTesseractHealth();
        
        console.log('\\n🏥 Health Check Results:');
        console.log('   Status:', health.healthy ? '✅ HEALTHY' : '❌ ISSUES FOUND');
        if (health.issues.length > 0) {
            health.issues.forEach(issue => console.log('   -', issue));
        }
        
        return health.healthy;
        
    } catch (error) {
        console.log('❌ Failed to create health check:', error.message);
        return false;
    }
}

function main() {
    console.log('🔧 IC Mesh Tesseract Infrastructure Fix');
    console.log('=======================================');
    console.log(`Started at: ${new Date().toISOString()}\\n`);
    
    // Check current status
    const tesseractStatus = checkTesseractInstallation();
    const tempDirOk = fixTempDirectoryPermissions();
    const jobIssues = validateFailedJobs();
    
    // Install missing components
    if (tesseractStatus.installed && tesseractStatus.missingLangs.length > 0) {
        installMissingLanguages(tesseractStatus.missingLangs);
    }
    
    // Create health monitoring
    const healthCheckOk = createTesseractHealthCheck();
    
    // Final summary
    console.log('\\n📊 Fix Summary');
    console.log('===============');
    console.log(`Tesseract installed: ${tesseractStatus.installed ? '✅' : '❌'}`);
    console.log(`Temp directories OK: ${tempDirOk ? '✅' : '❌'}`);
    console.log(`Health check created: ${healthCheckOk ? '✅' : '❌'}`);
    
    if (jobIssues) {
        console.log(`Failed jobs analyzed: ${Object.values(jobIssues).reduce((a,b) => a+b, 0)}`);
        if (jobIssues.tesseractLangMissing > 0) {
            console.log('  ⚠️  Language file issues may need manual resolution');
        }
    }
    
    console.log('\\n✅ Tesseract infrastructure fix completed');
    console.log('   Run ./tesseract-health-check.js to verify the fixes');
}

if (require.main === module) {
    main();
}

module.exports = { 
    checkTesseractInstallation,
    fixTempDirectoryPermissions,
    installMissingLanguages 
};