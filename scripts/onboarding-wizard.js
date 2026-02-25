#!/usr/bin/env node

/**
 * IC Mesh Onboarding Wizard
 * 
 * Interactive setup tool that ensures new nodes are properly configured
 * before joining the mesh. Reduces node churn by catching issues early.
 * 
 * Features:
 * - System requirements check
 * - Capability detection and optimization
 * - Network connectivity testing
 * - Configuration wizard
 * - Service setup assistance
 * - Troubleshooting diagnostics
 * 
 * Usage: node scripts/onboarding-wizard.js
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');

class OnboardingWizard {
    constructor() {
        this.config = {};
        this.requirements = {
            nodejs: { min: '18.0.0', installed: null },
            git: { required: true, installed: null },
            network: { required: true, status: null }
        };
        this.capabilities = {
            ollama: { status: null, models: [], earning_potential: 'High' },
            whisper: { status: null, earning_potential: 'High' },
            ffmpeg: { status: null, earning_potential: 'Medium' },
            gpu: { status: null, type: null, earning_potential: 'Very High' },
            python: { status: null, version: null }
        };
        this.issues = [];
        this.warnings = [];
        
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    // Colors for terminal output
    colors = {
        reset: '\x1b[0m',
        bright: '\x1b[1m',
        red: '\x1b[31m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        blue: '\x1b[34m',
        magenta: '\x1b[35m',
        cyan: '\x1b[36m'
    };

    log(message, color = 'reset') {
        console.log(`${this.colors[color]}${message}${this.colors.reset}`);
    }

    async question(prompt) {
        return new Promise((resolve) => {
            this.rl.question(prompt, resolve);
        });
    }

    async welcome() {
        console.clear();
        this.log('┌─────────────────────────────────────────────────────────────┐', 'cyan');
        this.log('│                🌐 IC MESH ONBOARDING WIZARD                │', 'cyan');
        this.log('│                                                             │', 'cyan');
        this.log('│  Get your OpenClaw machine earning money from idle compute  │', 'cyan');
        this.log('│  This wizard ensures optimal setup and reduces issues      │', 'cyan');
        this.log('└─────────────────────────────────────────────────────────────┘', 'cyan');
        console.log();
        
        this.log('🚀 Welcome to the IC Mesh Network!', 'green');
        console.log();
        this.log('This wizard will:', 'bright');
        this.log('  1. Check your system meets requirements');
        this.log('  2. Detect and optimize money-earning capabilities');
        this.log('  3. Test network connectivity to the mesh hub');
        this.log('  4. Configure your node for maximum earnings');
        this.log('  5. Set up monitoring and troubleshooting tools');
        console.log();
        
        const proceed = await this.question('Ready to start? (Y/n): ');
        if (proceed.toLowerCase() === 'n') {
            this.log('Setup cancelled. Run the wizard again when ready!', 'yellow');
            process.exit(0);
        }
    }

    checkCommand(command) {
        try {
            execSync(`which ${command}`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    getVersion(command, regex) {
        try {
            const output = execSync(`${command} --version 2>&1`, { encoding: 'utf8' });
            const match = output.match(regex);
            return match ? match[1] : 'unknown';
        } catch {
            return null;
        }
    }

    compareVersions(version1, version2) {
        const v1 = version1.split('.').map(Number);
        const v2 = version2.split('.').map(Number);
        
        for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
            const n1 = v1[i] || 0;
            const n2 = v2[i] || 0;
            if (n1 > n2) return 1;
            if (n1 < n2) return -1;
        }
        return 0;
    }

    async checkRequirements() {
        console.log();
        this.log('📋 STEP 1: Checking System Requirements', 'blue');
        this.log('═'.repeat(50), 'blue');

        // Node.js check
        this.log('Checking Node.js...', 'yellow');
        const nodeInstalled = this.checkCommand('node');
        if (nodeInstalled) {
            const nodeVersion = this.getVersion('node', /v(\d+\.\d+\.\d+)/);
            this.requirements.nodejs.installed = nodeVersion;
            
            if (nodeVersion && this.compareVersions(nodeVersion, this.requirements.nodejs.min) >= 0) {
                this.log(`✅ Node.js ${nodeVersion} (meets requirement: ${this.requirements.nodejs.min}+)`, 'green');
            } else {
                this.log(`❌ Node.js ${nodeVersion || 'unknown'} (need ${this.requirements.nodejs.min}+)`, 'red');
                this.issues.push({
                    type: 'requirement',
                    component: 'nodejs',
                    message: `Node.js ${this.requirements.nodejs.min}+ required`,
                    fix: 'Install from https://nodejs.org'
                });
            }
        } else {
            this.log('❌ Node.js not found', 'red');
            this.issues.push({
                type: 'requirement',
                component: 'nodejs',
                message: 'Node.js not installed',
                fix: 'Install from https://nodejs.org'
            });
        }

        // Git check
        this.log('Checking Git...', 'yellow');
        if (this.checkCommand('git')) {
            this.log('✅ Git installed', 'green');
            this.requirements.git.installed = true;
        } else {
            this.log('❌ Git not found', 'red');
            this.issues.push({
                type: 'requirement',
                component: 'git',
                message: 'Git not installed',
                fix: 'Install git for your platform'
            });
        }

        // NPM dependencies check
        this.log('Checking project dependencies...', 'yellow');
        const packagePath = path.join(__dirname, '..', 'package.json');
        const nodeModulesPath = path.join(__dirname, '..', 'node_modules');
        
        if (fs.existsSync(packagePath) && fs.existsSync(nodeModulesPath)) {
            this.log('✅ IC Mesh dependencies installed', 'green');
        } else {
            this.log('⚠️ Dependencies need installation', 'yellow');
            this.warnings.push({
                type: 'setup',
                message: 'Run "npm install" to install dependencies',
                fix: 'npm install'
            });
        }
    }

    async checkCapabilities() {
        console.log();
        this.log('🔧 STEP 2: Detecting Money-Making Capabilities', 'blue');
        this.log('═'.repeat(50), 'blue');
        this.log('The more capabilities you have, the more you can earn!', 'bright');
        console.log();

        // Ollama check (highest earning potential)
        this.log('Checking Ollama (LLM inference - High earning potential)...', 'yellow');
        if (this.checkCommand('ollama')) {
            this.capabilities.ollama.status = 'installed';
            try {
                const modelsOutput = execSync('ollama list 2>/dev/null', { encoding: 'utf8' });
                const models = modelsOutput.split('\n')
                    .slice(1)
                    .filter(line => line.trim())
                    .map(line => line.split('\t')[0].split(' ')[0])
                    .filter(model => model && !model.includes(':'));
                
                this.capabilities.ollama.models = models;
                if (models.length > 0) {
                    this.log(`✅ Ollama with ${models.length} models: ${models.slice(0, 3).join(', ')}${models.length > 3 ? '...' : ''}`, 'green');
                } else {
                    this.log('⚠️ Ollama installed but no models found', 'yellow');
                    this.warnings.push({
                        type: 'capability',
                        component: 'ollama',
                        message: 'Install models for LLM jobs',
                        fix: 'ollama pull llama3.1:8b  # Popular model for inference jobs'
                    });
                }
            } catch {
                this.log('⚠️ Ollama installed but not responding', 'yellow');
                this.warnings.push({
                    type: 'capability',
                    component: 'ollama',
                    message: 'Ollama service not running',
                    fix: 'Start with: ollama serve'
                });
            }
        } else {
            this.capabilities.ollama.status = 'not_installed';
            this.log('❌ Ollama not found (High earning potential missed)', 'red');
            this.warnings.push({
                type: 'capability',
                component: 'ollama',
                message: 'Ollama enables high-value LLM inference jobs',
                fix: 'Install from https://ollama.com'
            });
        }

        // Whisper check (high earning potential)
        this.log('Checking Whisper (Audio transcription - High earning potential)...', 'yellow');
        if (this.checkCommand('whisper')) {
            this.capabilities.whisper.status = 'installed';
            this.log('✅ Whisper installed (audio transcription enabled)', 'green');
        } else {
            this.capabilities.whisper.status = 'not_installed';
            this.log('❌ Whisper not found (High earning potential missed)', 'red');
            this.warnings.push({
                type: 'capability',
                component: 'whisper',
                message: 'Whisper enables audio transcription jobs',
                fix: 'pip install openai-whisper'
            });
        }

        // Python check (for Whisper)
        this.log('Checking Python (needed for Whisper)...', 'yellow');
        if (this.checkCommand('python3')) {
            const pythonVersion = this.getVersion('python3', /(\d+\.\d+\.\d+)/);
            this.capabilities.python = { status: 'installed', version: pythonVersion };
            this.log(`✅ Python ${pythonVersion}`, 'green');
        } else if (this.checkCommand('python')) {
            const pythonVersion = this.getVersion('python', /(\d+\.\d+\.\d+)/);
            this.capabilities.python = { status: 'installed', version: pythonVersion };
            this.log(`✅ Python ${pythonVersion}`, 'green');
        } else {
            this.capabilities.python.status = 'not_installed';
            this.log('⚠️ Python not found (needed for Whisper)', 'yellow');
            if (this.capabilities.whisper.status === 'not_installed') {
                this.warnings.push({
                    type: 'capability',
                    component: 'python',
                    message: 'Python needed for Whisper installation',
                    fix: 'Install Python 3.8+ from python.org'
                });
            }
        }

        // FFmpeg check (medium earning potential)
        this.log('Checking FFmpeg (Media processing - Medium earning potential)...', 'yellow');
        if (this.checkCommand('ffmpeg')) {
            this.capabilities.ffmpeg.status = 'installed';
            this.log('✅ FFmpeg installed (media processing enabled)', 'green');
        } else {
            this.capabilities.ffmpeg.status = 'not_installed';
            this.log('❌ FFmpeg not found (Medium earning potential missed)', 'red');
            this.warnings.push({
                type: 'capability',
                component: 'ffmpeg',
                message: 'FFmpeg enables media processing jobs',
                fix: 'Install: brew install ffmpeg (Mac) or apt install ffmpeg (Linux)'
            });
        }

        // GPU check (very high earning potential)
        this.log('Checking GPU acceleration (Very high earning potential)...', 'yellow');
        try {
            // Check for NVIDIA GPU
            const nvidiaCheck = execSync('nvidia-smi --query-gpu=name --format=csv,noheader,nounits 2>/dev/null', { encoding: 'utf8' });
            if (nvidiaCheck.trim()) {
                this.capabilities.gpu = { status: 'nvidia', type: nvidiaCheck.trim() };
                this.log(`✅ NVIDIA GPU: ${nvidiaCheck.trim()}`, 'green');
            }
        } catch {
            // Check for Apple Silicon
            try {
                const systemInfo = execSync('system_profiler SPHardwareDataType 2>/dev/null', { encoding: 'utf8' });
                if (systemInfo.includes('Apple M1') || systemInfo.includes('Apple M2') || systemInfo.includes('Apple M3')) {
                    const chipMatch = systemInfo.match(/Chip: (Apple M\d+[^\n]*)/);
                    this.capabilities.gpu = { status: 'apple_silicon', type: chipMatch ? chipMatch[1] : 'Apple Silicon' };
                    this.log(`✅ Apple Silicon GPU: ${this.capabilities.gpu.type}`, 'green');
                } else {
                    this.capabilities.gpu.status = 'not_found';
                    this.log('⚠️ No GPU acceleration detected', 'yellow');
                    this.warnings.push({
                        type: 'capability',
                        component: 'gpu',
                        message: 'GPU acceleration significantly increases earnings',
                        fix: 'Consider upgrading to a system with dedicated GPU'
                    });
                }
            } catch {
                this.capabilities.gpu.status = 'unknown';
                this.log('⚠️ Could not detect GPU status', 'yellow');
            }
        }

        // Earnings potential summary
        console.log();
        this.log('💰 Earnings Potential Summary:', 'bright');
        const capabilityCount = Object.values(this.capabilities).filter(cap => 
            cap.status === 'installed' || cap.status === 'nvidia' || cap.status === 'apple_silicon'
        ).length;
        
        if (capabilityCount >= 4) {
            this.log('🌟 Excellent! Maximum earnings potential', 'green');
        } else if (capabilityCount >= 2) {
            this.log('👍 Good earnings potential - consider adding more capabilities', 'yellow');
        } else {
            this.log('⚠️ Limited earnings potential - install more capabilities for better income', 'red');
        }
    }

    async testConnectivity() {
        console.log();
        this.log('🌐 STEP 3: Testing Network Connectivity', 'blue');
        this.log('═'.repeat(50), 'blue');

        const meshServer = process.env.IC_MESH_SERVER || 'https://moilol.com:8333';
        this.log(`Testing connection to: ${meshServer}`, 'yellow');

        try {
            // Test with curl
            const response = execSync(`curl -s -m 10 ${meshServer}/status 2>/dev/null`, { encoding: 'utf8' });
            const status = JSON.parse(response);
            
            if (status.status === 'healthy') {
                this.log('✅ Mesh hub reachable and healthy', 'green');
                this.log(`   Server: ${status.service || 'IC Mesh Hub'}`, 'cyan');
                this.log(`   Version: ${status.version || 'Unknown'}`, 'cyan');
                this.requirements.network.status = 'healthy';
            } else {
                this.log('⚠️ Mesh hub reachable but unhealthy', 'yellow');
                this.warnings.push({
                    type: 'network',
                    component: 'mesh_hub',
                    message: 'Mesh hub reporting unhealthy status',
                    fix: 'Try again later or check status at moilol.com'
                });
            }
        } catch (error) {
            this.log('❌ Cannot reach mesh hub', 'red');
            this.issues.push({
                type: 'network',
                component: 'connectivity',
                message: 'Cannot connect to mesh hub',
                fix: 'Check internet connection and firewall settings'
            });
        }

        // Test DNS resolution
        this.log('Testing DNS resolution...', 'yellow');
        try {
            execSync('nslookup moilol.com', { stdio: 'ignore' });
            this.log('✅ DNS resolution working', 'green');
        } catch {
            this.log('❌ DNS resolution failed', 'red');
            this.issues.push({
                type: 'network',
                component: 'dns',
                message: 'Cannot resolve moilol.com',
                fix: 'Check DNS settings or try different DNS server'
            });
        }
    }

    async configureNode() {
        console.log();
        this.log('⚙️ STEP 4: Node Configuration', 'blue');
        this.log('═'.repeat(50), 'blue');

        // Check for existing configuration
        const configPath = path.join(__dirname, '..', 'node-config.json');
        const envPath = path.join(__dirname, '..', '.env');
        
        let hasConfig = false;
        if (fs.existsSync(configPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (config.nodeName) {
                    this.log(`✅ Found existing configuration: ${config.nodeName}`, 'green');
                    const useExisting = await this.question('Use existing configuration? (Y/n): ');
                    if (useExisting.toLowerCase() !== 'n') {
                        this.config = config;
                        hasConfig = true;
                    }
                }
            } catch {
                this.log('⚠️ Configuration file exists but is invalid', 'yellow');
            }
        }

        if (!hasConfig) {
            this.log('Let\'s set up your node configuration:', 'bright');
            console.log();

            // Node name
            const defaultName = `openclaw-${require('os').hostname()}`;
            const nodeName = await this.question(`Node name [${defaultName}]: `);
            this.config.nodeName = nodeName.trim() || defaultName;

            // Owner name
            const owner = await this.question('Your name (for identification): ');
            this.config.nodeOwner = owner.trim() || 'anonymous';

            // Region
            const region = await this.question('Your region (e.g., hawaii, nyc, london): ');
            this.config.nodeRegion = region.trim() || 'unknown';

            // Mesh server
            const defaultServer = 'https://moilol.com:8333';
            const server = await this.question(`Mesh server [${defaultServer}]: `);
            this.config.meshServer = server.trim() || defaultServer;

            // Save configuration
            const configChoice = await this.question('Save as config file (f) or environment variables (e)? [f]: ');
            if (configChoice.toLowerCase() === 'e') {
                const envContent = [
                    `IC_MESH_SERVER=${this.config.meshServer}`,
                    `IC_NODE_NAME=${this.config.nodeName}`,
                    `IC_NODE_OWNER=${this.config.nodeOwner}`,
                    `IC_NODE_REGION=${this.config.nodeRegion}`,
                    ''
                ].join('\n');
                
                fs.writeFileSync(envPath, envContent);
                this.log(`✅ Configuration saved to .env`, 'green');
            } else {
                fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
                this.log(`✅ Configuration saved to node-config.json`, 'green');
            }
        }
    }

    displaySummary() {
        console.log();
        this.log('📊 SETUP SUMMARY', 'blue');
        this.log('═'.repeat(50), 'blue');

        // Requirements status
        this.log('System Requirements:', 'bright');
        Object.entries(this.requirements).forEach(([key, req]) => {
            if (req.installed !== null) {
                const status = req.installed ? '✅' : '❌';
                const detail = req.installed === true ? '' : ` (${req.installed})`;
                this.log(`  ${status} ${key}${detail}`);
            }
        });

        console.log();
        
        // Capabilities status
        this.log('Earning Capabilities:', 'bright');
        Object.entries(this.capabilities).forEach(([key, cap]) => {
            if (cap.status) {
                const icons = {
                    'installed': '✅',
                    'nvidia': '🚀',
                    'apple_silicon': '🍎',
                    'not_installed': '❌',
                    'not_found': '❌',
                    'unknown': '⚪'
                };
                const icon = icons[cap.status] || '⚪';
                const potential = cap.earning_potential ? ` (${cap.earning_potential} earning potential)` : '';
                this.log(`  ${icon} ${key}${potential}`);
                
                if (cap.models && cap.models.length > 0) {
                    this.log(`     Models: ${cap.models.slice(0, 3).join(', ')}`, 'cyan');
                }
            }
        });

        console.log();

        // Issues and warnings
        if (this.issues.length > 0) {
            this.log('🚨 Critical Issues (must fix):', 'red');
            this.issues.forEach(issue => {
                this.log(`  ❌ ${issue.message}`, 'red');
                this.log(`     Fix: ${issue.fix}`, 'yellow');
            });
            console.log();
        }

        if (this.warnings.length > 0) {
            this.log('⚠️ Optimization Opportunities:', 'yellow');
            this.warnings.forEach(warning => {
                this.log(`  ⚠️ ${warning.message}`, 'yellow');
                this.log(`     Suggestion: ${warning.fix}`, 'cyan');
            });
            console.log();
        }

        // Next steps
        this.log('🚀 Next Steps:', 'bright');
        if (this.issues.length > 0) {
            this.log('1. Fix critical issues listed above', 'red');
            this.log('2. Re-run this wizard: node scripts/onboarding-wizard.js', 'yellow');
        } else {
            this.log('1. Start your node: node client.js', 'green');
            this.log('2. Monitor earnings: https://moilol.com/account', 'cyan');
            this.log('3. Install more capabilities to increase earnings', 'yellow');
            this.log('4. Set up as background service for 24/7 operation', 'cyan');
        }

        console.log();
        this.log('💡 Pro Tips:', 'bright');
        this.log('• Keep your node running 24/7 for maximum earnings');
        this.log('• More capabilities = more job types = higher income');
        this.log('• GPU acceleration provides the highest earning potential');
        this.log('• Monitor your earnings dashboard regularly');
    }

    async run() {
        try {
            await this.welcome();
            await this.checkRequirements();
            await this.checkCapabilities();
            await this.testConnectivity();
            await this.configureNode();
            this.displaySummary();

            console.log();
            if (this.issues.length === 0) {
                this.log('🎉 Setup complete! Your node is ready to earn money.', 'green');
                console.log();
                
                const startNow = await this.question('Start your node now? (Y/n): ');
                if (startNow.toLowerCase() !== 'n') {
                    this.rl.close();
                    console.log();
                    this.log('🚀 Starting IC Mesh node...', 'green');
                    
                    // Start the client
                    const client = spawn('node', ['client.js'], { stdio: 'inherit' });
                    
                    // Handle graceful shutdown
                    process.on('SIGINT', () => {
                        console.log('\n🛑 Shutting down...');
                        client.kill('SIGTERM');
                        process.exit(0);
                    });
                    
                    return;
                }
            } else {
                this.log('❌ Please fix the critical issues and run the wizard again.', 'red');
            }
            
        } catch (error) {
            console.error();
            this.log('💥 Setup wizard encountered an error:', 'red');
            this.log(error.message, 'red');
        } finally {
            this.rl.close();
        }
    }
}

// CLI execution
if (require.main === module) {
    const wizard = new OnboardingWizard();
    wizard.run();
}

module.exports = OnboardingWizard;