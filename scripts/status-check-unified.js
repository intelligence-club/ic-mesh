#!/usr/bin/env node

/**
 * Unified Status Check - Official IC Mesh status command
 * Single source of truth to replace inconsistent monitoring tools
 */

const path = require('path');
const parentDir = path.dirname(__dirname);
const unifiedMonitor = require(path.join(parentDir, 'unified-status-monitor.js'));

// This script is just a wrapper around the unified monitor
// It can be run via `npm run status:unified` or directly

if (require.main === module) {
    // Re-export the unified monitor functionality
    require(path.join(parentDir, 'unified-status-monitor.js'));
}