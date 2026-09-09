const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const { rateLimit } = require('express-rate-limit');

const { requireAuth } = require('../middleware/auth');
const { createRateLimitOptions } = require('../middleware/rateLimit');

const router = express.Router();
const authRateLimit = rateLimit(createRateLimitOptions('auth', 'upload'));
const uploadRateLimit = rateLimit(createRateLimitOptions('upload', 'upload'));
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const FILE_TYPES = Object.freeze({
  '.jpg': { mimeTypes: ['image/jpeg'], signature: 'jpeg' },
  '.jpeg': { mimeTypes: ['image/jpeg'], signature: 'jpeg' },
  '.png': { mimeTypes: ['image/png'], signature: 'png' },
  '.gif': { mimeTypes: ['image/gif'], signature: 'gif' },
  '.pdf': { mimeTypes: ['application/pdf'], signature: 'pdf' },
  '.doc': { mimeTypes: ['application/msword', 'application/octet-stream'], signature: 'ole' },
  '.docx': { mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'], signature: 'zip' },
  '.txt': { mimeTypes: ['text/plain'], signature: 'text' },
  '.mp4': { mimeTypes: ['video/mp4'], signature: 'mp4' },
  '.webm': { mimeTypes: ['video/webm', 'audio/webm'], signature: 'webm' },
});
const AVATAR_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif']);

const uploadDir = process.env.APP_DATA_DIR
  ? path.join(path.resolve(process.env.APP_DATA_DIR), 'uploads')
  : path.join(__dirname, '../../uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const resolvedUploadDir = path.resolve(uploadDir);
const uploadFilenamePattern = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:${Object.keys(FILE_TYPES)
    .map(extension => extension.replace('.', '\\.'))
    .join('|')})$`,
  'i',
);
const requestedStorageLimit = Number(process.env.UPLOAD_STORAGE_LIMIT_BYTES || 5 * 1024 * 1024 * 1024);
const uploadStorageLimit = Number.isFinite(requestedStorageLimit)
  ? Math.min(Math.max(Math.trunc(requestedStorageLimit), 100 * 1024 * 1024), 100 * 1024 * 1024 * 1024)
  : 5 * 1024 * 1024 * 1024;
let trackedUploadBytes = fs.readdirSync(uploadDir, { withFileTypes: true })
  .filter(entry => entry.isFile())
  .reduce((total, entry) => {
    try { return total + fs.statSync(path.join(uploadDir, entry.name)).size; } catch (_) { return total; }
  }, 0);
let reservedUploadBytes = 0;

function declaredFileType(file, avatarOnly = false) {
  const extension = path.extname(String(file.originalname || '')).toLowerCase();
  const definition = FILE_TYPES[extension];
  if (!definition || (avatarOnly && !AVATAR_EXTENSIONS.has(extension))) return null;
  const mimeType = String(file.mimetype || '').toLowerCase();
  return definition.mimeTypes.includes(mimeType) ? { extension, ...definition } : null;
}

function hasPrefix(buffer, bytes) {
  return bytes.every((value, index) => buffer[index] === value);
}

function signatureMatches(buffer, signature) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  switch (signature) {
    case 'jpeg': return hasPrefix(buffer, [0xff, 0xd8, 0xff]);
    case 'png': return hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'gif': return buffer.subarray(0, 6).toString('ascii') === 'GIF87a'
      || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
    case 'pdf': return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    case 'ole': return hasPrefix(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'zip': return hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04])
      || hasPrefix(buffer, [0x50, 0x4b, 0x05, 0x06]);
    case 'mp4': return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
    case 'webm': return hasPrefix(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'text': {
      if (buffer.includes(0)) return false;
      let suspiciousControls = 0;
      for (const byte of buffer) {
        if (byte < 0x20 && ![0x09, 0x0a, 0x0d, 0x0c].includes(byte)) suspiciousControls += 1;
      }
      return suspiciousControls <= Math.max(1, Math.floor(buffer.length * 0.01));
    }
    default: return false;
  }
}

function resolveUploadedFilePath(file) {
  const filename = String(file?.filename || '');
  if (!uploadFilenamePattern.test(filename) || path.basename(filename) !== filename) return null;
  const candidate = path.resolve(resolvedUploadDir, filename);
  const relativePath = path.relative(resolvedUploadDir, candidate);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
  return candidate;
}

function removeUploadedFile(file) {
  const storedFilePath = resolveUploadedFilePath(file);
  if (!storedFilePath) return;
  try {
    fs.unlinkSync(storedFilePath);
  } catch (_) {
    // File daha önce kaldırılmışsa istemci repliesı değişmemeli.
  }
}

function reserveUploadCapacity(req, res, next) {
  if (trackedUploadBytes + reservedUploadBytes + MAX_UPLOAD_BYTES > uploadStorageLimit) {
    return res.status(507).json({ error: 'File storage is full. Contact an administrator.' });
  }
  reservedUploadBytes += MAX_UPLOAD_BYTES;
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    reservedUploadBytes = Math.max(0, reservedUploadBytes - MAX_UPLOAD_BYTES);
    if (res.statusCode < 400 && req.file?.size) {
      trackedUploadBytes += req.file.size;
    } else if (req.file) {
      removeUploadedFile(req.file);
    }
  };
  res.once('finish', finalize);
  res.once('close', finalize);
  return next();
}

function validateUploadedFile(req, res, next) {
  if (!req.file) return res.status(400).json({ error: 'No file was uploaded.' });
  const definition = declaredFileType(req.file, req.path === '/avatar');
  const storedFilePath = resolveUploadedFilePath(req.file);
  if (!storedFilePath) return res.status(400).json({ error: 'The file path failed the security check.' });
  let descriptor;
  try {
    descriptor = fs.openSync(storedFilePath, 'r');
    const header = Buffer.alloc(1024);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (!definition || !signatureMatches(header.subarray(0, bytesRead), definition.signature)) {
      removeUploadedFile(req.file);
      return res.status(415).json({ error: 'The actual file type is unsupported or does not match its extension.' });
    }
    req.verifiedUpload = definition;
    return next();
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_) { /* kapanmış olabilir */ }
    }
    removeUploadedFile(req.file);
    return next(error);
  }
}

const diskStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (_req, file, callback) => {
    const type = declaredFileType(file);
    callback(type ? null : new multer.MulterError('LIMIT_UNEXPECTED_FILE'), type ? `${crypto.randomUUID()}${type.extension}` : undefined);
  },
});

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 6 },
  fileFilter: (req, file, callback) => callback(null, Boolean(declaredFileType(file, req.path === '/avatar'))),
});

router.use(authRateLimit, requireAuth);

router.post('/file', uploadRateLimit, reserveUploadCapacity, upload.single('file'), validateUploadedFile, (req, res) => {
  res.status(201).json({
    url: `/uploads/${req.file.filename}`,
    filename: path.basename(String(req.file.originalname || 'dosya')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255),
    size: req.file.size,
    mimetype: req.file.mimetype,
  });
});

router.post('/avatar', uploadRateLimit, reserveUploadCapacity, upload.single('avatar'), validateUploadedFile, (req, res) => {
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

module.exports = router;
