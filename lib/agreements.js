/**
 * Agreements — AHP Layer 2: Service Agreements
 * 
 * Formalizes working relationships between the mesh and nodes
 * after successful interviews.
 * 
 * Standalone module — takes a DB connection.
 * 
 * Usage:
 *   const Agreements = require('./lib/agreements');
 *   const agreements = new Agreements(db);
 *   agreements.create({ nodeId, interviewId, scope, terms, evaluation });
 *   agreements.get(agreementId);
 *   agreements.hasActiveAgreement(nodeId);
 */

const crypto = require('crypto');

class Agreements {
  constructor(db) {
    this.db = db;
    this._initTables();
    this._prepareStatements();
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ahp_agreements (
        agreementId TEXT PRIMARY KEY,
        nodeId TEXT NOT NULL,
        interviewId TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        scope TEXT NOT NULL DEFAULT '{}',
        terms TEXT NOT NULL DEFAULT '{}',
        evaluation TEXT NOT NULL DEFAULT '{}',
        jobsCompleted INTEGER DEFAULT 0,
        jobsFailed INTEGER DEFAULT 0,
        intsEarned INTEGER DEFAULT 0,
        createdAt INTEGER NOT NULL,
        expiresAt INTEGER,
        terminatedAt INTEGER,
        terminationReason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ahp_agreements_node ON ahp_agreements(nodeId);
      CREATE INDEX IF NOT EXISTS idx_ahp_agreements_status ON ahp_agreements(status);
    `);
  }

  _prepareStatements() {
    this.stmts = {
      insert: this.db.prepare(`
        INSERT INTO ahp_agreements (agreementId, nodeId, interviewId, status, scope, terms, evaluation, createdAt, expiresAt)
        VALUES (@agreementId, @nodeId, @interviewId, 'active', @scope, @terms, @evaluation, @createdAt, @expiresAt)
      `),
      get: this.db.prepare('SELECT * FROM ahp_agreements WHERE agreementId = ?'),
      getByNode: this.db.prepare('SELECT * FROM ahp_agreements WHERE nodeId = ? ORDER BY createdAt DESC'),
      getActiveByNode: this.db.prepare("SELECT * FROM ahp_agreements WHERE nodeId = ? AND status = 'active'"),
      list: this.db.prepare('SELECT * FROM ahp_agreements ORDER BY createdAt DESC LIMIT ?'),
      listByStatus: this.db.prepare('SELECT * FROM ahp_agreements WHERE status = ? ORDER BY createdAt DESC LIMIT ?'),
      listByNodeAndStatus: this.db.prepare('SELECT * FROM ahp_agreements WHERE nodeId = ? AND status = ? ORDER BY createdAt DESC LIMIT ?'),
      countActive: this.db.prepare("SELECT COUNT(*) as count FROM ahp_agreements WHERE status = 'active'"),
      update: this.db.prepare(`
        UPDATE ahp_agreements SET status=@status, terminatedAt=@terminatedAt, terminationReason=@terminationReason
        WHERE agreementId=@agreementId
      `),
      incrementJobs: this.db.prepare(`
        UPDATE ahp_agreements SET jobsCompleted = jobsCompleted + 1, intsEarned = intsEarned + ?
        WHERE agreementId = ?
      `),
      incrementFailed: this.db.prepare(`
        UPDATE ahp_agreements SET jobsFailed = jobsFailed + 1
        WHERE agreementId = ?
      `),
      getExpired: this.db.prepare("SELECT * FROM ahp_agreements WHERE status = 'active' AND expiresAt IS NOT NULL AND expiresAt < ?"),
    };
  }

  /**
   * Create a service agreement.
   */
  create({ nodeId, interviewId, scope = {}, terms = {}, evaluation = {} }) {
    if (!nodeId) throw new Error('nodeId is required');

    const agreementId = `agr_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();
    const durationMs = (terms.durationDays || 30) * 86400000;
    const expiresAt = now + durationMs;

    // Default scope
    const fullScope = {
      jobTypes: scope.jobTypes || [],
      maxJobsPerDay: scope.maxJobsPerDay || 100,
      maxIntsPerDay: scope.maxIntsPerDay || 10000,
      qualityStandard: scope.qualityStandard || 'default',
      ...scope
    };

    // Default terms
    const fullTerms = {
      durationDays: terms.durationDays || 30,
      renewalPolicy: terms.renewalPolicy || 'manual',
      terminationPolicy: terms.terminationPolicy || 'either party, immediate, no penalty',
      ...terms
    };

    // Default evaluation criteria
    const fullEval = {
      reviewFrequencyDays: evaluation.reviewFrequencyDays || 7,
      minimumSuccessRate: evaluation.minimumSuccessRate || 0.95,
      method: evaluation.method || 'automated verification',
      ...evaluation
    };

    this.stmts.insert.run({
      agreementId,
      nodeId,
      interviewId: interviewId || null,
      scope: JSON.stringify(fullScope),
      terms: JSON.stringify(fullTerms),
      evaluation: JSON.stringify(fullEval),
      createdAt: now,
      expiresAt
    });

    return this._toJSON(this.stmts.get.get(agreementId));
  }

  /**
   * Get an agreement by ID.
   */
  get(agreementId) {
    const row = this.stmts.get.get(agreementId);
    return row ? this._toJSON(row) : null;
  }

  /**
   * Check if a node has an active agreement.
   */
  hasActiveAgreement(nodeId) {
    const rows = this.stmts.getActiveByNode.all(nodeId);
    return rows.length > 0;
  }

  /**
   * Get active agreements for a node.
   */
  getActiveAgreements(nodeId) {
    return this.stmts.getActiveByNode.all(nodeId).map(r => this._toJSON(r));
  }

  /**
   * Count active agreements.
   */
  countActive() {
    return this.stmts.countActive.get().count;
  }

  /**
   * List agreements with optional filters.
   */
  list({ nodeId, status, limit = 50 } = {}) {
    if (nodeId && status) return this.stmts.listByNodeAndStatus.all(nodeId, status, limit).map(r => this._toJSON(r));
    if (status) return this.stmts.listByStatus.all(status, limit).map(r => this._toJSON(r));
    return this.stmts.list.all(limit).map(r => this._toJSON(r));
  }

  /**
   * Terminate an agreement.
   */
  terminate(agreementId, reason = 'Manual termination') {
    const row = this.stmts.get.get(agreementId);
    if (!row) throw new Error(`Agreement not found: ${agreementId}`);
    if (row.status !== 'active') throw new Error(`Agreement is already ${row.status}`);

    this.stmts.update.run({
      agreementId,
      status: 'terminated',
      terminatedAt: Date.now(),
      terminationReason: reason
    });

    return this._toJSON(this.stmts.get.get(agreementId));
  }

  /**
   * Record a completed job under an agreement.
   */
  recordJobCompleted(nodeId, intsEarned = 0) {
    const actives = this.stmts.getActiveByNode.all(nodeId);
    for (const agr of actives) {
      this.stmts.incrementJobs.run(intsEarned, agr.agreementId);
    }
  }

  /**
   * Record a failed job under an agreement.
   */
  recordJobFailed(nodeId) {
    const actives = this.stmts.getActiveByNode.all(nodeId);
    for (const agr of actives) {
      this.stmts.incrementFailed.run(agr.agreementId);
    }
  }

  /**
   * Expire old agreements.
   */
  expireAgreements() {
    const expired = this.stmts.getExpired.all(Date.now());
    for (const agr of expired) {
      this.stmts.update.run({
        agreementId: agr.agreementId,
        status: 'expired',
        terminatedAt: Date.now(),
        terminationReason: 'Agreement duration expired'
      });
    }
    return expired.length;
  }

  _toJSON(row) {
    if (!row) return null;
    return {
      agreementId: row.agreementId,
      nodeId: row.nodeId,
      interviewId: row.interviewId,
      status: row.status,
      scope: JSON.parse(row.scope),
      terms: JSON.parse(row.terms),
      evaluation: JSON.parse(row.evaluation),
      jobsCompleted: row.jobsCompleted,
      jobsFailed: row.jobsFailed,
      intsEarned: row.intsEarned,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      terminatedAt: row.terminatedAt,
      terminationReason: row.terminationReason
    };
  }
}

module.exports = Agreements;
