import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { MessageCircle, Search, RefreshCw, MailOpen, Mail, Send, X } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import axios from 'axios';
import { operationsShell } from '../../utils/operationsUi';

function getRoleApiPrefix() {
  try {
    const saved = localStorage.getItem('user');
    const u = saved ? JSON.parse(saved) : null;
    return u?.role === 'director' ? 'director' : 'manager';
  } catch {
    return 'manager';
  }
}

function getApiBase() {
  const prefix = getRoleApiPrefix();
  return import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/${prefix}`
    : `/api/${prefix}`;
}

function getAuthHeader() {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
}

export default function BroadcastInboxTab({ parkId, onUnreadCountChange, sceneNight = false }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [threads, setThreads] = useState([]);
  const [q, setQ] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [mineOnly, setMineOnly] = useState(false);

  const [activeThread, setActiveThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const loadThreads = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${getApiBase()}/broadcast-threads`, {
        params: {
          ...(q.trim() ? { q: q.trim() } : {}),
          ...(unreadOnly ? { unread: 1 } : {}),
          ...(mineOnly ? { mine: 1 } : {}),
          ...(parkId ? { parkId } : {}),
        },
        headers: getAuthHeader(),
      });
      const rows = Array.isArray(res.data) ? res.data : [];
      setThreads(rows);
      if (typeof onUnreadCountChange === 'function') {
        onUnreadCountChange(rows.filter((t) => t.unreadForPark).length);
      }
    } catch (e) {
      setThreads([]);
      showToast(e.response?.data?.error || e.message || 'Не удалось загрузить', 'error');
      if (typeof onUnreadCountChange === 'function') onUnreadCountChange(0);
    } finally {
      setLoading(false);
    }
  };

  const openThread = async (t) => {
    setActiveThread(t);
    setMessages([]);
    setReply('');
    setMessagesLoading(true);
    try {
      const res = await axios.get(`${getApiBase()}/broadcast-threads/${t.id}/messages`, {
        params: parkId ? { parkId } : {},
        headers: getAuthHeader(),
      });
      setMessages(Array.isArray(res.data) ? res.data : []);
      // локально снимаем непрочитанное
      setThreads((prev) => {
        const next = prev.map((x) => (x.id === t.id ? { ...x, unreadForPark: 0 } : x));
        if (typeof onUnreadCountChange === 'function') onUnreadCountChange(next.filter((x) => x.unreadForPark).length);
        return next;
      });
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Не удалось открыть диалог', 'error');
    } finally {
      setMessagesLoading(false);
    }
  };

  const sendReply = async () => {
    if (!activeThread) return;
    if (!reply.trim()) return showToast('Введите текст', 'error');
    try {
      setSending(true);
      await axios.post(
        `${getApiBase()}/broadcast-threads/${activeThread.id}/message`,
        { body: reply.trim() },
        { params: parkId ? { parkId } : {}, headers: getAuthHeader() }
      );
      setReply('');
      await openThread(activeThread);
      await loadThreads();
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Не удалось отправить', 'error');
    } finally {
      setSending(false);
    }
  };

  useEffect(() => { loadThreads(); /* eslint-disable-next-line */ }, [parkId, unreadOnly, mineOnly]);
  useEffect(() => {
    const t = setTimeout(() => loadThreads(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const unreadCount = useMemo(() => threads.filter((t) => t.unreadForPark).length, [threads]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm ${
            sceneNight
              ? 'border border-white/15 bg-white/[0.06] backdrop-blur-xl text-slate-100 ring-1 ring-white/10'
              : 'bg-white/75 backdrop-blur-md border border-white/60 shadow-slate-900/10'
          }`}
        >
          <MessageCircle className={`w-5 h-5 ${sceneNight ? 'text-teal-300' : 'text-teal-600'}`} />
          <h2 className={`text-sm sm:text-base font-bold tracking-wide uppercase ${sceneNight ? '' : 'text-slate-900'}`}>
            Ответы водителей {unreadCount ? `· ${unreadCount}` : ''}
          </h2>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={loadThreads}
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl font-semibold transition ${
            sceneNight
              ? 'border border-white/12 bg-white/[0.08] text-slate-200 hover:bg-white/[0.12]'
              : 'border border-white/55 bg-white/45 text-slate-800 hover:bg-white/60 backdrop-blur-md'
          }`}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </motion.button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`rounded-2xl shadow-xl overflow-hidden lg:col-span-1 ${operationsShell(sceneNight)}`}>
          <div className={`p-4 space-y-3 border-b ${sceneNight ? 'border-white/[0.08]' : 'border-slate-100'}`}>
            <div className="relative">
              <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${sceneNight ? 'text-slate-500' : 'text-slate-400'}`} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск: ФИО / телефон / тема"
                className={`w-full pl-9 pr-3 py-2 rounded-xl text-sm ${
                  sceneNight
                    ? 'border border-white/15 bg-white/[0.06] text-slate-100 placeholder:text-slate-400 backdrop-blur-md'
                    : 'border border-white/50 bg-white/50 text-slate-900 backdrop-blur-sm'
                }`}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setUnreadOnly((v) => !v)}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border ${
                  unreadOnly
                    ? 'bg-teal-600 text-white border-teal-600'
                    : sceneNight
                      ? 'bg-white/[0.06] text-slate-300 border-white/12 hover:bg-white/10'
                      : 'bg-white/60 text-slate-700 border-white/55 hover:bg-white/85'
                }`}
                title="Только непрочитанные"
              >
                {unreadOnly ? <Mail className="w-4 h-4" /> : <MailOpen className="w-4 h-4" />}
                Непрочитанные
              </button>
              <button
                type="button"
                onClick={() => setMineOnly((v) => !v)}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border ${
                  mineOnly
                    ? 'bg-teal-600 text-white border-teal-600'
                    : sceneNight
                      ? 'bg-white/[0.06] text-slate-300 border-white/12 hover:bg-white/10'
                      : 'bg-white/60 text-slate-700 border-white/55 hover:bg-white/85'
                }`}
                title="Только мои (назначено мне)"
              >
                Мои
              </button>
            </div>
          </div>

          <div className={`max-h-[70vh] overflow-auto ${sceneNight ? 'divide-y divide-white/[0.08]' : 'divide-y divide-slate-100'}`}>
            {threads.length === 0 ? (
              <div className={`p-8 text-center text-sm ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                {loading ? 'Загрузка…' : 'Пока нет диалогов'}
              </div>
            ) : (
              threads.map((t) => {
                const active = activeThread?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => openThread(t)}
                    className={`w-full text-left px-4 py-3 transition ${
                      active
                        ? sceneNight
                          ? 'bg-teal-500/15'
                          : 'bg-teal-50/90'
                        : sceneNight
                          ? 'hover:bg-white/[0.04]'
                          : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`font-semibold truncate ${sceneNight ? 'text-slate-50' : 'text-slate-900'}`}>
                          {t.driverName || t.driverPhone || `#${t.driverUserId}`}
                        </p>
                        <p className={`text-xs truncate ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                          {t.title || 'Сообщение от парка'}
                        </p>
                      </div>
                      {t.unreadForPark ? (
                        <span className="px-2 py-0.5 rounded-full bg-teal-600 text-white text-[11px] font-bold">NEW</span>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className={`rounded-2xl shadow-xl overflow-hidden lg:col-span-2 ${operationsShell(sceneNight)}`}>
          {!activeThread ? (
            <div className={`p-10 text-center ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>Выбери диалог слева</div>
          ) : (
            <div className="flex flex-col h-full">
              <div className={`px-4 py-3 flex items-center justify-between gap-3 border-b ${sceneNight ? 'border-white/[0.08]' : 'border-slate-100'}`}>
                <div className="min-w-0">
                  <p className={`font-bold truncate ${sceneNight ? 'text-slate-50' : 'text-slate-900'}`}>
                    {activeThread.driverName || activeThread.driverPhone || `#${activeThread.driverUserId}`}
                  </p>
                  <p className={`text-xs truncate ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                    {activeThread.title || 'Сообщение от парка'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveThread(null)}
                  className={`p-2 rounded-lg ${sceneNight ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-slate-100 text-slate-600'}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-2 overflow-auto max-h-[55vh]">
                {messagesLoading ? (
                  <div className={sceneNight ? 'text-center text-slate-400' : 'text-center text-slate-500'}>Загрузка…</div>
                ) : messages.length === 0 ? (
                  <div className={sceneNight ? 'text-center text-slate-400' : 'text-center text-slate-500'}>Сообщений нет</div>
                ) : (
                  messages.map((m) => {
                    const mine = m.fromRole === 'park';
                    return (
                      <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm border ${
                            mine
                              ? 'bg-teal-600 text-white border-teal-600'
                              : sceneNight
                                ? 'bg-slate-800/80 text-slate-100 border-white/10'
                                : 'bg-slate-50 text-slate-800 border-slate-200'
                          }`}
                        >
                          <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          <div className={`mt-1 text-[11px] ${mine ? 'text-teal-100' : sceneNight ? 'text-slate-500' : 'text-slate-500'}`}>
                            {m.createdAt}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className={`p-4 border-t ${sceneNight ? 'border-white/[0.08]' : 'border-slate-100'}`}>
                <div className="flex gap-2">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={2}
                    placeholder="Написать водителю…"
                    className={`flex-1 px-3 py-2 rounded-xl text-sm resize-none ${
                      sceneNight
                        ? 'border border-white/15 bg-white/[0.06] text-slate-100 placeholder:text-slate-400 backdrop-blur-md'
                        : 'border border-white/50 bg-white/50 backdrop-blur-sm'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={sendReply}
                    disabled={sending}
                    className="freight-btn-primary gap-2 disabled:opacity-50"
                    title="Отправить"
                  >
                    <Send className="w-4 h-4" />
                    {sending ? '...' : 'Отправить'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

