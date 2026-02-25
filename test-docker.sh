#!/bin/bash
# Test Docker deployment locally before pushing to remote servers

set -e

echo "🐳 Testing IC Mesh Docker deployment..."

# Build the image
echo "📦 Building Docker image..."
docker build -t ic-mesh:test .

# Run container
echo "🚀 Starting container..."
docker run -d --name ic-mesh-test -p 8334:8333 ic-mesh:test

# Wait for startup
echo "⏳ Waiting for service to start..."
sleep 10

# Test basic endpoints
echo "🔍 Testing endpoints..."
if curl -f http://localhost:8334/status > /dev/null 2>&1; then
  echo "✅ /status endpoint working"
else
  echo "❌ /status endpoint failed"
  docker logs ic-mesh-test
  docker rm -f ic-mesh-test
  exit 1
fi

# Test WebSocket (basic)
if curl -f -H "Upgrade: websocket" -H "Connection: Upgrade" http://localhost:8334/ws > /dev/null 2>&1; then
  echo "✅ WebSocket endpoint accessible"
else
  echo "⚠️  WebSocket endpoint test inconclusive (expected for HTTP client)"
fi

# Test a POST endpoint
echo '{"name": "test-node", "capabilities": ["test"]}' | \
  curl -f -X POST -H "Content-Type: application/json" -d @- http://localhost:8334/nodes/register > /dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "✅ POST /nodes/register working"
else
  echo "❌ POST /nodes/register failed"
  docker logs ic-mesh-test
  docker rm -f ic-mesh-test
  exit 1
fi

# Test support endpoint
echo '{"email": "test@example.com", "subject": "Test", "body": "Docker test"}' | \
  curl -f -X POST -H "Content-Type: application/json" -d @- http://localhost:8334/support > /dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "✅ POST /support working"
else
  echo "❌ POST /support failed"
  docker logs ic-mesh-test
  docker rm -f ic-mesh-test
  exit 1
fi

# Check logs for errors
echo "📄 Checking logs for errors..."
if docker logs ic-mesh-test 2>&1 | grep -q "ERROR\|Error\|error"; then
  echo "⚠️  Found potential errors in logs:"
  docker logs ic-mesh-test | grep -i error
else
  echo "✅ No obvious errors in logs"
fi

# Cleanup
echo "🧹 Cleaning up..."
docker rm -f ic-mesh-test

echo "🎉 Docker deployment test completed successfully!"
echo ""
echo "🚀 To deploy with docker-compose:"
echo "   docker-compose up -d"
echo ""
echo "📊 To deploy to remote server:"
echo "   1. scp docker-compose.yml user@server:~/ic-mesh/"
echo "   2. ssh user@server"
echo "   3. cd ic-mesh && docker-compose up -d"