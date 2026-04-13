import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { MessageCircle, RefreshCw, ChevronLeft, Send, X } from 'lucide-react';
import { useToast } from '../hooks/useToast';

export default function DriverMessages() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [threads, setThreads] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const loadThreads = async () => {
    setLoading(true);
    try {
      const res = await api.get('/driver/broadcast-threads');
      setThreads(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setThreads([]);
      showToast(e.response?.data?.error || e.message || 'Не удалось загрузить', 'error');
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
      const res = await api.get(`/driver/broadcast-threads/${t.id}/messages`);
      setMessages(Array.isArray(res.data) ? res.data : []);
      setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, unreadForDriver: 0 } : x)));
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
      await api.post(`/driver/broadcast-threads/${activeThread.id}/reply`, { body: reply.trim() });
      setReply('');
      await openThread(activeThread);
      await loadThreads();
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Не удалось отправить', 'error');
    } finally {
      setSending(false);
    }
  };

  useEffect(() => { loadThreads(); }, []);

  const unreadCount = useMemo(() => threads.filter((t) => t.unreadForDriver).length, [threads]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 shadow-md">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/driver')}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/15 text-white"
              title="Назад"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <p className="text-white font-bold truncate flex items-center gap-2">
                <MessageCircle className="w-5 h-5" />
                Сообщения от парка {unreadCount ? `· ${unreadCount}` : ''}
              </p>
              <p className="text-white/80 text-xs truncate">Можно отвечать на рассылки в виде диалога</p>
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={loadThreads}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white text-slate-800 font-semibold"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </motion.button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden lg:col-span-1">
          <div className="divide-y divide-slate-100 max-h-[75vh] overflow-auto">
            {threads.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">{loading ? 'Загрузка…' : 'Пока нет сообщений'}</div>
            ) : (
              threads.map((t) => {
                const active = activeThread?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => openThread(t)}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${active ? 'bg-indigo-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">{t.parkName || 'Парк'}</p>
                        <p className="text-xs text-slate-500 truncate">{t.title || 'Сообщение от парка'}</p>
                      </div>
                      {t.unreadForDriver ? (
                        <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[11px] font-bold">NEW</span>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden lg:col-span-2">
          {!activeThread ? (
            <div className="p-10 text-center text-slate-500">Выбери диалог слева</div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 truncate">{activeThread.parkName || 'Парк'}</p>
                  <p className="text-xs text-slate-500 truncate">{activeThread.title || 'Сообщение от парка'}</p>
                </div>
                <button type="button" onClick={() => setActiveThread(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-2 overflow-auto max-h-[60vh]">
                {messagesLoading ? (
                  <div className="text-center text-slate-500">Загрузка…</div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-slate-500">Сообщений нет</div>
                ) : (
                  messages.map((m) => {
                    const mine = m.fromRole === 'driver';
                    return (
                      <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm border ${
                          mine ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-800 border-slate-200'
                        }`}>
                          <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          <div className={`mt-1 text-[11px] ${mine ? 'text-blue-100' : 'text-slate-500'}`}>{m.createdAt}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="p-4 border-t border-slate-100">
                <div className="flex gap-2">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={2}
                    placeholder="Ответить парку…"
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm resize-none"
                  />
                  <button
                    type="button"
                    onClick={sendReply}
                    disabled={sending}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
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

