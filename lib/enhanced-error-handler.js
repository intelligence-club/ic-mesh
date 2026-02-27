/**
 * Enhanced Error Handler for IC Mesh
 * Provides user-friendly error messages with clear solutions
 */

const errorMappings = {
  "ECONNREFUSED": {
    "userMessage": "Cannot connect to IC Mesh server",
    "solution": "Check your internet connection and verify the server URL is correct",
    "action": "Retry in a few seconds, or check https://moilol.com:8333/status"
  },
  "ENOTFOUND": {
    "userMessage": "Server hostname not found",
    "solution": "Check your DNS settings and internet connectivity",
    "action": "Verify you can reach https://moilol.com in your browser"
  },
  "ETIMEDOUT": {
    "userMessage": "Connection timed out",
    "solution": "Server may be temporarily unavailable or your connection is slow",
    "action": "Wait a moment and try again, or check your firewall settings"
  },
  "EACCES": {
    "userMessage": "Permission denied",
    "solution": "The application lacks necessary permissions",
    "action": "Check file permissions or run with appropriate privileges"
  },
  "ENOENT": {
    "userMessage": "Required file or command not found",
    "solution": "A required dependency may not be installed",
    "action": "Verify all dependencies are installed: npm install"
  }
};

class EnhancedErrorHandler {
  static formatError(err) {
    const code = err.code || err.errno || 'UNKNOWN';
    const mapping = errorMappings[code];
    
    if (mapping) {
      return {
        type: 'user-friendly',
        title: mapping.userMessage,
        description: err.message,
        solution: mapping.solution,
        action: mapping.action,
        originalError: err
      };
    }
    
    return {
      type: 'technical',
      title: 'Unexpected Error',
      description: err.message,
      solution: 'This appears to be a technical issue. Please check the logs for details.',
      action: 'Try restarting the application or contact support if the issue persists',
      originalError: err
    };
  }

  static logError(err) {
    const formatted = this.formatError(err);
    
    console.error('\n❌ \x1b[31mError occurred\x1b[0m');
    console.error(`📋 Problem: ${formatted.title}`);
    if (formatted.description !== formatted.title) {
      console.error(`📝 Details: ${formatted.description}`);
    }
    console.error(`🔧 Solution: ${formatted.solution}`);
    console.error(`🎯 Next Step: ${formatted.action}`);
    
    // Only show technical details if requested
    if (process.env.IC_DEBUG === 'true' || process.env.NODE_ENV === 'development') {
      console.error('\n🔍 Technical Details:');
      console.error(formatted.originalError.stack || formatted.originalError);
    }
    
    console.error(''); // Empty line for readability
  }

  static wrapAsyncFunction(fn, context = 'operation') {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        console.error(`\n⚠️  Error during ${context}:`);
        this.logError(err);
        throw err;
      }
    };
  }
}

module.exports = EnhancedErrorHandler;
