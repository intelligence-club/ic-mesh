/**
 * Node Auth — Ed25519 Identity for IC Mesh Nodes
 * 
 * Standalone module for keypair generation, signing, and verification.
 * Uses Node.js built-in crypto (Ed25519, available since Node 16).
 * 
 * Usage:
 *   const { generateKeyPair, sign, verify } = require('./lib/node-auth');
 *   const { publicKey, privateKey } = generateKeyPair();
 *   const signature = sign(privateKey, { jobId, nodeId, timestamp });
 *   const valid = verify(publicKey, { jobId, nodeId, timestamp }, signature);
 */

const crypto = require('crypto');

/**
 * Generate an Ed25519 keypair.
 * @returns {{ publicKey: string, privateKey: string }} Base64-encoded keys
 */
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  });
  return {
    publicKey: publicKey.toString('base64'),
    privateKey: privateKey.toString('base64')
  };
}

/**
 * Sign data with an Ed25519 private key.
 * @param {string} privateKeyB64 - Base64-encoded PKCS8 DER private key
 * @param {object} data - Object to sign (will be JSON-stringified with sorted keys)
 * @returns {string} Base64-encoded signature
 */
function sign(privateKeyB64, data) {
  const keyObj = crypto.createPrivateKey({
    key: Buffer.from(privateKeyB64, 'base64'),
    format: 'der',
    type: 'pkcs8'
  });
  const message = JSON.stringify(data, Object.keys(data).sort());
  return crypto.sign(null, Buffer.from(message), keyObj).toString('base64');
}

/**
 * Verify an Ed25519 signature.
 * @param {string} publicKeyB64 - Base64-encoded SPKI DER public key
 * @param {object} data - Object that was signed
 * @param {string} signatureB64 - Base64-encoded signature
 * @returns {boolean} Whether the signature is valid
 */
function verify(publicKeyB64, data, signatureB64) {
  try {
    const keyObj = crypto.createPublicKey({
      key: Buffer.from(publicKeyB64, 'base64'),
      format: 'der',
      type: 'spki'
    });
    const message = JSON.stringify(data, Object.keys(data).sort());
    return crypto.verify(null, Buffer.from(message), keyObj, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

module.exports = { generateKeyPair, sign, verify };
