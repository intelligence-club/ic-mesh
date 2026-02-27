/**
 * IC Mesh — Storage Layer
 * 
 * Handles file upload/download with DO Spaces (S3-compatible).
 * Falls back to local disk if Spaces isn't configured.
 * 
 * Responsible usage:
 *   - Files auto-expire after 24 hours (lifecycle policy)
 *   - Max file size: 50MB
 *   - Presigned URLs for download (no public bucket)
 *   - Uploaded files go to /jobs/<jobId>/ prefix for easy cleanup
 * 
 * Environment:
 *   DO_SPACES_KEY     — Spaces access key
 *   DO_SPACES_SECRET  — Spaces secret key
 *   DO_SPACES_BUCKET  — Bucket name (default: ic-mesh)
 *   DO_SPACES_REGION  — Region (default: sfo3)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

let s3Client = null;
let bucketName = null;
let spacesRegion = null;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const URL_EXPIRY = 3600; // 1 hour presigned URL

function isSpacesConfigured() {
  return !!(process.env.DO_SPACES_KEY && process.env.DO_SPACES_SECRET);
}

async function initSpaces() {
  if (!isSpacesConfigured()) return false;
  
  const { S3Client } = require('@aws-sdk/client-s3');
  
  spacesRegion = process.env.DO_SPACES_REGION || 'sfo3';
  bucketName = process.env.DO_SPACES_BUCKET || 'ic-mesh';
  
  s3Client = new S3Client({
    endpoint: `https://${spacesRegion}.digitaloceanspaces.com`,
    region: spacesRegion,
    credentials: {
      accessKeyId: process.env.DO_SPACES_KEY,
      secretAccessKey: process.env.DO_SPACES_SECRET
    },
    forcePathStyle: false
  });
  
  logger.info('Storage initialized', 'Digital Ocean Spaces storage configured', {
    bucket: bucketName,
    region: spacesRegion,
    endpoint: `${bucketName}.${spacesRegion}.digitaloceanspaces.com`,
    storage_type: 'spaces'
  });
  return true;
}

/**
 * Upload a file buffer to storage.
 * Returns { url, key, size, storage } 
 */
async function uploadFile(buffer, filename, contentType = 'application/octet-stream') {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
  }
  
  const id = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(filename) || '.bin';
  const key = `uploads/${id}${ext}`;
  
  if (s3Client) {
    // Upload to Spaces
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // Auto-expire after 24 hours
      Metadata: { 'expires-at': new Date(Date.now() + 86400000).toISOString() }
    }));
    
    // Generate presigned download URL
    const url = await getPresignedUrl(key);
    
    return { url, key, size: buffer.length, storage: 'spaces', filename: `${id}${ext}` };
  }
  
  // Fallback: local disk
  const localDir = path.join(__dirname, '..', 'data', 'uploads');
  fs.mkdirSync(localDir, { recursive: true });
  const localFile = `upload-${id}${ext}`;
  fs.writeFileSync(path.join(localDir, localFile), buffer);
  
  const pubBase = process.env.IC_MESH_PUBLIC_URL || 'http://localhost:8333';
  return { url: `${pubBase}/files/${localFile}`, key: localFile, size: buffer.length, storage: 'local', filename: localFile };
}

/**
 * Get a presigned download URL for a Spaces key.
 */
async function getPresignedUrl(key) {
  if (!s3Client) return null;
  
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  
  return getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: bucketName,
    Key: key
  }), { expiresIn: URL_EXPIRY });
}

/**
 * Delete a file from storage.
 */
async function deleteFile(key) {
  if (s3Client) {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await s3Client.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key
    }));
    return true;
  }
  
  // Local fallback
  const localPath = path.join(__dirname, '..', 'data', 'uploads', key);
  if (fs.existsSync(localPath)) {
    fs.unlinkSync(localPath);
    return true;
  }
  return false;
}

/**
 * Clean up expired files (call periodically).
 */
async function cleanupExpired() {
  if (s3Client) {
    // Spaces lifecycle policies handle this, but we can also do manual cleanup
    const { ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const list = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: 'uploads/'
    }));
    
    const cutoff = Date.now() - 86400000; // 24 hours
    let deleted = 0;
    for (const obj of (list.Contents || [])) {
      if (obj.LastModified && obj.LastModified.getTime() < cutoff) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: obj.Key }));
        deleted++;
      }
    }
    return deleted;
  }
  
  // Local cleanup
  const uploadDir = path.join(__dirname, '..', 'data', 'uploads');
  if (!fs.existsSync(uploadDir)) return 0;
  
  const cutoff = Date.now() - 86400000;
  let deleted = 0;
  for (const file of fs.readdirSync(uploadDir)) {
    const fp = path.join(uploadDir, file);
    const stat = fs.statSync(fp);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(fp);
      deleted++;
    }
  }
  return deleted;
}

module.exports = {
  getPresignedUploadUrl,
  isSpacesConfigured,
  initSpaces,
  uploadFile,
  getPresignedUrl,
  deleteFile,
  cleanupExpired
};

/**
 * Generate a presigned PUT URL for direct client→Spaces upload.
 * Client PUTs the file directly to Spaces, bypassing the hub.
 */
async function getPresignedUploadUrl(key, contentType = 'application/octet-stream', expiresIn = 3600) {
  if (!s3Client) return null;
  
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  
  return getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
    Metadata: { 'expires-at': new Date(Date.now() + 86400000).toISOString() }
  }), { expiresIn });
}
