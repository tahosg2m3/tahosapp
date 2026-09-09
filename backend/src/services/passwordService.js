const argon2 = require('argon2');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Argon2'nin bellek değeri KiB cinsindendir. Bu ayarlar parola denemelerini
// pahalı hale getirirken masaüstü/yerel backend usesında makul kalır.
const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});

const PASSWORD_WORK_CONCURRENCY = 2;
const PASSWORD_WORK_MAX_QUEUE = 32;
const passwordWorkQueue = [];
let activePasswordWork = 0;

function passwordWorkQueueError() {
  const error = new Error('Secure password processing is temporarily at capacity.');
  error.code = 'PASSWORD_WORK_QUEUE_FULL';
  return error;
}

function drainPasswordWorkQueue() {
  while (activePasswordWork < PASSWORD_WORK_CONCURRENCY && passwordWorkQueue.length > 0) {
    const work = passwordWorkQueue.shift();
    activePasswordWork += 1;

    Promise.resolve()
      .then(work.task)
      .then(work.resolve, work.reject)
      .finally(() => {
        activePasswordWork -= 1;
        drainPasswordWorkQueue();
      });
  }
}

function schedulePasswordWork(task) {
  if (passwordWorkQueue.length >= PASSWORD_WORK_MAX_QUEUE) {
    return Promise.reject(passwordWorkQueueError());
  }

  return new Promise((resolve, reject) => {
    passwordWorkQueue.push({ task, resolve, reject });
    drainPasswordWorkQueue();
  });
}

function isPasswordWorkQueueError(error) {
  return error?.code === 'PASSWORD_WORK_QUEUE_FULL';
}

function isArgon2Hash(value) {
  return typeof value === 'string' && /^\$argon2(?:id|i|d)\$/.test(value);
}

function isArgon2idHash(value) {
  return typeof value === 'string' && value.startsWith('$argon2id$');
}

function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

function isLegacyPlaintextPassword(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1024
    // Tanınmayan `$algoritma$...` biçimini yanlışlıkla düz text kabul edip
    // çift hashlemeyelim; yalnız '$' ile başlayan normal eski parolaları bozmayalım.
    && !/^\$[A-Za-z0-9-]+\$/.test(value)
    && !isArgon2Hash(value)
    && !isBcryptHash(value);
}

function constantTimeTextEquals(first, second) {
  const expected = Buffer.from(String(first || ''), 'utf8');
  const supplied = Buffer.from(String(second || ''), 'utf8');
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

async function hashPassword(password) {
  if (typeof password !== 'string') throw new TypeError('The password must be text.');
  return schedulePasswordWork(() => argon2.hash(password, ARGON2_OPTIONS));
}

async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string' || !storedHash) {
    return { valid: false, needsRehash: false, format: 'invalid' };
  }

  if (isArgon2Hash(storedHash)) {
    try {
      const valid = await schedulePasswordWork(() => argon2.verify(storedHash, password));
      const parametersChanged = typeof argon2.needsRehash === 'function'
        ? argon2.needsRehash(storedHash, ARGON2_OPTIONS)
        : false;
      return {
        valid,
        needsRehash: valid && (!isArgon2idHash(storedHash) || parametersChanged),
        format: isArgon2idHash(storedHash) ? 'argon2id' : 'argon2-legacy',
      };
    } catch (error) {
      if (isPasswordWorkQueueError(error)) throw error;
      return { valid: false, needsRehash: false, format: 'invalid' };
    }
  }

  if (isBcryptHash(storedHash)) {
    try {
      const valid = await schedulePasswordWork(() => bcrypt.compare(password, storedHash));
      return { valid, needsRehash: valid, format: 'bcrypt' };
    } catch (error) {
      if (isPasswordWorkQueueError(error)) throw error;
      return { valid: false, needsRehash: false, format: 'invalid' };
    }
  }

  // Çok eski sürümler parolayı düz text saklıyordu. Yalnızca başarılı ilk
  // girişe izin verilir and değer aynı istek içinde Argon2id'e taşınır.
  if (!isLegacyPlaintextPassword(storedHash)) {
    return { valid: false, needsRehash: false, format: 'invalid' };
  }

  const valid = constantTimeTextEquals(storedHash, password);
  return { valid, needsRehash: valid, format: 'plaintext-legacy' };
}

module.exports = {
  ARGON2_OPTIONS,
  hashPassword,
  isArgon2Hash,
  isArgon2idHash,
  isBcryptHash,
  isLegacyPlaintextPassword,
  isPasswordWorkQueueError,
  verifyPassword,
};
