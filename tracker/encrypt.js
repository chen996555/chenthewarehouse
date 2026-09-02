'use strict';

/**
 * 简历文件加密（AES-256-GCM 带认证）
 * 简历属《个保法》敏感个人信息，落盘必须加密（业界标准：AES-256 + KMS）。
 * 密钥从环境变量 RESUME_ENC_KEY 读；未设置时用 sha256(默认串) 派生（内测兜底，上线务必设真密钥）。
 * 用法：
 *   const enc = require('./encrypt');
 *   const cipherBuf = enc.encrypt(Buffer.from(fileData, 'base64'));   // 存盘
 *   const plainBuf = enc.decrypt(cipherBuf);                          // 读取
 */

const crypto = require('node:crypto');

// 32 字节密钥：优先环境变量，否则 sha256(默认串) 派生（仅内测兜底）
function deriveKey() {
  const raw = process.env.RESUME_ENC_KEY || 'jobstar-resume-default-key-change-me';
  return crypto.createHash('sha256').update(raw).digest(); // 32 bytes
}

// 加密：返回 iv(16) + authTag(16) + ciphertext
function encrypt(buf) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

// 解密：输入 iv(16) + authTag(16) + ciphertext
function decrypt(data) {
  const iv = data.slice(0, 16);
  const tag = data.slice(16, 32);
  const enc = data.slice(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

module.exports = { encrypt, decrypt };
