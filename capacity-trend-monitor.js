#!/usr/bin/env node

/**
 * Capacity Trend Monitor
 * Advanced analytics for Intelligence Club Mesh capacity patterns
 * 
 * Features:
 * - Historical capacity trend analysis
 * - Node retention pattern detection
 * - Peak usage identification and forecasting
 * - Revenue impact analysis
 * - Predictive capacity planning
 * - Automated scaling recommendations
 */

const Database = require('better-sqlite3');
const fs = require('fs');

class CapacityTrendMonitor {
    constructor() {
        this.db = new Database('./data/mesh.db');
        this.config = {
            retentionCategories: {
                immediate: { min: 0, max: 5, description: 'Disconnects within 5 minutes' },
                short: { min: 5, max: 60, description: 'Disconnects within 1 hour' },
                medium: { min: 60, max: 1440, description: 'Stays 1-24 hours' },
                long: { min: 1440, max: 10080, description: 'Stays 1-7 days' },
                stable: { min: 10080, max: Infinity, description: 'Stays over 1 week' }
            },
            jobValueEstimates: {
                'transcribe': { min: 0.30, max: 0.50, currency: 'USD' },
                'ocr': { min: 0.25, max: 0.40, currency: 'USD' },
                'pdf-extract': { min: 0.20, max: 0.35, currency: 'USD' },
                'stable-diffusion': { min: 0.50, max: 1.00, currency: 'USD' },
                'default': { min: 0.15, max: 0.25, currency: 'USD' }
            }
        };
        
        this.initializeTrendTracking();
    }
    
    initializeTrendTracking() {
        // Create trend tracking table if it doesn't exist
        try {
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS capacity_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp INTEGER NOT NULL,
                    active_nodes INTEGER NOT NULL,
                    total_nodes INTEGER NOT NULL,
                    capabilities TEXT,
                    total_cores INTEGER,
                    total_ram_gb REAL,
                    pending_jobs INTEGER,
                    processing_jobs INTEGER,
                    health_score INTEGER,
                    revenue_potential_min REAL,
                    revenue_potential_max REAL
                )
            `);
            
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_capacity_timestamp ON capacity_snapshots(timestamp)
            `);
        } catch (error) {
            console.warn('Warning: Could not create capacity tracking table:', error.message);
        }
    }
    
    recordCapacitySnapshot() {
        const now = Date.now();
        const status = this.getCurrentSystemStatus();
        
        const capabilities = JSON.stringify(status.compute.capabilities.sort());
        const revenuePotential = this.calculateRevenuePotential(status);
        
        try {
            this.db.prepare(`
                INSERT INTO capacity_snapshots (
                    timestamp, active_nodes, total_nodes, capabilities,
                    total_cores, total_ram_gb, pending_jobs, processing_jobs,
                    health_score, revenue_potential_min, revenue_potential_max
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                now,
                status.nodes.active,
                status.nodes.total,
                capabilities,
                status.compute.totalCores,
                status.compute.totalRAM_GB,
                status.jobs.pending,
                status.jobs.processing,
                status.health.score,
                revenuePotential.min,
                revenuePotential.max
            );
        } catch (error) {
            console.warn('Warning: Could not record capacity snapshot:', error.message);
        }
        
        return status;
    }
    
    getCurrentSystemStatus() {
        const now = Date.now();
        const nodeOfflineThreshold = 300000; // 5 minutes
        
        // Get nodes
        const nodes = this.db.prepare(`
            SELECT nodeId, name, lastSeen, jobsCompleted, capabilities, 
                   cpuCores, ramMB, computeMinutes
            FROM nodes 
            ORDER BY lastSeen DESC
        `).all();
        
        const activeNodes = nodes.filter(node => 
            (now - node.lastSeen) < nodeOfflineThreshold
        );
        
        // Get jobs
        const jobStats = this.db.prepare(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
            FROM jobs
        `).get();
        
        // Calculate compute resources
        const capabilities = new Set();
        let totalCores = 0;
        let totalRAM = 0;
        
        activeNodes.forEach(node => {
            if (node.capabilities) {
                JSON.parse(node.capabilities).forEach(cap => capabilities.add(cap));
            }
            totalCores += node.cpuCores || 0;
            totalRAM += (node.ramMB || 0) / 1024;
        });
        
        return {
            timestamp: now,
            nodes: {
                active: activeNodes.length,
                total: nodes.length,
                details: activeNodes
            },
            compute: {
                totalCores,
                totalRAM_GB: Math.round(totalRAM * 10) / 10,
                capabilities: Array.from(capabilities)
            },
            jobs: jobStats,
            health: {
                score: this.calculateHealthScore(activeNodes.length, nodes.length, capabilities, jobStats)
            }
        };
    }
    
    calculateHealthScore(activeNodes, totalNodes, capabilities, jobStats) {
        let score = 0;
        
        // Node availability (40%)
        if (totalNodes > 0) {
            score += (activeNodes / totalNodes) * 40;
        }
        
        // Capability coverage (30%)
        const criticalCaps = ['transcribe', 'whisper', 'ocr', 'pdf-extract'];
        const availableCriticalCaps = criticalCaps.filter(cap => capabilities.has(cap)).length;
        score += (availableCriticalCaps / criticalCaps.length) * 30;
        
        // Job processing health (20%)
        const totalJobs = jobStats.total || 1;
        const successRate = jobStats.completed / totalJobs;
        score += Math.min(successRate * 20, 20);
        
        // Queue responsiveness (10%)
        const pendingJobs = jobStats.pending || 0;
        score += pendingJobs < 10 ? 10 : Math.max(0, 10 - pendingJobs);
        
        return Math.round(score);
    }
    
    calculateRevenuePotential(status) {
        const pendingRevenue = { min: 0, max: 0 };
        const hourlyCapacity = { min: 0, max: 0 };
        
        // Estimate revenue from pending jobs
        const pendingJobs = status.jobs.pending || 0;
        const avgJobValue = this.config.jobValueEstimates.default;
        pendingRevenue.min = pendingJobs * avgJobValue.min;
        pendingRevenue.max = pendingJobs * avgJobValue.max;
        
        // Estimate hourly capacity based on active compute
        const activeNodes = status.nodes.active;
        if (activeNodes > 0) {
            // Rough estimate: each node can handle 2-5 jobs per hour
            hourlyCapacity.min = activeNodes * 2 * avgJobValue.min;
            hourlyCapacity.max = activeNodes * 5 * avgJobValue.max;
        }
        
        return {
            min: pendingRevenue.min + hourlyCapacity.min,
            max: pendingRevenue.max + hourlyCapacity.max,
            pending: pendingRevenue,
            hourly: hourlyCapacity
        };
    }
    
    analyzeNodeRetentionPatterns() {
        const nodes = this.db.prepare(`
            SELECT nodeId, name, registeredAt, lastSeen, jobsCompleted, computeMinutes
            FROM nodes 
            ORDER BY registeredAt DESC
        `).all();
        
        const now = Date.now();
        const patterns = {
            total: nodes.length,
            categories: {},
            avgSessionDuration: 0,
            totalComputeMinutes: 0,
            productiveNodes: 0
        };
        
        // Initialize categories
        Object.keys(this.config.retentionCategories).forEach(cat => {
            patterns.categories[cat] = {
                count: 0,
                nodes: [],
                ...this.config.retentionCategories[cat]
            };
        });
        
        let totalSessionMinutes = 0;
        
        nodes.forEach(node => {
            const sessionDurationMs = node.lastSeen - node.registeredAt;
            const sessionMinutes = sessionDurationMs / 60000;
            totalSessionMinutes += sessionMinutes;
            
            patterns.totalComputeMinutes += node.computeMinutes || 0;
            if (node.jobsCompleted > 0) {
                patterns.productiveNodes++;
            }
            
            // Categorize by retention
            for (const [catName, category] of Object.entries(this.config.retentionCategories)) {
                if (sessionMinutes >= category.min && sessionMinutes < category.max) {
                    patterns.categories[catName].count++;
                    patterns.categories[catName].nodes.push({
                        nodeId: node.nodeId.slice(0, 8),
                        name: node.name || 'unnamed',
                        sessionMinutes: Math.round(sessionMinutes),
                        jobsCompleted: node.jobsCompleted,
                        efficiency: node.jobsCompleted / Math.max(sessionMinutes / 60, 0.1) // jobs per hour
                    });
                    break;
                }
            }
        });
        
        patterns.avgSessionDuration = patterns.total > 0 ? 
            Math.round(totalSessionMinutes / patterns.total) : 0;
        
        // Calculate retention rates
        patterns.retentionRate = patterns.total > 0 ? 
            (patterns.productiveNodes / patterns.total) * 100 : 0;
        
        return patterns;
    }
    
    getCapacityTrends(hours = 24) {
        const startTime = Date.now() - (hours * 60 * 60 * 1000);
        
        try {
            const snapshots = this.db.prepare(`
                SELECT * FROM capacity_snapshots 
                WHERE timestamp > ?
                ORDER BY timestamp ASC
            `).all(startTime);
            
            if (snapshots.length === 0) {
                return {
                    period: `${hours} hours`,
                    snapshots: 0,
                    trends: 'No historical data available'
                };
            }
            
            const trends = {
                period: `${hours} hours`,
                snapshots: snapshots.length,
                timeRange: {
                    start: new Date(snapshots[0].timestamp).toISOString(),
                    end: new Date(snapshots[snapshots.length - 1].timestamp).toISOString()
                },
                capacity: {
                    minNodes: Math.min(...snapshots.map(s => s.active_nodes)),
                    maxNodes: Math.max(...snapshots.map(s => s.active_nodes)),
                    avgNodes: snapshots.reduce((sum, s) => sum + s.active_nodes, 0) / snapshots.length,
                    currentNodes: snapshots[snapshots.length - 1].active_nodes
                },
                health: {
                    minHealth: Math.min(...snapshots.map(s => s.health_score)),
                    maxHealth: Math.max(...snapshots.map(s => s.health_score)),
                    avgHealth: snapshots.reduce((sum, s) => sum + s.health_score, 0) / snapshots.length,
                    currentHealth: snapshots[snapshots.length - 1].health_score
                },
                revenue: {
                    avgPotentialMin: snapshots.reduce((sum, s) => sum + s.revenue_potential_min, 0) / snapshots.length,
                    avgPotentialMax: snapshots.reduce((sum, s) => sum + s.revenue_potential_max, 0) / snapshots.length,
                    currentPotentialMin: snapshots[snapshots.length - 1].revenue_potential_min,
                    currentPotentialMax: snapshots[snapshots.length - 1].revenue_potential_max
                }
            };
            
            // Calculate trend directions
            const recentSnapshots = snapshots.slice(-Math.min(10, snapshots.length));
            const olderSnapshots = snapshots.slice(0, Math.min(10, snapshots.length));
            
            if (recentSnapshots.length > 1 && olderSnapshots.length > 1) {
                const recentAvgNodes = recentSnapshots.reduce((sum, s) => sum + s.active_nodes, 0) / recentSnapshots.length;
                const olderAvgNodes = olderSnapshots.reduce((sum, s) => sum + s.active_nodes, 0) / olderSnapshots.length;
                
                trends.direction = {
                    nodes: recentAvgNodes > olderAvgNodes ? 'increasing' : 
                           recentAvgNodes < olderAvgNodes ? 'decreasing' : 'stable'
                };
            }
            
            return trends;
            
        } catch (error) {
            return {
                error: `Could not analyze trends: ${error.message}`,
                period: `${hours} hours`
            };
        }
    }
    
    generateCapacityForecast() {
        const retention = this.analyzeNodeRetentionPatterns();
        const trends = this.getCapacityTrends(168); // 1 week
        const current = this.getCurrentSystemStatus();
        
        const forecast = {
            timestamp: new Date().toISOString(),
            current: {
                activeNodes: current.nodes.active,
                healthScore: current.health.score,
                capabilities: current.compute.capabilities
            },
            patterns: {
                totalNodesRegistered: retention.total,
                productiveNodeRate: retention.retentionRate.toFixed(1) + '%',
                avgSessionDuration: `${Math.round(retention.avgSessionDuration)}min`,
                mostRetentiveCategory: this.findMostRetentiveCategory(retention)
            },
            recommendations: []
        };
        
        // Generate recommendations based on patterns
        if (retention.retentionRate < 50) {
            forecast.recommendations.push({
                priority: 'HIGH',
                area: 'Retention',
                action: 'Improve node operator onboarding and support',
                reason: `Only ${retention.retentionRate.toFixed(1)}% of nodes become productive`
            });
        }
        
        if (current.nodes.active === 0) {
            forecast.recommendations.push({
                priority: 'CRITICAL',
                area: 'Capacity',
                action: 'Emergency node operator outreach',
                reason: 'Complete service outage - no active capacity'
            });
        }
        
        if (retention.categories.stable.count === 0) {
            forecast.recommendations.push({
                priority: 'MEDIUM',
                area: 'Stability',
                action: 'Develop long-term operator retention program',
                reason: 'No nodes staying connected for over 1 week'
            });
        }
        
        // Revenue impact forecast
        if (trends.revenue && trends.revenue.avgPotentialMax > 0) {
            const weeklyRevenueProjection = trends.revenue.avgPotentialMax * 24 * 7;
            forecast.revenue = {
                weeklyProjection: `$${weeklyRevenueProjection.toFixed(2)}`,
                monthly: `$${(weeklyRevenueProjection * 4.33).toFixed(2)}`,
                note: 'Based on current capacity patterns'
            };
        }
        
        return forecast;
    }
    
    findMostRetentiveCategory(retention) {
        let bestCategory = { name: 'none', efficiency: 0, count: 0 };
        
        Object.entries(retention.categories).forEach(([name, category]) => {
            if (category.count > 0) {
                const avgEfficiency = category.nodes.reduce((sum, node) => 
                    sum + node.efficiency, 0) / category.nodes.length;
                
                if (avgEfficiency > bestCategory.efficiency && category.count > bestCategory.count / 2) {
                    bestCategory = { name, efficiency: avgEfficiency, count: category.count };
                }
            }
        });
        
        return bestCategory.name !== 'none' ? 
            `${bestCategory.name} (${bestCategory.count} nodes, ${bestCategory.efficiency.toFixed(1)} jobs/hour avg)` :
            'No productive patterns identified';
    }
    
    generateReport() {
        console.log('🔍 Generating Capacity Trend Analysis Report...\n');
        
        const current = this.recordCapacitySnapshot();
        const retention = this.analyzeNodeRetentionPatterns();
        const trends24h = this.getCapacityTrends(24);
        const trends7d = this.getCapacityTrends(168);
        const forecast = this.generateCapacityForecast();
        
        const report = `# Capacity Trend Analysis Report
Generated: ${new Date().toISOString()}

## Current Status
- **Active Nodes:** ${current.nodes.active}/${current.nodes.total}
- **Health Score:** ${current.health.score}/100
- **Active Capabilities:** ${current.compute.capabilities.join(', ') || 'none'}
- **Compute Resources:** ${current.compute.totalCores} cores, ${current.compute.totalRAM_GB}GB RAM
- **Queue Status:** ${current.jobs.pending} pending, ${current.jobs.processing} processing

## Node Retention Analysis
- **Total Registered:** ${retention.total} nodes
- **Productive Rate:** ${retention.retentionRate.toFixed(1)}% (${retention.productiveNodes}/${retention.total})
- **Average Session:** ${Math.round(retention.avgSessionDuration)} minutes
- **Total Compute Time:** ${retention.totalComputeMinutes.toFixed(1)} minutes

### Retention Categories
${Object.entries(retention.categories).map(([name, category]) => 
    `- **${name.charAt(0).toUpperCase() + name.slice(1)}:** ${category.count} nodes (${category.description})`
).join('\n')}

### Top Performing Nodes by Category
${Object.entries(retention.categories).filter(([name, cat]) => cat.nodes.length > 0).map(([name, category]) => 
    `**${name.charAt(0).toUpperCase() + name.slice(1)}:**\n${category.nodes.slice(0, 3).map(node => 
        `  - ${node.name} (${node.nodeId}): ${node.jobsCompleted} jobs, ${node.efficiency.toFixed(1)} jobs/hour`
    ).join('\n')}`
).join('\n\n')}

## Capacity Trends

### 24-Hour Trends
${trends24h.error || `
- **Active Nodes:** ${trends24h.capacity?.minNodes || 0}-${trends24h.capacity?.maxNodes || 0} (avg: ${(trends24h.capacity?.avgNodes || 0).toFixed(1)})
- **Health Score:** ${trends24h.health?.minHealth || 0}-${trends24h.health?.maxHealth || 0} (avg: ${(trends24h.health?.avgHealth || 0).toFixed(1)})
- **Direction:** ${trends24h.direction?.nodes || 'unknown'}
- **Data Points:** ${trends24h.snapshots} snapshots`}

### 7-Day Trends
${trends7d.error || `
- **Active Nodes:** ${trends7d.capacity?.minNodes || 0}-${trends7d.capacity?.maxNodes || 0} (avg: ${(trends7d.capacity?.avgNodes || 0).toFixed(1)})
- **Health Score:** ${trends7d.health?.minHealth || 0}-${trends7d.health?.maxHealth || 0} (avg: ${(trends7d.health?.avgHealth || 0).toFixed(1)})
- **Direction:** ${trends7d.direction?.nodes || 'unknown'}
- **Data Points:** ${trends7d.snapshots} snapshots`}

## Forecast & Recommendations

### Key Insights
${forecast.patterns ? `
- **Retention Rate:** ${forecast.patterns.productiveNodeRate}
- **Session Duration:** ${forecast.patterns.avgSessionDuration}  
- **Best Retention Pattern:** ${forecast.patterns.mostRetentiveCategory}` : ''}

### Priority Actions
${forecast.recommendations.map(rec => 
    `- **${rec.priority}:** ${rec.action}\n  *${rec.reason}*`
).join('\n')}

### Revenue Projections
${forecast.revenue ? `
- **Weekly Potential:** ${forecast.revenue.weeklyProjection}
- **Monthly Potential:** ${forecast.revenue.monthly}
- *${forecast.revenue.note}*` : 'Insufficient data for revenue projections'}

## Technical Notes
- Report generated from ${retention.total} registered nodes
- Historical trend data: ${trends24h.snapshots || 0} snapshots (24h), ${trends7d.snapshots || 0} snapshots (7d)
- Health scoring: Node availability (40%) + Capabilities (30%) + Job success (20%) + Queue health (10%)
- Revenue estimates based on job type averages and processing capacity

---
*This report is automatically generated and should be reviewed alongside operational metrics*`;

        // Save report
        const reportsDir = './reports';
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir);
        }
        
        const reportPath = `${reportsDir}/capacity-trends-${new Date().toISOString().slice(0, 10)}.md`;
        fs.writeFileSync(reportPath, report);
        
        console.log(`📊 Detailed report saved to: ${reportPath}`);
        
        return {
            report,
            reportPath,
            summary: {
                currentNodes: current.nodes.active,
                healthScore: current.health.score,
                retentionRate: retention.retentionRate,
                recommendations: forecast.recommendations.length
            }
        };
    }
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0] || 'report';
    
    const monitor = new CapacityTrendMonitor();
    
    switch (command) {
        case 'report':
            monitor.generateReport();
            break;
            
        case 'snapshot':
            const status = monitor.recordCapacitySnapshot();
            console.log('📷 Capacity snapshot recorded');
            console.log(`🖥️  ${status.nodes.active}/${status.nodes.total} nodes active`);
            console.log(`📊 Health: ${status.health.score}/100`);
            break;
            
        case 'retention':
            const retention = monitor.analyzeNodeRetentionPatterns();
            console.log('🔍 Node Retention Analysis:');
            console.log(`Total registered: ${retention.total}`);
            console.log(`Productive rate: ${retention.retentionRate.toFixed(1)}%`);
            console.log(`Average session: ${retention.avgSessionDuration} minutes`);
            break;
            
        case 'trends':
            const hours = parseInt(args[1]) || 24;
            const trends = monitor.getCapacityTrends(hours);
            console.log(`📈 Capacity trends (${trends.period}):`);
            console.log(JSON.stringify(trends, null, 2));
            break;
            
        case 'forecast':
            const forecast = monitor.generateCapacityForecast();
            console.log('🔮 Capacity Forecast:');
            console.log(JSON.stringify(forecast, null, 2));
            break;
            
        default:
            console.log('Usage: node capacity-trend-monitor.js [report|snapshot|retention|trends|forecast]');
            console.log('  report - Generate full analysis report');
            console.log('  snapshot - Record current capacity state');
            console.log('  retention - Analyze node retention patterns');
            console.log('  trends [hours] - Show capacity trends (default: 24h)');
            console.log('  forecast - Generate capacity forecast');
            process.exit(1);
    }
}

module.exports = CapacityTrendMonitor;