#!/bin/bash
# health-check.sh - Quick IC Mesh development health check

set -e

echo "🔍 IC Mesh Development Health Check"
echo "=================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Not in IC Mesh root directory"
    exit 1
fi

echo "📁 Working directory: $(pwd)"
echo ""

# Check Node.js version
echo "🟢 Node.js version:"
node --version
echo ""

# Check dependencies
echo "📦 Checking dependencies..."
if npm list --depth=0 > /dev/null 2>&1; then
    echo "✅ All dependencies installed"
else
    echo "⚠️  Some dependencies missing - run 'npm install'"
fi
echo ""

# Check environment file
echo "🔧 Environment configuration:"
if [ -f ".env" ]; then
    echo "✅ .env file exists"
    env_vars=$(grep -c "^[^#]" .env || echo "0")
    echo "   📊 Contains $env_vars environment variables"
else
    echo "⚠️  No .env file found"
    if [ -f ".env.example" ]; then
        echo "   💡 Copy .env.example to .env to get started"
    fi
fi
echo ""

# Run tests
echo "🧪 Running test suite..."
if npm test > /dev/null 2>&1; then
    test_count=$(npm test 2>/dev/null | grep -o "[0-9]\+ passed" | head -1 | cut -d' ' -f1)
    echo "✅ All tests passing ($test_count tests)"
else
    echo "❌ Some tests failing - run 'npm test' for details"
fi
echo ""

# Check git status
echo "📝 Git status:"
if git status --porcelain | grep -q .; then
    uncommitted=$(git status --porcelain | wc -l)
    echo "⚠️  $uncommitted uncommitted changes"
    echo "   💡 Run 'git status' to see details"
else
    echo "✅ Working directory clean"
fi

# Check if we're ahead/behind remote
if git remote > /dev/null 2>&1; then
    ahead=$(git rev-list --count HEAD ^origin/main 2>/dev/null || echo "0")
    behind=$(git rev-list --count origin/main ^HEAD 2>/dev/null || echo "0")
    
    if [ "$ahead" -gt 0 ]; then
        echo "   📤 $ahead commits ahead of remote"
    fi
    if [ "$behind" -gt 0 ]; then
        echo "   📥 $behind commits behind remote"
    fi
    if [ "$ahead" -eq 0 ] && [ "$behind" -eq 0 ]; then
        echo "   🔄 Up to date with remote"
    fi
fi
echo ""

# Check if server is running
echo "🌐 Server status:"
if pgrep -f "node.*app.js" > /dev/null; then
    echo "✅ IC Mesh server appears to be running"
    # Try to hit the health endpoint if possible
    if command -v curl > /dev/null; then
        if curl -s http://localhost:3344/status > /dev/null 2>&1; then
            echo "   🚀 Health endpoint responding"
        else
            echo "   ⚠️  Server process found but health endpoint not responding"
        fi
    fi
else
    echo "🔴 IC Mesh server not running"
    echo "   💡 Run 'npm start' to start the server"
fi
echo ""

echo "✨ Health check complete!"
echo ""
echo "📋 Quick commands:"
echo "   npm install     - Install dependencies"
echo "   npm test        - Run test suite"  
echo "   npm start       - Start development server"
echo "   git status      - Check git status"
echo "   git push        - Push commits to remote"