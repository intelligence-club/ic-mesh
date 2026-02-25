#!/bin/bash
# IC Mesh Cluster Deployment Script
# 
# Deploys IC Mesh to remote servers via SSH
# Handles Docker setup, user permissions, and service startup

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_PORT=8333
DEFAULT_USER="root"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

usage() {
    echo "Usage: $0 [OPTIONS] HOST..."
    echo ""
    echo "Deploy IC Mesh to remote servers"
    echo ""
    echo "OPTIONS:"
    echo "  -u USER     SSH user (default: root)"
    echo "  -p PORT     Service port (default: 8333)"
    echo "  -k KEY      SSH key file"
    echo "  -e ENV      Environment file (.env)"
    echo "  -h          Show this help"
    echo ""
    echo "EXAMPLES:"
    echo "  $0 server1.example.com"
    echo "  $0 -u ubuntu -k ~/.ssh/id_rsa server1 server2"
    echo "  $0 -e production.env 134.209.141.111"
    exit 1
}

log() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

# Parse command line arguments
USER="$DEFAULT_USER"
PORT="$DEFAULT_PORT"
SSH_KEY=""
ENV_FILE=""
HOSTS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--user)
            USER="$2"
            shift 2
            ;;
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -k|--key)
            SSH_KEY="-i $2"
            shift 2
            ;;
        -e|--env)
            ENV_FILE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        -*)
            error "Unknown option $1"
            usage
            ;;
        *)
            HOSTS+=("$1")
            shift
            ;;
    esac
done

if [ ${#HOSTS[@]} -eq 0 ]; then
    error "No hosts specified"
    usage
fi

log "Starting IC Mesh cluster deployment..."
log "Targets: ${HOSTS[*]}"
log "User: $USER"
log "Port: $PORT"

# Prepare deployment package
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

log "Preparing deployment package..."
rsync -av \
    --exclude='node_modules' \
    --exclude='data' \
    --exclude='.git' \
    --exclude='*.log' \
    "$SCRIPT_DIR/" "$TEMP_DIR/"

# Copy environment file if specified
if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "$TEMP_DIR/.env"
    log "Added environment file: $ENV_FILE"
fi

# Deploy to each host
for HOST in "${HOSTS[@]}"; do
    log "Deploying to $HOST..."
    
    # Test SSH connection
    if ! ssh $SSH_KEY -o ConnectTimeout=5 "$USER@$HOST" "echo 'SSH connection test'" >/dev/null 2>&1; then
        error "Cannot connect to $HOST via SSH"
        continue
    fi
    
    # Copy files
    log "Copying files to $HOST..."
    rsync -av --delete $SSH_KEY "$TEMP_DIR/" "$USER@$HOST:~/ic-mesh/"
    
    # Execute deployment on remote host
    ssh $SSH_KEY "$USER@$HOST" bash << EOF
set -e

echo "🔧 Setting up IC Mesh on \$(hostname)..."

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    systemctl enable docker
    systemctl start docker
fi

# Add user to docker group if not root
if [ "$USER" != "root" ]; then
    echo "👤 Adding $USER to docker group..."
    usermod -aG docker $USER || true
    newgrp docker || true
fi

# Stop any existing service
echo "🛑 Stopping existing services..."
cd ~/ic-mesh
if [ -f docker-compose.yml ]; then
    docker compose down || true
fi

# Update port in docker-compose if different from default
if [ "$PORT" != "$DEFAULT_PORT" ]; then
    echo "🔧 Updating port to $PORT..."
    sed -i "s/8333:8333/$PORT:8333/g" docker-compose.yml
fi

# Start service
echo "🚀 Starting IC Mesh service..."
docker compose up -d

# Show immediate status for debugging
echo "📊 Initial container status:"
docker compose ps

# Wait for service to start (Docker health check needs 40s start period)
echo "⏳ Waiting for service to start (this takes ~45 seconds)..."
sleep 45

# Test service with retry logic
echo "🔍 Checking service health..."
RETRY_COUNT=0
MAX_RETRIES=3

while [ \$RETRY_COUNT -lt \$MAX_RETRIES ]; do
    if docker compose ps | grep -q "Up.*healthy"; then
        echo "✅ Service is running and healthy"
        if curl -f http://localhost:$PORT/status >/dev/null 2>&1; then
            echo "✅ HTTP endpoint responding correctly"
            break
        else
            echo "⚠️  Service healthy but HTTP not responding, retrying..."
        fi
    else
        echo "⚠️  Service not yet healthy, retrying in 10 seconds..."
    fi
    
    RETRY_COUNT=\$((RETRY_COUNT + 1))
    if [ \$RETRY_COUNT -lt \$MAX_RETRIES ]; then
        sleep 10
    fi
done

if [ \$RETRY_COUNT -eq \$MAX_RETRIES ]; then
    echo "❌ Service failed to start after 65 seconds"
    echo "📋 Container status:"
    docker compose ps
    echo ""
    echo "📄 Recent logs:"
    docker compose logs --tail=20
    exit 1
fi

echo "🎉 Deployment completed successfully on \$(hostname)"
echo "📊 Dashboard: http://$HOST:$PORT/"
EOF
    
    if [ $? -eq 0 ]; then
        success "Deployed successfully to $HOST"
    else
        error "Deployment failed on $HOST"
    fi
done

log "Cluster deployment completed!"
log ""
log "🎯 Next Steps:"
log "1. Check service status: ssh $USER@HOST 'cd ic-mesh && docker compose ps'"
log "2. View logs: ssh $USER@HOST 'cd ic-mesh && docker compose logs'"
log "3. Access dashboard: http://HOST:$PORT/"
log ""
log "🔧 Management Commands:"
log "  Start:   docker compose up -d"
log "  Stop:    docker compose down"
log "  Restart: docker compose restart"
log "  Update:  docker compose pull && docker compose up -d"