#!/bin/bash

# Quick Operational Dashboard for IC Mesh
# Provides at-a-glance service status for work pulse monitoring

echo "🚀 IC Mesh Quick Dashboard"
echo "══════════════════════════════════════"
echo "⏰ $(date -u)"
echo ""

# Service Status
echo "🌐 Service Status:"
curl -s http://localhost:8333/status | jq -r '
  "   Network: " + .status + " | Nodes: " + (.nodes.active | tostring) + "/" + (.nodes.total | tostring) + 
  " | Jobs: " + (.jobs.pending | tostring) + " pending, " + (.jobs.completed | tostring) + " completed"
'

# Quick Node Analysis
echo ""
echo "🖥️  Node Status:"
if command -v node >/dev/null 2>&1; then
    node -e "
    const Database = require('better-sqlite3');
    const db = new Database('./data/mesh.db');
    
    const nodes = db.prepare('SELECT nodeId, name, jobsCompleted, datetime(lastSeen/1000, \"unixepoch\") as lastSeen FROM nodes ORDER BY lastSeen DESC').all();
    
    nodes.forEach(node => {
        const minutesAgo = Math.round((Date.now() - node.lastSeen) / (1000 * 60));
        const status = minutesAgo < 5 ? '🟢' : minutesAgo < 30 ? '🟡' : '🔴';
        const name = node.name.padEnd(8);
        const id = node.nodeId.slice(0, 8);
        const jobs = node.jobsCompleted.toString().padStart(3);
        console.log(\`   \${status} \${name} (\${id}) | \${jobs} jobs | \${minutesAgo}m ago\`);
    });
    
    db.close();
    " 2>/dev/null || echo "   ❌ Node analysis unavailable (database error)"
fi

# Revenue Status
echo ""
echo "💰 Revenue Status:"
if command -v node >/dev/null 2>&1; then
    node -e "
    const Database = require('better-sqlite3');
    const db = new Database('./data/mesh.db');
    
    const pending = db.prepare('SELECT type, COUNT(*) as count FROM jobs WHERE status = \"pending\" GROUP BY type').all();
    let totalRevenue = 0;
    
    pending.forEach(job => {
        const rate = job.type === 'transcribe' ? 0.5 : 0.8; // Rough revenue estimates
        const revenue = job.count * rate;
        totalRevenue += revenue;
        console.log(\`   \${job.type.padEnd(12)}: \${job.count.toString().padStart(2)} jobs (~$\${revenue.toFixed(2)})\`);
    });
    
    if (pending.length > 0) {
        console.log(\`   Total blocked revenue: ~$\${totalRevenue.toFixed(2)}\`);
    } else {
        console.log('   ✅ No jobs pending - all capacity utilized');
    }
    
    db.close();
    " 2>/dev/null || echo "   ❌ Revenue analysis unavailable"
fi

# Unnamed Node Pattern (if available)
echo ""
echo "📊 Unnamed Node Prediction:"
if [ -f scripts/unnamed-node-pattern-tracker.js ]; then
    node scripts/unnamed-node-pattern-tracker.js 2>/dev/null | grep -E "(Current offline time|Prediction|Impact)" | sed 's/^/   /'
else
    echo "   ❌ Pattern tracker not available"
fi

echo ""
echo "🔧 Quick Commands:"
echo "   npm run status  - Full status"
echo "   npm run health  - JSON health data" 
echo "   npm test        - Run test suite"
echo "   node scripts/unnamed-node-pattern-tracker.js  - Pattern analysis"