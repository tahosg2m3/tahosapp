import { useState } from 'react';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';
import ForgotPasswordForm from './ForgotPasswordForm';
import { useI18n } from '../../i18n/I18nContext';

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const { locale, setLocale, locales, t } = useI18n();

  return (
    <div className="relative h-screen bg-gray-900 flex items-center justify-center">
      <label className="absolute right-5 top-5 rounded-lg border border-white/10 bg-[#151b27] px-2 text-xs font-semibold text-[#DBDEE1] shadow-lg" aria-label={t('language.field')}>
        <select value={locale} onChange={event => setLocale(event.target.value)} className="bg-transparent py-2 outline-none">
          {locales.map(option => <option key={option.code} value={option.code} className="bg-[#151b27]">{option.label}</option>)}
        </select>
      </label>
      {mode === 'login' && <LoginForm onSwitchToRegister={() => setMode('register')} onForgotPassword={() => setMode('forgot-password')} />}
      {mode === 'register' && <RegisterForm onSwitchToLogin={() => setMode('login')} />}
      {mode === 'forgot-password' && <ForgotPasswordForm onBackToLogin={() => setMode('login')} />}
    </div>
  );
}
