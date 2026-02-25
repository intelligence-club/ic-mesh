#!/usr/bin/env node

/**
 * IC Mesh Performance Optimizer
 * 
 * Analyzes system performance and provides actionable optimization recommendations.
 * Focuses on database optimization, memory usage, and network efficiency.
 * 
 * Usage:
 *   node scripts/performance-optimizer.js analyze    # Analyze current performance
 *   node scripts/performance-optimizer.js optimize   # Apply safe optimizations  
 *   node scripts/performance-optimizer.js benchmark  # Run performance benchmarks
 *   node scripts/performance-optimizer.js report     # Generate performance report
 */

const fs = require('fs').promises;
const path = require('path');
const { performance } = require('perf_hooks');
const Database = require('better-sqlite3');
const os = require('os');
const v8 = require('v8');

class PerformanceOptimizer {
  constructor() {
    this.dbPath = path.join(__dirname, '..', 'data', 'mesh.db');
    this.logPath = path.join(__dirname, '..', 'data', 'performance.log');
    this.metrics = {
      database: {},
      memory: {},
      cpu: {},
      network: {},
      filesystem: {}
    };
    this.recommendations = [];
  }

  async analyze() {
    console.log('🔍 Analyzing IC Mesh performance...\n');
    
    await this.analyzeDatabasePerformance();
    await this.analyzeMemoryUsage();
    await this.analyzeCPUUsage();
    await this.analyzeNetworkPerformance();
    await this.analyzeFileSystemPerformance();
    
    this.generateRecommendations();
    this.displayResults();
    
    return this.metrics;
  }

  async analyzeDatabasePerformance() {
    console.log('📊 Analyzing database performance...');
    const start = performance.now();
    
    try {
      const db = new Database(this.dbPath, { readonly: true });
      
      // Database size and structure analysis
      const stats = await fs.stat(this.dbPath);
      this.metrics.database.size = stats.size;
      this.metrics.database.sizeHuman = this.formatBytes(stats.size);
      
      // Query performance analysis
      const queries = [
        { name: 'nodes_count', sql: 'SELECT COUNT(*) as count FROM nodes' },
        { name: 'jobs_count', sql: 'SELECT COUNT(*) as count FROM jobs' },
        { name: 'recent_jobs', sql: 'SELECT COUNT(*) as count FROM jobs WHERE createdAt > datetime("now", "-1 hour")' },
        { name: 'active_nodes', sql: 'SELECT COUNT(*) as count FROM nodes WHERE lastSeen > datetime("now", "-5 minutes")' }
      ];
      
      this.metrics.database.queryTimes = {};
      
      for (const query of queries) {
        const queryStart = performance.now();
        const result = db.prepare(query.sql).get();
        const queryTime = performance.now() - queryStart;
        
        this.metrics.database.queryTimes[query.name] = {
          time: queryTime,
          result: result
        };
      }
      
      // Index analysis
      const indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all();
      this.metrics.database.indexes = indexes.length;
      this.metrics.database.indexNames = indexes.map(idx => idx.name);
      
      // Table analysis  
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      this.metrics.database.tableStats = {};
      
      for (const table of tables) {
        try {
          const rowCount = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get();
          const sampleRow = db.prepare(`SELECT * FROM ${table.name} LIMIT 1`).get();
          
          this.metrics.database.tableStats[table.name] = {
            rows: rowCount.count,
            columns: sampleRow ? Object.keys(sampleRow).length : 0
          };
        } catch (e) {
          // Skip system tables that might cause issues
        }
      }
      
      // Check for database fragmentation
      const pragma = db.prepare('PRAGMA integrity_check').get();
      this.metrics.database.integrityCheck = pragma;
      
      const pageCount = db.prepare('PRAGMA page_count').get();
      const freelistCount = db.prepare('PRAGMA freelist_count').get();
      this.metrics.database.fragmentation = {
        pages: pageCount['page_count'],
        freePages: freelistCount['freelist_count'],
        fragmentationPercent: (freelistCount['freelist_count'] / pageCount['page_count'] * 100).toFixed(2)
      };
      
      db.close();
      
    } catch (error) {
      this.metrics.database.error = error.message;
    }
    
    this.metrics.database.analysisTime = performance.now() - start;
    console.log(`   ✓ Database analysis completed in ${this.metrics.database.analysisTime.toFixed(2)}ms`);
  }

  async analyzeMemoryUsage() {
    console.log('🧠 Analyzing memory usage...');
    const start = performance.now();
    
    // Node.js memory usage
    const memUsage = process.memoryUsage();
    this.metrics.memory.node = {
      rss: memUsage.rss,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
      rssHuman: this.formatBytes(memUsage.rss),
      heapUsedHuman: this.formatBytes(memUsage.heapUsed),
      heapTotalHuman: this.formatBytes(memUsage.heapTotal)
    };
    
    // V8 heap statistics
    const heapStats = v8.getHeapStatistics();
    this.metrics.memory.v8 = {
      totalHeapSize: heapStats.total_heap_size,
      usedHeapSize: heapStats.used_heap_size,
      heapSizeLimit: heapStats.heap_size_limit,
      totalPhysicalSize: heapStats.total_physical_size,
      totalAvailableSize: heapStats.total_available_size,
      usedPercent: ((heapStats.used_heap_size / heapStats.total_heap_size) * 100).toFixed(2)
    };
    
    // System memory
    const systemMem = {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem()
    };
    
    this.metrics.memory.system = {
      ...systemMem,
      totalHuman: this.formatBytes(systemMem.total),
      freeHuman: this.formatBytes(systemMem.free),
      usedHuman: this.formatBytes(systemMem.used),
      usedPercent: ((systemMem.used / systemMem.total) * 100).toFixed(2)
    };
    
    // Memory pressure indicators
    this.metrics.memory.pressure = {
      nodeHeapPressure: (memUsage.heapUsed / memUsage.heapTotal) > 0.85,
      systemMemoryPressure: ((systemMem.used / systemMem.total) > 0.9),
      v8HeapPressure: (heapStats.used_heap_size / heapStats.heap_size_limit) > 0.8
    };
    
    this.metrics.memory.analysisTime = performance.now() - start;
    console.log(`   ✓ Memory analysis completed in ${this.metrics.memory.analysisTime.toFixed(2)}ms`);
  }

  async analyzeCPUUsage() {
    console.log('⚡ Analyzing CPU usage...');
    const start = performance.now();
    
    // Basic CPU info
    const cpus = os.cpus();
    this.metrics.cpu.cores = cpus.length;
    this.metrics.cpu.model = cpus[0].model;
    this.metrics.cpu.speed = cpus[0].speed;
    
    // Load averages (Unix systems)
    if (os.loadavg) {
      const loads = os.loadavg();
      this.metrics.cpu.loadAvg = {
        '1min': loads[0],
        '5min': loads[1], 
        '15min': loads[2]
      };
      
      // Load pressure analysis (load avg / core count)
      this.metrics.cpu.loadPressure = {
        '1min': (loads[0] / cpus.length),
        '5min': (loads[1] / cpus.length),
        '15min': (loads[2] / cpus.length)
      };
    }
    
    // Process CPU time
    const cpuUsage = process.cpuUsage();
    this.metrics.cpu.processUsage = {
      user: cpuUsage.user,
      system: cpuUsage.system,
      total: cpuUsage.user + cpuUsage.system
    };
    
    this.metrics.cpu.analysisTime = performance.now() - start;
    console.log(`   ✓ CPU analysis completed in ${this.metrics.cpu.analysisTime.toFixed(2)}ms`);
  }

  async analyzeNetworkPerformance() {
    console.log('🌐 Analyzing network performance...');
    const start = performance.now();
    
    // Network interfaces
    const interfaces = os.networkInterfaces();
    this.metrics.network.interfaces = Object.keys(interfaces).length;
    
    // Simple network connectivity test
    try {
      const testStart = performance.now();
      const testReq = require('http').request({
        hostname: 'localhost',
        port: 8333,
        path: '/status',
        method: 'GET',
        timeout: 5000
      });
      
      await new Promise((resolve, reject) => {
        testReq.on('response', (res) => {
          this.metrics.network.localConnectivity = {
            status: res.statusCode,
            responseTime: performance.now() - testStart
          };
          resolve();
        });
        
        testReq.on('error', (error) => {
          this.metrics.network.localConnectivity = {
            error: error.message,
            responseTime: performance.now() - testStart
          };
          resolve();
        });
        
        testReq.on('timeout', () => {
          this.metrics.network.localConnectivity = {
            error: 'Timeout',
            responseTime: performance.now() - testStart
          };
          resolve();
        });
        
        testReq.end();
      });
    } catch (error) {
      this.metrics.network.localConnectivity = { error: error.message };
    }
    
    this.metrics.network.analysisTime = performance.now() - start;
    console.log(`   ✓ Network analysis completed in ${this.metrics.network.analysisTime.toFixed(2)}ms`);
  }

  async analyzeFileSystemPerformance() {
    console.log('💾 Analyzing filesystem performance...');
    const start = performance.now();
    
    try {
      // Test file I/O performance
      const testFile = path.join(__dirname, '..', 'data', '.perf-test');
      const testData = 'x'.repeat(1024 * 10); // 10KB test data
      
      // Write test
      const writeStart = performance.now();
      await fs.writeFile(testFile, testData);
      const writeTime = performance.now() - writeStart;
      
      // Read test
      const readStart = performance.now();
      await fs.readFile(testFile);
      const readTime = performance.now() - readStart;
      
      // Cleanup
      await fs.unlink(testFile);
      
      this.metrics.filesystem.performance = {
        writeTime,
        readTime,
        writeSpeed: (testData.length / writeTime * 1000).toFixed(2) + ' bytes/sec',
        readSpeed: (testData.length / readTime * 1000).toFixed(2) + ' bytes/sec'
      };
      
      // Check disk space
      const dataDir = path.join(__dirname, '..', 'data');
      const stats = await fs.stat(dataDir);
      
      this.metrics.filesystem.dataDirectory = {
        path: dataDir,
        exists: true,
        accessible: true
      };
      
    } catch (error) {
      this.metrics.filesystem.error = error.message;
    }
    
    this.metrics.filesystem.analysisTime = performance.now() - start;
    console.log(`   ✓ Filesystem analysis completed in ${this.metrics.filesystem.analysisTime.toFixed(2)}ms`);
  }

  generateRecommendations() {
    console.log('💡 Generating optimization recommendations...');
    
    // Database recommendations
    if (this.metrics.database.fragmentation) {
      const fragPercent = parseFloat(this.metrics.database.fragmentation.fragmentationPercent);
      if (fragPercent > 25) {
        this.recommendations.push({
          category: 'database',
          priority: 'high',
          issue: `Database fragmentation at ${fragPercent}%`,
          solution: 'Run VACUUM command to defragment database',
          command: 'sqlite3 data/mesh.db "VACUUM;"'
        });
      }
    }
    
    if (this.metrics.database.size > 100 * 1024 * 1024) { // 100MB
      this.recommendations.push({
        category: 'database',
        priority: 'medium',
        issue: `Large database size: ${this.metrics.database.sizeHuman}`,
        solution: 'Consider archiving old jobs and implementing data retention policies',
        command: 'Implement job cleanup in server.js'
      });
    }
    
    // Memory recommendations
    if (this.metrics.memory.pressure.systemMemoryPressure) {
      this.recommendations.push({
        category: 'memory',
        priority: 'high',
        issue: `System memory usage at ${this.metrics.memory.system.usedPercent}%`,
        solution: 'Reduce memory usage or add more RAM',
        command: 'Monitor memory leaks and optimize data structures'
      });
    }
    
    if (this.metrics.memory.pressure.v8HeapPressure) {
      this.recommendations.push({
        category: 'memory',
        priority: 'medium',
        issue: 'V8 heap approaching limit',
        solution: 'Increase --max-old-space-size or optimize memory usage',
        command: 'node --max-old-space-size=4096 server.js'
      });
    }
    
    // CPU recommendations
    if (this.metrics.cpu.loadPressure && this.metrics.cpu.loadPressure['5min'] > 2) {
      this.recommendations.push({
        category: 'cpu',
        priority: 'high',
        issue: `High CPU load: ${this.metrics.cpu.loadAvg['5min'].toFixed(2)}`,
        solution: 'Optimize CPU-intensive operations or distribute load',
        command: 'Profile application and optimize bottlenecks'
      });
    }
    
    // Network recommendations
    if (this.metrics.network.localConnectivity && this.metrics.network.localConnectivity.responseTime > 1000) {
      this.recommendations.push({
        category: 'network',
        priority: 'medium',
        issue: `Slow local connectivity: ${this.metrics.network.localConnectivity.responseTime.toFixed(2)}ms`,
        solution: 'Investigate network bottlenecks',
        command: 'Check server load and network configuration'
      });
    }
    
    // Filesystem recommendations
    if (this.metrics.filesystem.performance) {
      const writeTime = this.metrics.filesystem.performance.writeTime;
      const readTime = this.metrics.filesystem.performance.readTime;
      
      if (writeTime > 50) {
        this.recommendations.push({
          category: 'filesystem',
          priority: 'medium',
          issue: `Slow disk writes: ${writeTime.toFixed(2)}ms`,
          solution: 'Consider faster storage or optimize I/O operations',
          command: 'Move to SSD or optimize file operations'
        });
      }
    }
  }

  displayResults() {
    console.log('\n📈 Performance Analysis Results\n');
    
    // Overall health score
    let healthScore = 100;
    const highPriorityIssues = this.recommendations.filter(r => r.priority === 'high');
    const mediumPriorityIssues = this.recommendations.filter(r => r.priority === 'medium');
    
    healthScore -= (highPriorityIssues.length * 20);
    healthScore -= (mediumPriorityIssues.length * 10);
    healthScore = Math.max(0, healthScore);
    
    console.log(`🏥 Overall Health Score: ${healthScore}/100`);
    
    if (healthScore >= 90) console.log('   Status: Excellent ✨');
    else if (healthScore >= 70) console.log('   Status: Good ✅');
    else if (healthScore >= 50) console.log('   Status: Needs Attention ⚠️');
    else console.log('   Status: Critical Issues ❌');
    
    console.log('\n📊 Key Metrics:');
    
    // Database metrics
    console.log(`\n💾 Database:`);
    console.log(`   Size: ${this.metrics.database.sizeHuman}`);
    console.log(`   Tables: ${Object.keys(this.metrics.database.tableStats || {}).length}`);
    console.log(`   Indexes: ${this.metrics.database.indexes || 0}`);
    if (this.metrics.database.fragmentation) {
      console.log(`   Fragmentation: ${this.metrics.database.fragmentation.fragmentationPercent}%`);
    }
    
    // Memory metrics
    console.log(`\n🧠 Memory:`);
    console.log(`   Node.js Heap: ${this.metrics.memory.node.heapUsedHuman} / ${this.metrics.memory.node.heapTotalHuman}`);
    console.log(`   System RAM: ${this.metrics.memory.system.usedPercent}% used (${this.metrics.memory.system.usedHuman})`);
    
    // CPU metrics
    console.log(`\n⚡ CPU:`);
    console.log(`   Cores: ${this.metrics.cpu.cores}`);
    if (this.metrics.cpu.loadAvg) {
      console.log(`   Load Average: ${this.metrics.cpu.loadAvg['1min'].toFixed(2)}, ${this.metrics.cpu.loadAvg['5min'].toFixed(2)}, ${this.metrics.cpu.loadAvg['15min'].toFixed(2)}`);
    }
    
    // Recommendations
    if (this.recommendations.length > 0) {
      console.log(`\n💡 Recommendations (${this.recommendations.length}):`);
      
      this.recommendations
        .sort((a, b) => {
          const priorityOrder = { high: 3, medium: 2, low: 1 };
          return priorityOrder[b.priority] - priorityOrder[a.priority];
        })
        .forEach((rec, index) => {
          const priority = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
          console.log(`   ${index + 1}. ${priority} ${rec.issue}`);
          console.log(`      Solution: ${rec.solution}`);
          if (rec.command) {
            console.log(`      Command: ${rec.command}`);
          }
          console.log();
        });
    } else {
      console.log('\n✨ No optimization recommendations - system performing well!');
    }
  }

  async benchmark() {
    console.log('🏁 Running performance benchmarks...\n');
    
    const results = {};
    
    // Database benchmark
    console.log('📊 Database operations...');
    results.database = await this.benchmarkDatabase();
    
    // Memory allocation benchmark
    console.log('🧠 Memory operations...');
    results.memory = await this.benchmarkMemory();
    
    // CPU benchmark
    console.log('⚡ CPU operations...');
    results.cpu = await this.benchmarkCPU();
    
    console.log('\n🏁 Benchmark Results:\n');
    
    Object.entries(results).forEach(([category, result]) => {
      console.log(`${category.toUpperCase()}:`);
      Object.entries(result).forEach(([test, time]) => {
        console.log(`   ${test}: ${time.toFixed(2)}ms`);
      });
      console.log();
    });
    
    return results;
  }

  async benchmarkDatabase() {
    const db = new Database(':memory:'); // In-memory for benchmarking
    
    // Setup test table
    db.exec(`
      CREATE TABLE test_table (
        id INTEGER PRIMARY KEY,
        data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_created_at ON test_table(created_at);
    `);
    
    const results = {};
    
    // Insert benchmark
    const insertStart = performance.now();
    const insertStmt = db.prepare('INSERT INTO test_table (data) VALUES (?)');
    for (let i = 0; i < 1000; i++) {
      insertStmt.run(`test data ${i}`);
    }
    results.insert_1000_rows = performance.now() - insertStart;
    
    // Select benchmark
    const selectStart = performance.now();
    const selectStmt = db.prepare('SELECT * FROM test_table WHERE id = ?');
    for (let i = 1; i <= 100; i++) {
      selectStmt.get(i);
    }
    results.select_100_by_id = performance.now() - selectStart;
    
    // Complex query benchmark
    const complexStart = performance.now();
    db.prepare('SELECT COUNT(*) FROM test_table WHERE data LIKE ?').get('%test%');
    results.complex_query = performance.now() - complexStart;
    
    db.close();
    return results;
  }

  async benchmarkMemory() {
    const results = {};
    
    // Array creation and manipulation
    const arrayStart = performance.now();
    const largeArray = new Array(100000).fill(0).map((_, i) => ({ id: i, data: `item ${i}` }));
    results.create_100k_objects = performance.now() - arrayStart;
    
    // String operations
    const stringStart = performance.now();
    let testString = '';
    for (let i = 0; i < 10000; i++) {
      testString += 'test string ' + i;
    }
    results.string_concatenation_10k = performance.now() - stringStart;
    
    // JSON operations
    const jsonStart = performance.now();
    const testObject = { data: largeArray.slice(0, 1000) };
    const jsonString = JSON.stringify(testObject);
    JSON.parse(jsonString);
    results.json_serialize_parse_1k_objects = performance.now() - jsonStart;
    
    return results;
  }

  async benchmarkCPU() {
    const results = {};
    
    // Mathematical operations
    const mathStart = performance.now();
    let sum = 0;
    for (let i = 0; i < 1000000; i++) {
      sum += Math.sqrt(i) * Math.sin(i);
    }
    results.math_operations_1m = performance.now() - mathStart;
    
    // Sorting
    const sortStart = performance.now();
    const randomArray = new Array(10000).fill(0).map(() => Math.random());
    randomArray.sort();
    results.sort_10k_numbers = performance.now() - sortStart;
    
    // Regular expressions
    const regexStart = performance.now();
    const testText = 'The quick brown fox jumps over the lazy dog'.repeat(1000);
    const regex = /\b\w{4,}\b/g;
    for (let i = 0; i < 1000; i++) {
      testText.match(regex);
    }
    results.regex_matching_1k = performance.now() - regexStart;
    
    return results;
  }

  async optimize() {
    console.log('🔧 Applying safe optimizations...\n');
    
    let optimizationsApplied = 0;
    
    // Database optimizations
    if (this.metrics.database && this.metrics.database.fragmentation) {
      const fragPercent = parseFloat(this.metrics.database.fragmentation.fragmentationPercent);
      
      if (fragPercent > 10) {
        console.log('🗜️ Defragmenting database...');
        try {
          const db = new Database(this.dbPath);
          db.exec('VACUUM;');
          db.close();
          console.log('   ✓ Database defragmentation completed');
          optimizationsApplied++;
        } catch (error) {
          console.log(`   ❌ Database defragmentation failed: ${error.message}`);
        }
      }
    }
    
    // Update database settings for better performance
    console.log('⚙️ Updating database performance settings...');
    try {
      const db = new Database(this.dbPath);
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA cache_size = 10000;
        PRAGMA temp_store = MEMORY;
      `);
      db.close();
      console.log('   ✓ Database performance settings updated');
      optimizationsApplied++;
    } catch (error) {
      console.log(`   ❌ Failed to update database settings: ${error.message}`);
    }
    
    // Memory optimization suggestions
    if (this.metrics.memory && this.metrics.memory.pressure.nodeHeapPressure) {
      console.log('🧠 Memory optimization needed:');
      console.log('   Suggestion: Restart the server to clear memory leaks');
      console.log('   Command: pm2 restart ic-mesh || systemctl restart ic-mesh');
    }
    
    console.log(`\n✨ Applied ${optimizationsApplied} optimizations`);
    
    if (optimizationsApplied > 0) {
      console.log('\n💡 Recommendation: Restart the server to apply all optimizations');
      console.log('   Command: npm run restart || node server.js');
    }
  }

  async generateReport() {
    console.log('📋 Generating performance report...\n');
    
    await this.analyze();
    
    const report = {
      timestamp: new Date().toISOString(),
      metrics: this.metrics,
      recommendations: this.recommendations,
      summary: {
        healthScore: Math.max(0, 100 - (this.recommendations.filter(r => r.priority === 'high').length * 20) - (this.recommendations.filter(r => r.priority === 'medium').length * 10)),
        criticalIssues: this.recommendations.filter(r => r.priority === 'high').length,
        totalRecommendations: this.recommendations.length
      }
    };
    
    const reportPath = path.join(__dirname, '..', 'data', `performance-report-${Date.now()}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`📄 Report saved to: ${reportPath}`);
    console.log(`📊 Health Score: ${report.summary.healthScore}/100`);
    console.log(`🔴 Critical Issues: ${report.summary.criticalIssues}`);
    console.log(`💡 Total Recommendations: ${report.summary.totalRecommendations}`);
    
    return report;
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// CLI handling
async function main() {
  const command = process.argv[2] || 'analyze';
  const optimizer = new PerformanceOptimizer();
  
  try {
    switch (command) {
      case 'analyze':
        await optimizer.analyze();
        break;
        
      case 'optimize':
        await optimizer.analyze();
        await optimizer.optimize();
        break;
        
      case 'benchmark':
        await optimizer.benchmark();
        break;
        
      case 'report':
        await optimizer.generateReport();
        break;
        
      default:
        console.log('Usage: node scripts/performance-optimizer.js [analyze|optimize|benchmark|report]');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Performance optimizer error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = PerformanceOptimizer;