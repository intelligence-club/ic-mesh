# IC Mesh Deployment Configuration Examples

**Real-world deployment configurations for different scenarios and platforms**

---

## Quick Start Configurations

### 1. Home Server Setup (Raspberry Pi / Mini PC)
```bash
# .env configuration for home deployment
IC_MESH_HUB=https://moilol.com/mesh
IC_NODE_NAME=home-pi-whisper
IC_NODE_OWNER=operator@email.com
IC_CAPABILITIES=whisper,ffmpeg
IC_MAX_CONCURRENT_JOBS=2
IC_RESOURCE_LIMITS='{"memory": "2GB", "cpu": "80%"}'
IC_WORK_DIR=/home/pi/ic-mesh-work
IC_LOG_LEVEL=info
IC_AUTO_RESTART=true
IC_UPDATE_CHECK_INTERVAL=3600000
```

**Startup script (`home-server-start.sh`):**
```bash
#!/bin/bash
# Home server startup for IC Mesh node
cd /opt/ic-mesh
source .env

# Check system resources
echo "🏠 Starting home IC Mesh node..."
echo "Available RAM: $(free -h | grep Mem | awk '{print $7}')"
echo "Available storage: $(df -h /home | tail -1 | awk '{print $4}')"

# Start with resource monitoring
NODE_ENV=production \
PROCESS_PRIORITY=10 \
node client.js 2>&1 | tee logs/node-$(date +%Y%m%d).log
```

### 2. Cloud VPS Setup (DigitalOcean/AWS/GCP)
```bash
# .env configuration for cloud VPS
IC_MESH_HUB=https://moilol.com/mesh
IC_NODE_NAME=cloud-gpu-stable-diffusion
IC_NODE_OWNER=operator@email.com
IC_CAPABILITIES=stable-diffusion,gpu-metal,transcribe
IC_MAX_CONCURRENT_JOBS=8
IC_RESOURCE_LIMITS='{"memory": "16GB", "cpu": "90%", "gpu": "100%"}'
IC_WORK_DIR=/var/lib/ic-mesh
IC_LOG_LEVEL=info
IC_METRICS_ENABLED=true
IC_HEALTH_CHECK_PORT=9090
IC_AUTO_SCALE_ENABLED=true
```

**systemd service (`/etc/systemd/system/ic-mesh.service`):**
```ini
[Unit]
Description=IC Mesh Network Node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ic-mesh
Group=ic-mesh
WorkingDirectory=/opt/ic-mesh
Environment=NODE_ENV=production
EnvironmentFile=/opt/ic-mesh/.env
ExecStart=/usr/bin/node client.js
ExecReload=/bin/kill -HUP $MAINPID
Restart=always
RestartSec=10
StandardOutput=append:/var/log/ic-mesh/node.log
StandardError=append:/var/log/ic-mesh/node.error.log

# Resource limits for production
LimitNOFILE=65536
LimitNPROC=4096
MemoryLimit=16G

[Install]
WantedBy=multi-user.target
```

### 3. Docker Deployment
```yaml
# docker-compose.yml for containerized deployment
version: '3.8'

services:
  ic-mesh-node:
    image: ghcr.io/intelligence-club/ic-mesh:latest
    container_name: ic-mesh-node
    restart: unless-stopped
    
    environment:
      - IC_MESH_HUB=https://moilol.com/mesh
      - IC_NODE_NAME=docker-whisper-${HOSTNAME}
      - IC_NODE_OWNER=operator@email.com
      - IC_CAPABILITIES=whisper,ffmpeg,transcribe
      - IC_MAX_CONCURRENT_JOBS=4
      - NODE_ENV=production
    
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
      - /tmp:/tmp:rw
    
    ports:
      - "9090:9090"  # Health check port
    
    deploy:
      resources:
        limits:
          cpus: '4.0'
          memory: 8G
        reservations:
          cpus: '1.0'
          memory: 2G
    
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9090/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # Optional: monitoring stack
  node-exporter:
    image: prom/node-exporter:latest
    container_name: node-exporter
    restart: unless-stopped
    ports:
      - "9100:9100"
    command:
      - '--path.rootfs=/host'
    volumes:
      - '/:/host:ro,rslave'
```

### 4. Kubernetes Deployment
```yaml
# k8s-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ic-mesh-node
  namespace: ic-mesh
  labels:
    app: ic-mesh-node
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ic-mesh-node
  template:
    metadata:
      labels:
        app: ic-mesh-node
    spec:
      containers:
      - name: ic-mesh-node
        image: ghcr.io/intelligence-club/ic-mesh:latest
        ports:
        - containerPort: 9090
        env:
        - name: IC_MESH_HUB
          value: "https://moilol.com/mesh"
        - name: IC_NODE_NAME
          value: "k8s-cluster-node"
        - name: IC_NODE_OWNER
          valueFrom:
            secretKeyRef:
              name: ic-mesh-secrets
              key: node-owner-email
        - name: IC_CAPABILITIES
          value: "whisper,transcribe,gpu-metal"
        - name: NODE_ENV
          value: "production"
        
        resources:
          limits:
            memory: "8Gi"
            cpu: "4000m"
            nvidia.com/gpu: 1
          requests:
            memory: "2Gi"
            cpu: "1000m"
        
        volumeMounts:
        - name: work-storage
          mountPath: /app/data
        - name: temp-storage
          mountPath: /tmp
        
        livenessProbe:
          httpGet:
            path: /health
            port: 9090
          initialDelaySeconds: 60
          periodSeconds: 30
        
        readinessProbe:
          httpGet:
            path: /ready
            port: 9090
          initialDelaySeconds: 30
          periodSeconds: 10
      
      volumes:
      - name: work-storage
        persistentVolumeClaim:
          claimName: ic-mesh-pvc
      - name: temp-storage
        emptyDir:
          sizeLimit: 10Gi

---
apiVersion: v1
kind: Service
metadata:
  name: ic-mesh-service
  namespace: ic-mesh
spec:
  selector:
    app: ic-mesh-node
  ports:
    - protocol: TCP
      port: 9090
      targetPort: 9090
  type: ClusterIP
```

---

## Platform-Specific Configurations

### AWS EC2 with GPU (p3.2xlarge)
```bash
# Optimized for AWS GPU instances
IC_MESH_HUB=https://moilol.com/mesh
IC_NODE_NAME=aws-p3-${EC2_INSTANCE_ID}
IC_NODE_OWNER=operator@email.com
IC_CAPABILITIES=stable-diffusion,gpu-metal,machine-learning,transcribe
IC_MAX_CONCURRENT_JOBS=12
IC_RESOURCE_LIMITS='{"memory": "60GB", "cpu": "95%", "gpu": "100%"}'

# AWS-specific optimizations
IC_INSTANCE_TYPE=p3.2xlarge
IC_AVAILABILITY_ZONE=${EC2_AVAILABILITY_ZONE}
IC_SPOT_INSTANCE=true
IC_AUTO_SCALE_GROUP=ic-mesh-gpu-nodes

# EBS optimized storage
IC_WORK_DIR=/mnt/ebs-ssd/ic-mesh
IC_TEMP_DIR=/mnt/instance-store/tmp
IC_LOG_DIR=/var/log/ic-mesh

# CloudWatch integration
IC_CLOUDWATCH_ENABLED=true
IC_CLOUDWATCH_NAMESPACE=ICMesh/Nodes
IC_CLOUDWATCH_REGION=${AWS_REGION}
```

**User data script for EC2 launch:**
```bash
#!/bin/bash
# EC2 user data for IC Mesh node setup

# Install dependencies
yum update -y
yum install -y docker git curl nodejs npm

# Setup NVIDIA drivers for GPU instances
if lspci | grep -i nvidia; then
    yum install -y nvidia-driver nvidia-docker2
    systemctl restart docker
fi

# Setup IC Mesh
git clone https://github.com/intelligence-club/ic-mesh.git /opt/ic-mesh
cd /opt/ic-mesh
npm install --production

# Configure environment
cat > .env << EOF
IC_MESH_HUB=https://moilol.com/mesh
IC_NODE_NAME=aws-$(ec2-metadata --instance-id | cut -d' ' -f2)
IC_NODE_OWNER=${NODE_OWNER_EMAIL}
IC_CAPABILITIES=stable-diffusion,transcribe,gpu-metal
NODE_ENV=production
EOF

# Start service
systemctl enable ic-mesh
systemctl start ic-mesh

# Send success notification
aws sns publish --region ${AWS_REGION} --topic-arn ${SNS_TOPIC} --message "IC Mesh node started on $(hostname)"
```

### Google Cloud Platform with TPU
```bash
# GCP-specific configuration
IC_MESH_HUB=https://moilol.com/mesh
IC_NODE_NAME=gcp-tpu-${GCE_INSTANCE_NAME}
IC_NODE_OWNER=operator@email.com
IC_CAPABILITIES=machine-learning,tpu-inference,transcribe
IC_MAX_CONCURRENT_JOBS=16

# TPU-specific settings
IC_TPU_NAME=${TPU_NAME}
IC_TPU_ZONE=${TPU_ZONE}
IC_TPU_VERSION=2.8.0

# GCP optimizations
IC_PREEMPTIBLE=true
IC_SUSTAINED_USE_DISCOUNT=true
IC_RESOURCE_MONITORING=true

# Stackdriver integration
IC_STACKDRIVER_ENABLED=true
IC_STACKDRIVER_PROJECT=${GCP_PROJECT_ID}
```

### Azure VM with FPGA
```bash
# Azure-specific configuration
IC_MESH_HUB=https://moilol.com/mesh
IC_NODE_NAME=azure-fpga-${AZURE_VM_NAME}
IC_NODE_OWNER=operator@email.com
IC_CAPABILITIES=fpga-acceleration,transcribe,custom-inference
IC_MAX_CONCURRENT_JOBS=8

# FPGA-specific settings
IC_FPGA_ENABLED=true
IC_FPGA_BITSTREAM_PATH=/opt/fpga/bitstreams
IC_FPGA_OPTIMIZATION_LEVEL=3

# Azure monitoring
IC_AZURE_MONITOR_ENABLED=true
IC_AZURE_WORKSPACE_ID=${AZURE_WORKSPACE_ID}
```

---

## Hardware-Optimized Configurations

### Apple Silicon (M1/M2/M3 Mac)
```bash
# Optimized for Apple Silicon Macs
IC_MESH_HUB=https://moilol.com/mesh
IC_NODE_NAME=apple-silicon-${HOSTNAME}
IC_NODE_OWNER=operator@email.com
IC_CAPABILITIES=gpu-metal,transcribe,stable-diffusion,machine-learning
IC_MAX_CONCURRENT_JOBS=6

# Metal Performance Shaders optimization
IC_METAL_ENABLED=true
IC_METAL_GPU_FAMILY=apple8  # For M3, adjust for M1/M2
IC_UNIFIED_MEMORY=true
IC_MEMORY_EFFICIENCY_MODE=true

# macOS-specific paths
IC_WORK_DIR=/Users/$(whoami)/Library/Application\ Support/ICMesh
IC_LOG_DIR=/Users/$(whoami)/Library/Logs/ICMesh
IC_MODELS_DIR=/Users/$(whoami)/.cache/ic-mesh-models

# Power management
IC_THERMAL_MANAGEMENT=true
IC_BATTERY_AWARE=true
IC_SLEEP_PREVENTION=true
```

### NVIDIA GPU Workstation
```bash
# High-end NVIDIA GPU setup
IC_MESH_HUB=https://moilol.com/mesh
IC_NODE_NAME=nvidia-workstation-${HOSTNAME}
IC_NODE_OWNER=operator@email.com
IC_CAPABILITIES=stable-diffusion,gpu-compute,machine-learning,transcribe
IC_MAX_CONCURRENT_JOBS=20

# NVIDIA-specific optimizations
IC_CUDA_VISIBLE_DEVICES=0,1,2,3  # Multiple GPUs
IC_NVIDIA_MPS_ENABLED=true       # Multi-Process Service
IC_GPU_MEMORY_FRACTION=0.9
IC_MIXED_PRECISION=true

# Performance tuning
IC_TENSORRT_ENABLED=true
IC_CUDNN_BENCHMARK=true
IC_GPU_MEMORY_GROWTH=true

# Cooling and power
IC_FAN_CURVE=performance
IC_POWER_LIMIT=400W
IC_TEMPERATURE_LIMIT=83
```

### AMD GPU Setup
```bash
# AMD ROCm configuration
IC_MESH_HUB=https://moilol.com/mesh
IC_NODE_NAME=amd-rocm-${HOSTNAME}
IC_NODE_OWNER=operator@email.com
IC_CAPABILITIES=gpu-compute,machine-learning,transcribe
IC_MAX_CONCURRENT_JOBS=8

# ROCm-specific settings
IC_ROCR_VISIBLE_DEVICES=0,1
IC_HSA_OVERRIDE_GFX_VERSION=10.3.0
IC_ROCM_PATH=/opt/rocm
IC_HIP_PLATFORM=amd

# Performance optimization
IC_ROCBLAS_TENSILE_LIBPATH=/opt/rocm/rocblas/lib/library
IC_MIOPEN_USER_DB_PATH=/tmp/miopen-cache
IC_MIOPEN_FIND_MODE=1
```

---

## Security-Hardened Configurations

### Production Security Setup
```bash
# Security-hardened configuration
IC_MESH_HUB=https://moilol.com/mesh
IC_NODE_NAME=secure-prod-${RANDOM_ID}
IC_NODE_OWNER=operator@company.com

# Security settings
IC_TLS_ENABLED=true
IC_TLS_CERT_PATH=/etc/ssl/certs/ic-mesh.crt
IC_TLS_KEY_PATH=/etc/ssl/private/ic-mesh.key
IC_ALLOWED_ORIGINS=https://moilol.com
IC_RATE_LIMIT=1000  # requests per hour
IC_MAX_FILE_SIZE=100MB
IC_SANDBOX_ENABLED=true
IC_NETWORK_ISOLATION=true

# Authentication
IC_API_KEY_REQUIRED=true
IC_JWT_SECRET=${JWT_SECRET_FROM_VAULT}
IC_SESSION_TIMEOUT=3600000

# Audit logging
IC_AUDIT_LOG_ENABLED=true
IC_AUDIT_LOG_PATH=/var/log/ic-mesh/audit.log
IC_SECURITY_EVENTS_WEBHOOK=${SECURITY_WEBHOOK_URL}

# Resource limits for security
IC_MAX_PROCESS_TIME=300000  # 5 minutes max per job
IC_MAX_MEMORY_PER_JOB=4GB
IC_BLOCKED_EXTENSIONS=.exe,.bat,.ps1,.sh
```

### Corporate Firewall Setup
```bash
# Corporate network configuration
IC_MESH_HUB=https://moilol.com/mesh
IC_NODE_NAME=corp-${DEPARTMENT}-${HOSTNAME}
IC_NODE_OWNER=it-admin@company.com

# Proxy settings
IC_HTTP_PROXY=http://proxy.company.com:8080
IC_HTTPS_PROXY=http://proxy.company.com:8080
IC_NO_PROXY=localhost,127.0.0.1,*.company.com

# Certificate authority
IC_CA_BUNDLE_PATH=/etc/ssl/certs/company-ca-bundle.crt
IC_SSL_VERIFY_PEER=true
IC_SSL_VERIFY_HOST=true

# Network restrictions
IC_ALLOWED_DOMAINS=moilol.com,*.intelligence-club.com
IC_BLOCKED_PORTS=22,23,135,139,445
IC_EGRESS_WHITELIST=true
```

---

## Development and Testing Configurations

### Local Development
```bash
# Development environment
IC_MESH_HUB=http://localhost:8333  # Local test hub
IC_NODE_NAME=dev-${USER}-${HOSTNAME}
IC_NODE_OWNER=developer@email.com
IC_CAPABILITIES=transcribe,test-capability
IC_MAX_CONCURRENT_JOBS=2

# Development settings
NODE_ENV=development
IC_DEBUG=true
IC_LOG_LEVEL=debug
IC_HOT_RELOAD=true
IC_MOCK_JOBS=true
IC_TEST_MODE=true

# Fast iteration
IC_SKIP_CAPABILITY_CHECK=true
IC_DISABLE_AUTH=true
IC_SHORT_TIMEOUTS=true
```

### CI/CD Pipeline
```yaml
# .github/workflows/test-node.yml
name: Test IC Mesh Node
on: [push, pull_request]

jobs:
  test-deployment:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]
        config: [minimal, standard, gpu-sim]
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: ${{ matrix.node-version }}
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Configure test environment
      run: |
        cp examples/configs/ci-${{ matrix.config }}.env .env
        mkdir -p data logs
    
    - name: Run integration tests
      env:
        IC_TEST_CONFIG: ${{ matrix.config }}
        CI: true
      run: |
        npm run test:ci
        npm run health:regenerative
    
    - name: Upload test results
      uses: actions/upload-artifact@v3
      if: always()
      with:
        name: test-results-${{ matrix.config }}
        path: |
          logs/
          data/test-results.json
```

---

## Monitoring and Observability

### Prometheus + Grafana
```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'ic-mesh-nodes'
    static_configs:
      - targets: ['localhost:9090']
    scrape_interval: 30s
    metrics_path: /metrics
    
  - job_name: 'ic-mesh-regenerative'
    static_configs:
      - targets: ['localhost:9091']
    scrape_interval: 60s
    metrics_path: /health/regenerative/prometheus
```

### ELK Stack Integration
```bash
# Filebeat configuration for log shipping
filebeat.inputs:
- type: log
  enabled: true
  paths:
    - /var/log/ic-mesh/*.log
  fields:
    service: ic-mesh-node
    environment: production
  multiline.pattern: '^\d{4}-\d{2}-\d{2}'
  multiline.negate: true
  multiline.match: after

output.elasticsearch:
  hosts: ["elasticsearch:9200"]
  index: "ic-mesh-%{+yyyy.MM.dd}"
  template.settings:
    index.number_of_shards: 1
    index.number_of_replicas: 0
```

---

## Troubleshooting Common Configurations

### Debug Mode Setup
```bash
# Maximum debugging configuration
IC_MESH_HUB=https://moilol.com/mesh
IC_NODE_NAME=debug-${HOSTNAME}-${TIMESTAMP}
IC_NODE_OWNER=debug@email.com

# Debug settings
NODE_ENV=development
DEBUG=*
IC_LOG_LEVEL=trace
IC_VERBOSE=true
IC_CAPABILITY_CHECK_TIMEOUT=30000
IC_JOB_TIMEOUT=600000
IC_HEARTBEAT_INTERVAL=5000

# Debug outputs
IC_DEBUG_JOB_DATA=true
IC_DEBUG_NETWORK_CALLS=true
IC_DEBUG_CAPABILITIES=true
IC_SAVE_DEBUG_SNAPSHOTS=true
IC_DEBUG_SNAPSHOT_PATH=/tmp/ic-mesh-debug
```

### Network Diagnostic Mode
```bash
# Network connectivity testing
IC_NETWORK_DIAGNOSTIC_MODE=true
IC_PING_TEST_HOSTS=8.8.8.8,moilol.com
IC_BANDWIDTH_TEST=true
IC_LATENCY_MONITORING=true
IC_CONNECTION_RETRY_ATTEMPTS=10
IC_CONNECTION_RETRY_DELAY=5000
IC_NETWORK_TIMEOUT=30000
```

---

## Configuration Management

### Using Configuration Files
```json
// config/production.json
{
  "meshHub": "https://moilol.com/mesh",
  "node": {
    "name": "prod-node-${HOSTNAME}",
    "owner": "${NODE_OWNER_EMAIL}",
    "capabilities": ["transcribe", "stable-diffusion"],
    "maxConcurrentJobs": 8,
    "resourceLimits": {
      "memory": "16GB",
      "cpu": "90%"
    }
  },
  "logging": {
    "level": "info",
    "file": "/var/log/ic-mesh/node.log",
    "rotation": "daily",
    "maxFiles": 30
  },
  "monitoring": {
    "enabled": true,
    "healthCheckPort": 9090,
    "metricsInterval": 60000
  },
  "security": {
    "tlsEnabled": true,
    "rateLimitPerHour": 1000,
    "maxFileSize": "100MB"
  }
}
```

### Environment Variable Validation
```bash
#!/bin/bash
# validate-config.sh - Configuration validation script

echo "🔍 Validating IC Mesh node configuration..."

# Required variables
REQUIRED_VARS=(
    "IC_MESH_HUB"
    "IC_NODE_NAME" 
    "IC_NODE_OWNER"
)

MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!var}" ]]; then
        MISSING_VARS+=("$var")
    fi
done

if [[ ${#MISSING_VARS[@]} -gt 0 ]]; then
    echo "❌ Missing required environment variables:"
    printf '   %s\n' "${MISSING_VARS[@]}"
    exit 1
fi

# Validate mesh hub URL
if ! curl -sSf "${IC_MESH_HUB}/status" > /dev/null; then
    echo "❌ Cannot connect to mesh hub: ${IC_MESH_HUB}"
    exit 1
fi

# Validate email format
if [[ ! "${IC_NODE_OWNER}" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
    echo "❌ Invalid email format: ${IC_NODE_OWNER}"
    exit 1
fi

echo "✅ Configuration validation passed"
```

---

This comprehensive deployment configuration guide provides real-world examples for deploying IC Mesh nodes across different platforms, environments, and use cases. Choose the configuration that best matches your deployment scenario and customize as needed.

**Next steps:**
1. Copy the appropriate configuration for your platform
2. Customize the environment variables for your specific setup
3. Test the configuration in a development environment first
4. Deploy to production with monitoring enabled
5. Document any custom modifications for your team

**Need help?** Check the [troubleshooting section](../TROUBLESHOOTING.md) or join the [Intelligence Club Discord](https://discord.gg/intelligence-club).