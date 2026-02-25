/**
 * AHP — Agent Hiring Protocol: Profile Generation
 * 
 * Generates AHP 1.0 profiles from node registration data,
 * reputation evidence, and ints balance.
 * 
 * Standalone module — takes a DB connection + reputation + ints instances.
 * 
 * Usage:
 *   const AHP = require('./lib/ahp');
 *   const ahp = new AHP(db, reputation, ints);
 *   const profile = ahp.getProfile(nodeId);
 */

class AHP {
  constructor(db, reputation, ints) {
    this.db = db;
    this.reputation = reputation;
    this.ints = ints;
    this._prepareStatements();
  }

  _prepareStatements() {
    this.stmts = {
      getNode: this.db.prepare('SELECT * FROM nodes WHERE nodeId = ?'),
      getAllNodes: this.db.prepare('SELECT * FROM nodes'),
      getJobStats: this.db.prepare(`
        SELECT type, COUNT(*) as count, 
               SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
               SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
               AVG(CASE WHEN status='completed' THEN computeMs ELSE NULL END) as avgMs
        FROM jobs WHERE claimedBy = ? GROUP BY type
      `),
    };
  }

  /**
   * Generate an AHP 1.0 profile for a node.
   */
  getProfile(nodeId) {
    const node = this.stmts.getNode.get(nodeId);
    if (!node) return null;

    const caps = JSON.parse(node.capabilities || '[]');
    const models = JSON.parse(node.models || '[]');
    const jobStats = this.stmts.getJobStats.all(nodeId);
    const account = this.ints.getAccount(nodeId);
    const isOnline = node.lastSeen > Date.now() - 120000;

    // Build reputation summary
    let repSummary;
    try {
      const score = this.reputation.getScore(nodeId);
      repSummary = {
        source: 'ic-mesh',
        trustScore: score.trustScore,
        totalJobs: score.totalJobs || 0,
        completionRate: score.completionRate || 0,
        confidence: score.confidence || 'low',
        summary: `${score.totalJobs || 0} jobs, ${Math.round((score.completionRate || 0) * 100)}% completion`
      };
    } catch (e) {
      repSummary = { source: 'ic-mesh', trustScore: 50, totalJobs: 0, completionRate: 0, confidence: 'none' };
    }

    // Build capability entries with evidence
    const capabilities = caps.map(cap => {
      const stats = jobStats.find(s => s.type === cap) || {};
      return {
        name: cap,
        verified: (stats.completed || 0) >= 10,
        evidence: stats.count
          ? `${stats.completed || 0}/${stats.count} jobs completed (${Math.round(((stats.completed || 0) / stats.count) * 100)}% success)`
          : 'No job history for this capability',
        constraints: {
          avgCompletionSeconds: stats.avgMs ? Math.round(stats.avgMs / 1000) : null
        }
      };
    });

    // Add model capabilities
    if (models.length > 0) {
      capabilities.push({
        name: 'ollama',
        description: `Models: ${models.join(', ')}`,
        verified: jobStats.some(s => s.type === 'inference' && (s.completed || 0) >= 5),
        evidence: (() => {
          const inf = jobStats.find(s => s.type === 'inference');
          return inf ? `${inf.completed || 0} inference jobs completed` : 'No inference history';
        })()
      });
    }

    const cpuIdle = node.cpuIdle || 0;
    const ramFree = node.ramFreeMB || 0;
    const ramTotal = node.ramMB || 0;
    const loadPct = ramTotal > 0 ? Math.round((1 - ramFree / ramTotal) * 100) : 0;

    return {
      ahp: '1.0',
      type: 'agent-profile',
      identity: {
        nodeId,
        name: node.name,
        owner: node.owner,
        region: node.region,
        description: `${node.cpuCores} cores, ${Math.round(ramTotal / 1024)}GB RAM. ${caps.join(', ') || 'general compute'}.`,
        protocols: ['ahp/interview', 'ahp/hire', 'ahp/verify']
      },
      capabilities,
      availability: {
        status: isOnline ? 'available' : 'offline',
        currentLoad: `${loadPct}%`,
        lastSeen: node.lastSeen,
        resources: {
          cpuCores: node.cpuCores,
          ramMB: ramTotal,
          ramFreeMB: ramFree,
          cpuIdle,
          gpuVRAM: node.gpuVRAM || 0,
          diskFreeGB: node.diskFreeGB || 0
        }
      },
      reputation: repSummary,
      economics: {
        currency: 'ints',
        balance: account.balance,
        totalEarned: account.totalEarned,
        totalSpent: account.totalSpent,
        rateMultiplier: 1.0
      },
      generatedAt: Date.now()
    };
  }

  /**
   * List all node profiles.
   */
  getAllProfiles() {
    const nodes = this.stmts.getAllNodes.all();
    return nodes.map(n => this.getProfile(n.nodeId)).filter(Boolean);
  }

  /**
   * Generate server's own AHP profile.
   */
  getServerProfile() {
    const nodes = this.stmts.getAllNodes.all();
    const onlineCount = nodes.filter(n => n.lastSeen > Date.now() - 120000).length;
    const treasuryAccount = this.ints.getAccount('ic-treasury');
    const stats = this.ints.getNetworkStats();

    return {
      ahp: '1.0',
      type: 'agent-profile',
      identity: {
        name: 'ic-mesh',
        role: 'coordination-server',
        description: 'IC Mesh distributed compute coordination server. Routes jobs, manages reputation, settles payments.',
        protocols: ['ahp/interview', 'ahp/hire', 'ahp/verify', 'ahp/profiles']
      },
      capabilities: [
        { name: 'job-routing', description: 'Matches jobs to capable nodes', verified: true },
        { name: 'reputation-management', description: 'Trust scoring from observable behavior', verified: true },
        { name: 'payment-settlement', description: 'Zero-sum integer currency settlement', verified: true },
        { name: 'hiring', description: 'Agent interview and service agreement management', verified: true }
      ],
      network: {
        totalNodes: nodes.length,
        onlineNodes: onlineCount,
        wsConnected: 0  // filled in by server
      },
      economics: {
        currency: 'ints',
        treasuryBalance: treasuryAccount.balance,
        totalTransacted: stats.totalOughtTransacted,
        feeRate: 0.20
      },
      generatedAt: Date.now()
    };
  }
}

module.exports = AHP;
