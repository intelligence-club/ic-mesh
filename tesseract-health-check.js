#!/usr/bin/env node

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
        const langList = langs.split('\\n').slice(1).filter(l => l.trim());
        
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
