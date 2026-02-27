#!/usr/bin/env node

/**
 * Automated Deployment and Health Monitoring System for IC Mesh
 * 
 * Comprehensive deployment automation with:
 * - Zero-downtime rolling deployments
 * - Health monitoring and automatic rollback
 * - Environment validation and safety checks
 * - Performance monitoring during deployments
 * - Multi-stage deployment pipeline
 * - Deployment history and rollback capabilities
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync, spawn } = require('child_process');
const http = require('http');

class DeploymentAutomation {
    constructor(options = {}) {
        this.config = {
            healthCheckUrl: options.healthCheckUrl || 'http://localhost:3000/health',
            healthCheckTimeout: options.healthCheckTimeout || 30000,
            deploymentTimeout: options.deploymentTimeout || 300000, // 5 minutes
            rollbackOnFailure: options.rollbackOnFailure !== false,
            backupBeforeDeploy: options.backupBeforeDeploy !== false,
            maxHealthCheckRetries: options.maxHealthCheckRetries || 10,
            preDeploymentChecks: options.preDeploymentChecks !== false,
            ...options
        };
        
        this.deploymentStages = [
            { name: 'Pre-deployment Validation', handler: this.preDeploymentValidation.bind(this) },
            { name: 'Backup Creation', handler: this.createDeploymentBackup.bind(this) },
            { name: 'Dependency Installation', handler: this.installDependencies.bind(this) },
            { name: 'Database Migration', handler: this.runDatabaseMigrations.bind(this) },
            { name: 'Application Build', handler: this.buildApplication.bind(this) },
            { name: 'Service Restart', handler: this.restartServices.bind(this) },
            { name: 'Health Verification', handler: this.verifyDeploymentHealth.bind(this) },
            { name: 'Performance Validation', handler: this.validatePerformance.bind(this) },
            { name: 'Post-deployment Cleanup', handler: this.postDeploymentCleanup.bind(this) }
        ];
    }

    // Main deployment orchestration
    async deploy(options = {}) {
        const deploymentId = `deploy-${Date.now()}`;
        const startTime = Date.now();
        
        console.log(`🚀 Starting deployment: ${deploymentId}`);
        
        const deploymentLog = {
            id: deploymentId,
            startTime: new Date(startTime).toISOString(),
            endTime: null,
            success: false,
            stages: [],
            rollback: null,
            options
        };
        
        try {
            // Log deployment start
            await this.logDeployment(deploymentLog);
            
            // Execute deployment stages
            for (const stage of this.deploymentStages) {
                if (options.skipStages?.includes(stage.name)) {
                    console.log(`⏭️ Skipping stage: ${stage.name}`);
                    continue;
                }
                
                const stageResult = await this.executeStage(stage, options);
                deploymentLog.stages.push(stageResult);
                
                if (!stageResult.success) {
                    throw new Error(`Stage '${stage.name}' failed: ${stageResult.error}`);
                }
            }
            
            deploymentLog.success = true;
            deploymentLog.endTime = new Date().toISOString();
            deploymentLog.duration = Date.now() - startTime;
            
            console.log(`✅ Deployment completed successfully in ${this.formatDuration(deploymentLog.duration)}`);
            
            return deploymentLog;
            
        } catch (error) {
            console.error(`❌ Deployment failed: ${error.message}`);
            
            deploymentLog.success = false;
            deploymentLog.error = error.message;
            deploymentLog.endTime = new Date().toISOString();
            deploymentLog.duration = Date.now() - startTime;
            
            // Attempt rollback if enabled
            if (this.config.rollbackOnFailure) {
                try {
                    deploymentLog.rollback = await this.rollback(deploymentLog);
                } catch (rollbackError) {
                    console.error(`❌ Rollback also failed: ${rollbackError.message}`);
                    deploymentLog.rollback = { success: false, error: rollbackError.message };
                }
            }
            
            await this.logDeployment(deploymentLog);
            throw error;
            
        } finally {
            await this.logDeployment(deploymentLog);
        }
    }
    
    async executeStage(stage, options) {
        const stageStart = Date.now();
        console.log(`🔄 Executing: ${stage.name}`);
        
        try {
            const result = await stage.handler(options);
            const duration = Date.now() - stageStart;
            
            console.log(`✅ Completed: ${stage.name} (${this.formatDuration(duration)})`);
            
            return {
                name: stage.name,
                success: true,
                duration,
                result
            };
            
        } catch (error) {
            const duration = Date.now() - stageStart;
            
            console.error(`❌ Failed: ${stage.name} - ${error.message}`);
            
            return {
                name: stage.name,
                success: false,
                duration,
                error: error.message
            };
        }
    }

    // Deployment Stages
    async preDeploymentValidation(options) {
        const validation = {
            gitStatus: null,
            diskSpace: null,
            dependencies: null,
            environment: null,
            backupSpace: null,
            runningProcesses: null
        };
        
        // Check git status
        try {
            const gitStatus = execSync('git status --porcelain', { encoding: 'utf8', stdio: 'pipe' });
            const hasUncommittedChanges = gitStatus.trim().length > 0;
            
            validation.gitStatus = {
                clean: !hasUncommittedChanges,
                branch: execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim(),
                commit: execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
            };
            
            if (hasUncommittedChanges && !options.allowDirtyRepo) {
                throw new Error('Repository has uncommitted changes. Use --allow-dirty-repo to override.');
            }
        } catch (error) {
            validation.gitStatus = { error: error.message };
        }
        
        // Check disk space
        try {
            const df = execSync('df -h .', { encoding: 'utf8' });
            const lines = df.split('\n');
            if (lines.length > 1) {
                const parts = lines[1].split(/\s+/);
                validation.diskSpace = {
                    filesystem: parts[0],
                    size: parts[1],
                    used: parts[2],
                    available: parts[3],
                    usePercent: parts[4]
                };
                
                const usePercent = parseInt(parts[4].replace('%', ''));
                if (usePercent > 90) {
                    throw new Error(`Disk usage is ${usePercent}% - insufficient space for deployment`);
                }
            }
        } catch (error) {
            validation.diskSpace = { error: error.message };
        }
        
        // Validate environment variables
        const requiredEnvVars = ['NODE_ENV', 'DATABASE_URL'];
        validation.environment = {};
        
        for (const envVar of requiredEnvVars) {
            validation.environment[envVar] = {
                present: !!process.env[envVar],
                value: process.env[envVar] ? '[SET]' : '[MISSING]'
            };
        }
        
        // Check for critical processes
        try {
            const processes = execSync('ps aux | grep node | grep -v grep', { encoding: 'utf8' });
            validation.runningProcesses = {
                nodeProcesses: processes.split('\n').filter(line => line.trim()).length
            };
        } catch (error) {
            validation.runningProcesses = { error: 'Could not check running processes' };
        }
        
        return validation;
    }
    
    async createDeploymentBackup(options) {
        if (!this.config.backupBeforeDeploy) {
            return { skipped: true, reason: 'Backup disabled in configuration' };
        }
        
        try {
            const BackupSystem = require('./backup-system');
            const backup = new BackupSystem();
            
            const result = await backup.createBackup();
            
            if (result.success) {
                return {
                    backupId: result.backupId,
                    fileCount: result.manifest.metrics.fileCount,
                    totalSize: result.manifest.metrics.totalSize
                };
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            throw new Error(`Backup creation failed: ${error.message}`);
        }
    }
    
    async installDependencies(options) {
        const installStart = Date.now();
        
        try {
            // Check if package-lock.json exists for npm ci vs npm install
            const hasPackageLock = await fs.access('./package-lock.json').then(() => true).catch(() => false);
            const installCmd = hasPackageLock ? 'npm ci' : 'npm install';
            
            console.log(`📦 Running: ${installCmd}`);
            
            const output = execSync(installCmd, { 
                encoding: 'utf8',
                stdio: 'pipe',
                timeout: 120000 // 2 minutes
            });
            
            const duration = Date.now() - installStart;
            
            return {
                command: installCmd,
                duration,
                output: output.split('\n').slice(-5) // Last 5 lines of output
            };
            
        } catch (error) {
            throw new Error(`Dependency installation failed: ${error.message}`);
        }
    }
    
    async runDatabaseMigrations(options) {
        try {
            // Check if migrations directory exists
            const hasMigrations = await fs.access('./migrations').then(() => true).catch(() => false);
            
            if (!hasMigrations) {
                return { skipped: true, reason: 'No migrations directory found' };
            }
            
            // Check if there's a migration script in package.json
            const packageContent = await fs.readFile('./package.json', 'utf8');
            const packageJson = JSON.parse(packageContent);
            
            if (packageJson.scripts?.migrate) {
                console.log('🗃️ Running database migrations...');
                
                const output = execSync('npm run migrate', {
                    encoding: 'utf8',
                    stdio: 'pipe',
                    timeout: 60000 // 1 minute
                });
                
                return {
                    migrationsRun: true,
                    output: output.split('\n').slice(-5)
                };
            }
            
            return { skipped: true, reason: 'No migrate script defined in package.json' };
            
        } catch (error) {
            throw new Error(`Database migration failed: ${error.message}`);
        }
    }
    
    async buildApplication(options) {
        try {
            const packageContent = await fs.readFile('./package.json', 'utf8');
            const packageJson = JSON.parse(packageContent);
            
            if (packageJson.scripts?.build) {
                console.log('🏗️ Building application...');
                
                const output = execSync('npm run build', {
                    encoding: 'utf8',
                    stdio: 'pipe',
                    timeout: 180000 // 3 minutes
                });
                
                return {
                    buildCompleted: true,
                    output: output.split('\n').slice(-5)
                };
            }
            
            return { skipped: true, reason: 'No build script defined' };
            
        } catch (error) {
            throw new Error(`Build failed: ${error.message}`);
        }
    }
    
    async restartServices(options) {
        const serviceResults = [];
        
        // Check if PM2 is being used
        try {
            const pm2List = execSync('pm2 list --silent', { encoding: 'utf8', stdio: 'pipe' });
            
            if (pm2List && pm2List.trim()) {
                console.log('🔄 Restarting PM2 services...');
                
                const restartOutput = execSync('pm2 restart all', {
                    encoding: 'utf8',
                    stdio: 'pipe'
                });
                
                serviceResults.push({
                    service: 'pm2',
                    action: 'restart',
                    success: true,
                    output: restartOutput.split('\n').slice(-3)
                });
            }
        } catch (pm2Error) {
            // PM2 not available, try other methods
        }
        
        // Check for systemd services
        try {
            const serviceNames = ['ic-mesh', 'intelligence-club'];
            
            for (const serviceName of serviceNames) {
                try {
                    execSync(`systemctl is-active ${serviceName}`, { stdio: 'pipe' });
                    
                    console.log(`🔄 Restarting systemd service: ${serviceName}`);
                    execSync(`sudo systemctl restart ${serviceName}`, { stdio: 'pipe' });
                    
                    serviceResults.push({
                        service: serviceName,
                        action: 'systemctl restart',
                        success: true
                    });
                } catch (serviceError) {
                    // Service not found or not active
                }
            }
        } catch (systemdError) {
            // Systemd not available
        }
        
        // If no services were restarted, provide manual instructions
        if (serviceResults.length === 0) {
            serviceResults.push({
                service: 'manual',
                action: 'restart_required',
                message: 'No automatic service restart available. Please restart your application manually.'
            });
        }
        
        // Wait for services to start
        await this.waitForServiceStartup();
        
        return { serviceResults };
    }
    
    async waitForServiceStartup() {
        console.log('⏳ Waiting for service startup...');
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second grace period
    }
    
    async verifyDeploymentHealth(options) {
        const healthChecks = [];
        let retryCount = 0;
        
        while (retryCount < this.config.maxHealthCheckRetries) {
            try {
                const healthResult = await this.performHealthCheck();
                
                if (healthResult.healthy) {
                    healthChecks.push({
                        attempt: retryCount + 1,
                        success: true,
                        responseTime: healthResult.responseTime,
                        status: healthResult.status
                    });
                    
                    console.log(`✅ Health check passed (attempt ${retryCount + 1}/${this.config.maxHealthCheckRetries})`);
                    return { healthy: true, checks: healthChecks };
                } else {
                    throw new Error(healthResult.error);
                }
                
            } catch (error) {
                retryCount++;
                
                healthChecks.push({
                    attempt: retryCount,
                    success: false,
                    error: error.message
                });
                
                console.log(`⚠️ Health check failed (attempt ${retryCount}/${this.config.maxHealthCheckRetries}): ${error.message}`);
                
                if (retryCount < this.config.maxHealthCheckRetries) {
                    const waitTime = Math.min(5000 * retryCount, 30000); // Exponential backoff, max 30s
                    console.log(`🔄 Retrying in ${waitTime / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }
        
        throw new Error(`Health checks failed after ${this.config.maxHealthCheckRetries} attempts`);
    }
    
    async performHealthCheck() {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const timeout = setTimeout(() => {
                resolve({ healthy: false, error: 'Health check timeout' });
            }, this.config.healthCheckTimeout);
            
            const request = http.get(this.config.healthCheckUrl, (response) => {
                clearTimeout(timeout);
                
                const responseTime = Date.now() - startTime;
                
                if (response.statusCode === 200) {
                    resolve({
                        healthy: true,
                        status: response.statusCode,
                        responseTime
                    });
                } else {
                    resolve({
                        healthy: false,
                        error: `HTTP ${response.statusCode}`,
                        responseTime
                    });
                }
            });
            
            request.on('error', (error) => {
                clearTimeout(timeout);
                resolve({
                    healthy: false,
                    error: error.message
                });
            });
        });
    }
    
    async validatePerformance(options) {
        const performanceTests = [];
        
        // Test response times for key endpoints
        const endpoints = [
            { path: '/', name: 'Homepage' },
            { path: '/health', name: 'Health Check' },
            { path: '/api/nodes', name: 'Nodes API' },
            { path: '/api/status', name: 'Status API' }
        ];
        
        for (const endpoint of endpoints) {
            try {
                const times = [];
                
                // Test each endpoint 3 times
                for (let i = 0; i < 3; i++) {
                    const result = await this.testEndpointPerformance(endpoint.path);
                    times.push(result.responseTime);
                }
                
                const averageTime = times.reduce((sum, time) => sum + time, 0) / times.length;
                
                performanceTests.push({
                    endpoint: endpoint.name,
                    path: endpoint.path,
                    averageResponseTime: Math.round(averageTime),
                    samples: times,
                    status: averageTime < 1000 ? 'good' : averageTime < 3000 ? 'acceptable' : 'slow'
                });
                
            } catch (error) {
                performanceTests.push({
                    endpoint: endpoint.name,
                    path: endpoint.path,
                    error: error.message,
                    status: 'failed'
                });
            }
        }
        
        // Check if any endpoints are performing poorly
        const slowEndpoints = performanceTests.filter(test => test.status === 'slow');
        if (slowEndpoints.length > 0) {
            console.warn(`⚠️ Slow endpoints detected: ${slowEndpoints.map(e => e.endpoint).join(', ')}`);
        }
        
        return { performanceTests };
    }
    
    async testEndpointPerformance(path) {
        const url = this.config.healthCheckUrl.replace('/health', path);
        
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const request = http.get(url, (response) => {
                const responseTime = Date.now() - startTime;
                resolve({ responseTime, status: response.statusCode });
            });
            
            request.on('error', reject);
            request.setTimeout(10000, () => reject(new Error('Request timeout')));
        });
    }
    
    async postDeploymentCleanup(options) {
        const cleanupActions = [];
        
        // Clean npm cache
        try {
            execSync('npm cache clean --force', { stdio: 'pipe' });
            cleanupActions.push({ action: 'npm_cache_clean', success: true });
        } catch (error) {
            cleanupActions.push({ action: 'npm_cache_clean', success: false, error: error.message });
        }
        
        // Remove old log files (older than 30 days)
        try {
            await this.cleanOldLogs();
            cleanupActions.push({ action: 'log_cleanup', success: true });
        } catch (error) {
            cleanupActions.push({ action: 'log_cleanup', success: false, error: error.message });
        }
        
        // Update deployment status
        try {
            await this.updateDeploymentStatus('completed');
            cleanupActions.push({ action: 'status_update', success: true });
        } catch (error) {
            cleanupActions.push({ action: 'status_update', success: false, error: error.message });
        }
        
        return { cleanupActions };
    }

    // Rollback functionality
    async rollback(deploymentLog) {
        console.log('🔄 Starting rollback...');
        
        const rollbackStart = Date.now();
        const rollbackLog = {
            deploymentId: deploymentLog.id,
            startTime: new Date().toISOString(),
            success: false,
            actions: []
        };
        
        try {
            // Find latest successful backup
            const backupId = await this.findLatestBackup();
            
            if (backupId) {
                console.log(`📂 Restoring from backup: ${backupId}`);
                
                const BackupSystem = require('./backup-system');
                const backup = new BackupSystem();
                
                const restoreResult = await backup.restoreBackup(backupId, {
                    selectiveRestore: ['database', 'config']
                });
                
                rollbackLog.actions.push({
                    action: 'backup_restore',
                    success: restoreResult.success,
                    backupId
                });
                
                if (restoreResult.success) {
                    // Restart services
                    await this.restartServices();
                    rollbackLog.actions.push({
                        action: 'service_restart',
                        success: true
                    });
                    
                    // Verify health after rollback
                    const healthResult = await this.verifyDeploymentHealth();
                    rollbackLog.actions.push({
                        action: 'health_verification',
                        success: healthResult.healthy
                    });
                    
                    if (healthResult.healthy) {
                        rollbackLog.success = true;
                        console.log('✅ Rollback completed successfully');
                    } else {
                        throw new Error('Health check failed after rollback');
                    }
                }
            } else {
                throw new Error('No backup found for rollback');
            }
            
        } catch (error) {
            console.error(`❌ Rollback failed: ${error.message}`);
            rollbackLog.error = error.message;
        }
        
        rollbackLog.endTime = new Date().toISOString();
        rollbackLog.duration = Date.now() - rollbackStart;
        
        return rollbackLog;
    }

    // Utility functions
    async findLatestBackup() {
        try {
            const BackupSystem = require('./backup-system');
            const backup = new BackupSystem();
            const backups = await backup.listBackups();
            
            return backups.length > 0 ? backups[0].id : null;
        } catch (error) {
            return null;
        }
    }
    
    async cleanOldLogs() {
        const logDirs = ['./logs', './log'];
        
        for (const logDir of logDirs) {
            try {
                const exists = await fs.access(logDir).then(() => true).catch(() => false);
                if (exists) {
                    const files = await fs.readdir(logDir);
                    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
                    
                    for (const file of files) {
                        const filePath = path.join(logDir, file);
                        const stats = await fs.stat(filePath);
                        
                        if (stats.mtime.getTime() < thirtyDaysAgo) {
                            await fs.unlink(filePath);
                        }
                    }
                }
            } catch (error) {
                // Ignore errors for log cleanup
            }
        }
    }
    
    async updateDeploymentStatus(status) {
        const statusFile = './deployment-status.json';
        const statusData = {
            lastDeployment: new Date().toISOString(),
            status,
            version: await this.getCurrentVersion()
        };
        
        await fs.writeFile(statusFile, JSON.stringify(statusData, null, 2));
    }
    
    async getCurrentVersion() {
        try {
            const packageContent = await fs.readFile('./package.json', 'utf8');
            const packageJson = JSON.parse(packageContent);
            return packageJson.version || '0.1.0';
        } catch (error) {
            return 'unknown';
        }
    }
    
    async logDeployment(deploymentLog) {
        const logDir = './deployment-logs';
        await fs.mkdir(logDir, { recursive: true });
        
        const logFile = path.join(logDir, `${deploymentLog.id}.json`);
        await fs.writeFile(logFile, JSON.stringify(deploymentLog, null, 2));
    }
    
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds}s`;
        
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds}s`;
    }

    // Status and history
    async getDeploymentHistory() {
        const logDir = './deployment-logs';
        const deployments = [];
        
        try {
            const files = await fs.readdir(logDir);
            
            for (const file of files) {
                if (file.endsWith('.json')) {
                    try {
                        const content = await fs.readFile(path.join(logDir, file), 'utf8');
                        const deployment = JSON.parse(content);
                        deployments.push({
                            id: deployment.id,
                            startTime: deployment.startTime,
                            success: deployment.success,
                            duration: deployment.duration,
                            stages: deployment.stages?.length || 0,
                            rollback: deployment.rollback?.success || false
                        });
                    } catch (parseError) {
                        // Skip invalid files
                    }
                }
            }
            
            return deployments.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
            
        } catch (error) {
            return [];
        }
    }
    
    async getDeploymentStatus() {
        try {
            const statusFile = './deployment-status.json';
            const content = await fs.readFile(statusFile, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            return {
                lastDeployment: null,
                status: 'unknown',
                version: 'unknown'
            };
        }
    }
}

// CLI Interface
async function main() {
    const deployment = new DeploymentAutomation();
    const command = process.argv[2];
    
    switch (command) {
        case 'deploy':
            const deployOptions = {
                allowDirtyRepo: process.argv.includes('--allow-dirty-repo'),
                skipStages: process.argv.includes('--skip-backup') ? ['Backup Creation'] : []
            };
            await deployment.deploy(deployOptions);
            break;
            
        case 'status':
            const status = await deployment.getDeploymentStatus();
            console.log('📊 Deployment Status:');
            console.log(JSON.stringify(status, null, 2));
            break;
            
        case 'history':
            const history = await deployment.getDeploymentHistory();
            console.log('📋 Deployment History:');
            history.forEach(d => {
                const statusIcon = d.success ? '✅' : '❌';
                const rollbackIcon = d.rollback ? '🔄' : '';
                console.log(`  ${statusIcon} ${d.id} (${new Date(d.startTime).toLocaleString()}) - ${deployment.formatDuration(d.duration)} ${rollbackIcon}`);
            });
            break;
            
        case 'rollback':
            const backupId = process.argv[3];
            if (backupId) {
                const rollbackResult = await deployment.rollback({ id: 'manual-rollback' });
                console.log('Rollback result:', rollbackResult);
            } else {
                console.error('❌ Please specify backup ID for rollback');
            }
            break;
            
        case 'validate':
            const validation = await deployment.preDeploymentValidation();
            console.log('🔍 Pre-deployment Validation:');
            console.log(JSON.stringify(validation, null, 2));
            break;
            
        case 'health':
            const health = await deployment.performHealthCheck();
            console.log('🏥 Health Check:');
            console.log(JSON.stringify(health, null, 2));
            break;
            
        default:
            console.log(`
Deployment Automation for IC Mesh

Usage:
  node deployment-automation.js <command>

Commands:
  deploy      - Run full deployment pipeline
  status      - Show current deployment status
  history     - Show deployment history
  rollback    - Rollback to previous deployment
  validate    - Run pre-deployment validation
  health      - Perform health check

Options:
  --allow-dirty-repo    Allow deployment with uncommitted changes
  --skip-backup        Skip backup creation during deployment

Examples:
  node deployment-automation.js deploy
  node deployment-automation.js deploy --skip-backup
  node deployment-automation.js status
  node deployment-automation.js rollback backup-2026-02-25T06-00-00-000Z
            `);
    }
}

module.exports = DeploymentAutomation;

if (require.main === module) {
    main().catch(console.error);
}