#!/usr/bin/env node

/**
 * Performance Monitor for IC Mesh
 * 
 * Comprehensive performance monitoring system that tracks:
 * - Database query performance and optimization suggestions
 * - Memory usage patterns and leak detection
 * - Request/response timing analysis  
 * - Resource utilization monitoring
 * - Performance regression detection
 */

const path = require('path');
const fs = require('fs').promises;
const Database = require('better-sqlite3');

class PerformanceMonitor {
    constructor() {
        this.metrics = {
            queries: [],
            requests: [],
            memory: [],
            startTime: Date.now()
        };
        this.thresholds = {
            slowQueryMs: 100,
            slowRequestMs: 1000,
            memoryLeakMb: 50,
            maxLogEntries: 10000
        };
    }

    // Database Performance Analysis
    analyzeDatabase(dbPath = './mesh.db') {
        console.log('🔍 Analyzing database performance...');
        
        try {
            const db = new Database(dbPath);
            
            // Analyze table statistics
            const tables = ['nodes', 'jobs', 'ledger', 'uploads'];
            const analysis = {
                timestamp: new Date().toISOString(),
                tables: {},
                recommendations: []
            };
            
            for (const table of tables) {
                const start = process.hrtime.bigint();
                
                // Get table info
                const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
                const size = db.prepare(`SELECT page_count * page_size as size FROM pragma_page_count('${table}'), pragma_page_size`).get();
                
                const end = process.hrtime.bigint();
                const duration = Number(end - start) / 1000000; // Convert to ms
                
                analysis.tables[table] = {
                    rowCount: count.count,
                    sizeBytes: size?.size || 0,
                    queryTimeMs: parseFloat(duration.toFixed(2))
                };
                
                // Performance recommendations
                if (count.count > 10000) {
                    analysis.recommendations.push(`Consider adding indexes on ${table} for queries on frequently filtered columns`);
                }
                if (duration > 50) {
                    analysis.recommendations.push(`${table} count query took ${duration.toFixed(2)}ms - consider optimization`);
                }
            }
            
            // Analyze most frequent queries
            this.analyzeQueryPatterns(db, analysis);
            
            // Check for missing indexes
            this.checkIndexOptimization(db, analysis);
            
            db.close();
            
            console.log('📊 Database Analysis Results:');
            console.log(JSON.stringify(analysis, null, 2));
            
            return analysis;
            
        } catch (error) {
            console.error('❌ Database analysis failed:', error.message);
            return { error: error.message };
        }
    }
    
    analyzeQueryPatterns(db, analysis) {
        // Simulate common query patterns and measure performance
        const commonQueries = [
            { name: 'pending_jobs', sql: "SELECT * FROM jobs WHERE status = 'pending' LIMIT 10" },
            { name: 'node_status', sql: "SELECT id, name, status FROM nodes WHERE status = 'online'" },
            { name: 'recent_uploads', sql: "SELECT * FROM uploads ORDER BY uploadedAt DESC LIMIT 5" },
            { name: 'ledger_balance', sql: "SELECT SUM(amount) as balance FROM ledger WHERE nodeId = ?" }
        ];
        
        analysis.queryPerformance = {};
        
        for (const query of commonQueries) {
            const start = process.hrtime.bigint();
            
            try {
                if (query.sql.includes('?')) {
                    // Use a sample nodeId for parameterized queries
                    const sampleNode = db.prepare("SELECT id FROM nodes LIMIT 1").get();
                    if (sampleNode) {
                        db.prepare(query.sql).get(sampleNode.id);
                    }
                } else {
                    db.prepare(query.sql).all();
                }
                
                const end = process.hrtime.bigint();
                const duration = Number(end - start) / 1000000;
                
                analysis.queryPerformance[query.name] = {
                    durationMs: parseFloat(duration.toFixed(3)),
                    status: duration > this.thresholds.slowQueryMs ? 'slow' : 'fast'
                };
                
                if (duration > this.thresholds.slowQueryMs) {
                    analysis.recommendations.push(`${query.name} query is slow (${duration.toFixed(2)}ms) - consider optimization`);
                }
                
            } catch (error) {
                analysis.queryPerformance[query.name] = { error: error.message };
            }
        }
    }
    
    checkIndexOptimization(db, analysis) {
        // Check for existing indexes
        const indexes = db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all();
        
        analysis.indexes = indexes.map(idx => ({
            name: idx.name,
            table: idx.tbl_name,
            definition: idx.sql
        }));
        
        // Recommend missing indexes based on common query patterns
        const recommendedIndexes = [
            { table: 'jobs', columns: 'status', reason: 'Frequently filtered by status' },
            { table: 'jobs', columns: 'nodeId', reason: 'Frequently filtered by node' },
            { table: 'nodes', columns: 'status', reason: 'Frequently filtered by status' },
            { table: 'uploads', columns: 'uploadedAt', reason: 'Frequently ordered by upload time' },
            { table: 'ledger', columns: 'nodeId', reason: 'Frequently grouped by node for balances' }
        ];
        
        analysis.indexRecommendations = recommendedIndexes.filter(rec => {
            // Check if index already exists
            const exists = indexes.some(idx => 
                idx.table === rec.table && 
                idx.definition.toLowerCase().includes(rec.columns.toLowerCase())
            );
            return !exists;
        });
    }

    // Memory Usage Analysis
    analyzeMemoryUsage() {
        const usage = process.memoryUsage();
        const timestamp = Date.now();
        
        const memoryInfo = {
            timestamp,
            rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100, // MB
            heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100,
            heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100,
            external: Math.round(usage.external / 1024 / 1024 * 100) / 100,
            arrayBuffers: Math.round(usage.arrayBuffers / 1024 / 1024 * 100) / 100
        };
        
        this.metrics.memory.push(memoryInfo);
        
        // Keep only recent entries
        if (this.metrics.memory.length > 100) {
            this.metrics.memory = this.metrics.memory.slice(-50);
        }
        
        // Check for memory leaks
        if (this.metrics.memory.length >= 10) {
            const recent = this.metrics.memory.slice(-10);
            const trend = this.calculateMemoryTrend(recent);
            
            if (trend.slope > this.thresholds.memoryLeakMb) {
                console.warn(`⚠️ Potential memory leak detected: ${trend.slope.toFixed(2)}MB/sample increase`);
            }
        }
        
        return memoryInfo;
    }
    
    calculateMemoryTrend(samples) {
        const n = samples.length;
        const sumX = samples.reduce((sum, _, i) => sum + i, 0);
        const sumY = samples.reduce((sum, sample) => sum + sample.heapUsed, 0);
        const sumXY = samples.reduce((sum, sample, i) => sum + i * sample.heapUsed, 0);
        const sumX2 = samples.reduce((sum, _, i) => sum + i * i, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        return { slope, intercept };
    }

    // Request Performance Monitoring
    monitorRequest(req, res, next) {
        const startTime = process.hrtime.bigint();
        const originalSend = res.send;
        
        res.send = function(body) {
            const endTime = process.hrtime.bigint();
            const duration = Number(endTime - startTime) / 1000000; // ms
            
            const requestMetric = {
                timestamp: Date.now(),
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                durationMs: parseFloat(duration.toFixed(2)),
                bodySize: Buffer.isBuffer(body) ? body.length : JSON.stringify(body || '').length
            };
            
            // Log slow requests
            if (duration > this.thresholds.slowRequestMs) {
                console.warn(`🐌 Slow request: ${req.method} ${req.path} took ${duration.toFixed(2)}ms`);
            }
            
            this.metrics.requests.push(requestMetric);
            
            // Keep only recent entries
            if (this.metrics.requests.length > this.thresholds.maxLogEntries) {
                this.metrics.requests = this.metrics.requests.slice(-1000);
            }
            
            return originalSend.call(this, body);
        }.bind(res);
        
        if (next) next();
    }

    // System Resource Monitoring
    async checkSystemResources() {
        const resources = {
            timestamp: Date.now(),
            uptime: process.uptime(),
            loadAverage: process.platform !== 'win32' ? require('os').loadavg() : [0, 0, 0],
            cpuUsage: process.cpuUsage(),
            memory: this.analyzeMemoryUsage()
        };
        
        // Check disk space if possible
        try {
            const stats = await fs.stat('./');
            // Note: fs.stat doesn't provide disk space info, but we can check file system
            resources.diskCheck = 'available';
        } catch (error) {
            resources.diskCheck = 'error';
        }
        
        return resources;
    }

    // Performance Report Generation
    generateReport() {
        const report = {
            generatedAt: new Date().toISOString(),
            uptimeSeconds: Math.floor(process.uptime()),
            summary: {
                totalRequests: this.metrics.requests.length,
                slowRequests: this.metrics.requests.filter(r => r.durationMs > this.thresholds.slowRequestMs).length,
                averageResponseTime: this.calculateAverageResponseTime(),
                memoryUsage: this.metrics.memory.slice(-1)[0] || null
            },
            topSlowRequests: this.getTopSlowRequests(10),
            memoryTrend: this.getMemoryTrend(),
            recommendations: this.generateRecommendations()
        };
        
        console.log('📈 Performance Report:');
        console.log(JSON.stringify(report, null, 2));
        
        return report;
    }
    
    calculateAverageResponseTime() {
        if (this.metrics.requests.length === 0) return 0;
        
        const total = this.metrics.requests.reduce((sum, req) => sum + req.durationMs, 0);
        return parseFloat((total / this.metrics.requests.length).toFixed(2));
    }
    
    getTopSlowRequests(limit = 10) {
        return this.metrics.requests
            .sort((a, b) => b.durationMs - a.durationMs)
            .slice(0, limit)
            .map(req => ({
                method: req.method,
                path: req.path,
                durationMs: req.durationMs,
                timestamp: new Date(req.timestamp).toISOString()
            }));
    }
    
    getMemoryTrend() {
        if (this.metrics.memory.length < 5) return null;
        
        const recent = this.metrics.memory.slice(-10);
        const trend = this.calculateMemoryTrend(recent);
        
        return {
            samples: recent.length,
            trendSlope: parseFloat(trend.slope.toFixed(3)),
            status: Math.abs(trend.slope) > this.thresholds.memoryLeakMb ? 'concerning' : 'stable'
        };
    }
    
    generateRecommendations() {
        const recommendations = [];
        
        // Response time recommendations
        const avgResponseTime = this.calculateAverageResponseTime();
        if (avgResponseTime > 500) {
            recommendations.push('Average response time is high - consider caching or query optimization');
        }
        
        // Memory recommendations
        const currentMemory = this.metrics.memory.slice(-1)[0];
        if (currentMemory && currentMemory.heapUsed > 100) {
            recommendations.push('Memory usage is high - monitor for potential memory leaks');
        }
        
        // Request volume recommendations
        const recentRequests = this.metrics.requests.filter(r => 
            Date.now() - r.timestamp < 60000 // Last minute
        ).length;
        
        if (recentRequests > 100) {
            recommendations.push('High request volume detected - consider rate limiting or load balancing');
        }
        
        return recommendations;
    }

    // Database Optimization Tools
    async optimizeDatabase(dbPath = './mesh.db') {
        console.log('🔧 Running database optimization...');
        
        try {
            const db = new Database(dbPath);
            
            // Run VACUUM to reclaim space
            console.log('Running VACUUM...');
            db.exec('VACUUM');
            
            // Update statistics
            console.log('Updating statistics...');
            db.exec('ANALYZE');
            
            // Add recommended indexes if they don't exist
            const analysis = this.analyzeDatabase(dbPath);
            
            if (analysis.indexRecommendations) {
                for (const rec of analysis.indexRecommendations) {
                    try {
                        const indexName = `idx_${rec.table}_${rec.columns.replace(',', '_')}`;
                        const createIndexSQL = `CREATE INDEX IF NOT EXISTS ${indexName} ON ${rec.table} (${rec.columns})`;
                        
                        console.log(`Creating index: ${createIndexSQL}`);
                        db.exec(createIndexSQL);
                        
                    } catch (indexError) {
                        console.warn(`⚠️ Could not create index for ${rec.table}.${rec.columns}:`, indexError.message);
                    }
                }
            }
            
            db.close();
            console.log('✅ Database optimization completed');
            
        } catch (error) {
            console.error('❌ Database optimization failed:', error.message);
        }
    }

    // Export monitoring data for external analysis
    async exportMetrics(filepath) {
        const exportData = {
            exported: new Date().toISOString(),
            uptime: process.uptime(),
            metrics: this.metrics,
            summary: {
                totalRequests: this.metrics.requests.length,
                averageResponseTime: this.calculateAverageResponseTime(),
                memoryTrend: this.getMemoryTrend()
            }
        };
        
        await fs.writeFile(filepath, JSON.stringify(exportData, null, 2));
        console.log(`📊 Metrics exported to ${filepath}`);
    }
}

// CLI Interface
async function main() {
    const monitor = new PerformanceMonitor();
    const command = process.argv[2];
    
    switch (command) {
        case 'analyze':
            monitor.analyzeDatabase();
            break;
            
        case 'optimize':
            await monitor.optimizeDatabase();
            break;
            
        case 'report':
            monitor.generateReport();
            break;
            
        case 'memory':
            console.log('Memory Analysis:', monitor.analyzeMemoryUsage());
            break;
            
        case 'resources':
            console.log('System Resources:', await monitor.checkSystemResources());
            break;
            
        case 'export':
            const exportPath = process.argv[3] || './performance-metrics.json';
            await monitor.exportMetrics(exportPath);
            break;
            
        case 'watch':
            console.log('🔄 Starting continuous monitoring (Ctrl+C to stop)...');
            setInterval(() => {
                monitor.analyzeMemoryUsage();
                if (Math.random() < 0.1) { // 10% chance to show full report
                    monitor.generateReport();
                }
            }, 5000);
            break;
            
        default:
            console.log(`
Performance Monitor for IC Mesh

Usage:
  node performance-monitor.js <command>

Commands:
  analyze     - Analyze database performance and structure
  optimize    - Run database optimization (VACUUM, ANALYZE, create indexes)
  report      - Generate comprehensive performance report  
  memory      - Show current memory usage analysis
  resources   - Check system resource utilization
  export      - Export metrics to JSON file
  watch       - Start continuous monitoring

Examples:
  node performance-monitor.js analyze
  node performance-monitor.js optimize
  node performance-monitor.js export ./metrics-$(date +%Y%m%d).json
            `);
    }
}

// Export for use as middleware
module.exports = PerformanceMonitor;

// Run CLI if called directly
if (require.main === module) {
    main().catch(console.error);
}