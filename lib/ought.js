/**
 * Ought — Zero-Sum Compute Currency
 * 
 * Rules:
 * 1. Zero-sum: every transaction creates +X for one party and -X for the other.
 *    The total across all accounts always equals zero.
 * 2. Integers only. No floats, no fractions, no rounding.
 * 3. Addition and subtraction only. No division, no multiplication in the ledger.
 * 4. Every ought represents real compute work that was done.
 * 
 * How it works:
 * - You start at 0.
 * - Someone does work for you → they get +N, you get -N.
 * - You do work for someone → you get +N, they get -N.
 * - Negative balance means you've consumed more than you've contributed.
 * - Positive balance means you've contributed more than you've consumed.
 * - There's no floor — you can go as negative as the network allows.
 *   (Reputation determines how much credit the network extends you.)
 * 
 * Pricing:
 * - 1 ought = 1 second of compute time (integer, rounded up)
 * - A 45-second transcription job costs 45 ought
 * - A 120-second SD generation costs 120 ought
 * - The worker gets +N, the requester gets -N
 * 
 * The name: "ought" as in "naught" (zero). Because it always adds to zero.
 * 
 * Usage:
 *   const Ought = require('./lib/ought');
 *   const ought = new Ought(db);
 *   ought.transfer(fromId, toId, amount, jobId, description);
 *   ought.getBalance(nodeId);  // → integer
 *   ought.getLedger(nodeId);   // → transaction history
 */

const crypto = require('crypto');

class Ought {
  constructor(db) {
    this.db = db;
    this._initTables();
    this._prepareStatements();
    this._verifyInvariant();
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ought_accounts (
        accountId TEXT PRIMARY KEY,
        balance INTEGER NOT NULL DEFAULT 0,
        totalEarned INTEGER NOT NULL DEFAULT 0,
        totalSpent INTEGER NOT NULL DEFAULT 0,
        transactionCount INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        lastActivity INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ought_transactions (
        txId TEXT PRIMARY KEY,
        fromAccount TEXT NOT NULL,
        toAccount TEXT NOT NULL,
        amount INTEGER NOT NULL,
        jobId TEXT,
        jobType TEXT,
        description TEXT,
        computeSeconds INTEGER,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ought_tx_from ON ought_transactions(fromAccount, timestamp);
      CREATE INDEX IF NOT EXISTS idx_ought_tx_to ON ought_transactions(toAccount, timestamp);
      CREATE INDEX IF NOT EXISTS idx_ought_tx_job ON ought_transactions(jobId);
    `);
  }

  _prepareStatements() {
    this.stmts = {
      getAccount: this.db.prepare('SELECT * FROM ought_accounts WHERE accountId = ?'),
      upsertAccount: this.db.prepare(`
        INSERT INTO ought_accounts (accountId, balance, totalEarned, totalSpent, transactionCount, createdAt, lastActivity)
        VALUES (?, 0, 0, 0, 0, ?, ?)
        ON CONFLICT(accountId) DO NOTHING
      `),
      credit: this.db.prepare('UPDATE ought_accounts SET balance = balance + ?, totalEarned = totalEarned + ?, transactionCount = transactionCount + 1, lastActivity = ? WHERE accountId = ?'),
      debit: this.db.prepare('UPDATE ought_accounts SET balance = balance - ?, totalSpent = totalSpent + ?, transactionCount = transactionCount + 1, lastActivity = ? WHERE accountId = ?'),
      insertTx: this.db.prepare(`
        INSERT INTO ought_transactions (txId, fromAccount, toAccount, amount, jobId, jobType, description, computeSeconds, timestamp)
        VALUES (@txId, @fromAccount, @toAccount, @amount, @jobId, @jobType, @description, @computeSeconds, @timestamp)
      `),
      getTxByAccount: this.db.prepare(`
        SELECT * FROM ought_transactions WHERE fromAccount = ? OR toAccount = ? ORDER BY timestamp DESC LIMIT ?
      `),
      getTxByJob: this.db.prepare('SELECT * FROM ought_transactions WHERE jobId = ?'),
      sumAll: this.db.prepare('SELECT SUM(balance) as total FROM ought_accounts'),
      getAllAccounts: this.db.prepare('SELECT * FROM ought_accounts ORDER BY balance DESC'),
      getTopEarners: this.db.prepare('SELECT * FROM ought_accounts ORDER BY totalEarned DESC LIMIT ?'),
      getTopSpenders: this.db.prepare('SELECT * FROM ought_accounts ORDER BY totalSpent DESC LIMIT ?'),
    };
  }

  /**
   * Verify the zero-sum invariant. Total of all balances must equal 0.
   * If it doesn't, something is very wrong.
   */
  _verifyInvariant() {
    const result = this.stmts.sumAll.get();
    const total = result?.total || 0;
    if (total !== 0) {
      console.error(`⚠ OUGHT INVARIANT VIOLATION: sum of all balances = ${total} (should be 0)`);
    }
    return total === 0;
  }

  /**
   * Ensure an account exists.
   */
  _ensureAccount(accountId) {
    const now = Date.now();
    this.stmts.upsertAccount.run(accountId, now, now);
  }

  // ===== Core API =====

  /**
   * Transfer ought from one account to another.
   * This is the only way ought moves. Always zero-sum.
   * 
   * @param {string} from - Account being debited (requester/consumer)
   * @param {string} to - Account being credited (worker/provider)
   * @param {number} amount - Positive integer of ought to transfer
   * @param {object} meta - { jobId, jobType, description, computeSeconds }
   * @returns {object} Transaction receipt
   */
  transfer(from, to, amount, meta = {}) {
    // Enforce integer-only rule
    if (!Number.isInteger(amount)) {
      throw new Error(`Ought amount must be an integer, got: ${amount}`);
    }
    if (amount <= 0) {
      throw new Error(`Ought amount must be positive, got: ${amount}`);
    }
    if (from === to) {
      throw new Error('Cannot transfer to yourself');
    }

    const txId = `tx_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();

    // Ensure both accounts exist
    this._ensureAccount(from);
    this._ensureAccount(to);

    // Atomic: debit from, credit to, record transaction
    const doTransfer = this.db.transaction(() => {
      this.stmts.debit.run(amount, amount, now, from);
      this.stmts.credit.run(amount, amount, now, to);
      this.stmts.insertTx.run({
        txId,
        fromAccount: from,
        toAccount: to,
        amount,
        jobId: meta.jobId || null,
        jobType: meta.jobType || null,
        description: meta.description || null,
        computeSeconds: meta.computeSeconds || null,
        timestamp: now
      });
    });

    doTransfer();

    return {
      txId,
      from,
      to,
      amount,
      description: meta.description,
      timestamp: now
    };
  }

  /**
   * Price a job: compute seconds → ought amount.
   * Always rounds up to nearest integer. No fractions.
   */
  priceJob(computeMs) {
    return Math.max(1, Math.ceil(computeMs / 1000));
  }

  /**
   * Complete a job payment: worker gets paid, requester gets debited.
   */
  settleJob(requesterId, workerId, computeMs, jobId, jobType) {
    const amount = this.priceJob(computeMs);
    return this.transfer(requesterId, workerId, amount, {
      jobId,
      jobType,
      computeSeconds: Math.ceil(computeMs / 1000),
      description: `${jobType} job (${Math.ceil(computeMs/1000)}s compute)`
    });
  }

  // ===== Query API =====

  /**
   * Get account balance. Returns integer.
   */
  getBalance(accountId) {
    const account = this.stmts.getAccount.get(accountId);
    if (!account) return 0;
    return account.balance;
  }

  /**
   * Get full account info.
   */
  getAccount(accountId) {
    const account = this.stmts.getAccount.get(accountId);
    if (!account) return { accountId, balance: 0, totalEarned: 0, totalSpent: 0, transactionCount: 0 };
    return account;
  }

  /**
   * Get transaction history for an account.
   */
  getLedger(accountId, { limit = 50 } = {}) {
    return this.stmts.getTxByAccount.all(accountId, accountId, limit);
  }

  /**
   * Get all transactions for a specific job.
   */
  getJobTransactions(jobId) {
    return this.stmts.getTxByJob.all(jobId);
  }

  /**
   * Network-wide stats.
   */
  getNetworkStats() {
    const accounts = this.stmts.getAllAccounts.all();
    const total = this.stmts.sumAll.get()?.total || 0;

    let totalTransacted = 0;
    for (const a of accounts) totalTransacted += a.totalEarned;

    return {
      invariantHolds: total === 0,
      sumOfAllBalances: total,
      totalAccounts: accounts.length,
      totalOughtTransacted: totalTransacted,
      topEarners: this.stmts.getTopEarners.all(5).map(a => ({
        accountId: a.accountId,
        balance: a.balance,
        earned: a.totalEarned,
        spent: a.totalSpent,
        jobs: a.transactionCount
      })),
      topSpenders: this.stmts.getTopSpenders.all(5).map(a => ({
        accountId: a.accountId,
        balance: a.balance,
        earned: a.totalEarned,
        spent: a.totalSpent,
        jobs: a.transactionCount
      }))
    };
  }

  /**
   * Verify the zero-sum invariant (call anytime, especially after crashes).
   */
  audit() {
    const total = this.stmts.sumAll.get()?.total || 0;
    const accounts = this.stmts.getAllAccounts.all();

    // Verify each account's balance matches its transaction history
    const discrepancies = [];
    for (const account of accounts) {
      const txs = this.stmts.getTxByAccount.all(account.accountId, account.accountId, 100000);
      let computed = 0;
      for (const tx of txs) {
        if (tx.toAccount === account.accountId) computed += tx.amount;
        if (tx.fromAccount === account.accountId) computed -= tx.amount;
      }
      if (computed !== account.balance) {
        discrepancies.push({
          accountId: account.accountId,
          storedBalance: account.balance,
          computedBalance: computed,
          difference: account.balance - computed
        });
      }
    }

    return {
      healthy: total === 0 && discrepancies.length === 0,
      sumOfAllBalances: total,
      zereSumHolds: total === 0,
      accountsChecked: accounts.length,
      discrepancies
    };
  }
}

module.exports = Ought;
