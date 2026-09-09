import { useEffect, useState } from 'react';
import { Check, ShieldCheck, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { acknowledgeOnboarding, getOnboarding } from '../../services/platformApi';
import { useAuth } from '../../context/AuthContext';
import { useServer } from '../../context/ServerContext';
import { useSocket } from '../../context/SocketContext';

export default function OnboardingGate() {
  const { user } = useAuth();
  const { currentServer } = useServer();
  const { socket } = useSocket();
  const [config, setConfig] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setConfig(null); setAccepted(false); setAnswers({});
    if (!currentServer?.id || !user?.id || currentServer.creatorId === user.id) return;
    getOnboarding(currentServer.id)
      .then(payload => {
        const onboarding = payload.onboarding || payload;
        const verification = payload.memberVerification || null;
        const rulesScreening = onboarding.rulesScreening || {};
        const rules = onboarding.rules || rulesScreening.rules || [];
        const requiredRuleIds = rules.map(rule => rule?.id).filter(Boolean);
        const acceptedRuleIds = verification?.acceptedRuleIds || [];
        const rulesDone = !rulesScreening.enabled || requiredRuleIds.every(id => acceptedRuleIds.includes(id));
        const emailDone = !rulesScreening.requireVerifiedEmail || Boolean(verification?.emailVerified);
        const onboardingDone = !onboarding.enabled || Boolean(verification);
        const enabled = Boolean(onboarding.enabled || rulesScreening.enabled);
        if (enabled && !(rulesDone && emailDone && onboardingDone)) setConfig({ ...onboarding, rules, rulesScreening });
      })
      .catch(() => {});
  }, [currentServer?.id, currentServer?.creatorId, refreshKey, user?.id]);

  useEffect(() => {
    if (!socket || !currentServer?.id) return undefined;
    const update = payload => {
      if (payload?.scope === 'onboarding' && String(payload?.serverId || '') === String(currentServer.id)) {
        setRefreshKey(value => value + 1);
      }
    };
    socket.on('platform:update', update);
    return () => socket.off('platform:update', update);
  }, [currentServer?.id, socket]);

  if (!config) return null;
  const rules = config.rules || [];
  const questions = config.questions || [];

  const complete = async () => {
    if (config.rulesScreening?.requireVerifiedEmail && !user?.emailVerified) {
      toast.error('This server requires a verified email address. Verify your account email first.');
      return;
    }
    if (rules.length && !accepted) { toast.error('Accept the rules to continue.'); return; }
    const missingRequired = questions.some(question => typeof question === 'object' && question.required && !(answers[question.id] || []).length);
    if (missingRequired) { toast.error('Answer the required onboarding questions.'); return; }
    setSaving(true);
    try {
      await acknowledgeOnboarding(currentServer.id, { accepted: true, acceptedRuleIds: rules.map(rule => rule.id).filter(Boolean), answers });
      setConfig(null);
      toast.success('Welcome to the server!');
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#020617]/90 p-5 backdrop-blur-xl">
      <section className="custom-scrollbar max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/[0.09] bg-[#0f172a] p-7 shadow-2xl">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2563eb] to-[#7c3aed] text-white shadow-lg shadow-blue-500/20"><Sparkles className="h-8 w-8" /></div>
        <div className="text-center"><h1 className="text-2xl font-bold text-white">{currentServer.name} Welcome to</h1><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#94a3b8]">{config.welcomeMessage || 'Review the community rules and choose your interests before joining.'}</p></div>
        {rules.length > 0 && <div className="mt-7 rounded-2xl border border-white/[0.07] bg-[#151d2c] p-5"><div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-[#34d399]" /><h2 className="font-bold text-white">Community rules</h2></div><ol className="space-y-2">{rules.map((rule, index) => <li key={rule.id || index} className="flex gap-3 rounded-lg bg-[#0f172a] px-3 py-2.5 text-sm text-[#cbd5e1]"><span className="font-bold text-[#60a5fa]">{index + 1}.</span><span><strong className="block text-[#e2e8f0]">{typeof rule === 'string' ? rule : rule.title || rule.description}</strong>{typeof rule === 'object' && rule.title && rule.description && <span className="mt-0.5 block text-xs text-[#94a3b8]">{rule.description}</span>}</span></li>)}</ol><label className="mt-4 flex cursor-pointer items-center gap-3 text-sm font-semibold text-[#e2e8f0]"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} className="h-4 w-4" /> I have read and accept the rules.</label></div>}
        {questions.length > 0 && <div className="mt-4 rounded-2xl border border-white/[0.07] bg-[#151d2c] p-5"><h2 className="font-bold text-white">What are you interested in?</h2><p className="mt-1 text-xs text-[#64748b]">Your choices help us personalize recommended channels and roles.</p><div className="mt-4 space-y-4">{questions.map((question, index) => { const promptId = question.id || `question-${index}`; const options = Array.isArray(question.options) && question.options.length ? question.options : [{ id: String(question), title: typeof question === 'string' ? question : question.title }]; const selectedIds = answers[promptId] || []; return <section key={promptId}><p className="mb-2 text-sm font-semibold text-[#e2e8f0]">{typeof question === 'string' ? question : question.title}{question.required && <span className="ml-1 text-[#f87171]">*</span>}</p><div className="flex flex-wrap gap-2">{options.map(option => { const optionId = option.id || option.title; const selected = selectedIds.includes(optionId); return <button key={optionId} type="button" onClick={() => setAnswers(current => ({ ...current, [promptId]: question.multiple ? (selected ? selectedIds.filter(id => id !== optionId) : [...selectedIds, optionId]) : [optionId] }))} className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${selected ? 'border-[#3b82f6] bg-[#2563eb]/20 text-[#bfdbfe]' : 'border-white/[0.09] text-[#94a3b8] hover:bg-white/[0.05]'}`}>{selected && <Check className="mr-1 inline h-3.5 w-3.5" />}{option.title || option.label || optionId}</button>; })}</div></section>; })}</div></div>}
        <button type="button" disabled={saving || (rules.length > 0 && !accepted)} onClick={complete} className="mt-6 w-full rounded-xl bg-[#2563eb] py-3 text-sm font-bold text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-40">{saving ? 'Saving…' : 'Continue to Server'}</button>
      </section>
    </div>
  );
}
