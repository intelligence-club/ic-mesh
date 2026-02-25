/**
 * Interviewer — AHP Layer 1: Structured Agent Interviews
 * 
 * Evaluates nodes through template-based questions and practical tests.
 * No external LLM — uses structured templates and algorithmic evaluation.
 * 
 * Standalone module — takes a DB connection + reputation + ints instances.
 * 
 * Usage:
 *   const Interviewer = require('./lib/interviewer');
 *   const interviewer = new Interviewer(db, reputation, ints);
 *   const interview = interviewer.startInterview(nodeId, { description, capabilities_required });
 *   interviewer.submitResponse(interviewId, answers);
 *   const result = interviewer.evaluate(interviewId);
 */

const crypto = require('crypto');
const logger = require('./logger');

// Interview question templates by category
const QUESTION_TEMPLATES = {
  capability_verification: [
    { q: 'What tools or models do you use for {capability}? List specifics.', weight: 2 },
    { q: 'What is the largest {capability} job you have handled? Describe the input and output.', weight: 1 },
    { q: 'What are the limitations of your {capability} setup?', weight: 2 },
  ],
  failure_handling: [
    { q: 'Your history shows {failCount} failed jobs. What caused the failures?', weight: 2, condition: 'hasFailed' },
    { q: 'If a job fails midway, what do you do with partial results?', weight: 1 },
    { q: 'What happens if you lose connectivity during a long-running job?', weight: 1 },
  ],
  capacity_planning: [
    { q: 'What is your current system load and available resources?', weight: 1 },
    { q: 'Can you handle concurrent jobs? What is the tradeoff?', weight: 1 },
    { q: 'How many {capability} jobs can you process per hour at current load?', weight: 2 },
  ],
  honesty_probes: [
    { q: 'What types of jobs are you NOT well-suited for?', weight: 3 },
    { q: 'Is there anything about this position that concerns you?', weight: 1 },
    { q: 'What would make you turn down this work?', weight: 1 },
  ]
};

// Scoring rubric for automated evaluation
const RESPONSE_SCORING = {
  // Points for specificity (mentions actual tools, numbers, models)
  specificity: { regex: /\b(\d+|whisper|ollama|ffmpeg|stable.?diffusion|comfyui|metal|cuda|m[1-4]|nvidia|a1111)\b/gi, pointsPer: 2, max: 10 },
  // Points for honest limitations
  honesty: { regex: /\b(can'?t|cannot|limit|slow|unable|not.?suited|struggle|weak)\b/gi, pointsPer: 3, max: 9 },
  // Points for detail (longer, more substantive answers)
  detail: { minChars: 50, pointsPer: 1, max: 5 },
  // Penalty for vague/empty responses
  vagueness: { regex: /^(yes|no|ok|sure|i can do that|n\/a)\.?$/i, penalty: -10 },
};

class Interviewer {
  constructor(db, reputation, ints) {
    this.db = db;
    this.reputation = reputation;
    this.ints = ints;
    this._initTables();
    this._prepareStatements();
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ahp_interviews (
        interviewId TEXT PRIMARY KEY,
        nodeId TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        position TEXT NOT NULL DEFAULT '{}',
        questions TEXT NOT NULL DEFAULT '[]',
        responses TEXT NOT NULL DEFAULT '[]',
        transcript TEXT NOT NULL DEFAULT '[]',
        scores TEXT NOT NULL DEFAULT '{}',
        decision TEXT,
        reasoning TEXT,
        testJobId TEXT,
        testResult TEXT,
        createdAt INTEGER NOT NULL,
        completedAt INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_ahp_interviews_node ON ahp_interviews(nodeId);
      CREATE INDEX IF NOT EXISTS idx_ahp_interviews_status ON ahp_interviews(status);
    `);
  }

  _prepareStatements() {
    this.stmts = {
      insert: this.db.prepare(`
        INSERT INTO ahp_interviews (interviewId, nodeId, status, position, questions, createdAt)
        VALUES (@interviewId, @nodeId, 'pending', @position, @questions, @createdAt)
      `),
      get: this.db.prepare('SELECT * FROM ahp_interviews WHERE interviewId = ?'),
      getByNode: this.db.prepare('SELECT * FROM ahp_interviews WHERE nodeId = ? ORDER BY createdAt DESC'),
      list: this.db.prepare('SELECT * FROM ahp_interviews ORDER BY createdAt DESC LIMIT ?'),
      listByStatus: this.db.prepare('SELECT * FROM ahp_interviews WHERE status = ? ORDER BY createdAt DESC LIMIT ?'),
      update: this.db.prepare(`
        UPDATE ahp_interviews SET status=@status, responses=@responses, transcript=@transcript,
        scores=@scores, decision=@decision, reasoning=@reasoning, testJobId=@testJobId,
        testResult=@testResult, completedAt=@completedAt WHERE interviewId=@interviewId
      `),
      getNode: this.db.prepare('SELECT * FROM nodes WHERE nodeId = ?'),
      getJobStats: this.db.prepare(`
        SELECT type, COUNT(*) as total,
               SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
               SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
               AVG(CASE WHEN status='completed' THEN computeMs ELSE NULL END) as avgMs
        FROM jobs WHERE claimedBy = ? GROUP BY type
      `),
    };
  }

  /**
   * Start an interview for a node.
   * @param {string} nodeId
   * @param {object} position - { description, capabilities_required, estimated_duration, ints_budget }
   * @returns {object} interview record
   */
  startInterview(nodeId, position = {}) {
    const node = this.stmts.getNode.get(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    const interviewId = `int_${crypto.randomBytes(8).toString('hex')}`;
    const requiredCaps = position.capabilities_required || [];
    const jobStats = this.stmts.getJobStats.all(nodeId);
    const totalFailed = jobStats.reduce((sum, s) => sum + (s.failed || 0), 0);

    // Generate questions from templates
    const questions = [];
    for (const [category, templates] of Object.entries(QUESTION_TEMPLATES)) {
      for (const tmpl of templates) {
        // Skip conditional questions if condition not met
        if (tmpl.condition === 'hasFailed' && totalFailed === 0) continue;

        // Generate question for each required capability or generically
        if (tmpl.q.includes('{capability}')) {
          const caps = requiredCaps.length > 0 ? requiredCaps : JSON.parse(node.capabilities || '[]');
          for (const cap of caps.slice(0, 2)) { // limit to 2 per template
            questions.push({
              id: `q_${crypto.randomBytes(4).toString('hex')}`,
              category,
              question: tmpl.q.replace(/\{capability\}/g, cap).replace(/\{failCount\}/g, String(totalFailed)),
              weight: tmpl.weight
            });
          }
        } else {
          questions.push({
            id: `q_${crypto.randomBytes(4).toString('hex')}`,
            category,
            question: tmpl.q.replace(/\{failCount\}/g, String(totalFailed)),
            weight: tmpl.weight
          });
        }
      }
    }

    this.stmts.insert.run({
      interviewId,
      nodeId,
      position: JSON.stringify(position),
      questions: JSON.stringify(questions),
      createdAt: Date.now()
    });

    return this._toJSON(this.stmts.get.get(interviewId));
  }

  /**
   * Submit responses to interview questions.
   * @param {string} interviewId
   * @param {Array} responses - [{ questionId, answer }]
   */
  submitResponses(interviewId, responses) {
    const interview = this.stmts.get.get(interviewId);
    if (!interview) throw new Error(`Interview not found: ${interviewId}`);
    if (interview.status !== 'pending') throw new Error(`Interview is ${interview.status}, not pending`);

    const questions = JSON.parse(interview.questions);
    const transcript = [];

    for (const q of questions) {
      const resp = responses.find(r => r.questionId === q.id);
      transcript.push({
        turn: transcript.length + 1,
        interviewer: q.question,
        candidate: resp ? resp.answer : '(no response)',
        category: q.category,
        questionId: q.id
      });
    }

    // Score the responses
    const scores = this._scoreResponses(questions, responses, interview.nodeId);

    // Make decision
    const { decision, reasoning } = this._makeDecision(scores, interview.nodeId);

    this.stmts.update.run({
      interviewId,
      status: 'completed',
      responses: JSON.stringify(responses),
      transcript: JSON.stringify(transcript),
      scores: JSON.stringify(scores),
      decision,
      reasoning,
      testJobId: null,
      testResult: null,
      completedAt: Date.now()
    });

    return this._toJSON(this.stmts.get.get(interviewId));
  }

  /**
   * Score interview responses algorithmically.
   */
  _scoreResponses(questions, responses, nodeId) {
    const categoryScores = {};
    let totalScore = 0;
    let totalWeight = 0;

    for (const q of questions) {
      const resp = responses.find(r => r.questionId === q.id);
      const answer = resp?.answer || '';
      let questionScore = 0;

      // Specificity
      const specMatches = (answer.match(RESPONSE_SCORING.specificity.regex) || []).length;
      questionScore += Math.min(specMatches * RESPONSE_SCORING.specificity.pointsPer, RESPONSE_SCORING.specificity.max);

      // Honesty (admitting limitations)
      if (q.category === 'honesty_probes') {
        const honMatches = (answer.match(RESPONSE_SCORING.honesty.regex) || []).length;
        questionScore += Math.min(honMatches * RESPONSE_SCORING.honesty.pointsPer, RESPONSE_SCORING.honesty.max);
      }

      // Detail
      if (answer.length >= RESPONSE_SCORING.detail.minChars) {
        const detailPoints = Math.floor(answer.length / 100);
        questionScore += Math.min(detailPoints * RESPONSE_SCORING.detail.pointsPer, RESPONSE_SCORING.detail.max);
      }

      // Vagueness penalty
      if (RESPONSE_SCORING.vagueness.regex.test(answer.trim())) {
        questionScore += RESPONSE_SCORING.vagueness.penalty;
      }

      questionScore = Math.max(0, questionScore);

      if (!categoryScores[q.category]) categoryScores[q.category] = { total: 0, count: 0 };
      categoryScores[q.category].total += questionScore * q.weight;
      categoryScores[q.category].count += q.weight;

      totalScore += questionScore * q.weight;
      totalWeight += q.weight;
    }

    // Normalize category scores to 0-100
    for (const cat of Object.keys(categoryScores)) {
      const c = categoryScores[cat];
      // Max possible per weighted question ~24 points (10 spec + 9 honesty + 5 detail)
      categoryScores[cat].normalized = c.count > 0 ? Math.min(100, Math.round((c.total / (c.count * 15)) * 100)) : 0;
    }

    // Factor in reputation
    let repBonus = 0;
    try {
      const score = this.reputation.getScore(nodeId);
      repBonus = Math.round((score.trustScore || 50) / 5); // 0-20 bonus
    } catch (e) {
      // Reputation system unavailable - continue with 0 bonus
      repBonus = 0;
    }

    const interviewScore = totalWeight > 0 ? Math.round((totalScore / (totalWeight * 15)) * 100) : 0;
    const finalScore = Math.min(100, interviewScore + repBonus);

    return {
      interviewScore: Math.min(100, interviewScore),
      reputationBonus: repBonus,
      finalScore,
      categories: categoryScores
    };
  }

  /**
   * Make hire/conditional/reject decision based on scores.
   */
  _makeDecision(scores, nodeId) {
    const s = scores.finalScore;
    const account = this.ints.getAccount(nodeId);

    let decision, reasoning;

    if (s >= 60) {
      decision = 'hire';
      reasoning = `Strong interview score (${s}/100). `;
      if (account.totalEarned > 0) reasoning += `Active contributor with ${account.totalEarned} ints earned. `;
      reasoning += `Category scores: ${Object.entries(scores.categories).map(([k, v]) => `${k}: ${v.normalized}`).join(', ')}.`;
    } else if (s >= 35) {
      decision = 'conditional';
      reasoning = `Moderate interview score (${s}/100). Recommend starting with small jobs and re-evaluating after 10 completions. `;
      reasoning += `Category scores: ${Object.entries(scores.categories).map(([k, v]) => `${k}: ${v.normalized}`).join(', ')}.`;
    } else {
      decision = 'reject';
      reasoning = `Low interview score (${s}/100). Responses lacked specificity or substance. `;
      reasoning += `Category scores: ${Object.entries(scores.categories).map(([k, v]) => `${k}: ${v.normalized}`).join(', ')}.`;
    }

    return { decision, reasoning };
  }

  /**
   * Record the result of a practical test job.
   */
  recordTestResult(interviewId, jobId, result) {
    const interview = this.stmts.get.get(interviewId);
    if (!interview) throw new Error(`Interview not found: ${interviewId}`);

    this.stmts.update.run({
      interviewId,
      status: interview.status,
      responses: interview.responses,
      transcript: interview.transcript,
      scores: interview.scores,
      decision: interview.decision,
      reasoning: interview.reasoning,
      testJobId: jobId,
      testResult: JSON.stringify(result),
      completedAt: interview.completedAt
    });

    return this._toJSON(this.stmts.get.get(interviewId));
  }

  // ===== Query API =====

  getInterview(interviewId) {
    const row = this.stmts.get.get(interviewId);
    if (!row) return null;
    return this._toJSON(row);
  }

  getInterviewsByNode(nodeId) {
    return this.stmts.getByNode.all(nodeId).map(r => this._toJSON(r));
  }

  listInterviews({ status, limit = 50 } = {}) {
    if (status) return this.stmts.listByStatus.all(status, limit).map(r => this._toJSON(r));
    return this.stmts.list.all(limit).map(r => this._toJSON(r));
  }

  _toJSON(row) {
    if (!row) return null;
    return {
      interviewId: row.interviewId,
      nodeId: row.nodeId,
      status: row.status,
      position: JSON.parse(row.position),
      questions: JSON.parse(row.questions),
      responses: JSON.parse(row.responses || '[]'),
      transcript: JSON.parse(row.transcript || '[]'),
      scores: JSON.parse(row.scores || '{}'),
      decision: row.decision,
      reasoning: row.reasoning,
      testJobId: row.testJobId,
      testResult: row.testResult ? JSON.parse(row.testResult) : null,
      createdAt: row.createdAt,
      completedAt: row.completedAt
    };
  }
}

module.exports = Interviewer;
