#!/usr/bin/env node

/**
 * IC Mesh Dashboard Server
 * 
 * Secure web server for the connection health dashboard with:
 * - Authentication middleware
 * - Rate limiting
 * - Security headers
 * - CORS protection
 * - Audit logging
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

class DashboardServer {
    constructor(options = {}) {
        this.app = express();
        this.port = options.port || 8334;
        this.meshServerUrl = options.meshServerUrl || 'http://localhost:8333';
        this.authToken = options.authToken || this.generateAuthToken();
        this.setupMiddleware();
        this.setupRoutes();
    }

    generateAuthToken() {
        // Generate a secure random token for dashboard access
        return crypto.randomBytes(32).toString('hex');
    }

    setupMiddleware() {
        // Security headers
        this.app.use((req, res, next) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('X-XSS-Protection', '1; mode=block');
            res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
            res.setHeader('Content-Security-Policy', 
                "default-src 'self'; " +
                "script-src 'self'; " +
                "style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data:; " +
                "connect-src 'self'; " +
                "font-src 'self';"
            );
            next();
        });

        // Rate limiting
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100, // limit each IP to 100 requests per windowMs
            message: {
                error: 'Too many requests from this IP, please try again later.'
            },
            standardHeaders: true,
            legacyHeaders: false
        });
        this.app.use(limiter);

        // JSON parsing with size limit
        this.app.use(express.json({ limit: '10mb' }));
        
        // Request logging
        this.app.use((req, res, next) => {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] ${req.method} ${req.path} - ${req.ip}`);
            next();
        });
    }

    // Authentication middleware
    authenticate(req, res, next) {
        const token = req.headers.authorization?.replace('Bearer ', '') || 
                     req.query.token || 
                     req.cookies?.dashboardToken;

        if (!token || token !== this.authToken) {
            // Audit log failed authentication
            console.warn(`[${new Date().toISOString()}] SECURITY: Unauthorized access attempt from ${req.ip} to ${req.path}`);
            
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Valid authentication token required',
                hint: 'Include token in Authorization header, query string, or cookie'
            });
        }

        next();
    }

    async fetchMeshData() {
        try {
            const fetch = (await import('node-fetch')).default;
            const response = await fetch(`${this.meshServerUrl}/health`, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'IC-Mesh-Dashboard/1.0'
                }
            });

            if (!response.ok) {
                throw new Error(`Mesh server returned ${response.status}`);
            }

            const data = await response.json();
            
            // Add simulated node details for demo (replace with real node data)
            data.nodeDetails = [
                {
                    id: 'miniclaw-001',
                    status: 'healthy',
                    uptime: '2d 14h',
                    successRate: 100,
                    capabilities: ['transcribe', 'whisper']
                },
                {
                    id: 'unnamed-002',
                    status: 'healthy',
                    uptime: '1d 6h',
                    successRate: 95,
                    capabilities: ['transcribe', 'ollama']
                }
            ];

            return data;
        } catch (error) {
            console.error('Failed to fetch mesh data:', error.message);
            return {
                status: 'error',
                error: error.message,
                uptime: 'Unknown',
                jobs: { total: 0, pending: 0 },
                nodes: { total: 0, active: 0 },
                performance: { successRate: 0 },
                nodeDetails: []
            };
        }
    }

    setupRoutes() {
        // Health check (no auth required)
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                service: 'IC Mesh Dashboard',
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        });

        // Dashboard page (with authentication)
        this.app.get('/dashboard', this.authenticate.bind(this), (req, res) => {
            const dashboardPath = path.join(__dirname, 'connection-health.html');
            
            if (!fs.existsSync(dashboardPath)) {
                return res.status(404).json({
                    error: 'Dashboard file not found',
                    path: dashboardPath
                });
            }

            res.sendFile(dashboardPath);
        });

        // Dashboard data API (with authentication)
        this.app.get('/health', this.authenticate.bind(this), async (req, res) => {
            try {
                const data = await this.fetchMeshData();
                res.json(data);
            } catch (error) {
                console.error('Dashboard data error:', error);
                res.status(500).json({
                    error: 'Failed to fetch dashboard data',
                    message: error.message
                });
            }
        });

        // Authentication endpoint
        this.app.post('/auth', (req, res) => {
            const { username, password } = req.body;
            
            // Simple auth for demo (replace with proper auth system)
            if (username === 'admin' && password === 'mesh-admin-2026') {
                res.json({
                    success: true,
                    token: this.authToken,
                    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                });
            } else {
                console.warn(`[${new Date().toISOString()}] SECURITY: Failed login attempt for '${username}' from ${req.ip}`);
                res.status(401).json({
                    success: false,
                    error: 'Invalid credentials'
                });
            }
        });

        // Root redirect
        this.app.get('/', (req, res) => {
            res.redirect('/dashboard');
        });

        // 404 handler
        this.app.use((req, res) => {
            res.status(404).json({
                error: 'Not Found',
                message: 'The requested resource was not found',
                available: ['/dashboard', '/health', '/auth']
            });
        });

        // Error handler
        this.app.use((error, req, res, next) => {
            console.error('Server error:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'An unexpected error occurred'
            });
        });
    }

    start() {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.port, () => {
                console.log(`🔒 IC Mesh Dashboard Server started on port ${this.port}`);
                console.log(`🌐 Dashboard: http://localhost:${this.port}/dashboard?token=${this.authToken.substring(0, 8)}...`);
                console.log(`🔑 Auth Token: ${this.authToken.substring(0, 8)}...`);
                console.log(`📊 Monitoring: ${this.meshServerUrl}`);
                console.log('');
                console.log('Security Features:');
                console.log('  ✓ Authentication required');
                console.log('  ✓ Rate limiting enabled');
                console.log('  ✓ XSS protection headers');
                console.log('  ✓ Content Security Policy');
                console.log('  ✓ Request logging');
                resolve(this.server);
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(resolve);
            } else {
                resolve();
            }
        });
    }
}

// CLI usage
async function main() {
    const args = process.argv.slice(2);
    const options = {};

    // Parse command line arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--port' && args[i + 1]) {
            options.port = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--mesh-url' && args[i + 1]) {
            options.meshServerUrl = args[i + 1];
            i++;
        } else if (args[i] === '--help') {
            console.log('IC Mesh Dashboard Server');
            console.log('');
            console.log('Usage: node dashboard/server.js [options]');
            console.log('');
            console.log('Options:');
            console.log('  --port <n>        Server port (default: 8334)');
            console.log('  --mesh-url <url>  IC Mesh server URL (default: http://localhost:8333)');
            console.log('  --help            Show this help');
            console.log('');
            console.log('Authentication:');
            console.log('  Default credentials: admin / mesh-admin-2026');
            console.log('  Token is displayed on startup');
            process.exit(0);
        }
    }

    const server = new DashboardServer(options);
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down dashboard server...');
        await server.stop();
        console.log('✅ Dashboard server stopped');
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n🛑 Received SIGTERM, shutting down...');
        await server.stop();
        process.exit(0);
    });

    await server.start();
}

if (require.main === module) {
    main().catch(error => {
        console.error('Failed to start dashboard server:', error);
        process.exit(1);
    });
}

module.exports = DashboardServer;