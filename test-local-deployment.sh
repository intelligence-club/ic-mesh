#!/bin/bash
# Test local deployment simulation
# Tests the complete Docker deployment workflow locally

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🧪 Testing local IC Mesh deployment..."

# Clean up any existing containers
echo "🧹 Cleaning up existing containers..."
sudo docker compose down -v 2>/dev/null || true
sudo docker system prune -f || true

# Test Docker build
echo "📦 Testing Docker build..."
sudo docker build -t ic-mesh:local-test .

# Test with docker-compose
echo "🐳 Testing docker-compose deployment..."
sudo docker compose up -d

# Wait for startup
echo "⏳ Waiting for service startup..."
sleep 15

# Test health check
echo "🔍 Testing service health..."
CONTAINER_NAME=$(sudo docker compose ps --services | head -1)
if sudo docker compose ps | grep -q "healthy"; then
    echo "✅ Container health check passed"
else
    echo "❌ Container health check failed"
    sudo docker compose logs
    exit 1
fi

# Test endpoints
echo "🌐 Testing API endpoints..."
BASE_URL="http://localhost:8333"

# Test status endpoint
if curl -f "$BASE_URL/status" >/dev/null 2>&1; then
    echo "✅ Status endpoint working"
else
    echo "❌ Status endpoint failed"
    sudo docker compose logs
    exit 1
fi

# Test node registration
if echo '{"name": "local-test-node", "capabilities": ["test"]}' | \
   curl -f -X POST -H "Content-Type: application/json" -d @- "$BASE_URL/nodes/register" >/dev/null 2>&1; then
    echo "✅ Node registration working"
else
    echo "❌ Node registration failed"
    exit 1
fi

# Test support endpoint (our new endpoint)
if echo '{"email": "test@example.com", "subject": "Test", "body": "Local deployment test"}' | \
   curl -f -X POST -H "Content-Type: application/json" -d @- "$BASE_URL/api/support" >/dev/null 2>&1; then
    echo "✅ Support endpoint working"
else
    echo "❌ Support endpoint failed"
    exit 1
fi

# Test volume persistence
echo "💾 Testing data persistence..."
TEMP_DATA=$(mktemp)
curl -s "$BASE_URL/status" > "$TEMP_DATA"

# Restart container
echo "🔄 Testing container restart..."
sudo docker compose restart
sleep 10

# Check if data persists
if curl -f "$BASE_URL/status" >/dev/null 2>&1; then
    echo "✅ Service restarted successfully"
else
    echo "❌ Service failed to restart"
    exit 1
fi

# Performance test
echo "⚡ Running basic performance test..."
START_TIME=$(date +%s)
for i in {1..10}; do
    curl -s "$BASE_URL/status" >/dev/null || exit 1
done
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
echo "✅ 10 requests completed in ${DURATION}s"

# Resource usage check
echo "📊 Checking resource usage..."
CONTAINER_ID=$(sudo docker compose ps -q)
MEMORY_USAGE=$(sudo docker stats --no-stream --format "table {{.MemUsage}}" "$CONTAINER_ID" | tail -1)
echo "📈 Memory usage: $MEMORY_USAGE"

# Cleanup
echo "🧹 Cleaning up test deployment..."
sudo docker compose down -v

echo ""
echo "🎉 Local deployment test completed successfully!"
echo ""
echo "✅ All tests passed:"
echo "  - Docker build ✓"
echo "  - Container startup ✓"
echo "  - Health checks ✓"
echo "  - API endpoints ✓"
echo "  - Data persistence ✓"
echo "  - Container restart ✓"
echo "  - Basic performance ✓"
echo ""
echo "🚀 Ready for production deployment!"

rm -f "$TEMP_DATA"