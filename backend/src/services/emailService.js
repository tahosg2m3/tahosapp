const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

let runtimeEnvLoaded = false;

function loadRuntimeEmailConfig() {
  if (runtimeEnvLoaded) return;
  runtimeEnvLoaded = true;

  // Paketli uygulamada sırlar kaynak dizininde tutulmamalı. İstenirse işletim
  // sistemi tarafından sağlanan bu yol üzerinden harici bir dotenv dosyası okunur.
  const runtimeEnvFile = process.env.RUNTIME_ENV_FILE || process.env.SMTP_ENV_FILE;
  if (runtimeEnvFile) dotenv.config({ path: runtimeEnvFile, override: false });
}

function configurationError(message) {
  const error = new Error(message);
  error.code = 'SMTP_CONFIG_ERROR';
  return error;
}

function getSmtpSecure(port) {
  const configuredValue = process.env.SMTP_SECURE;
  if (configuredValue === undefined || configuredValue === '') {
    // SMTP'nin 465 portundaki TLS bağlantısı varsayılan olarak güvenlidir.
    return port === 465;
  }

  const value = String(configuredValue).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(value)) return true;
  if (['false', '0', 'no'].includes(value)) return false;
  throw configurationError('SMTP_SECURE must be true or false.');
}

function createTransporter() {
  loadRuntimeEmailConfig();

  const missing = ['SMTP_USER', 'SMTP_PASS'].filter(key => !String(process.env[key] || '').trim());
  if (missing.length) {
    throw configurationError(`SMTP configuration is incomplete: ${missing.join(', ')} must be configured.`);
  }

  const port = Number(process.env.SMTP_PORT || 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw configurationError('SMTP_PORT must be a valid number between 1 and 65535.');
  }

  const host = String(process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const secure = getSmtpSecure(port);

  return nodemailer.createTransport({
    host,
    port,
    secure,
    // Submission ports must upgrade with STARTTLS; do not silently fall back
    // to clear text if a network attacker strips the server capability.
    requireTLS: !secure,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
    },
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

async function sendSecurityCode(email, username, code, { subject, heading, description }) {
  const transporter = createTransporter();
  const safeUsername = escapeHtml(username);

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: email,
    subject,
    text: `Hello ${username},\n\n${description}\n\nYour code: ${code}\n\nThis code is valid for 10 minutes. If you did not start this action, you can ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#1f2937">
        <h2>${heading}</h2>
        <p>Merhaba <strong>${safeUsername}</strong>,</p>
        <p>${description}</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#f3f4f6;padding:18px;text-align:center;border-radius:8px;color:#111827">
          ${code}
        </div>
        <p>This code is valid for <strong>10 minutes</strong>.</p>
        <p style="color:#6b7280;font-size:13px">If you did not start this action, you can ignore this email.</p>
      </div>
    `,
  });
}

function sendTwoFactorCode(email, username, code) {
  return sendSecurityCode(email, username, code, {
    subject: 'Your tahosapp sign-in verification code',
    heading: 'Sign-in verification',
    description: 'Use this verification code to sign in to your tahosapp account:',
  });
}

function sendPasswordResetCode(email, username, code) {
  return sendSecurityCode(email, username, code, {
    subject: 'Your tahosapp password reset code',
    heading: 'Password reset',
    description: 'Use this verification code to reset your password:',
  });
}

function sendEmailChangeCode(email, username, code) {
  return sendSecurityCode(email, username, code, {
    subject: 'Your tahosapp email change code',
    heading: 'Confirm your email change',
    description: 'Use this verification code to connect this email address to your account:',
  });
}

module.exports = {
  createTransporter,
  sendTwoFactorCode,
  sendPasswordResetCode,
  sendEmailChangeCode,
};
