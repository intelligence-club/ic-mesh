/**
 * IC Mesh — Reputation Module
 * 
 * Standalone trust scoring system for compute nodes (and eventually agents).
 * Designed to be extracted into its own package when ready.
 * 
 * Usage:
 *   const Reputation = require('./lib/reputation');
 *   const rep = new Reputation(db);  // pass a better-sqlite3 instance
 *   rep.recordEvent({ nodeId, type: 'job_completed', jobType: 'transcribe', ... });
 *   const score = rep.getScore(nodeId);
 */

const crypto = require('crypto');

// Score weights — fully automated, no subjective ratings
// Inspired by PageRank: trust is earned through observable behavior,
// not through votes. Nodes prove themselves by doing good work
// that passes automated verification and cross-node agreement.
const WEIGHTS = {
  completion: 0.30,   // Did you finish what you started?
  honesty: 0.25,      // Are your capabilities real?
  verification: 0.25, // Does your output pass automated checks?
  latency: 0.10,      // Are you fast?
  uptime: 0.10        // Are you reliably online?
};

// How much recent events matter vs old ones (exponential decay)
const RECENCY_HALFLIFE_DAYS = 30;

// New nodes start here
const DEFAULT_SCORE = 50;

// Min events before score is considered "established"
const MIN_EVENTS_FOR_CONFIDENCE = 10;

// Capability verification thresholds
const CAP_VERIFIED_THRESHOLD = 10;    // 10+ successful jobs = verified
const CAP_SUSPECT_THRESHOLD = 0.3;    // 30%+ failure rate = suspect

class Reputation {
  constructor(db) {
    this.db = db;
    this._initTables();
    this._prepareStatements();
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reputation_scores (
        nodeId TEXT PRIMARY KEY,
        trustScore REAL DEFAULT ${DEFAULT_SCORE},
        completionRate REAL DEFAULT 0,
        honestyScore REAL DEFAULT 100,
        qualityScore REAL DEFAULT ${DEFAULT_SCORE},
        latencyScore REAL DEFAULT ${DEFAULT_SCORE},
        uptimeScore REAL DEFAULT ${DEFAULT_SCORE},
        totalJobs INTEGER DEFAULT 0,
        totalCompleted INTEGER DEFAULT 0,
        totalFailed INTEGER DEFAULT 0,
        totalTimeout INTEGER DEFAULT 0,
        verifiedCapabilities TEXT DEFAULT '[]',
        suspectCapabilities TEXT DEFAULT '[]',
        lastUpdated INTEGER,
        createdAt INTEGER
      );

      CREATE TABLE IF NOT EXISTS reputation_events (
        eventId TEXT PRIMARY KEY,
        nodeId TEXT NOT NULL,
        type TEXT NOT NULL,
        jobId TEXT,
        jobType TEXT,
        details TEXT,
        impact REAL DEFAULT 0,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rep_events_node ON reputation_events(nodeId, timestamp);
      CREATE INDEX IF NOT EXISTS idx_rep_events_type ON reputation_events(type);

      CREATE TABLE IF NOT EXISTS reputation_verifications (
        verificationId TEXT PRIMARY KEY,
        jobId TEXT NOT NULL,
        nodeId TEXT NOT NULL,
        method TEXT NOT NULL,
        result TEXT NOT NULL,
        details TEXT,
        timestamp INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_rep_verif_job ON reputation_verifications(jobId);
    `);
  }

  _prepareStatements() {
    this.stmts = {
      getScore: this.db.prepare('SELECT * FROM reputation_scores WHERE nodeId = ?'),
      upsertScore: this.db.prepare(`
        INSERT INTO reputation_scores (nodeId, trustScore, completionRate, honestyScore, qualityScore, latencyScore, uptimeScore,
          totalJobs, totalCompleted, totalFailed, totalTimeout, verifiedCapabilities, suspectCapabilities, lastUpdated, createdAt)
        VALUES (@nodeId, @trustScore, @completionRate, @honestyScore, @qualityScore, @latencyScore, @uptimeScore,
          @totalJobs, @totalCompleted, @totalFailed, @totalTimeout, @verifiedCapabilities, @suspectCapabilities, @lastUpdated, @createdAt)
        ON CONFLICT(nodeId) DO UPDATE SET
          trustScore=@trustScore, completionRate=@completionRate, honestyScore=@honestyScore,
          qualityScore=@qualityScore, latencyScore=@latencyScore, uptimeScore=@uptimeScore,
          totalJobs=@totalJobs, totalCompleted=@totalCompleted, totalFailed=@totalFailed,
          totalTimeout=@totalTimeout, verifiedCapabilities=@verifiedCapabilities,
          suspectCapabilities=@suspectCapabilities, lastUpdated=@lastUpdated
      `),
      insertEvent: this.db.prepare(`
        INSERT INTO reputation_events (eventId, nodeId, type, jobId, jobType, details, impact, timestamp)
        VALUES (@eventId, @nodeId, @type, @jobId, @jobType, @details, @impact, @timestamp)
      `),
      getEvents: this.db.prepare('SELECT * FROM reputation_events WHERE nodeId = ? ORDER BY timestamp DESC LIMIT ?'),
      getEventsByType: this.db.prepare('SELECT * FROM reputation_events WHERE nodeId = ? AND type = ? ORDER BY timestamp DESC LIMIT ?'),
      getRecentEvents: this.db.prepare('SELECT * FROM reputation_events WHERE nodeId = ? AND timestamp > ? ORDER BY timestamp DESC'),
      countByType: this.db.prepare(`
        SELECT type, COUNT(*) as count FROM reputation_events WHERE nodeId = ? AND jobType = ? GROUP BY type
      `),
      insertVerification: this.db.prepare(`
        INSERT INTO reputation_verifications (verificationId, jobId, nodeId, method, result, details, timestamp)
        VALUES (@verificationId, @jobId, @nodeId, @method, @result, @details, @timestamp)
      `),
      getAllScores: this.db.prepare('SELECT * FROM reputation_scores ORDER BY trustScore DESC'),
      getTopScores: this.db.prepare('SELECT * FROM reputation_scores ORDER BY trustScore DESC LIMIT ?'),
      getAllNodeIds: this.db.prepare('SELECT DISTINCT nodeId FROM reputation_events'),
    };
  }

  // ===== Core API =====

  /**
   * Get a node's reputation summary.
   */
  getScore(nodeId) {
    const row = this.stmts.getScore.get(nodeId);
    if (!row) return this._defaultScore(nodeId);

    return {
      nodeId: row.nodeId,
      trustScore: Math.round(row.trustScore * 10) / 10,
      completionRate: Math.round(row.completionRate * 10) / 10,
      honestyScore: Math.round(row.honestyScore * 10) / 10,
      verificationScore: Math.round(row.qualityScore * 10) / 10,
      latencyScore: Math.round(row.latencyScore * 10) / 10,
      uptimeScore: Math.round(row.uptimeScore * 10) / 10,
      totalJobs: row.totalJobs,
      totalCompleted: row.totalCompleted,
      totalFailed: row.totalFailed,
      totalTimeout: row.totalTimeout,
      verifiedCapabilities: JSON.parse(row.verifiedCapabilities || '[]'),
      suspectCapabilities: JSON.parse(row.suspectCapabilities || '[]'),
      established: row.totalJobs >= MIN_EVENTS_FOR_CONFIDENCE,
      lastUpdated: row.lastUpdated
    };
  }

  _defaultScore(nodeId) {
    return {
      nodeId,
      trustScore: DEFAULT_SCORE,
      completionRate: 0,
      honestyScore: 100,
      verificationScore: DEFAULT_SCORE,
      latencyScore: DEFAULT_SCORE,
      uptimeScore: DEFAULT_SCORE,
      totalJobs: 0, totalCompleted: 0, totalFailed: 0, totalTimeout: 0,
      verifiedCapabilities: [], suspectCapabilities: [],
      established: false,
      lastUpdated: null
    };
  }

  /**
   * Record a reputation event and recalculate score.
   */
  recordEvent(event) {
    const eventId = event.eventId || `evt_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();

    // Calculate impact before inserting
    const impact = this._calculateImpact(event);

    this.stmts.insertEvent.run({
      eventId,
      nodeId: event.nodeId,
      type: event.type,
      jobId: event.jobId || null,
      jobType: event.jobType || null,
      details: JSON.stringify(event.details || {}),
      impact,
      timestamp: event.timestamp || now
    });

    // Recalculate score
    this.recalculate(event.nodeId);

    return { eventId, impact };
  }

  /**
   * Get event history for a node.
   */
  getHistory(nodeId, { limit = 50, since = 0 } = {}) {
    if (since) {
      return this.stmts.getRecentEvents.all(nodeId, since).map(this._parseEvent);
    }
    return this.stmts.getEvents.all(nodeId, limit).map(this._parseEvent);
  }

  _parseEvent(row) {
    return {
      ...row,
      details: JSON.parse(row.details || '{}')
    };
  }

  // ===== Score Calculation =====

  _calculateImpact(event) {
    switch (event.type) {
      case 'job_completed': return +2.0;
      case 'job_failed': return -5.0;
      case 'job_timeout': return -8.0;
      case 'verification_passed': return +4.0;   // automated verification is high-value signal
      case 'verification_failed': return -12.0;  // output didn't match — serious
      case 'cross_verification_agree': return +3.0;  // two nodes agreed
      case 'cross_verification_disagree': return -6.0; // disagreement — lower-rep node takes hit
      case 'capability_confirmed': return +1.0;
      case 'capability_suspect': return -4.0;
      case 'uptime_checkin': return +0.1;
      case 'uptime_miss': return -1.0;
      default: return 0;
    }
  }

  /**
   * Recalculate a node's trust score from its event history.
   */
  recalculate(nodeId) {
    const events = this.stmts.getEvents.all(nodeId, 1000);
    if (!events.length) return this._defaultScore(nodeId);

    const now = Date.now();
    let totalJobs = 0, completed = 0, failed = 0, timeout = 0;
    let latencySum = 0, latencyCount = 0;
    let qualitySum = 0, qualityCount = 0;
    let checkins = 0, missedCheckins = 0;

    // Capability tracking: { cap: { success: n, fail: n } }
    const capStats = {};

    for (const evt of events) {
      const details = JSON.parse(evt.details || '{}');
      const age = (now - evt.timestamp) / (86400000); // days
      const recencyWeight = Math.pow(0.5, age / RECENCY_HALFLIFE_DAYS);

      switch (evt.type) {
        case 'job_completed':
          totalJobs++;
          completed++;
          if (details.claimed_time && details.actual_time) {
            const ratio = details.claimed_time / Math.max(details.actual_time, 1);
            latencySum += Math.min(ratio, 2) * recencyWeight;
            latencyCount += recencyWeight;
          }
          // Track capability success
          if (evt.jobType) {
            if (!capStats[evt.jobType]) capStats[evt.jobType] = { success: 0, fail: 0 };
            capStats[evt.jobType].success++;
          }
          break;

        case 'job_failed':
          totalJobs++;
          failed++;
          if (evt.jobType) {
            if (!capStats[evt.jobType]) capStats[evt.jobType] = { success: 0, fail: 0 };
            capStats[evt.jobType].fail++;
          }
          break;

        case 'job_timeout':
          totalJobs++;
          timeout++;
          if (evt.jobType) {
            if (!capStats[evt.jobType]) capStats[evt.jobType] = { success: 0, fail: 0 };
            capStats[evt.jobType].fail++;
          }
          break;

        case 'verification_passed':
        case 'cross_verification_agree': {
          qualitySum += 100 * recencyWeight;
          qualityCount += recencyWeight;
          break;
        }

        case 'verification_failed':
        case 'cross_verification_disagree': {
          qualitySum += 0;
          qualityCount += recencyWeight;
          break;
        }

        case 'uptime_checkin': checkins++; break;
        case 'uptime_miss': missedCheckins++; break;
      }
    }

    // Calculate sub-scores
    const completionRate = totalJobs > 0 ? (completed / totalJobs) * 100 : 0;
    const latencyScore = latencyCount > 0 ? Math.min((latencySum / latencyCount) * 100, 100) : DEFAULT_SCORE;
    const verificationScore = qualityCount > 0 ? qualitySum / qualityCount : DEFAULT_SCORE;
    const uptimeTotal = checkins + missedCheckins;
    const uptimeScore = uptimeTotal > 0 ? (checkins / uptimeTotal) * 100 : DEFAULT_SCORE;

    // Honesty: based on capability claim accuracy
    let honestyScore = 100;
    const verifiedCaps = [];
    const suspectCaps = [];

    for (const [cap, stats] of Object.entries(capStats)) {
      const total = stats.success + stats.fail;
      const failRate = total > 0 ? stats.fail / total : 0;

      if (total >= CAP_VERIFIED_THRESHOLD && failRate < CAP_SUSPECT_THRESHOLD) {
        verifiedCaps.push(cap);
      } else if (total >= 3 && failRate >= CAP_SUSPECT_THRESHOLD) {
        suspectCaps.push(cap);
        honestyScore -= 15; // Each suspect capability docks 15 points
      }
    }
    honestyScore = Math.max(honestyScore, 0);

    // Composite trust score — PageRank-style: purely from observable behavior
    const trustScore = Math.min(100, Math.max(0,
      completionRate * WEIGHTS.completion +
      honestyScore * WEIGHTS.honesty +
      verificationScore * WEIGHTS.verification +
      latencyScore * WEIGHTS.latency +
      uptimeScore * WEIGHTS.uptime
    ));

    const scoreData = {
      nodeId,
      trustScore,
      completionRate,
      honestyScore,
      qualityScore: verificationScore,  // DB column is still qualityScore for compat
      latencyScore,
      uptimeScore,
      totalJobs,
      totalCompleted: completed,
      totalFailed: failed,
      totalTimeout: timeout,
      verifiedCapabilities: JSON.stringify(verifiedCaps),
      suspectCapabilities: JSON.stringify(suspectCaps),
      lastUpdated: now,
      createdAt: now
    };

    this.stmts.upsertScore.run(scoreData);
    return this.getScore(nodeId);
  }

  // ===== Verification =====

  verifyJob(jobId, nodeId, method, result, details = {}) {
    const verificationId = `ver_${crypto.randomBytes(8).toString('hex')}`;
    this.stmts.insertVerification.run({
      verificationId, jobId, nodeId, method, result,
      details: JSON.stringify(details),
      timestamp: Date.now()
    });

    // Record as reputation event
    this.recordEvent({
      nodeId,
      type: result === 'pass' ? 'verification_passed' : 'verification_failed',
      jobId,
      details: { method, ...details }
    });

    return { verificationId };
  }

  // ===== Capabilities =====

  confirmCapability(nodeId, capability) {
    this.recordEvent({
      nodeId,
      type: 'capability_confirmed',
      details: { capability }
    });
  }

  suspectCapability(nodeId, capability) {
    this.recordEvent({
      nodeId,
      type: 'capability_suspect',
      details: { capability }
    });
  }

  // ===== Leaderboard =====

  getLeaderboard({ limit = 20 } = {}) {
    return this.stmts.getTopScores.all(limit).map(row => ({
      nodeId: row.nodeId,
      trustScore: Math.round(row.trustScore * 10) / 10,
      totalJobs: row.totalJobs,
      totalCompleted: row.totalCompleted,
      completionRate: Math.round(row.completionRate * 10) / 10,
      verifiedCapabilities: JSON.parse(row.verifiedCapabilities || '[]'),
      established: row.totalJobs >= MIN_EVENTS_FOR_CONFIDENCE
    }));
  }

  // ===== Maintenance =====

  /**
   * Decay all scores toward DEFAULT_SCORE.
   * Call this periodically (e.g., daily).
   */
  decayScores() {
    const allScores = this.stmts.getAllScores.all();
    const now = Date.now();
    let updated = 0;

    for (const row of allScores) {
      const daysSinceUpdate = (now - (row.lastUpdated || now)) / 86400000;
      if (daysSinceUpdate < 1) continue; // Only decay if >1 day stale

      const decayFactor = Math.pow(0.5, daysSinceUpdate / RECENCY_HALFLIFE_DAYS);
      const decayedScore = DEFAULT_SCORE + (row.trustScore - DEFAULT_SCORE) * decayFactor;

      if (Math.abs(decayedScore - row.trustScore) > 0.1) {
        this.stmts.upsertScore.run({
          ...row,
          trustScore: decayedScore,
          lastUpdated: now
        });
        updated++;
      }
    }

    return { updated };
  }
}

module.exports = Reputation;
