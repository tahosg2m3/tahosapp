const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENVELOPE_TYPE = 'tahosapp-encrypted-state';
const LEGACY_ENVELOPE_TYPE = 'discord-clone-encrypted-state';
const ENVELOPE_VERSION = 1;
const ENVELOPE_ALGORITHM = 'aes-256-gcm';
const MIGRATION_MARKER_TYPE = 'tahosapp-plaintext-migration';
const LEGACY_MIGRATION_MARKER_TYPE = 'discord-clone-plaintext-migration';
const MIGRATION_MARKER_VERSION = 1;
const KEY_FILE_PREFIX = 'tahosapp-data-key-v1:';
const LEGACY_KEY_FILE_PREFIX = 'discord-clone-data-key-v1:';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const WINDOWS_PRIVATE_FILE_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:DCS_PRIVATE_FILE_PATH
if ([string]::IsNullOrWhiteSpace($target) -or -not (Test-Path -LiteralPath $target -PathType Leaf)) {
  throw 'Private file does not exist.'
}

$acl = [System.IO.File]::GetAccessControl($target)
$ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier])
$systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$administratorsSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
$principals = @{}
foreach ($sid in @($ownerSid, $systemSid, $administratorsSid)) { $principals[$sid.Value] = $sid }

# Codex'in kısıtlı test token'ı gibi ortamlarda çalışan process SID'i gerçek
# oturum hesabından farklı olabilir. Dosya sahibine ek olarak Windows'un
# USERDOMAIN/USERNAME hesabını çöz ve grant listesini SID bazında tekilleştir.
if (-not [string]::IsNullOrWhiteSpace($env:USERDOMAIN) -and -not [string]::IsNullOrWhiteSpace($env:USERNAME)) {
  $interactiveAccount = New-Object System.Security.Principal.NTAccount("$($env:USERDOMAIN)\$($env:USERNAME)")
  $interactiveSid = $interactiveAccount.Translate([System.Security.Principal.SecurityIdentifier])
  $principals[$interactiveSid.Value] = $interactiveSid
}
$expected = @($principals.Keys)

$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) {
  [void]$acl.RemoveAccessRuleAll($rule)
}
foreach ($sid in @($principals.Values)) {
  $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $sid,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  [void]$acl.AddAccessRule($accessRule)
}
[System.IO.File]::SetAccessControl($target, $acl)

$verified = [System.IO.File]::GetAccessControl($target)
if (-not $verified.AreAccessRulesProtected) { throw 'ACL inheritance is still enabled.' }
$seen = @{}
foreach ($rule in @($verified.Access)) {
  $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
    throw "Unexpected deny rule: $sid"
  }
  if ($expected -notcontains $sid) { throw "Unexpected principal: $sid" }
  if (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl) {
    throw "Principal does not have FullControl: $sid"
  }
  $seen[$sid] = $true
}
foreach ($sid in $expected) {
  if (-not $seen.ContainsKey($sid)) { throw "Required principal missing: $sid" }
}
`;

class StateEncryptionError extends Error {
  constructor(message, code = 'DATA_ENCRYPTION_ERROR', cause = null) {
    super(message);
    this.name = 'StateEncryptionError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  try {
    return Buffer.from(value, 'base64url');
  } catch (_) {
    return null;
  }
}

function decodeKeyEncoding(value) {
  if (typeof value !== 'string') return null;
  if (/^[A-Za-z0-9_-]+={0,2}$/.test(value)) {
    try { return Buffer.from(value, 'base64url'); } catch (_) { return null; }
  }
  if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    try { return Buffer.from(value, 'base64'); } catch (_) { return null; }
  }
  return null;
}

function parseKeyMaterial(value, sourceName) {
  const rawValue = String(value || '').trim();
  let key;

  if (/^[A-Fa-f0-9]{64}$/.test(rawValue)) {
    key = Buffer.from(rawValue, 'hex');
  } else if (rawValue.startsWith('hex:') && /^[A-Fa-f0-9]{64}$/.test(rawValue.slice(4))) {
    key = Buffer.from(rawValue.slice(4), 'hex');
  } else {
    const encoded = rawValue.startsWith('base64:') ? rawValue.slice(7) : rawValue;
    key = decodeKeyEncoding(encoded);
  }

  if (!key || key.length !== KEY_LENGTH) {
    throw new StateEncryptionError(
      `${sourceName} tam olarak 32 baytlık bir anahtar olmalıdır (64 karakter hex veya base64).`,
      'DATA_ENCRYPTION_KEY_INVALID',
    );
  }

  return key;
}

function getWindowsAclChildEnvironment(filePath) {
  const allowedNames = [
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATH',
    'PATHEXT',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'USERDOMAIN',
    'USERNAME',
  ];
  const environment = {};
  allowedNames.forEach(name => {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  });
  environment.DCS_PRIVATE_FILE_PATH = filePath;
  return environment;
}

function enforcePrivateFilePermissions(filePath) {
  try {
    if (process.platform === 'win32') {
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_PRIVATE_FILE_ACL_SCRIPT],
        {
          encoding: 'utf8',
          // Never expose application secrets (DATA_ENCRYPTION_KEY, JWT, SMTP,
          // GIPHY, NODE_OPTIONS, Electron flags, etc.) to the ACL helper.
          env: getWindowsAclChildEnvironment(filePath),
          timeout: 15000,
          windowsHide: true,
        },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) {
        const detail = String(result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-8).join(' | ');
        throw new Error(detail || `PowerShell exit code ${result.status}`);
      }
      return;
    }

    fs.chmodSync(filePath, 0o600);
    const mode = fs.statSync(filePath).mode & 0o777;
    if (mode !== 0o600) {
      throw new Error(`beklenen izin 0600, mevcut izin 0${mode.toString(8)}`);
    }
  } catch (error) {
    throw new StateEncryptionError(
      `Özel veri dosyasının erişim izinleri güvenli hale getirilemedi (${filePath}): ${error.message}`,
      'DATA_PRIVATE_FILE_PERMISSIONS',
      error,
    );
  }
}

function readKeyFile(keyFilePath, privateFileProtector = enforcePrivateFilePermissions) {
  let contents;
  try {
    // Tighten and verify the ACL before bringing key material into memory.
    privateFileProtector(keyFilePath);
    contents = fs.readFileSync(keyFilePath, 'utf8').trim();
  } catch (error) {
    if (error instanceof StateEncryptionError) throw error;
    throw new StateEncryptionError(
      `Veri şifreleme anahtarı okunamadı (${keyFilePath}): ${error.message}`,
      'DATA_ENCRYPTION_KEY_READ_FAILED',
      error,
    );
  }

  const prefix = [KEY_FILE_PREFIX, LEGACY_KEY_FILE_PREFIX].find(candidate => contents.startsWith(candidate));
  const material = prefix ? contents.slice(prefix.length) : contents;
  return parseKeyMaterial(material, 'Veri şifreleme anahtarı dosyası');
}

function loadOrCreateEncryptionKey({
  keyFilePath,
  environmentKey = process.env.DATA_ENCRYPTION_KEY,
  allowKeyCreation = true,
  privateFileProtector = enforcePrivateFilePermissions,
}) {
  if (environmentKey && String(environmentKey).trim()) {
    return {
      key: parseKeyMaterial(environmentKey, 'DATA_ENCRYPTION_KEY'),
      source: 'environment',
      created: false,
    };
  }

  if (!keyFilePath) {
    throw new StateEncryptionError(
      'DATA_ENCRYPTION_KEY tanımlı değil ve anahtar dosyası yolu verilmedi.',
      'DATA_ENCRYPTION_KEY_MISSING',
    );
  }

  if (fs.existsSync(keyFilePath)) {
    return { key: readKeyFile(keyFilePath, privateFileProtector), source: 'file', created: false };
  }

  if (!allowKeyCreation) {
    throw new StateEncryptionError(
      `Şifreli uygulama verisi mevcut fakat anahtar bulunamadı (${keyFilePath}). Yeni anahtar oluşturulmadı ve hiçbir veri değiştirilmedi.`,
      'DATA_ENCRYPTION_KEY_MISSING',
    );
  }

  const generatedKey = crypto.randomBytes(KEY_LENGTH);
  const fileContents = `${KEY_FILE_PREFIX}${generatedKey.toString('base64url')}\n`;
  let descriptor = null;
  let createdFile = false;

  try {
    fs.mkdirSync(path.dirname(keyFilePath), { recursive: true, mode: 0o700 });
    descriptor = fs.openSync(keyFilePath, 'wx', 0o600);
    createdFile = true;
    fs.writeFileSync(descriptor, fileContents, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    privateFileProtector(keyFilePath);
    return { key: generatedKey, source: 'file', created: true };
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (_) { /* best effort */ }
    }
    if (createdFile) {
      try { fs.unlinkSync(keyFilePath); } catch (_) { /* best effort */ }
    }
    // İki süreç aynı anda ilk açılışı yaparsa yalnızca biri dosyayı oluşturur.
    // Diğeri oluşturulmuş anahtarı yeniden okuyarak aynı anahtarla devam eder.
    if (error.code === 'EEXIST') {
      return { key: readKeyFile(keyFilePath, privateFileProtector), source: 'file', created: false };
    }
    if (error instanceof StateEncryptionError) throw error;
    throw new StateEncryptionError(
      `Veri şifreleme anahtarı oluşturulamadı (${keyFilePath}): ${error.message}`,
      'DATA_ENCRYPTION_KEY_CREATE_FAILED',
      error,
    );
  }
}

function isEncryptionEnvelope(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && [ENVELOPE_TYPE, LEGACY_ENVELOPE_TYPE].includes(value.type),
  );
}

class EncryptedStateCodec {
  constructor(options = {}) {
    const keyInfo = loadOrCreateEncryptionKey(options);
    this.key = keyInfo.key;
    this.keySource = keyInfo.source;
    this.keyWasCreated = keyInfo.created;
    this.keyFilePath = options.keyFilePath || null;
    this.keyId = crypto.createHash('sha256').update(this.key).digest('hex').slice(0, 16);
  }

  getAdditionalAuthenticatedData(keyId = this.keyId, envelopeType = ENVELOPE_TYPE) {
    return Buffer.from(
      `${envelopeType}:${ENVELOPE_VERSION}:${ENVELOPE_ALGORITHM}:${keyId}`,
      'utf8',
    );
  }

  createMigrationMarker(status, markerType = MIGRATION_MARKER_TYPE) {
    if (!['pending', 'complete'].includes(status)) {
      throw new StateEncryptionError('Geçersiz plaintext migration marker durumu.', 'DATA_MIGRATION_MARKER_INVALID');
    }
    const marker = {
      type: markerType,
      version: MIGRATION_MARKER_VERSION,
      keyId: this.keyId,
      status,
    };
    const canonical = JSON.stringify([marker.type, marker.version, marker.keyId, marker.status]);
    return {
      ...marker,
      mac: crypto.createHmac('sha256', this.key)
        .update(markerType === LEGACY_MIGRATION_MARKER_TYPE
          ? 'discord-clone:migration-marker:v1\0'
          : 'tahosapp:migration-marker:v1\0', 'utf8')
        .update(canonical, 'utf8')
        .digest('base64url'),
    };
  }

  verifyMigrationMarker(marker) {
    if (
      !marker
      || typeof marker !== 'object'
      || Array.isArray(marker)
      || ![MIGRATION_MARKER_TYPE, LEGACY_MIGRATION_MARKER_TYPE].includes(marker.type)
      || marker.version !== MIGRATION_MARKER_VERSION
      || marker.keyId !== this.keyId
      || !['pending', 'complete'].includes(marker.status)
    ) {
      throw new StateEncryptionError(
        'Plaintext migration marker geçersiz veya farklı bir anahtara ait.',
        'DATA_MIGRATION_MARKER_INVALID',
      );
    }

    const suppliedMac = decodeBase64Url(marker.mac);
    const expected = this.createMigrationMarker(marker.status, marker.type);
    const expectedMac = decodeBase64Url(expected.mac);
    if (
      !suppliedMac
      || !expectedMac
      || suppliedMac.length !== expectedMac.length
      || !crypto.timingSafeEqual(suppliedMac, expectedMac)
    ) {
      throw new StateEncryptionError(
        'Plaintext migration marker doğrulanamadı; veri değiştirilmedi.',
        'DATA_MIGRATION_MARKER_AUTH_FAILED',
      );
    }
    return marker.status;
  }

  encodeSnapshot(snapshot) {
    let plaintext;
    try {
      plaintext = JSON.stringify(snapshot);
    } catch (error) {
      throw new StateEncryptionError(
        `Uygulama verisi JSON'a dönüştürülemedi: ${error.message}`,
        'DATA_SERIALIZATION_FAILED',
        error,
      );
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENVELOPE_ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    cipher.setAAD(this.getAdditionalAuthenticatedData());
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return JSON.stringify({
      type: ENVELOPE_TYPE,
      version: ENVELOPE_VERSION,
      algorithm: ENVELOPE_ALGORITHM,
      keyId: this.keyId,
      iv: iv.toString('base64url'),
      authTag: authTag.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    });
  }

  decodeSnapshot(serialized, sourceName = 'uygulama verisi') {
    let parsed;
    try {
      parsed = JSON.parse(serialized);
    } catch (error) {
      throw new StateEncryptionError(
        `${sourceName} geçerli JSON veya şifreli veri zarfı değil. Veri güvenliği için uygulama başlatılmadı.`,
        'DATA_FORMAT_INVALID',
        error,
      );
    }

    if (!isEncryptionEnvelope(parsed)) {
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new StateEncryptionError(
          `${sourceName} geçerli bir uygulama durumu içermiyor.`,
          'DATA_FORMAT_INVALID',
        );
      }
      return { snapshot: parsed, wasPlaintext: true };
    }

    if (parsed.version !== ENVELOPE_VERSION || parsed.algorithm !== ENVELOPE_ALGORITHM) {
      throw new StateEncryptionError(
        `${sourceName} desteklenmeyen bir şifreleme sürümü veya algoritması kullanıyor.`,
        'DATA_ENCRYPTION_VERSION_UNSUPPORTED',
      );
    }
    if (parsed.keyId !== this.keyId) {
      throw new StateEncryptionError(
        `${sourceName} bu DATA_ENCRYPTION_KEY/anahtar dosyasıyla şifrelenmemiş. Doğru anahtarı geri yüklemeden uygulama başlatılamaz.`,
        'DATA_ENCRYPTION_KEY_MISMATCH',
      );
    }

    const iv = decodeBase64Url(parsed.iv);
    const authTag = decodeBase64Url(parsed.authTag);
    const ciphertext = decodeBase64Url(parsed.ciphertext);
    if (!iv || iv.length !== IV_LENGTH || !authTag || authTag.length !== AUTH_TAG_LENGTH || !ciphertext) {
      throw new StateEncryptionError(
        `${sourceName} şifreli veri zarfı eksik veya bozuk.`,
        'DATA_ENCRYPTED_ENVELOPE_INVALID',
      );
    }

    let plaintext;
    try {
      const decipher = crypto.createDecipheriv(ENVELOPE_ALGORITHM, this.key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      decipher.setAAD(this.getAdditionalAuthenticatedData(parsed.keyId, parsed.type));
      decipher.setAuthTag(authTag);
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (error) {
      throw new StateEncryptionError(
        `${sourceName} çözülemedi veya doğrulanamadı. Anahtar yanlış ya da veri değiştirilmiş olabilir; veri sıfırlanmadı.`,
        'DATA_DECRYPTION_FAILED',
        error,
      );
    }

    try {
      const snapshot = JSON.parse(plaintext);
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Nesne bekleniyordu.');
      return { snapshot, wasPlaintext: false };
    } catch (error) {
      throw new StateEncryptionError(
        `${sourceName} başarıyla çözüldü ancak içeriği geçerli bir uygulama durumu değil.`,
        'DATA_DECRYPTED_FORMAT_INVALID',
        error,
      );
    }
  }

  destroy() {
    if (Buffer.isBuffer(this.key)) this.key.fill(0);
  }
}

module.exports = {
  ENVELOPE_TYPE,
  LEGACY_ENVELOPE_TYPE,
  EncryptedStateCodec,
  StateEncryptionError,
  enforcePrivateFilePermissions,
  isEncryptionEnvelope,
};
