# IC Mesh Security Dashboard

A secure web interface for monitoring IC Mesh network health, designed with security-first principles to address common web vulnerabilities.

## 🔒 Security Features

### ✅ XSS Protection
- **Content Security Policy**: Strict CSP headers prevent script injection
- **Input Sanitization**: All user inputs are sanitized before display
- **Safe DOM Manipulation**: Uses `textContent` instead of `innerHTML`
- **No Eval**: No dynamic code execution or `eval()` usage

### ✅ Authentication & Authorization  
- **Token-based Authentication**: Secure random tokens for access control
- **Multiple Auth Methods**: Header, query string, or cookie-based tokens
- **Session Management**: Configurable token expiration
- **Failed Login Logging**: Audit trail for security monitoring

### ✅ DoS Protection
- **Rate Limiting**: 100 requests per 15-minute window per IP
- **Request Size Limits**: 10MB JSON payload limit
- **Exponential Backoff**: Prevents infinite reload loops
- **Graceful Error Handling**: No cascading failures

### ✅ Additional Security
- **Security Headers**: OWASP-recommended HTTP headers
- **CORS Protection**: Controlled cross-origin access
- **Request Logging**: Full audit trail of access attempts
- **Error Information**: No sensitive data in error responses

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd ic-mesh
npm install express express-rate-limit node-fetch
```

### 2. Start the Dashboard Server
```bash
# Default configuration (port 8334)
./dashboard/server.js

# Custom configuration
./dashboard/server.js --port 9000 --mesh-url http://localhost:8333
```

### 3. Access the Dashboard
```bash
# Server will display the access URL with token:
# 🌐 Dashboard: http://localhost:8334/dashboard?token=<generated-token>
```

## 🔑 Authentication

### Default Credentials (Change in Production!)
- **Username**: `admin`
- **Password**: `mesh-admin-2026`

### Getting an Auth Token
```bash
# Method 1: Login via API
curl -X POST http://localhost:8334/auth \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"mesh-admin-2026"}'

# Method 2: Use the token displayed on startup
# Token is shown in server console output
```

### Using the Token
```bash
# Query parameter (easiest for browser)
http://localhost:8334/dashboard?token=your-token-here

# Authorization header (for API clients)
curl -H "Authorization: Bearer your-token-here" http://localhost:8334/health
```

## 📊 Dashboard Features

### Network Overview
- **Server Status**: IC Mesh server health and uptime
- **Job Queue**: Pending and completed job statistics  
- **Network Nodes**: Active node count and health status
- **Success Rate**: Recent job completion performance

### Real-time Monitoring
- **Auto-refresh**: Configurable automatic updates every 30 seconds
- **Manual Refresh**: On-demand data updates
- **Error Handling**: Graceful degradation when mesh server is unavailable
- **Visual Indicators**: Color-coded health status (🟢🟡🔴)

### Node Management
- **Node List**: All registered nodes with status indicators
- **Performance Metrics**: Success rates and uptime tracking
- **Capability Display**: Available handlers per node
- **Detail Views**: Per-node performance details (planned)

## 🛠 Configuration

### Environment Variables
```bash
export MESH_DASHBOARD_PORT=8334
export MESH_SERVER_URL=http://localhost:8333
export DASHBOARD_AUTH_TOKEN=your-custom-token
```

### Command Line Options
```bash
./dashboard/server.js --help

Options:
  --port <n>        Server port (default: 8334)
  --mesh-url <url>  IC Mesh server URL (default: http://localhost:8333)
  --help            Show help information
```

## 🔐 Production Security

### ⚠️ IMPORTANT: Change Default Credentials!
The default username/password is only for development. In production:

1. **Change Authentication**: Implement proper user management
2. **Use HTTPS**: Enable TLS/SSL for encrypted communication
3. **Network Security**: Use firewall rules to restrict access
4. **Token Rotation**: Implement regular token renewal
5. **Audit Logs**: Monitor and archive authentication logs

### Recommended Production Setup
```bash
# Behind reverse proxy with HTTPS
nginx → https://your-domain.com/dashboard → localhost:8334

# Environment-specific tokens
DASHBOARD_AUTH_TOKEN=$(openssl rand -hex 32)

# Restricted network access
iptables -A INPUT -p tcp --dport 8334 -s 10.0.0.0/8 -j ACCEPT
iptables -A INPUT -p tcp --dport 8334 -j DROP
```

## 🔧 Development

### Adding New Features
1. **XSS Prevention**: Always use `setSafeText()` for dynamic content
2. **Authentication**: Protect all sensitive endpoints with `authenticate()`
3. **Rate Limiting**: Consider per-endpoint limits for heavy operations
4. **Error Handling**: Use exponential backoff for retries

### Testing Security
```bash
# Test XSS protection
curl "http://localhost:8334/dashboard?token=valid-token&test=<script>alert('xss')</script>"

# Test rate limiting
for i in {1..150}; do curl http://localhost:8334/health; done

# Test authentication bypass
curl http://localhost:8334/dashboard
curl -H "Authorization: Bearer invalid-token" http://localhost:8334/dashboard
```

## 📋 API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /` | ✅ | Redirect to dashboard |
| `GET /dashboard` | ✅ | Dashboard HTML page |
| `GET /health` | ✅ | Dashboard data API |
| `POST /auth` | ❌ | Authentication endpoint |
| `GET /health` (no auth) | ❌ | Server health check |

## 🚨 Security Incident Response

### If You Suspect a Breach:
1. **Immediate**: Stop the dashboard server
2. **Investigate**: Check server logs for suspicious activity
3. **Rotate**: Generate new authentication tokens
4. **Update**: Change default credentials if still in use
5. **Audit**: Review all recent access logs

### Log Locations:
- **Access Logs**: Console output (timestamp, method, path, IP)
- **Auth Failures**: Console warnings with IP addresses
- **Error Logs**: Console errors with stack traces

## 🤝 Contributing

When adding features:
1. **Security First**: Review all inputs for injection vulnerabilities
2. **Test Auth**: Verify authentication works on new endpoints  
3. **Rate Limits**: Consider DoS implications of new features
4. **Audit Trail**: Log security-relevant actions

---

**Built with Security in Mind** 🔒  
This dashboard addresses the security vulnerabilities identified in code review:
- ✅ XSS prevention through input sanitization and CSP
- ✅ Authentication middleware for access control  
- ✅ Exponential backoff to prevent infinite reload loops