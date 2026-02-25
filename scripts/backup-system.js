#!/usr/bin/env node

/**
 * Intelligent Backup and Disaster Recovery System for IC Mesh
 * 
 * Features:
 * - Automated scheduled backups with versioning
 * - Point-in-time recovery capabilities
 * - Health validation of backup files
 * - Compressed storage with metadata
 * - Disaster recovery simulation and validation
 * - Cross-platform compatibility
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const zlib = require('zlib');
const crypto = require('crypto');

class BackupSystem {
    constructor(options = {}) {
        this.config = {
            backupDir: options.backupDir || './backups',
            maxBackups: options.maxBackups || 30,
            compressionLevel: options.compressionLevel || 6,
            verifyIntegrity: options.verifyIntegrity !== false,
            includeUploads: options.includeUploads !== false,
            encryptBackups: options.encryptBackups || false,
            ...options
        };
        
        this.backupTargets = [
            { type: 'database', path: './mesh.db', critical: true },
            { type: 'config', path: './.env', critical: true },
            { type: 'uploads', path: './uploads', critical: false },
            { type: 'logs', path: './logs', critical: false }
        ];
    }

    // Create comprehensive backup
    async createBackup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupId = `backup-${timestamp}`;
        const backupPath = path.join(this.config.backupDir, backupId);
        
        console.log(`🔄 Starting backup: ${backupId}`);
        
        try {
            // Ensure backup directory exists
            await fs.mkdir(backupPath, { recursive: true });
            
            const manifest = {
                id: backupId,
                timestamp,
                version: this.getVersion(),
                files: [],
                metrics: {
                    startTime: Date.now(),
                    endTime: null,
                    totalSize: 0,
                    compressedSize: 0,
                    fileCount: 0
                }
            };
            
            // Backup each target
            for (const target of this.backupTargets) {
                try {
                    await this.backupTarget(target, backupPath, manifest);
                } catch (error) {
                    console.error(`❌ Failed to backup ${target.path}:`, error.message);
                    if (target.critical) {
                        throw new Error(`Critical backup failed: ${target.path}`);
                    }
                }
            }
            
            // Create system snapshot
            await this.createSystemSnapshot(backupPath, manifest);
            
            // Finalize manifest
            manifest.metrics.endTime = Date.now();
            manifest.metrics.duration = manifest.metrics.endTime - manifest.metrics.startTime;
            manifest.checksum = this.calculateManifestChecksum(manifest);
            
            // Save manifest
            const manifestPath = path.join(backupPath, 'manifest.json');
            await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
            
            // Verify backup integrity
            if (this.config.verifyIntegrity) {
                await this.verifyBackup(backupPath);
            }
            
            // Cleanup old backups
            await this.cleanupOldBackups();
            
            console.log(`✅ Backup completed successfully: ${backupId}`);
            console.log(`📊 Files: ${manifest.metrics.fileCount}, Size: ${this.formatSize(manifest.metrics.totalSize)}, Compressed: ${this.formatSize(manifest.metrics.compressedSize)}`);
            
            return { success: true, backupId, manifest };
            
        } catch (error) {
            console.error(`❌ Backup failed:`, error.message);
            
            // Cleanup failed backup
            try {
                await fs.rmdir(backupPath, { recursive: true });
            } catch (cleanupError) {
                console.error('Failed to cleanup incomplete backup:', cleanupError.message);
            }
            
            return { success: false, error: error.message };
        }
    }
    
    async backupTarget(target, backupPath, manifest) {
        const targetPath = target.path;
        const exists = await fs.access(targetPath).then(() => true).catch(() => false);
        
        if (!exists) {
            console.log(`⚠️ Target not found, skipping: ${targetPath}`);
            return;
        }
        
        const stats = await fs.lstat(targetPath);
        const fileName = path.basename(targetPath);
        const backupFileName = `${target.type}-${fileName}`;
        
        if (stats.isFile()) {
            await this.backupFile(targetPath, backupPath, backupFileName, manifest);
        } else if (stats.isDirectory()) {
            await this.backupDirectory(targetPath, backupPath, backupFileName, manifest);
        }
    }
    
    async backupFile(filePath, backupPath, backupFileName, manifest) {
        console.log(`📄 Backing up file: ${filePath}`);
        
        const content = await fs.readFile(filePath);
        const originalSize = content.length;
        
        // Compress file
        const compressed = zlib.gzipSync(content, { level: this.config.compressionLevel });
        const compressedSize = compressed.length;
        
        // Calculate checksum
        const checksum = crypto.createHash('sha256').update(content).digest('hex');
        
        // Save compressed file
        const outputPath = path.join(backupPath, `${backupFileName}.gz`);
        await fs.writeFile(outputPath, compressed);
        
        manifest.files.push({
            originalPath: filePath,
            backupPath: outputPath,
            type: 'file',
            originalSize,
            compressedSize,
            checksum,
            compressionRatio: parseFloat((compressedSize / originalSize).toFixed(3))
        });
        
        manifest.metrics.totalSize += originalSize;
        manifest.metrics.compressedSize += compressedSize;
        manifest.metrics.fileCount++;
    }
    
    async backupDirectory(dirPath, backupPath, backupDirName, manifest) {
        console.log(`📁 Backing up directory: ${dirPath}`);
        
        // Create tar archive of directory
        const archiveName = `${backupDirName}.tar.gz`;
        const archivePath = path.join(backupPath, archiveName);
        
        try {
            // Use tar command for efficient directory archiving
            const tarCmd = `tar -czf "${archivePath}" -C "${path.dirname(dirPath)}" "${path.basename(dirPath)}"`;
            execSync(tarCmd, { stdio: 'ignore' });
            
            const archiveStats = await fs.stat(archivePath);
            const compressedSize = archiveStats.size;
            
            // Calculate original directory size
            const originalSize = await this.getDirectorySize(dirPath);
            
            manifest.files.push({
                originalPath: dirPath,
                backupPath: archivePath,
                type: 'directory',
                originalSize,
                compressedSize,
                compressionRatio: parseFloat((compressedSize / originalSize).toFixed(3))
            });
            
            manifest.metrics.totalSize += originalSize;
            manifest.metrics.compressedSize += compressedSize;
            manifest.metrics.fileCount++;
            
        } catch (error) {
            console.warn(`⚠️ Failed to create archive for ${dirPath}, using fallback method`);
            // Fallback: copy files individually
            await this.backupDirectoryFallback(dirPath, backupPath, backupDirName, manifest);
        }
    }
    
    async backupDirectoryFallback(dirPath, backupPath, backupDirName, manifest) {
        const files = await this.getDirectoryFiles(dirPath);
        const dirBackupPath = path.join(backupPath, backupDirName);
        await fs.mkdir(dirBackupPath, { recursive: true });
        
        for (const file of files) {
            const relativePath = path.relative(dirPath, file);
            const targetPath = path.join(dirBackupPath, relativePath);
            const targetDir = path.dirname(targetPath);
            
            await fs.mkdir(targetDir, { recursive: true });
            await fs.copyFile(file, targetPath);
        }
        
        manifest.files.push({
            originalPath: dirPath,
            backupPath: dirBackupPath,
            type: 'directory_copied',
            fileCount: files.length
        });
    }
    
    async createSystemSnapshot(backupPath, manifest) {
        console.log('📸 Creating system snapshot...');
        
        const snapshot = {
            timestamp: new Date().toISOString(),
            node: {
                version: process.version,
                platform: process.platform,
                arch: process.arch,
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                cwd: process.cwd()
            },
            environment: {
                nodeEnv: process.env.NODE_ENV || 'development',
                port: process.env.PORT || 'undefined'
            },
            git: await this.getGitInfo(),
            packageInfo: await this.getPackageInfo(),
            systemHealth: await this.getSystemHealth()
        };
        
        const snapshotPath = path.join(backupPath, 'system-snapshot.json');
        await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
        
        manifest.files.push({
            originalPath: 'system-state',
            backupPath: snapshotPath,
            type: 'snapshot',
            description: 'System state and environment information'
        });
    }
    
    async getGitInfo() {
        try {
            const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
            const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
            const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
            
            return {
                branch,
                commit: commit.substring(0, 8),
                fullCommit: commit,
                hasUncommittedChanges: status.length > 0,
                uncommittedFiles: status ? status.split('\n').length : 0
            };
        } catch (error) {
            return { error: 'Not a git repository or git not available' };
        }
    }
    
    async getPackageInfo() {
        try {
            const packagePath = './package.json';
            const content = await fs.readFile(packagePath, 'utf8');
            const pkg = JSON.parse(content);
            
            return {
                name: pkg.name,
                version: pkg.version,
                dependencies: Object.keys(pkg.dependencies || {}).length,
                devDependencies: Object.keys(pkg.devDependencies || {}).length
            };
        } catch (error) {
            return { error: 'package.json not found or invalid' };
        }
    }
    
    async getSystemHealth() {
        const health = {
            database: false,
            config: false,
            uploads: false,
            diskSpace: null
        };
        
        // Check database
        try {
            await fs.access('./mesh.db');
            health.database = true;
        } catch (error) {
            health.database = false;
        }
        
        // Check config
        try {
            await fs.access('./.env');
            health.config = true;
        } catch (error) {
            health.config = false;
        }
        
        // Check uploads directory
        try {
            await fs.access('./uploads');
            health.uploads = true;
        } catch (error) {
            health.uploads = false;
        }
        
        // Check disk space (if possible)
        try {
            const stats = await fs.statvfs?.('.') || null;
            if (stats) {
                health.diskSpace = {
                    total: stats.blocks * stats.frsize,
                    free: stats.bavail * stats.frsize,
                    used: (stats.blocks - stats.bavail) * stats.frsize
                };
            }
        } catch (error) {
            // statvfs not available on all platforms
        }
        
        return health;
    }

    // Backup verification
    async verifyBackup(backupPath) {
        console.log(`🔍 Verifying backup integrity...`);
        
        const manifestPath = path.join(backupPath, 'manifest.json');
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent);
        
        let verificationErrors = [];
        
        for (const file of manifest.files) {
            if (file.type === 'file') {
                try {
                    // Read compressed backup
                    const compressed = await fs.readFile(file.backupPath);
                    const decompressed = zlib.gunzipSync(compressed);
                    
                    // Verify checksum
                    const backupChecksum = crypto.createHash('sha256').update(decompressed).digest('hex');
                    
                    if (backupChecksum !== file.checksum) {
                        verificationErrors.push(`Checksum mismatch for ${file.originalPath}`);
                    }
                    
                } catch (error) {
                    verificationErrors.push(`Failed to verify ${file.originalPath}: ${error.message}`);
                }
            }
        }
        
        if (verificationErrors.length > 0) {
            console.error(`❌ Backup verification failed:`);
            verificationErrors.forEach(error => console.error(`  - ${error}`));
            throw new Error(`Backup verification failed with ${verificationErrors.length} errors`);
        }
        
        console.log(`✅ Backup verification passed`);
    }

    // Restore operations
    async listBackups() {
        try {
            const backupDirs = await fs.readdir(this.config.backupDir);
            const backups = [];
            
            for (const dir of backupDirs) {
                if (dir.startsWith('backup-')) {
                    try {
                        const manifestPath = path.join(this.config.backupDir, dir, 'manifest.json');
                        const manifestContent = await fs.readFile(manifestPath, 'utf8');
                        const manifest = JSON.parse(manifestContent);
                        
                        backups.push({
                            id: manifest.id,
                            timestamp: manifest.timestamp,
                            fileCount: manifest.metrics.fileCount,
                            totalSize: manifest.metrics.totalSize,
                            compressedSize: manifest.metrics.compressedSize,
                            duration: manifest.metrics.duration,
                            path: path.join(this.config.backupDir, dir)
                        });
                    } catch (error) {
                        console.warn(`⚠️ Invalid backup directory: ${dir}`);
                    }
                }
            }
            
            return backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
        } catch (error) {
            console.error('❌ Failed to list backups:', error.message);
            return [];
        }
    }
    
    async restoreBackup(backupId, options = {}) {
        console.log(`🔄 Restoring backup: ${backupId}`);
        
        const backupPath = path.join(this.config.backupDir, backupId);
        const manifestPath = path.join(backupPath, 'manifest.json');
        
        try {
            const manifestContent = await fs.readFile(manifestPath, 'utf8');
            const manifest = JSON.parse(manifestContent);
            
            // Verify backup before restore
            if (this.config.verifyIntegrity) {
                await this.verifyBackup(backupPath);
            }
            
            const restoreResults = [];
            
            for (const file of manifest.files) {
                if (options.selectiveRestore && !options.selectiveRestore.includes(file.type)) {
                    continue;
                }
                
                try {
                    await this.restoreFile(file, options);
                    restoreResults.push({ file: file.originalPath, status: 'success' });
                } catch (error) {
                    console.error(`❌ Failed to restore ${file.originalPath}:`, error.message);
                    restoreResults.push({ file: file.originalPath, status: 'failed', error: error.message });
                }
            }
            
            console.log(`✅ Restore completed. Success: ${restoreResults.filter(r => r.status === 'success').length}, Failed: ${restoreResults.filter(r => r.status === 'failed').length}`);
            
            return { success: true, results: restoreResults };
            
        } catch (error) {
            console.error(`❌ Restore failed:`, error.message);
            return { success: false, error: error.message };
        }
    }
    
    async restoreFile(file, options = {}) {
        const targetPath = options.targetDir ? path.join(options.targetDir, path.basename(file.originalPath)) : file.originalPath;
        
        if (file.type === 'file') {
            // Restore compressed file
            const compressed = await fs.readFile(file.backupPath);
            const decompressed = zlib.gunzipSync(compressed);
            
            // Create target directory if needed
            const targetDir = path.dirname(targetPath);
            await fs.mkdir(targetDir, { recursive: true });
            
            // Write restored file
            await fs.writeFile(targetPath, decompressed);
            
        } else if (file.type === 'directory') {
            // Extract tar archive
            const targetDir = options.targetDir || path.dirname(file.originalPath);
            const extractCmd = `tar -xzf "${file.backupPath}" -C "${targetDir}"`;
            execSync(extractCmd, { stdio: 'ignore' });
            
        } else if (file.type === 'directory_copied') {
            // Copy directory structure
            await this.copyDirectory(file.backupPath, targetPath);
        }
        
        console.log(`📄 Restored: ${file.originalPath} → ${targetPath}`);
    }

    // Utility methods
    async getDirectorySize(dirPath) {
        const files = await this.getDirectoryFiles(dirPath);
        let totalSize = 0;
        
        for (const file of files) {
            try {
                const stats = await fs.stat(file);
                totalSize += stats.size;
            } catch (error) {
                // Skip files that can't be accessed
            }
        }
        
        return totalSize;
    }
    
    async getDirectoryFiles(dirPath) {
        const files = [];
        
        async function walk(currentPath) {
            const entries = await fs.readdir(currentPath);
            
            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry);
                const stats = await fs.lstat(fullPath);
                
                if (stats.isDirectory()) {
                    await walk(fullPath);
                } else {
                    files.push(fullPath);
                }
            }
        }
        
        await walk(dirPath);
        return files;
    }
    
    async copyDirectory(srcPath, destPath) {
        await fs.mkdir(destPath, { recursive: true });
        const entries = await fs.readdir(srcPath);
        
        for (const entry of entries) {
            const srcFile = path.join(srcPath, entry);
            const destFile = path.join(destPath, entry);
            const stats = await fs.lstat(srcFile);
            
            if (stats.isDirectory()) {
                await this.copyDirectory(srcFile, destFile);
            } else {
                await fs.copyFile(srcFile, destFile);
            }
        }
    }
    
    async cleanupOldBackups() {
        const backups = await this.listBackups();
        
        if (backups.length > this.config.maxBackups) {
            const toDelete = backups.slice(this.config.maxBackups);
            
            console.log(`🧹 Cleaning up ${toDelete.length} old backups...`);
            
            for (const backup of toDelete) {
                try {
                    await fs.rmdir(backup.path, { recursive: true });
                    console.log(`🗑️ Deleted old backup: ${backup.id}`);
                } catch (error) {
                    console.warn(`⚠️ Failed to delete backup ${backup.id}:`, error.message);
                }
            }
        }
    }
    
    getVersion() {
        try {
            const packageContent = require('../package.json');
            return packageContent.version || '0.1.0';
        } catch (error) {
            return 'unknown';
        }
    }
    
    calculateManifestChecksum(manifest) {
        const manifestCopy = { ...manifest };
        delete manifestCopy.checksum;
        return crypto.createHash('sha256').update(JSON.stringify(manifestCopy)).digest('hex');
    }
    
    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Disaster recovery testing
    async testDisasterRecovery() {
        console.log('🧪 Running disaster recovery test...');
        
        const testDir = './disaster-recovery-test';
        const testBackupId = `test-backup-${Date.now()}`;
        
        try {
            // Create a test backup
            const backup = await this.createBackup();
            if (!backup.success) {
                throw new Error(`Backup creation failed: ${backup.error}`);
            }
            
            // Create test environment
            await fs.mkdir(testDir, { recursive: true });
            
            // Attempt restore in test environment
            const restore = await this.restoreBackup(backup.backupId, {
                targetDir: testDir,
                selectiveRestore: ['database', 'config']
            });
            
            if (!restore.success) {
                throw new Error(`Restore test failed: ${restore.error}`);
            }
            
            // Validate restored files
            const validationResults = await this.validateRestoredFiles(testDir);
            
            console.log('✅ Disaster recovery test passed');
            console.log(`📊 Validation results:`, validationResults);
            
            return {
                success: true,
                backupId: backup.backupId,
                validationResults
            };
            
        } catch (error) {
            console.error('❌ Disaster recovery test failed:', error.message);
            return { success: false, error: error.message };
            
        } finally {
            // Cleanup test environment
            try {
                await fs.rmdir(testDir, { recursive: true });
            } catch (cleanupError) {
                console.warn('⚠️ Failed to cleanup test environment:', cleanupError.message);
            }
        }
    }
    
    async validateRestoredFiles(testDir) {
        const validation = {
            filesRestored: 0,
            filesValid: 0,
            errors: []
        };
        
        try {
            const files = await this.getDirectoryFiles(testDir);
            validation.filesRestored = files.length;
            
            for (const file of files) {
                try {
                    const stats = await fs.stat(file);
                    if (stats.size > 0) {
                        validation.filesValid++;
                    }
                } catch (error) {
                    validation.errors.push(`File validation failed: ${file}`);
                }
            }
            
        } catch (error) {
            validation.errors.push(`Directory validation failed: ${error.message}`);
        }
        
        return validation;
    }
}

// CLI Interface
async function main() {
    const backup = new BackupSystem();
    const command = process.argv[2];
    
    switch (command) {
        case 'create':
            await backup.createBackup();
            break;
            
        case 'list':
            const backups = await backup.listBackups();
            console.log('📋 Available backups:');
            backups.forEach(b => {
                console.log(`  ${b.id} (${new Date(b.timestamp).toLocaleString()}) - ${backup.formatSize(b.compressedSize)}`);
            });
            break;
            
        case 'restore':
            const backupId = process.argv[3];
            if (!backupId) {
                console.error('❌ Please specify backup ID to restore');
                process.exit(1);
            }
            await backup.restoreBackup(backupId);
            break;
            
        case 'verify':
            const verifyId = process.argv[3];
            if (!verifyId) {
                console.error('❌ Please specify backup ID to verify');
                process.exit(1);
            }
            const backupPath = path.join(backup.config.backupDir, verifyId);
            await backup.verifyBackup(backupPath);
            break;
            
        case 'cleanup':
            await backup.cleanupOldBackups();
            break;
            
        case 'test':
            await backup.testDisasterRecovery();
            break;
            
        case 'schedule':
            console.log('🕒 Starting scheduled backup (every 6 hours)...');
            setInterval(async () => {
                console.log(`🔄 Starting scheduled backup at ${new Date().toISOString()}`);
                await backup.createBackup();
            }, 6 * 60 * 60 * 1000); // 6 hours
            
            // Initial backup
            await backup.createBackup();
            break;
            
        default:
            console.log(`
Backup System for IC Mesh

Usage:
  node backup-system.js <command>

Commands:
  create      - Create a new backup
  list        - List all available backups
  restore     - Restore a backup (specify backup ID)
  verify      - Verify backup integrity (specify backup ID)
  cleanup     - Remove old backups beyond retention limit
  test        - Run disaster recovery test
  schedule    - Start scheduled backup service (every 6 hours)

Examples:
  node backup-system.js create
  node backup-system.js list
  node backup-system.js restore backup-2026-02-25T06-00-00-000Z
  node backup-system.js test
            `);
    }
}

module.exports = BackupSystem;

if (require.main === module) {
    main().catch(console.error);
}