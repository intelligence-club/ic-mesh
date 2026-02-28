/**
 * Database utilities and validation
 */

const path = require('path');
const fs = require('fs');

/**
 * Validates database path for security and accessibility
 * @param {string} dbPath - Path to validate
 * @returns {string|null} Valid path or null if invalid
 */
function validateDbPath(dbPath) {
  if (!dbPath || typeof dbPath !== 'string') {
    return null;
  }

  // Resolve relative paths
  const resolvedPath = path.resolve(dbPath);
  
  // Basic security checks
  if (resolvedPath.includes('..')) {
    return null;
  }

  // Check if directory exists (create if needed for .db files)
  const dir = path.dirname(resolvedPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (error) {
    return null;
  }

  return resolvedPath;
}

module.exports = {
  validateDbPath
};