# Discord Monitoring Integration

Enhanced emergency recovery monitoring with Discord webhook alerts for IC Mesh network status.

## Setup

### 1. Create Discord Webhook

1. Go to your Discord server settings
2. Navigate to Integrations → Webhooks
3. Click "New Webhook"
4. Name it "IC Mesh Monitoring"
5. Select the channel for alerts (e.g., #alerts or #ic-mesh-status)
6. Copy the webhook URL

### 2. Configure Environment

Set the Discord webhook URL in your environment:

```bash
# Option 1: IC-specific variable
export IC_DISCORD_WEBHOOK="https://discord.com/api/webhooks/your/webhook/url"

# Option 2: Generic Discord webhook variable
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/your/webhook/url"
```

### 3. Test the Integration

Run the emergency recovery monitor:

```bash
node emergency-recovery-monitor.js
```

When alerts are triggered, you'll see both console output and Discord messages.

## Alert Types

The system sends Discord alerts for:

### Network Outages
- **Severity:** Critical (🚨)
- **Triggered:** When 0 active nodes detected
- **Content:** Node count, duration, system status

### Capacity Bottlenecks  
- **Severity:** High (🔥)
- **Triggered:** When pending jobs exceed capacity significantly
- **Content:** Job queue depth, processing rate, active nodes

### Node Disconnections
- **Severity:** Medium (⚠️)
- **Triggered:** When nodes go offline unexpectedly
- **Content:** Node ID, last seen time, capability impact

### Service Recovery
- **Severity:** Low (💙)
- **Triggered:** When systems return to healthy state
- **Content:** Recovery details, performance metrics

## Discord Message Format

```json
{
  "embeds": [{
    "title": "🚨 IC Mesh Alert: NETWORK_OUTAGE",
    "description": "Complete network outage detected - 0 active nodes",
    "color": 16711680,
    "timestamp": "2026-02-27T18:55:00Z",
    "fields": [
      {
        "name": "Severity",
        "value": "CRITICAL",
        "inline": true
      },
      {
        "name": "Active Nodes", 
        "value": "0/7",
        "inline": true
      },
      {
        "name": "Duration",
        "value": "15 minutes",
        "inline": true
      }
    ]
  }]
}
```

## Configuration Options

### Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `IC_DISCORD_WEBHOOK` | IC Mesh webhook URL | https://discord.com/api/webhooks/... |
| `DISCORD_WEBHOOK_URL` | Generic webhook fallback | https://discord.com/api/webhooks/... |

### Alert Thresholds

Customize alert sensitivity in `emergency-recovery-monitor.js`:

```javascript
const CONFIG = {
    outageThresholdMinutes: 5,     // Network outage detection
    capacityRatio: 10,             // Jobs:nodes ratio for bottleneck alerts
    checkIntervalMs: 60000,        // How often to check status
    retryAttempts: 3               // Retries before sending alert
};
```

## Channel Recommendations

### Production Setup
- **#ic-mesh-critical**: Critical alerts only (network outages, data loss)
- **#ic-mesh-alerts**: All monitoring alerts 
- **#ic-mesh-status**: Status updates and recovery notifications

### Development Setup
- **#dev-alerts**: All development environment alerts
- **#testing**: Test alert validation

## Integration Best Practices

1. **Separate Channels**: Use different channels for different severity levels
2. **Role Mentions**: Configure `@everyone` only for critical alerts
3. **Rate Limiting**: System includes built-in rate limiting to prevent spam
4. **Fallback Logging**: All alerts are logged to files even if Discord fails

## Troubleshooting

### Discord Alert Not Sending

1. **Check webhook URL**: Ensure environment variable is set correctly
2. **Verify permissions**: Webhook needs permission to send messages to target channel
3. **Test manually**: Use curl to test webhook directly:

```bash
curl -X POST "$IC_DISCORD_WEBHOOK" \
  -H "Content-Type: application/json" \
  -d '{"content": "Test message from IC Mesh monitoring"}'
```

### False Alerts

- **Database locks**: Temporary database access issues can trigger false outages
- **Network blips**: Brief connectivity issues may cause false node disconnections
- **Solution**: Monitoring includes retry logic and threshold delays

## Security Considerations

1. **Webhook Protection**: Keep webhook URLs private - they allow posting to your Discord
2. **Environment Variables**: Use `.env` files or secure environment management
3. **Channel Access**: Limit access to alert channels to relevant team members

This integration transforms the emergency recovery monitor from a local logging tool into a real-time collaborative alerting system.