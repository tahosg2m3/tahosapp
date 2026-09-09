import { useEffect, useState } from 'react';
import { Plus, Sparkles, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { createServer } from '../../services/api';
import { applyServerTemplate, listPublicTemplates } from '../../services/platformApi';
import { useAuth } from '../../context/AuthContext';
import { useServer } from '../../context/ServerContext';

export default function CreateServerModal({ onClose, onCreated }) {
  const [serverName, setServerName] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useAuth();
  const { setServers, setCurrentServer, setCurrentChannel } = useServer();

  useEffect(() => {
    listPublicTemplates()
      .then(payload => setTemplates(Array.isArray(payload) ? payload : payload.templates || []))
      .catch(() => setTemplates([]));
  }, []);

  const handleSubmit = async event => {
    event.preventDefault();
    const name = serverName.trim() || `${user?.username || 'New'}’s server`;
    setIsLoading(true);
    try {
      const response = templateId
        ? await applyServerTemplate(templateId, name)
        : await createServer(name, user.id);
      const newServer = response.server || response;
      setServers(previous => previous.some(item => item.id === newServer.id) ? previous : [...previous, newServer]);
      setCurrentChannel(null);
      setCurrentServer(newServer);
      onCreated?.(newServer);
      toast.success(templateId ? 'Server created from template.' : 'Server created.');
      onClose();
    } catch (error) {
      toast.error(error.message || 'The server could not be created.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <section className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/[0.08] bg-[#151d2c] shadow-2xl" onMouseDown={event => event.stopPropagation()}>
        <header className="relative border-b border-white/[0.07] bg-gradient-to-br from-[#1d4ed8]/25 to-[#7c3aed]/20 px-7 py-6">
          <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded-xl p-2 text-[#94a3b8] hover:bg-white/[0.07] hover:text-white"><X className="h-5 w-5" /></button>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#5865F2] text-white shadow-lg shadow-blue-500/20"><Users className="h-6 w-6" /></div>
          <h2 className="mt-4 text-2xl font-bold text-white">Create your community</h2>
          <p className="mt-1 max-w-md text-sm leading-5 text-[#94a3b8]">Start with an empty server or use a shared role and channel template.</p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5 p-7">
          <label className="block text-xs font-bold uppercase tracking-wide text-[#94a3b8]">Server name<input autoFocus maxLength="100" value={serverName} onChange={event => setServerName(event.target.value)} placeholder={`${user?.username || 'New'}’s server`} className="mt-2 w-full rounded-xl border border-white/[0.08] bg-[#0f172a] px-4 py-3 text-sm text-white outline-none placeholder:text-[#64748b] focus:border-[#3b82f6]" /></label>

          <div>
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-[#94a3b8]">Starting layout</span><Sparkles className="h-4 w-4 text-[#a78bfa]" /></div>
            <div className="grid max-h-52 gap-2 overflow-y-auto pr-1 custom-scrollbar sm:grid-cols-2">
              <button type="button" onClick={() => setTemplateId('')} className={`rounded-xl border p-3 text-left transition ${!templateId ? 'border-[#3b82f6] bg-[#2563eb]/15' : 'border-white/[0.08] bg-[#0f172a] hover:border-white/[0.16]'}`}><div className="flex items-center gap-2"><Plus className="h-4 w-4 text-[#60a5fa]" /><strong className="text-sm text-white">Empty server</strong></div><p className="mt-1 text-[11px] text-[#64748b]">A clean start with a general channel</p></button>
              {templates.map(template => <button key={template.id} type="button" onClick={() => setTemplateId(template.id)} className={`rounded-xl border p-3 text-left transition ${templateId === template.id ? 'border-[#8b5cf6] bg-[#7c3aed]/15' : 'border-white/[0.08] bg-[#0f172a] hover:border-white/[0.16]'}`}><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[#a78bfa]" /><strong className="truncate text-sm text-white">{template.name}</strong></div><p className="mt-1 line-clamp-2 text-[11px] text-[#64748b]">{template.description || `${template.channels?.length || 0} channels · ${template.roles?.length || 0} roles`}</p></button>)}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] pt-5"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-[#94a3b8] hover:bg-white/[0.06] hover:text-white">Cancel</button><button type="submit" disabled={isLoading} className="rounded-xl bg-[#5865F2] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/15 hover:bg-[#4752C4] disabled:opacity-50">{isLoading ? 'Creating…' : 'Create Server'}</button></div>
        </form>
      </section>
    </div>
  );
}
