import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, PhoneCall, RefreshCw } from 'lucide-react';
import { getCallbackLeads, updateCallbackLeadStatus } from '../api/crmLeadApi';

const statusOptions = [
  { value: 'new', label: 'Новая' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'done', label: 'Отработана' },
  { value: 'rejected', label: 'Отклонена' },
];

export default function CrmLeadsPage() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [draftResults, setDraftResults] = useState({});

  const loadLeads = async () => {
    setLoading(true);
    try {
      const rows = await getCallbackLeads();
      setLeads(rows || []);
      const draft = {};
      (rows || []).forEach((row) => {
        draft[row.id] = row.callResult || '';
      });
      setDraftResults(draft);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLeads();
  }, []);

  const counters = useMemo(() => {
    const init = { new: 0, in_progress: 0, done: 0, rejected: 0 };
    leads.forEach((lead) => {
      if (init[lead.status] !== undefined) init[lead.status] += 1;
    });
    return init;
  }, [leads]);

  const handleStatusChange = async (leadId, status) => {
    setSavingId(leadId);
    try {
      await updateCallbackLeadStatus(leadId, { status, callResult: draftResults[leadId] || '' });
      setLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, status, callResult: draftResults[leadId] || '' } : lead)));
    } finally {
      setSavingId(null);
    }
  };

  const handleSaveResult = async (leadId) => {
    const lead = leads.find((item) => item.id === leadId);
    if (!lead) return;
    setSavingId(leadId);
    try {
      await updateCallbackLeadStatus(leadId, {
        status: lead.status,
        callResult: draftResults[leadId] || '',
      });
      setLeads((prev) =>
        prev.map((item) => (item.id === leadId ? { ...item, callResult: draftResults[leadId] || '' } : item))
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold md:text-3xl">CRM заявки на звонок</h1>
            <p className="mt-1 text-sm text-slate-300">Лиды с лендинга для отработки менеджером.</p>
          </div>
          <button
            type="button"
            onClick={loadLeads}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:border-teal-300"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>

        <div className="mb-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm">Новые: <b>{counters.new}</b></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm">В работе: <b>{counters.in_progress}</b></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm">Отработаны: <b>{counters.done}</b></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm">Отклонены: <b>{counters.rejected}</b></div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6 text-sm text-slate-300">Загрузка лидов...</div>
        ) : leads.length === 0 ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6 text-sm text-slate-300">Пока нет заявок с лендинга.</div>
        ) : (
          <div className="grid gap-3">
            {leads.map((lead) => (
              <motion.article
                key={lead.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-400">Заявка #{lead.id}</p>
                    <h2 className="text-lg font-semibold text-white">{lead.name}</h2>
                    <p className="text-sm text-slate-300">{lead.contact}</p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/30 bg-teal-400/10 px-3 py-1 text-xs text-teal-100">
                    <PhoneCall className="h-3.5 w-3.5" />
                    {lead.businessType || 'Тип не указан'}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-sm text-slate-300 md:grid-cols-2">
                  <p>Компания: {lead.company || '—'}</p>
                  <p>Источник: {lead.sourcePage || 'landing'}</p>
                  <p className="md:col-span-2">Комментарий: {lead.comment || '—'}</p>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <label htmlFor={`status-${lead.id}`} className="text-xs text-slate-400">
                    Статус:
                  </label>
                  <select
                    id={`status-${lead.id}`}
                    value={lead.status}
                    disabled={savingId === lead.id}
                    onChange={(event) => handleStatusChange(lead.id, event.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100"
                  >
                    {statusOptions.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                  {lead.status === 'done' && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-100">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Отработано
                    </span>
                  )}
                </div>
                <div className="mt-3">
                  <label htmlFor={`result-${lead.id}`} className="mb-1 block text-xs text-slate-400">
                    Результат звонка / комментарий менеджера
                  </label>
                  <textarea
                    id={`result-${lead.id}`}
                    value={draftResults[lead.id] || ''}
                    onChange={(event) => setDraftResults((prev) => ({ ...prev, [lead.id]: event.target.value }))}
                    rows={2}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                  />
                  <button
                    type="button"
                    disabled={savingId === lead.id}
                    onClick={() => handleSaveResult(lead.id)}
                    className="mt-2 rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 hover:border-teal-300"
                  >
                    Сохранить отработку
                  </button>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
