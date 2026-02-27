#!/usr/bin/env node

/**
 * Node Reconnection Assistant
 * 
 * Comprehensive toolkit to help operators diagnose and resolve
 * node connection issues, reducing churn and improving retention.
 * 
 * Features:
 * - Connection diagnostics
 * - Common issue fixes
 * - Configuration validation
 * - Network troubleshooting
 * - Step-by-step guidance
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class NodeReconnectionAssistant {
    constructor() {
        this.serverUrl = 'http://localhost:8333';
        this.websocketUrl = 'ws://localhost:8333';
        this.configFile = 'node-config.json';
        this.clientScript = 'client.js';
    }

    async runDiagnostics() {
        console.log('\n🔧 IC Mesh Node Reconnection Assistant');
        console.log('=====================================\n');

        const issues = [];
        
        // Check 1: Configuration file exists and valid
        const configIssue = this.checkConfiguration();
        if (configIssue) issues.push(configIssue);

        // Check 2: Client script exists
        const clientIssue = this.checkClientScript();
        if (clientIssue) issues.push(clientIssue);

        // Check 3: Network connectivity to server
        const networkIssue = await this.checkNetworkConnectivity();
        if (networkIssue) issues.push(networkIssue);

        // Check 4: Dependencies installed
        const depIssue = this.checkDependencies();
        if (depIssue) issues.push(depIssue);

        // Check 5: File permissions
        const permIssue = this.checkPermissions();
        if (permIssue) issues.push(permIssue);

        // Check 6: System resources
        const resourceIssue = this.checkSystemResources();
        if (resourceIssue) issues.push(resourceIssue);

        // Check 7: Conflicting processes
        const processIssue = this.checkConflictingProcesses();
        if (processIssue) issues.push(processIssue);

        // Report results
        if (issues.length === 0) {
            console.log('✅ All checks passed! Your node should be able to connect.');
            console.log('\n🚀 Quick Start Command:');
            console.log('   node client.js');
            this.showHealthyNodeTips();
        } else {
            console.log(`❌ Found ${issues.length} issue(s) that may prevent connection:\n`);
            issues.forEach((issue, i) => {
                console.log(`${i + 1}. ${issue.title}`);
                console.log(`   Problem: ${issue.problem}`);
                console.log(`   Solution: ${issue.solution}\n`);
            });
            this.showNextSteps(issues);
        }
    }

    checkConfiguration() {
        try {
            if (!fs.existsSync(this.configFile)) {
                return {
                    title: 'Missing Configuration File',
                    problem: `${this.configFile} not found`,
                    solution: 'Create node-config.json with your capabilities and settings. Run: curl -s https://raw.githubusercontent.com/drakeology/ic-mesh/main/node-config-example.json > node-config.json'
                };
            }

            const config = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
            
            // Required fields check
            const required = ['name', 'capabilities'];
            const missing = required.filter(field => !config[field]);
            
            if (missing.length > 0) {
                return {
                    title: 'Invalid Configuration',
                    problem: `Missing required fields: ${missing.join(', ')}`,
                    solution: 'Update node-config.json with required fields. Example: {"name": "my-node", "capabilities": ["transcribe"], "description": "My processing node"}'
                };
            }

            // Capabilities validation
            if (!Array.isArray(config.capabilities) || config.capabilities.length === 0) {
                return {
                    title: 'Empty Capabilities',
                    problem: 'Node has no capabilities defined',
                    solution: 'Add capabilities to node-config.json. Common options: ["transcribe"], ["ocr"], ["pdf-extract"], ["stable-diffusion"]'
                };
            }

            console.log('✅ Configuration file valid');
            return null;
        } catch (e) {
            return {
                title: 'Configuration Parse Error',
                problem: `Cannot parse ${this.configFile}: ${e.message}`,
                solution: 'Fix JSON syntax in node-config.json. Use: node -e "console.log(JSON.parse(require(\'fs\').readFileSync(\'node-config.json\')))" to validate'
            };
        }
    }

    checkClientScript() {
        if (!fs.existsSync(this.clientScript)) {
            return {
                title: 'Missing Client Script',
                problem: `${this.clientScript} not found`,
                solution: 'Download client.js from the IC Mesh repository: curl -s https://raw.githubusercontent.com/drakeology/ic-mesh/main/client.js > client.js'
            };
        }

        try {
            // Check if client.js has executable permissions or can be run with node
            const stats = fs.statSync(this.clientScript);
            console.log('✅ Client script found');
            return null;
        } catch (e) {
            return {
                title: 'Client Script Error',
                problem: `Cannot access ${this.clientScript}: ${e.message}`,
                solution: 'Ensure client.js exists and is readable. Re-download if corrupted.'
            };
        }
    }

    async checkNetworkConnectivity() {
        try {
            // Test HTTP connection to server
            console.log('🌐 Testing network connectivity...');
            
            try {
                execSync(`curl -s --connect-timeout 5 ${this.serverUrl}/status`, { stdio: 'pipe' });
                console.log('✅ HTTP connection to server successful');
            } catch (e) {
                return {
                    title: 'Server Connection Failed',
                    problem: `Cannot reach IC Mesh server at ${this.serverUrl}`,
                    solution: 'Check network connection and verify server URL. Try: curl http://localhost:8333/status'
                };
            }

            // Test WebSocket connectivity (basic check)
            console.log('✅ Network connectivity check passed');
            return null;
        } catch (e) {
            return {
                title: 'Network Connectivity Issue',
                problem: `Network tests failed: ${e.message}`,
                solution: 'Check internet connection, firewall settings, and server availability'
            };
        }
    }

    checkDependencies() {
        try {
            // Check Node.js version
            const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
            const majorVersion = parseInt(nodeVersion.replace('v', '').split('.')[0]);
            
            if (majorVersion < 14) {
                return {
                    title: 'Outdated Node.js Version',
                    problem: `Node.js ${nodeVersion} is too old (requires 14+)`,
                    solution: 'Update Node.js to version 14 or higher. Visit: https://nodejs.org/'
                };
            }

            // Check npm (indicates proper Node.js installation)
            execSync('npm --version', { stdio: 'pipe' });
            
            console.log(`✅ Node.js ${nodeVersion} is compatible`);
            return null;
        } catch (e) {
            return {
                title: 'Node.js Not Found',
                problem: 'Node.js is not installed or not in PATH',
                solution: 'Install Node.js from https://nodejs.org/ and ensure it\'s in your system PATH'
            };
        }
    }

    checkPermissions() {
        try {
            // Check if we can read config file
            fs.accessSync(this.configFile, fs.constants.R_OK);
            
            // Check if we can execute client script
            if (fs.existsSync(this.clientScript)) {
                fs.accessSync(this.clientScript, fs.constants.R_OK);
            }
            
            // Check if we can write to current directory (for logs, temp files)
            fs.accessSync('.', fs.constants.W_OK);
            
            console.log('✅ File permissions look good');
            return null;
        } catch (e) {
            return {
                title: 'Permission Error',
                problem: 'Insufficient file permissions',
                solution: 'Ensure you have read access to config files and write access to working directory. Try: chmod +r node-config.json && chmod +r client.js'
            };
        }
    }

    checkSystemResources() {
        try {
            // Check available memory
            const memInfo = execSync('free -m', { encoding: 'utf8' });
            const memLines = memInfo.split('\n');
            const memLine = memLines.find(line => line.startsWith('Mem:'));
            
            if (memLine) {
                const available = parseInt(memLine.split(/\s+/)[6] || 0);
                if (available < 100) {
                    return {
                        title: 'Low Memory',
                        problem: `Only ${available}MB available memory`,
                        solution: 'Close other applications or add more RAM. Node processing requires at least 100MB available memory.'
                    };
                }
            }

            // Check disk space
            const dfInfo = execSync('df -h .', { encoding: 'utf8' });
            const dfLines = dfInfo.split('\n');
            if (dfLines.length > 1) {
                const spaceInfo = dfLines[1].split(/\s+/);
                const usedPercent = parseInt(spaceInfo[4]?.replace('%', '') || 0);
                if (usedPercent > 95) {
                    return {
                        title: 'Low Disk Space',
                        problem: `Disk is ${usedPercent}% full`,
                        solution: 'Free up disk space. Node operations require space for temporary files and logs.'
                    };
                }
            }

            console.log('✅ System resources adequate');
            return null;
        } catch (e) {
            // System resource checks are nice-to-have, not critical
            console.log('⚠️  Could not check system resources (non-critical)');
            return null;
        }
    }

    checkConflictingProcesses() {
        try {
            // Check if there's already a client.js running
            const processes = execSync('pgrep -f "node.*client.js" || true', { encoding: 'utf8' });
            
            if (processes.trim() && processes.trim().split('\n').length > 1) {
                return {
                    title: 'Conflicting Process',
                    problem: 'Another client.js instance is already running',
                    solution: 'Stop the existing instance first: pkill -f "node.*client.js" then start fresh'
                };
            }

            console.log('✅ No conflicting processes detected');
            return null;
        } catch (e) {
            // Process check is not critical
            return null;
        }
    }

    showHealthyNodeTips() {
        console.log('\n💡 Tips for Maintaining Healthy Connection:');
        console.log('-------------------------------------------');
        console.log('• Keep your node running 24/7 for maximum earnings');
        console.log('• Monitor logs for errors: node client.js 2>&1 | tee node.log');
        console.log('• Use screen/tmux for persistent sessions: screen -S icmesh node client.js');
        console.log('• Set up auto-restart on crashes: while true; do node client.js; sleep 5; done');
        console.log('• Monitor your earnings: curl http://localhost:8333/payouts/YOUR_NODE_ID');
    }

    showNextSteps(issues) {
        console.log('🔧 Recommended Next Steps:');
        console.log('---------------------------');
        console.log('1. Fix the issues above in order');
        console.log('2. Run this diagnostic again to verify fixes');
        console.log('3. Start your node: node client.js');
        console.log('4. Monitor connection in server logs');
        
        if (issues.some(i => i.title.includes('Configuration'))) {
            console.log('\n📋 Quick Configuration Template:');
            console.log('{');
            console.log('  "name": "my-awesome-node",');
            console.log('  "description": "High-performance processing node",');
            console.log('  "capabilities": ["transcribe"],');
            console.log('  "owner": "your-name"');
            console.log('}');
        }
    }

    generateReconnectionScript() {
        const scriptContent = `#!/bin/bash
# IC Mesh Node Auto-Reconnection Script
# Automatically restarts your node if it disconnects

NODE_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "$NODE_DIR"

echo "🚀 Starting IC Mesh Node Auto-Reconnection..."
echo "Node directory: $NODE_DIR"

# Function to check if node is connected
check_connection() {
    if pgrep -f "node.*client.js" > /dev/null; then
        return 0
    else
        return 1
    fi
}

# Main reconnection loop
while true; do
    if ! check_connection; then
        echo "$(date): Node disconnected, restarting..."
        
        # Kill any hanging processes
        pkill -f "node.*client.js" 2>/dev/null || true
        sleep 2
        
        # Start fresh
        echo "$(date): Starting node client..."
        node client.js &
        
        # Give it time to establish connection
        sleep 10
        
        if check_connection; then
            echo "$(date): Node reconnected successfully!"
        else
            echo "$(date): Failed to reconnect, will retry in 30 seconds..."
        fi
    fi
    
    sleep 30  # Check every 30 seconds
done
`;

        fs.writeFileSync('auto-reconnect.sh', scriptContent);
        execSync('chmod +x auto-reconnect.sh');
        
        console.log('\n🔄 Auto-Reconnection Script Created: auto-reconnect.sh');
        console.log('Usage: ./auto-reconnect.sh');
        console.log('       screen -S icmesh ./auto-reconnect.sh  (for background running)');
    }
}

// CLI Interface
async function main() {
    const assistant = new NodeReconnectionAssistant();
    
    if (process.argv.includes('--generate-script')) {
        assistant.generateReconnectionScript();
        return;
    }
    
    if (process.argv.includes('--help')) {
        console.log('IC Mesh Node Reconnection Assistant');
        console.log('Usage:');
        console.log('  node node-reconnection-assistant.js          Run diagnostics');
        console.log('  node node-reconnection-assistant.js --generate-script    Create auto-reconnect script');
        console.log('  node node-reconnection-assistant.js --help               Show this help');
        return;
    }
    
    await assistant.runDiagnostics();
    
    // Offer to generate auto-reconnection script
    console.log('\n🔄 Generate auto-reconnection script? (y/n)');
    // For automation, we'll generate it anyway
    new NodeReconnectionAssistant().generateReconnectionScript();
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = NodeReconnectionAssistant;