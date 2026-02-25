# IC Mesh Configuration Examples

This directory contains configuration templates for different deployment scenarios. Choose the configuration that best matches your use case and hardware setup.

## Quick Start

1. Copy the appropriate configuration file:
   ```bash
   cp configs/[scenario].example.json node-config.json
   ```

2. Edit the configuration to match your setup:
   ```bash
   nano node-config.json
   ```

3. Start your node:
   ```bash
   node client.js
   ```

## Available Configurations

### 🧪 development.example.json
**Best for:** Local development and testing
- Debug logging enabled
- Reduced resource limits
- Fast models for quick iteration
- Development-specific features

```bash
cp configs/development.example.json node-config.json
```

### 🏭 production.example.json  
**Best for:** Production deployments
- Security hardening
- Comprehensive monitoring
- Resource optimization
- Audit logging
- Backup configuration

```bash
cp configs/production.example.json node-config.json
```

### 🚀 gpu-optimized.example.json
**Best for:** High-performance GPU compute
- CUDA optimization
- GPU memory management
- Thermal monitoring
- ML inference acceleration
- Hardware-specific tuning

```bash
cp configs/gpu-optimized.example.json node-config.json
```

## Configuration Scenarios

### Development Setup
```bash
# 1. Copy development config
cp configs/development.example.json node-config.json

# 2. Edit node details
nano node-config.json
# - Set your name and region
# - Enable only handlers you want to test
# - Adjust resource limits for your machine

# 3. Test configuration
node client.js --validate-config

# 4. Start in development mode
node client.js --dev
```

### Production Deployment
```bash
# 1. Copy production config
cp configs/production.example.json node-config.json

# 2. Configure for your environment
nano node-config.json
# - Set production node name and owner
# - Configure handlers for your hardware
# - Set up monitoring and alerting
# - Review security settings

# 3. Validate configuration
node client.js --validate-config

# 4. Run pre-deployment checks
node scripts/health-check.js --pre-deploy

# 5. Start production service
systemctl start ic-mesh-client
```

### GPU Compute Node
```bash
# 1. Verify GPU setup
nvidia-smi
nvidia-docker --version

# 2. Copy GPU-optimized config
cp configs/gpu-optimized.example.json node-config.json

# 3. Configure GPU settings
nano node-config.json
# - Set CUDA device IDs
# - Configure GPU memory limits
# - Enable hardware-specific optimizations
# - Set thermal limits

# 4. Test GPU handlers
node client.js --test-gpu

# 5. Start with GPU monitoring
node client.js --enable-gpu-monitoring
```

## Configuration Sections

### Node Identity
```json
{
  "node": {
    "name": "unique-node-name",
    "owner": "your-name-or-org", 
    "region": "geographic-region",
    "description": "Node description",
    "tags": ["tag1", "tag2"]
  }
}
```

### Handler Configuration
```json
{
  "handlers": {
    "handler-name": {
      "command": "executable command",
      "description": "Human-readable description",
      "enabled": true,
      "resources": {
        "timeout": 300,
        "maxConcurrent": 2,
        "memoryMB": 1024
      },
      "env": {
        "ENV_VAR": "value"
      }
    }
  }
}
```

### Resource Limits
```json
{
  "limits": {
    "maxCpuPercent": 80,
    "maxRamPercent": 70, 
    "maxConcurrentJobs": 3,
    "maxFileSizeMB": 100
  }
}
```

### Monitoring Setup
```json
{
  "monitoring": {
    "enabled": true,
    "metricsPort": 9090,
    "alerting": {
      "webhookUrl": "https://hooks.slack.com/...",
      "thresholds": {
        "cpuPercent": 90,
        "memoryPercent": 85
      }
    }
  }
}
```

## Environment Variables

Many configuration values can be overridden with environment variables:

```bash
# Node identification
export IC_NODE_NAME="my-node"
export IC_NODE_OWNER="my-name"
export IC_NODE_REGION="us-west-2"

# Server connection
export IC_SERVER_URL="https://moilol.com:8333"

# Resource limits
export IC_MAX_CPU_PERCENT="80"
export IC_MAX_RAM_PERCENT="70"
export IC_MAX_CONCURRENT_JOBS="5"

# GPU settings (for GPU configs)
export CUDA_VISIBLE_DEVICES="0,1"
export PYTORCH_CUDA_ALLOC_CONF="max_split_size_mb:512"

# Monitoring
export IC_METRICS_PORT="9090"
export IC_ALERT_WEBHOOK_URL="https://hooks.slack.com/..."

# Start with environment variables
node client.js
```

## Validation and Testing

### Configuration Validation
```bash
# Validate syntax and required fields
node client.js --validate-config

# Test with dry-run mode  
node client.js --dry-run

# Check hardware compatibility
node scripts/hardware-check.js
```

### Handler Testing
```bash
# Test individual handlers
node client.js --test-handler transcribe

# Test all enabled handlers
node client.js --test-all-handlers

# Performance benchmark
node scripts/performance-benchmark.js
```

### Pre-deployment Checks
```bash
# Complete system check
node scripts/health-check.js --full

# Network connectivity test
node scripts/network-test.js

# Resource availability check
node scripts/resource-check.js
```

## Common Configurations

### Minimal CPU-only Node
```json
{
  "handlers": {
    "transcribe": {
      "enabled": true,
      "env": { "WHISPER_MODEL": "tiny", "WHISPER_DEVICE": "cpu" }
    }
  },
  "limits": {
    "maxCpuPercent": 70,
    "maxConcurrentJobs": 1
  }
}
```

### Balanced Multi-service Node
```json
{
  "handlers": {
    "transcribe": { "enabled": true, "resources": { "maxConcurrent": 2 } },
    "inference": { "enabled": true, "resources": { "maxConcurrent": 2 } },
    "ffmpeg": { "enabled": true, "resources": { "maxConcurrent": 1 } }
  },
  "limits": {
    "maxCpuPercent": 85,
    "maxConcurrentJobs": 4
  }
}
```

### GPU-only High-performance Node
```json
{
  "handlers": {
    "inference": {
      "enabled": true,
      "resources": { "requiresGPU": true, "maxConcurrent": 3 }
    },
    "generate-image": {
      "enabled": true, 
      "resources": { "requiresGPU": true, "maxConcurrent": 1 }
    }
  },
  "limits": {
    "maxGpuPercent": 90,
    "maxConcurrentJobs": 3
  }
}
```

## Migration Between Configs

### Development → Production
```bash
# 1. Backup current config
cp node-config.json node-config.dev.backup

# 2. Start with production template
cp configs/production.example.json node-config.json

# 3. Migrate custom settings
# - Copy handler customizations
# - Update resource limits for production hardware
# - Add monitoring and alerting configuration
# - Enable security features

# 4. Validate migration
node client.js --validate-config --compare node-config.dev.backup
```

### Adding GPU Support
```bash
# 1. Install GPU drivers and CUDA
nvidia-driver-install.sh

# 2. Update configuration  
# Add GPU-specific sections from gpu-optimized.example.json
# Enable GPU handlers
# Set GPU resource limits

# 3. Test GPU functionality
node client.js --test-gpu

# 4. Monitor GPU utilization
nvidia-smi -l 5
```

## Troubleshooting

### Common Issues

**"Handler not found" errors:**
- Check `command` paths are correct
- Verify executables have proper permissions
- Test handler commands manually

**Resource limit exceeded:**
- Adjust `limits` section for your hardware
- Reduce `maxConcurrent` values
- Increase timeout values for slow operations

**GPU not detected:**
- Verify NVIDIA drivers: `nvidia-smi`
- Check CUDA installation: `nvcc --version` 
- Set `CUDA_VISIBLE_DEVICES` properly

**Connection issues:**
- Verify `server.url` is correct
- Check firewall settings
- Test connectivity: `curl https://moilol.com:8333/status`

### Getting Help

1. **Validate your configuration:**
   ```bash
   node client.js --validate-config --verbose
   ```

2. **Check system compatibility:**
   ```bash
   node scripts/system-check.js
   ```

3. **Test individual components:**
   ```bash
   node client.js --test-handler [handler-name]
   ```

4. **Enable debug logging:**
   ```bash
   node client.js --log-level debug
   ```

5. **Review the troubleshooting guide:**
   ```bash
   cat TROUBLESHOOTING.md
   ```

---

**Need a custom configuration?** Start with the closest example and modify it for your specific needs. The configuration system is designed to be flexible and extensible.

**Found an issue?** Please report it in the IC Mesh repository with your configuration (redacted) and error logs.