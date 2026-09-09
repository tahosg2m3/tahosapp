import { useState } from 'react';
import {
  registerUser,
  resendTwoFactorCode,
  verifyTwoFactorCode,
} from '../../services/api';

export default function RegisterForm({ onSwitchToLogin }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loginTicket, setLoginTicket] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const isTwoFactorStep = Boolean(loginTicket);

  const finishLogin = (response) => {
    localStorage.setItem('user', JSON.stringify(response.user));
    localStorage.setItem('chat_token', response.token);
    window.location.reload();
  };

  const handleRegister = async (event) => {
    event.preventDefault();

    setError('');
    setMessage('');
    setIsLoading(true);

    try {
      const response = await registerUser({
        username,
        email,
        password,
      });

      setLoginTicket(response.loginTicket);
      setMessage('Registration successful. A code was sent to your email address.');
    } catch (err) {
      setError(err.message || 'Could not create the account.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (event) => {
    event.preventDefault();

    setError('');
    setMessage('');
    setIsLoading(true);

    try {
      const response = await verifyTwoFactorCode({
        loginTicket,
        code,
      });

      finishLogin(response);
    } catch (err) {
      setError(err.message || 'The code could not be verified.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setError('');
    setMessage('');
    setIsLoading(true);

    try {
      const response = await resendTwoFactorCode({ loginTicket });
      setMessage(response.message);
    } catch (err) {
      setError(err.message || 'The code could not be resent.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isTwoFactorStep) {
    return (
      <div className="bg-[#313338] p-8 rounded-lg shadow-2xl w-full max-w-[480px]">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-[#F2F3F5] mb-2">
            Verify your email
          </h2>

          <p className="text-[#B5BAC1]">
            We sent a code to <strong>{email}</strong>.
          </p>
        </div>

        {error && (
          <div className="bg-[#FA777C]/10 border border-[#FA777C] text-[#FA777C] p-3 rounded text-sm font-medium mb-4">
            {error}
          </div>
        )}

        {message && (
          <div className="bg-[#57F287]/10 border border-[#57F287] text-[#57F287] p-3 rounded text-sm font-medium mb-4">
            {message}
          </div>
        )}

        <form onSubmit={handleVerifyCode} className="space-y-4">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
            }
            className="w-full bg-[#1E1F22] text-[#DBDEE1] px-3 py-3 rounded text-center text-2xl tracking-[0.5em]"
            placeholder="123456"
            maxLength={6}
            required
            autoFocus
          />

          <button
            type="submit"
            disabled={isLoading || code.length !== 6}
            className="w-full bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium py-2.5 rounded disabled:opacity-50"
          >
            {isLoading ? 'Verifying...' : 'Verify Code'}
          </button>
        </form>

        <div className="mt-5 text-right text-sm">
          <button
            type="button"
            onClick={handleResendCode}
            disabled={isLoading}
            className="text-[#00A8FC] hover:underline disabled:opacity-50"
          >
            Resend code
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#313338] p-8 rounded-lg shadow-2xl w-full max-w-[480px]">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-[#F2F3F5] mb-2">
          Create an account
        </h2>
      </div>

      {error && (
        <div className="bg-[#FA777C]/10 border border-[#FA777C] text-[#FA777C] p-3 rounded text-sm font-medium mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleRegister} className="space-y-4">
        <input
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="w-full bg-[#1E1F22] text-[#DBDEE1] px-3 py-2.5 rounded"
          placeholder="Username"
          minLength={3}
          required
        />

        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full bg-[#1E1F22] text-[#DBDEE1] px-3 py-2.5 rounded"
          placeholder="E-posta"
          required
        />

        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full bg-[#1E1F22] text-[#DBDEE1] px-3 py-2.5 rounded"
          placeholder="Password"
          minLength={6}
          required
        />

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium py-2.5 rounded disabled:opacity-50"
        >
          {isLoading ? 'Sending code...' : 'Sign Up'}
        </button>
      </form>

      <div className="mt-4 text-sm text-[#949BA4]">
        Already have an account?{' '}

        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-[#00A8FC] hover:underline font-medium"
        >
          Log In
        </button>
      </div>
    </div>
  );
}
