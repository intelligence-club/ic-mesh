/**
 * Simple Performance Monitoring Middleware for IC Mesh
 * Tracks request timing, memory usage, and basic performance metrics
 */

class PerformanceMiddleware {
    constructor() {
        this.metrics = {
            requests: {},
            memory: [],
            startTime: Date.now()
        };
        
        // Collect memory metrics every 30 seconds
        setInterval(() => {
            this.collectMemoryMetrics();
        }, 30000);
    }
    
    // Middleware function to wrap around HTTP requests
    middleware(req, res, next) {
        const startTime = process.hrtime.bigint();
        const endpoint = `${req.method} ${req.url}`;
        
        // Initialize endpoint metrics if not exists
        if (!this.metrics.requests[endpoint]) {
            this.metrics.requests[endpoint] = {
                count: 0,
                totalTime: 0,
                avgTime: 0,
                minTime: Infinity,
                maxTime: 0,
                errors: 0
            };
        }
        
        const originalEnd = res.end;
        res.end = (...args) => {
            const duration = Number(process.hrtime.bigint() - startTime) / 1000000; // Convert to ms
            
            // Update metrics
            const metric = this.metrics.requests[endpoint];
            metric.count++;
            metric.totalTime += duration;
            metric.avgTime = metric.totalTime / metric.count;
            metric.minTime = Math.min(metric.minTime, duration);
            metric.maxTime = Math.max(metric.maxTime, duration);
            
            if (res.statusCode >= 400) {
                metric.errors++;
            }
            
            originalEnd.apply(res, args);
        };
        
        next();
    }
    
    collectMemoryMetrics() {
        const memUsage = process.memoryUsage();
        this.metrics.memory.push({
            timestamp: Date.now(),
            rss: memUsage.rss,
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external
        });
        
        // Keep only last 100 memory samples
        if (this.metrics.memory.length > 100) {
            this.metrics.memory = this.metrics.memory.slice(-100);
        }
    }
    
    getPerformanceReport() {
        const currentMemory = process.memoryUsage();
        const uptime = Date.now() - this.metrics.startTime;
        
        return {
            timestamp: Date.now(),
            uptime: uptime,
            memory: {
                current: currentMemory,
                history: this.metrics.memory.slice(-10), // Last 10 samples
                peak: {
                    rss: Math.max(...this.metrics.memory.map(m => m.rss)),
                    heapUsed: Math.max(...this.metrics.memory.map(m => m.heapUsed))
                }
            },
            requests: this.metrics.requests,
            summary: {
                totalRequests: Object.values(this.metrics.requests).reduce((sum, m) => sum + m.count, 0),
                avgResponseTime: this.calculateOverallAvgTime(),
                errorRate: this.calculateErrorRate()
            }
        };
    }
    
    calculateOverallAvgTime() {
        const requests = Object.values(this.metrics.requests);
        if (requests.length === 0) return 0;
        
        const totalTime = requests.reduce((sum, m) => sum + m.totalTime, 0);
        const totalCount = requests.reduce((sum, m) => sum + m.count, 0);
        
        return totalCount > 0 ? totalTime / totalCount : 0;
    }
    
    calculateErrorRate() {
        const requests = Object.values(this.metrics.requests);
        if (requests.length === 0) return 0;
        
        const totalErrors = requests.reduce((sum, m) => sum + m.errors, 0);
        const totalRequests = requests.reduce((sum, m) => sum + m.count, 0);
        
        return totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
    }
}

module.exports = PerformanceMiddleware;