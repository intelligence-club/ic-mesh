/**
 * IC Mesh — Stripe Connect Integration
 * 
 * Handles node operator onboarding and automated payouts.
 * Uses Stripe Connect Express for identity verification and bank details.
 * 
 * Flow:
 *   1. Node registers → POST /nodes/onboard → creates Stripe Connected Account
 *   2. Operator completes Stripe Express onboarding (identity, bank)
 *   3. Node earns ints from completed jobs
 *   4. Cashout → POST /cashout → automatic Stripe Transfer
 * 
 * Fault tolerance:
 *   - Payout details captured at signup (before any work)
 *   - Machine can disappear — ints are tracked server-side
 *   - Failed transfers retry automatically
 *   - Stripe handles tax reporting (1099-K)
 */

const https = require('https');
const logger = require('./logger');

const STRIPE_API_KEY = process.env.STRIPE_API_KEY || '';
const SELL_RATE = 0.0008; // $/int (what providers earn)
const MIN_CASHOUT_INTS = 1000;
const REQUEST_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;

// Validate required environment variables
if (!STRIPE_API_KEY) {
  throw new Error('STRIPE_API_KEY environment variable is required');
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stripeRequest(method, path, params, retryCount = 0) {
  return new Promise((resolve, reject) => {
    const data = params ? new URLSearchParams(params).toString() : '';
    const options = {
      hostname: 'api.stripe.com',
      path: '/v1' + path,
      method,
      headers: {
        'Authorization': 'Bearer ' + STRIPE_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: REQUEST_TIMEOUT,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            const error = new Error(parsed.error.message || 'Stripe API error');
            error.code = parsed.error.code;
            error.type = parsed.error.type;
            error.statusCode = res.statusCode;
            logger.stripeEvent('API error', { 
              method, 
              path, 
              error: error.message, 
              statusCode: res.statusCode,
              code: error.code,
              type: error.type 
            });
            reject(error);
          } else {
            resolve(parsed);
          }
        } catch (e) {
          logger.stripeEvent('response parse error', { 
            method, 
            path, 
            error: e.message 
          });
          reject(new Error('Failed to parse Stripe API response'));
        }
      });
    });

    req.on('error', async (err) => {
      logger.stripeEvent('request error', { 
        method, 
        path, 
        error: err.message,
        code: err.code 
      });
      
      // Retry on network errors
      if (retryCount < MAX_RETRIES && (err.code === 'ENOTFOUND' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
        const backoffMs = Math.pow(2, retryCount) * 1000; // Exponential backoff
        logger.stripeEvent('retry request', { 
          method, 
          path, 
          backoffMs, 
          attempt: retryCount + 1, 
          maxRetries: MAX_RETRIES 
        });
        await wait(backoffMs);
        try {
          const result = await stripeRequest(method, path, params, retryCount + 1);
          resolve(result);
        } catch (retryError) {
          reject(retryError);
        }
      } else {
        reject(new Error(`Stripe API request failed: ${err.message}`));
      }
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Stripe API request timed out'));
    });

    if (data) req.write(data);
    req.end();
  });
}

/**
 * Create a Stripe Connect Express account for a node operator.
 * Returns the account ID and onboarding URL.
 */
async function createConnectedAccount(nodeId, email, country = 'US') {
  if (!nodeId || typeof nodeId !== 'string') {
    throw new Error('Valid nodeId is required');
  }
  if (!email || !email.includes('@')) {
    throw new Error('Valid email address is required');
  }
  if (!country || country.length !== 2) {
    throw new Error('Valid 2-letter country code is required');
  }

  try {
    logger.stripeEvent('create connected account', { nodeId, email, country });
    
    // Create the Express account
    const account = await stripeRequest('POST', '/accounts', {
      type: 'express',
      country,
      email,
      'capabilities[transfers][requested]': 'true',
      'metadata[node_id]': nodeId,
      'metadata[platform]': 'ic-mesh',
    });

    // Create onboarding link
    const link = await stripeRequest('POST', '/account_links', {
      account: account.id,
      refresh_url: `https://moilol.com/mesh/onboard?nodeId=${nodeId}&refresh=true`,
      return_url: `https://moilol.com/mesh/onboard?nodeId=${nodeId}&complete=true`,
      type: 'account_onboarding',
    });

    logger.stripeEvent('connected account created', { nodeId, accountId: account.id });
    
    return {
      stripe_account_id: account.id,
      onboarding_url: link.url,
      email,
      country,
    };
  } catch (error) {
    logger.stripeEvent('account creation failed', { nodeId, error: error.message });
    throw new Error(`Stripe Connect account creation failed: ${error.message}`);
  }
}

/**
 * Check if a connected account has completed onboarding.
 */
async function checkAccountStatus(stripeAccountId) {
  const account = await stripeRequest('GET', `/accounts/${stripeAccountId}`);
  return {
    id: account.id,
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    details_submitted: account.details_submitted,
    requirements: account.requirements?.currently_due || [],
    email: account.email,
  };
}

/**
 * Create a fresh onboarding link (for when the old one expires or operator needs to retry).
 */
async function createOnboardingLink(stripeAccountId, nodeId) {
  const link = await stripeRequest('POST', '/account_links', {
    account: stripeAccountId,
    refresh_url: `https://moilol.com/mesh/onboard?nodeId=${nodeId}&refresh=true`,
    return_url: `https://moilol.com/mesh/onboard?nodeId=${nodeId}&complete=true`,
    type: 'account_onboarding',
  });
  return link.url;
}

/**
 * Transfer ints→USD to a connected account.
 * Amount is in ints, converted to USD cents at SELL_RATE.
 */
async function transferToNode(stripeAccountId, amountInts, nodeId) {
  if (!stripeAccountId || typeof stripeAccountId !== 'string') {
    throw new Error('Valid Stripe account ID is required');
  }
  if (!amountInts || typeof amountInts !== 'number' || amountInts <= 0) {
    throw new Error('Valid positive amount in ints is required');
  }
  if (amountInts < MIN_CASHOUT_INTS) {
    throw new Error(`Minimum cashout is ${MIN_CASHOUT_INTS} ints (${MIN_CASHOUT_INTS * SELL_RATE} USD)`);
  }
  if (!nodeId || typeof nodeId !== 'string') {
    throw new Error('Valid nodeId is required');
  }

  const amountUsd = amountInts * SELL_RATE;
  const amountCents = Math.round(amountUsd * 100);
  
  if (amountCents < 1) {
    throw new Error('Transfer amount too small (minimum $0.01)');
  }

  try {
    logger.stripeEvent('initiate transfer', { 
      nodeId, 
      stripeAccountId, 
      amountInts, 
      amountUsd, 
      amountCents 
    });
    
    const transfer = await stripeRequest('POST', '/transfers', {
      amount: String(amountCents),
      currency: 'usd',
      destination: stripeAccountId,
      'metadata[node_id]': nodeId,
      'metadata[ints]': String(amountInts),
      'metadata[platform]': 'ic-mesh',
      description: `IC Mesh payout: ${amountInts} ints`,
    });

    logger.stripeEvent('transfer initiated', { 
      nodeId, 
      transferId: transfer.id, 
      status: transfer.status || 'pending' 
    });

    return {
      transfer_id: transfer.id,
      amount_ints: amountInts,
      amount_usd: amountUsd,
      amount_cents: amountCents,
      status: transfer.status || 'pending',
    };
  } catch (error) {
    logger.stripeEvent('transfer failed', { nodeId, error: error.message, code: error.code });
    
    // Provide more specific error messages based on Stripe error codes
    if (error.code === 'insufficient_funds') {
      throw new Error('Transfer failed: Insufficient funds in platform account');
    } else if (error.code === 'account_invalid') {
      throw new Error('Transfer failed: Node operator account is not properly set up');
    } else if (error.code === 'transfers_not_allowed') {
      throw new Error('Transfer failed: Node operator account cannot receive transfers yet');
    }
    
    throw new Error(`Transfer failed: ${error.message}`);
  }
}

/**
 * Get transfer/payout history for a connected account.
 */
async function getTransferHistory(stripeAccountId, limit = 10) {
  const transfers = await stripeRequest('GET', `/transfers?destination=${stripeAccountId}&limit=${limit}`);
  return transfers.data.map(t => ({
    id: t.id,
    amount_cents: t.amount,
    amount_usd: (t.amount / 100).toFixed(2),
    ints: t.metadata?.ints || '?',
    created: new Date(t.created * 1000).toISOString(),
    status: t.reversed ? 'reversed' : 'completed',
  }));
}

module.exports = {
  createConnectedAccount,
  checkAccountStatus,
  createOnboardingLink,
  transferToNode,
  getTransferHistory,
  SELL_RATE,
  MIN_CASHOUT_INTS,
};
