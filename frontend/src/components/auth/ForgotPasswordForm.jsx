import { useState } from 'react';
import {
  requestPasswordReset,
  resendPasswordReset,
  resetPassword,
} from '../../services/api';

export default function ForgotPasswordForm({ onBackToLogin }) {
  const [email, setEmail] = useState('');
  const [resetTicket, setResetTicket] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const requestCode = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsLoading(true);

    try {
      const response = await requestPasswordReset(email.trim());
      setResetTicket(response.resetTicket || 'sent');
      setMessage(response.message || 'We sent a verification code to your email address.');
    } catch (requestError) {
      setError(requestError.message || 'The code could not be sent.');
    } finally {
      setIsLoading(false);
    }
  };

  const submitReset = async (event) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }

    setError('');
    setMessage('');
    setIsLoading(true);
    try {
      const response = await resetPassword({ resetTicket, code, newPassword });
      setMessage(response.message || 'Your password was updated. You can now log in.');
      setTimeout(onBackToLogin, 900);
    } catch (requestError) {
      setError(requestError.message || 'The password could not be updated.');
    } finally {
      setIsLoading(false);
    }
  };

  const resend = async () => {
    setError('');
    setMessage('');
    setIsLoading(true);
    try {
      const response = await resendPasswordReset(resetTicket);
      setMessage(response.message || 'A new code was sent.');
    } catch (requestError) {
      setError(requestError.message || 'The code could not be resent.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[480px] rounded-xl border border-white/[0.08] bg-[#151b27] p-8 shadow-2xl">
      <div className="mb-7 text-center">
        <h2 className="mb-2 text-2xl font-bold text-[#f8fafc]">Reset your password</h2>
        <p className="text-sm text-[#94a3b8]">
          {resetTicket ? <>Enter the six-digit code sent to <strong>{email}</strong>.</> : 'Enter the email address linked to your account.'}
        </p>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">{error}</div>}
      {message && <div className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-300">{message}</div>}

      {!resetTicket ? (
        <form onSubmit={requestCode} className="space-y-4">
          <label className="block text-xs font-bold uppercase tracking-wide text-[#b5bac1]">E-posta</label>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus className="w-full rounded-lg border border-white/[0.08] bg-[#0f172a] px-3 py-3 text-[#e2e8f0] outline-none focus:border-[#60a5fa]" placeholder="ornek@mail.com" />
          <button disabled={isLoading} className="w-full rounded-lg bg-[#5865f2] py-2.5 font-semibold text-white transition hover:bg-[#4752c4] disabled:opacity-60">{isLoading ? 'Sending code...' : 'Send reset code'}</button>
        </form>
      ) : (
        <form onSubmit={submitReset} className="space-y-4">
          <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required maxLength={6} className="w-full rounded-lg border border-white/[0.08] bg-[#0f172a] px-3 py-3 text-center text-2xl tracking-[0.45em] text-[#e2e8f0] outline-none focus:border-[#60a5fa]" placeholder="123456" />
          <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={8} className="w-full rounded-lg border border-white/[0.08] bg-[#0f172a] px-3 py-3 text-[#e2e8f0] outline-none focus:border-[#60a5fa]" placeholder="New password (at least 8 characters)" />
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} className="w-full rounded-lg border border-white/[0.08] bg-[#0f172a] px-3 py-3 text-[#e2e8f0] outline-none focus:border-[#60a5fa]" placeholder="Confirm new password" />
          <button disabled={isLoading || code.length !== 6} className="w-full rounded-lg bg-[#5865f2] py-2.5 font-semibold text-white transition hover:bg-[#4752c4] disabled:opacity-60">{isLoading ? 'Saving...' : 'Update password'}</button>
          <button type="button" onClick={resend} disabled={isLoading} className="w-full text-sm font-medium text-[#60a5fa] hover:underline disabled:opacity-60">Resend code</button>
        </form>
      )}

      <button type="button" onClick={onBackToLogin} className="mt-5 text-sm font-medium text-[#60a5fa] hover:underline">Back to login</button>
    </div>
  );
}
