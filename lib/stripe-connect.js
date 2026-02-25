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

const STRIPE_API_KEY = process.env.STRIPE_API_KEY || '';
const SELL_RATE = 0.0008; // $/int (what providers earn)
const MIN_CASHOUT_INTS = 1000;

function stripeRequest(method, path, params) {
  return new Promise((resolve, reject) => {
    const data = params ? new URLSearchParams(params).toString() : '';
    const options = {
      hostname: 'api.stripe.com',
      path: '/v1' + path,
      method,
      headers: {
        'Authorization': 'Bearer ' + STRIPE_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Create a Stripe Connect Express account for a node operator.
 * Returns the account ID and onboarding URL.
 */
async function createConnectedAccount(nodeId, email, country = 'US') {
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

  return {
    stripe_account_id: account.id,
    onboarding_url: link.url,
    email,
    country,
  };
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
  const amountUsd = amountInts * SELL_RATE;
  const amountCents = Math.round(amountUsd * 100);
  
  if (amountCents < 1) {
    throw new Error('Transfer amount too small (minimum $0.01)');
  }

  const transfer = await stripeRequest('POST', '/transfers', {
    amount: String(amountCents),
    currency: 'usd',
    destination: stripeAccountId,
    'metadata[node_id]': nodeId,
    'metadata[ints]': String(amountInts),
    'metadata[platform]': 'ic-mesh',
    description: `IC Mesh payout: ${amountInts} ints`,
  });

  return {
    transfer_id: transfer.id,
    amount_ints: amountInts,
    amount_usd: amountUsd,
    amount_cents: amountCents,
    status: transfer.status || 'pending',
  };
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
