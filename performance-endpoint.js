/**
 * Performance API endpoint for IC Mesh
 * Add this to your server.js to expose performance metrics
 */

const PerformanceMiddleware = require('./lib/performance-middleware');

// Initialize performance monitor (add this near the top of server.js)
const performanceMonitor = new PerformanceMiddleware();

// Add this middleware to your express app (or HTTP request handler)
function addPerformanceMonitoring(req, res, next) {
    performanceMonitor.middleware(req, res, next);
}

// Add this route handler to your server
function handlePerformanceEndpoint(req, res) {
    try {
        const report = performanceMonitor.getPerformanceReport();
        
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        
        res.end(JSON.stringify(report, null, 2));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
    }
}

// Example integration for server.js:
/*

const PerformanceMiddleware = require('./lib/performance-middleware');
const performanceMonitor = new PerformanceMiddleware();

// Add middleware to all requests
function processRequest(req, res) {
    performanceMonitor.middleware(req, res, () => {
        // Your existing request handling logic here
        handleRequest(req, res);
    });
}

// Add performance endpoint
if (url.pathname === '/api/performance') {
    return handlePerformanceEndpoint(req, res);
}

*/

module.exports = {
    PerformanceMiddleware,
    addPerformanceMonitoring,
    handlePerformanceEndpoint
};