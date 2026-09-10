const fs = require('fs');
const path = require('path');
const {
  ENVELOPE_TYPE,
  LEGACY_ENVELOPE_TYPE,
  EncryptedStateCodec,
  StateEncryptionError,
  enforcePrivateFilePermissions,
  isEncryptionEnvelope,
} = require('./encryptedStateCodec');

/**
 * Persists the complete application state as one authenticated, encrypted
 * document. SQLite still supplies atomic commits; the JSON file remains the
 * atomic fallback for runtimes where better-sqlite3 cannot be loaded.
 */
class SQLiteStateStore {
  constructor({
    databasePath,
    legacyDataFile,
    encryptionKeyFile,
    environmentKey = process.env.DATA_ENCRYPTION_KEY,
    legacyBackupFiles,
    migrationMarkerFile,
    allowPlaintextStateMigration = process.env.ALLOW_PLAINTEXT_STATE_MIGRATION,
    privateFileProtector = enforcePrivateFilePermissions,
    logger = console,
  }) {
    this.databasePath = databasePath;
    this.legacyDataFile = legacyDataFile;
    this.logger = logger;
    this.db = null;
    this.usingSQLite = false;
    this.selectState = null;
    this.writeState = null;
    this.privateFileProtector = privateFileProtector;
    this.encryptionKeyFile = encryptionKeyFile;
    this.explicitPlaintextMigrationAllowed = allowPlaintextStateMigration === true
      || allowPlaintextStateMigration === 'true';
    this.legacyBackupFiles = Array.isArray(legacyBackupFiles)
      ? legacyBackupFiles
      : this.findLegacyBackupFiles();
    const dataDirectory = path.dirname(encryptionKeyFile || legacyDataFile || databasePath);
    this.migrationMarkerFile = migrationMarkerFile
      || path.join(dataDirectory, 'data-encryption-migration.json');
    this.preflight = this.inspectStorageArtifacts();
    this.codec = new EncryptedStateCodec({
      keyFilePath: encryptionKeyFile,
      environmentKey,
      allowKeyCreation: !this.preflight.hasEncryptedState && !this.preflight.hasMigrationMarkerEvidence,
      privateFileProtector,
    });
    this.recoverMigrationMarkerTemporaryFiles();
    this.migrationStatus = this.readMigrationMarker();
    this.recoverEncryptedTemporaryFiles();
    // Temporary recovery/cleanup can change which authoritative artifacts are
    // present. Re-scan before deciding whether plaintext migration is allowed.
    this.preflight = this.inspectStorageArtifacts();
    this.preparePlaintextMigrationAuthorization();

    this.initialize();
  }

  findLegacyBackupFiles() {
    if (!this.legacyDataFile) return [];
    const directory = path.dirname(this.legacyDataFile);
    try {
      return fs.readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isFile() && /^datayedek.*\.json$/i.test(entry.name))
        .map(entry => path.join(directory, entry.name));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      this.logger.warn(`Legacy data backups could not be listed: ${error.message}`);
      return [];
    }
  }

  findTemporaryFiles(targetPath) {
    if (!targetPath) return [];
    const directory = path.dirname(targetPath);
    const escapedName = path.basename(targetPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedName}\\.\\d+\\.\\d+\\.tmp$`);
    try {
      return fs.readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isFile() && pattern.test(entry.name))
        .map(entry => path.join(directory, entry.name));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new StateEncryptionError(
        `Temporary data files could not be listed (${directory}): ${error.message}`,
        'DATA_TEMP_FILE_SCAN_FAILED',
        error,
      );
    }
  }

  inspectStorageArtifacts() {
    let hasEncryptedState = false;
    let hasPlaintextState = false;
    let hasAnyState = false;
    // Marka değişiminden önce yazılmış şifreli kayıtlar da şifreli veridir.
    // Yalnızca yeni zarf adını aramak, eski and geçerli AES-GCM verisini
    // yanlışlıkla plaintext sayarak güvenli başlangıcı engeller.
    const envelopeSignatures = [ENVELOPE_TYPE, LEGACY_ENVELOPE_TYPE]
      .map(type => Buffer.from(type, 'utf8'));

    const sqliteFiles = [this.databasePath, `${this.databasePath}-wal`]
      .filter(filePath => filePath && fs.existsSync(filePath));
    let sqliteHasContent = false;
    let sqliteHasEnvelope = false;
    sqliteFiles.forEach(filePath => {
      const contents = fs.readFileSync(filePath);
      if (contents.length > 0) sqliteHasContent = true;
      if (envelopeSignatures.some(signature => contents.includes(signature))) {
        sqliteHasEnvelope = true;
      }
    });
    if (sqliteHasContent) {
      hasAnyState = true;
      if (sqliteHasEnvelope) hasEncryptedState = true;
      else hasPlaintextState = true;
    }

    const jsonTargets = [...new Set([
      this.legacyDataFile,
      ...this.legacyBackupFiles,
    ].filter(Boolean))];
    jsonTargets.forEach(targetPath => {
      const candidates = [targetPath, ...this.findTemporaryFiles(targetPath)];
      candidates.forEach(filePath => {
        if (!fs.existsSync(filePath)) return;
        const contents = fs.readFileSync(filePath);
        if (!contents.length) return;
        hasAnyState = true;
        if (envelopeSignatures.some(signature => contents.includes(signature))) {
          hasEncryptedState = true;
        }
        else hasPlaintextState = true;
      });
    });

    const hasMigrationMarkerEvidence = Boolean(
      (this.migrationMarkerFile && fs.existsSync(this.migrationMarkerFile))
      || this.findTemporaryFiles(this.migrationMarkerFile).length,
    );

    return {
      hasAnyState,
      hasEncryptedState,
      hasPlaintextState,
      hasMigrationMarkerEvidence,
    };
  }

  secureDeleteTemporaryFile(filePath) {
    let descriptor = null;
    try {
      const size = fs.statSync(filePath).size;
      descriptor = fs.openSync(filePath, 'r+');
      const zeroes = Buffer.alloc(Math.min(Math.max(size, 1), 64 * 1024));
      let offset = 0;
      while (offset < size) {
        const length = Math.min(zeroes.length, size - offset);
        fs.writeSync(descriptor, zeroes, 0, length, offset);
        offset += length;
      }
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.unlinkSync(filePath);
    } catch (error) {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch (_) { /* best effort */ }
      }
      if (error.code === 'ENOENT') return;
      throw new StateEncryptionError(
        `The temporary data file could not be removed safely (${filePath}): ${error.message}`,
        'DATA_TEMP_FILE_CLEANUP_FAILED',
        error,
      );
    }
  }

  recoverAtomicTemporaryFiles(targetPath, validator, { privateFile = false } = {}) {
    const temporaryFiles = this.findTemporaryFiles(targetPath);
    if (!temporaryFiles.length) return;

    if (fs.existsSync(targetPath)) {
      temporaryFiles.forEach(filePath => this.secureDeleteTemporaryFile(filePath));
      return;
    }

    const validFiles = temporaryFiles.flatMap(filePath => {
      try {
        const rawData = fs.readFileSync(filePath, 'utf8');
        validator(rawData, filePath);
        return [{ filePath, modifiedAt: fs.statSync(filePath).mtimeMs }];
      } catch (_) {
        this.secureDeleteTemporaryFile(filePath);
        return [];
      }
    }).sort((left, right) => right.modifiedAt - left.modifiedAt);

    if (!validFiles.length) return;
    const recovered = validFiles[0].filePath;
    fs.renameSync(recovered, targetPath);
    if (privateFile) this.privateFileProtector(targetPath);
    else if (process.platform !== 'win32') fs.chmodSync(targetPath, 0o600);
    validFiles.slice(1).forEach(item => this.secureDeleteTemporaryFile(item.filePath));
    this.logger.warn(`${path.basename(targetPath)} was recovered from a completed secure temporary file.`);
  }

  recoverMigrationMarkerTemporaryFiles() {
    this.recoverAtomicTemporaryFiles(
      this.migrationMarkerFile,
      rawData => this.codec.verifyMigrationMarker(JSON.parse(rawData)),
      { privateFile: true },
    );
  }

  recoverEncryptedTemporaryFiles() {
    [...new Set([this.legacyDataFile, ...this.legacyBackupFiles].filter(Boolean))]
      .forEach(targetPath => this.recoverAtomicTemporaryFiles(
        targetPath,
        (rawData, filePath) => {
          const decoded = this.codec.decodeSnapshot(rawData, `${path.basename(filePath)} geçici dosyası`);
          if (decoded.wasPlaintext) {
            throw new StateEncryptionError(
              'The plaintext temporary snapshot was not recovered for security reasons.',
              'DATA_PLAINTEXT_TEMP_REJECTED',
            );
          }
        },
      ));
  }

  readMigrationMarker() {
    if (!this.migrationMarkerFile || !fs.existsSync(this.migrationMarkerFile)) return null;
    try {
      this.privateFileProtector(this.migrationMarkerFile);
      const marker = JSON.parse(fs.readFileSync(this.migrationMarkerFile, 'utf8'));
      return this.codec.verifyMigrationMarker(marker);
    } catch (error) {
      if (error instanceof StateEncryptionError) throw error;
      throw new StateEncryptionError(
        `The plaintext migration marker could not be read: ${error.message}`,
        'DATA_MIGRATION_MARKER_INVALID',
        error,
      );
    }
  }

  writeMigrationMarker(status) {
    const serialized = JSON.stringify(this.codec.createMigrationMarker(status));
    this.writeEncryptedFileAtomic(
      this.migrationMarkerFile,
      serialized,
      'The plaintext migration marker could not be saved',
      { privateFile: true },
    );
    this.migrationStatus = status;
  }

  preparePlaintextMigrationAuthorization() {
    if (this.migrationStatus === 'complete' && this.preflight.hasPlaintextState) {
      throw new StateEncryptionError(
        'Encryption migration was already completed; plaintext application data added later was rejected.',
        'PLAINTEXT_STATE_REJECTED',
      );
    }
    if (this.migrationStatus) return;

    if (this.codec.keyWasCreated) {
      // Persist authorization before touching plaintext so a crash after key
      // creation can safely resume instead of stranding the old state.
      try {
        this.writeMigrationMarker('pending');
      } catch (error) {
        // Nothing has been encrypted with this just-created key yet. Remove it
        // rather than leave an unusable key-without-marker half-state.
        if (this.encryptionKeyFile && fs.existsSync(this.encryptionKeyFile)) {
          this.secureDeleteTemporaryFile(this.encryptionKeyFile);
        }
        throw error;
      }
      return;
    }

    if (this.preflight.hasPlaintextState) {
      if (!this.explicitPlaintextMigrationAllowed) {
        throw new StateEncryptionError(
          'Plaintext application data exists, but one-time migration is not authorized. With an external key, use ALLOW_PLAINTEXT_STATE_MIGRATION=true only for the first controlled migration.',
          'PLAINTEXT_STATE_MIGRATION_NOT_AUTHORIZED',
        );
      }
      this.writeMigrationMarker('pending');
    }
  }

  assertPlaintextMigrationAllowed(sourceName) {
    if (this.migrationStatus === 'pending') return;
    if (!this.migrationStatus && this.explicitPlaintextMigrationAllowed) {
      this.writeMigrationMarker('pending');
      return;
    }
    throw new StateEncryptionError(
      `${sourceName} was found in plaintext, but the one-time migration is complete or was not authorized. The data was rejected and left unchanged.`,
      'PLAINTEXT_STATE_REJECTED',
    );
  }

  completePlaintextMigration() {
    if (this.migrationStatus !== 'complete') this.writeMigrationMarker('complete');
  }

  initialize() {
    // better-sqlite3 v13 requires Node 22+. Electron 28 embeds Node 18, and
    // loading its native addon there can terminate the child process before
    // JavaScript gets a chance to catch the ABI error. Use the encrypted,
    // atomic JSON fallback in that runtime instead.
    const nodeMajor = Number(String(process.versions.node || '0').split('.')[0]);
    if (process.versions.electron && nodeMajor < 22) {
      this.disableSQLite(new Error('The packaged Electron runtime does not include the Node version supported by the SQLite extension.'), false);
      this.logger.warn('No compatible SQLite extension was found in the packaged Electron build; an encrypted atomic JSON data file will be used.');
      return;
    }

    let Database;
    try {
      // Missing/incompatible native code is the one supported reason to use the
      // JSON fallback. Database/schema/corruption errors below are fatal.
      // eslint-disable-next-line global-require
      Database = require('better-sqlite3');
    } catch (error) {
      this.disableSQLite(error);
      return;
    }

    try {
      fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });

      this.db = new Database(this.databasePath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = FULL');
      // When a plaintext row is replaced during the one-time migration, SQLite
      // must wipe released cells/pages rather than leaving recoverable content.
      this.db.pragma('secure_delete = ON');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS app_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          state_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      this.selectState = this.db.prepare('SELECT state_json FROM app_state WHERE id = 1');
      const upsert = this.db.prepare(`
        INSERT INTO app_state (id, state_json, updated_at)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          state_json = excluded.state_json,
          updated_at = excluded.updated_at
      `);
      this.writeState = this.db.transaction((encryptedState, updatedAt) => {
        upsert.run(encryptedState, updatedAt);
      });
      this.usingSQLite = true;
    } catch (error) {
      if (this.db) {
        try { this.db.close(); } catch (_) { /* best effort */ }
      }
      this.db = null;
      this.selectState = null;
      this.writeState = null;
      this.usingSQLite = false;
      throw new StateEncryptionError(
        `The SQLite database could not be initialized; the JSON fallback was not used and data was not reset: ${error.message}`,
        'DATA_SQLITE_INITIALIZATION_FAILED',
        error,
      );
    }
  }

  disableSQLite(error, announce = true) {
    if (this.db) {
      try {
        this.db.close();
      } catch (_) {
        // Closing a failed database is only best effort.
      }
    }

    this.db = null;
    this.selectState = null;
    this.writeState = null;
    this.usingSQLite = false;

    if (announce) {
      this.logger.warn(`SQLite is unavailable; an encrypted JSON data file will be used: ${error.message}`);
    }
  }

  writeEncryptedFileAtomic(targetPath, serialized, errorPrefix, { privateFile = false } = {}) {
    const temporaryFile = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    let descriptor = null;
    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      descriptor = fs.openSync(temporaryFile, 'wx', 0o600);
      fs.writeFileSync(descriptor, serialized, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      if (privateFile) this.privateFileProtector(temporaryFile);
      else if (process.platform !== 'win32') fs.chmodSync(temporaryFile, 0o600);
      fs.renameSync(temporaryFile, targetPath);
      if (privateFile) this.privateFileProtector(targetPath);
      else if (process.platform !== 'win32') fs.chmodSync(targetPath, 0o600);
      return true;
    } catch (error) {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch (_) { /* best effort */ }
      }
      try {
        if (fs.existsSync(temporaryFile)) this.secureDeleteTemporaryFile(temporaryFile);
      } catch (_) {
        // Preserve the original error; temporary cleanup is best effort.
      }
      throw new StateEncryptionError(
        `${errorPrefix}: ${error.message}`,
        'DATA_ATOMIC_WRITE_FAILED',
        error,
      );
    }
  }

  readLegacySnapshot() {
    if (!this.legacyDataFile || !fs.existsSync(this.legacyDataFile)) return null;

    let rawData;
    try {
      rawData = fs.readFileSync(this.legacyDataFile, 'utf8');
    } catch (error) {
      throw new StateEncryptionError(
        `The JSON data file could not be read: ${error.message}`,
        'DATA_READ_FAILED',
        error,
      );
    }

    const decoded = this.codec.decodeSnapshot(rawData, 'JSON data file');
    if (decoded.wasPlaintext) {
      this.assertPlaintextMigrationAllowed('JSON data file');
      // Existing installations are migrated in place. The rename is atomic, so
      // a crash cannot leave a half-written encrypted JSON file behind.
      this.writeLegacySnapshot(this.codec.encodeSnapshot(decoded.snapshot));
      this.logger.info('Legacy plaintext JSON application data was migrated to encrypted storage.');
    }
    return decoded.snapshot;
  }

  migrateLegacyBackups() {
    this.legacyBackupFiles.forEach(backupFile => {
      if (!backupFile || !fs.existsSync(backupFile)) return;

      let rawData;
      let parsed;
      try {
        rawData = fs.readFileSync(backupFile, 'utf8');
        parsed = JSON.parse(rawData);
      } catch (error) {
        this.logger.warn(`${path.basename(backupFile)} was not encrypted automatically because it is not valid JSON: ${error.message}`);
        return;
      }

      if (isEncryptionEnvelope(parsed)) {
        // Verify existing encrypted backups too. A mismatched key must not be
        // silently ignored, because that would make later recovery impossible.
        this.codec.decodeSnapshot(rawData, `${path.basename(backupFile)} backup`);
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.logger.warn(`${path.basename(backupFile)} was left unchanged because it is not a JSON object.`);
        return;
      }

      this.assertPlaintextMigrationAllowed(`${path.basename(backupFile)} backup`);
      const encrypted = this.codec.encodeSnapshot(parsed);
      this.writeEncryptedFileAtomic(
        backupFile,
        encrypted,
        `${path.basename(backupFile)} backup could not be encrypted`,
      );
      this.logger.info(`${path.basename(backupFile)} plaintext backup was migrated to encrypted storage.`);
    });
  }

  async transformLegacySnapshots(transformer) {
    if (typeof transformer !== 'function') {
      throw new TypeError('The legacy snapshot converter must be a function.');
    }

    const files = [...new Set([
      this.legacyDataFile,
      ...this.legacyBackupFiles,
    ].filter(Boolean))];
    let transformedItems = 0;

    for (const filePath of files) {
      if (!fs.existsSync(filePath)) continue;

      let rawData;
      try {
        rawData = fs.readFileSync(filePath, 'utf8');
      } catch (error) {
        throw new StateEncryptionError(
          `${path.basename(filePath)} could not be read for secure conversion: ${error.message}`,
          'DATA_READ_FAILED',
          error,
        );
      }

      const decoded = this.codec.decodeSnapshot(rawData, `${path.basename(filePath)} snapshot`);
      if (decoded.wasPlaintext) this.assertPlaintextMigrationAllowed(`${path.basename(filePath)} snapshot`);
      const result = await transformer(decoded.snapshot, { filePath });
      if (!result?.changed && !decoded.wasPlaintext) continue;

      const nextSnapshot = result?.snapshot || decoded.snapshot;
      this.writeEncryptedFileAtomic(
        filePath,
        this.codec.encodeSnapshot(nextSnapshot),
        `${path.basename(filePath)} could not be updated safely`,
      );
      transformedItems += Number(result.changedCount) || 0;
    }

    return transformedItems;
  }

  purgePlaintextSQLiteRemnants() {
    try {
      // Truncate the old WAL first, rebuild the main file so free pages cannot
      // retain the former JSON, then truncate the encrypted VACUUM WAL too.
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      this.db.exec('VACUUM');
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (error) {
      throw new StateEncryptionError(
        `Plaintext SQLite remnants could not be removed safely: ${error.message}`,
        'DATA_PLAINTEXT_PURGE_FAILED',
        error,
      );
    }
  }

  migratePlaintextSQLiteSnapshot(snapshot) {
    this.assertPlaintextMigrationAllowed('SQLite application data');
    const encrypted = this.codec.encodeSnapshot(snapshot);
    try {
      this.writeState(encrypted, Date.now());
    } catch (error) {
      throw new StateEncryptionError(
        `SQLite application data could not be migrated to encrypted storage: ${error.message}`,
        'DATA_MIGRATION_FAILED',
        error,
      );
    }
    // Keep the authenticated marker pending until WAL truncation and VACUUM
    // both succeed. A crash/failure is retried on the next startup.
    this.sqlitePurgeRequired = true;
    this.logger.info('Legacy plaintext SQLite application data was migrated to encrypted storage.');
  }

  load() {
    let state;

    if (!this.usingSQLite) {
      state = this.readLegacySnapshot();
      this.migrateLegacyBackups();
      this.completePlaintextMigration();
      return state;
    }

    // Do not put decryption inside a fallback catch. A wrong key/authentication
    // tag is fatal and must never be mistaken for an empty database.
    let row;
    try {
      row = this.selectState.get();
    } catch (error) {
      throw new StateEncryptionError(
        `SQLite application data could not be read; data was not reset: ${error.message}`,
        'DATA_READ_FAILED',
        error,
      );
    }

    if (row) {
      const decoded = this.codec.decodeSnapshot(row.state_json, 'SQLite application data');
      if (decoded.wasPlaintext) this.migratePlaintextSQLiteSnapshot(decoded.snapshot);
      state = decoded.snapshot;
      // data.json may remain from an older SQLite import. It is not the active
      // source anymore, but leaving that stale snapshot in plaintext would
      // still expose accounts/messages at rest, so migrate it as well.
      if (this.legacyDataFile && fs.existsSync(this.legacyDataFile)) this.readLegacySnapshot();
    } else {
      // First SQLite launch: import the old JSON state once. readLegacySnapshot
      // rewrites plaintext JSON to an encrypted envelope before returning it.
      state = this.readLegacySnapshot();
      if (state && !this.save(state)) {
        throw new StateEncryptionError(
          'Legacy JSON data could not be imported into SQLite; data was not reset.',
          'DATA_MIGRATION_FAILED',
        );
      }
    }

    this.migrateLegacyBackups();
    if (this.migrationStatus === 'pending' || this.sqlitePurgeRequired) {
      this.purgePlaintextSQLiteRemnants();
      this.sqlitePurgeRequired = false;
    }
    this.completePlaintextMigration();
    return state;
  }

  save(snapshot) {
    let encrypted;
    try {
      encrypted = this.codec.encodeSnapshot(snapshot);
    } catch (error) {
      this.logger.error(error.message);
      return false;
    }

    if (this.usingSQLite) {
      try {
        // The transaction writes the complete authenticated envelope in one
        // SQLite commit; no application fields are stored in plaintext.
        this.writeState(encrypted, Date.now());
        return true;
      } catch (error) {
        // Once SQLite was selected it remains authoritative for this process.
        // Writing a newer JSON fallback here would create two divergent states
        // and could rolesl data back on restart, so fail closed instead.
        this.logger.error(`SQLite application data could not be saved; the JSON fallback was not written: ${error.message}`);
        return false;
      }
    }

    try {
      return this.writeLegacySnapshot(encrypted);
    } catch (error) {
      this.logger.error(error.message);
      return false;
    }
  }

  writeLegacySnapshot(encrypted) {
    if (!this.legacyDataFile) return false;
    return this.writeEncryptedFileAtomic(
      this.legacyDataFile,
      encrypted,
      'Data could not be saved to the encrypted JSON file',
    );
  }

  close() {
    try {
      if (this.db) {
        this.db.pragma('wal_checkpoint(TRUNCATE)');
        this.db.close();
      }
    } finally {
      this.db = null;
      this.selectState = null;
      this.writeState = null;
      this.usingSQLite = false;
      this.codec.destroy();
    }
  }
}

module.exports = { SQLiteStateStore };
