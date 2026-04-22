import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Loader2, PhoneCall, X } from 'lucide-react';
import { createCallbackLead } from '../../api/crmLeadApi';

const businessOptions = [
  'Такси частник',
  'Такси парк',
  'Грузовые парк',
  'Грузовые частник',
  'Мини-бизнес (ЭДО/Честный ЗНАК)',
];

export default function CallbackRequestModal({ isOpen, onClose, source = 'landing' }) {
  const [form, setForm] = useState({
    name: '',
    contact: '',
    company: '',
    businessType: businessOptions[0],
    comment: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submittedLeadId, setSubmittedLeadId] = useState(null);

  const canSubmit = useMemo(() => form.name.trim() && form.contact.trim(), [form]);

  const handleChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError('');
    setLoading(true);
    try {
      const payload = {
        ...form,
        sourcePage: source,
      };
      const result = await createCallbackLead(payload);
      setSubmittedLeadId(result?.id || null);
    } catch (err) {
      setError(err?.response?.data?.error || 'Не удалось отправить заявку. Попробуйте еще раз.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError('');
    setLoading(false);
    setSubmittedLeadId(null);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-300/50"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs text-teal-800">
                  <PhoneCall className="h-3.5 w-3.5 text-teal-600" />
                  Заявка
                </p>
                <h3 className="text-xl font-bold text-slate-900">Контакты для КП и звонка</h3>
                <p className="mt-2 text-sm text-slate-600">Менеджер ответит в рабочее время. Данные уходят в CRM без потерь.</p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-slate-300 hover:text-slate-800"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!submittedLeadId ? (
              <form onSubmit={handleSubmit} className="grid gap-3">
                <div>
                  <label htmlFor="callback-name" className="mb-1 block text-sm text-slate-600">
                    Имя
                  </label>
                  <input
                    id="callback-name"
                    value={form.name}
                    onChange={handleChange('name')}
                    required
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label htmlFor="callback-contact" className="mb-1 block text-sm text-slate-600">
                    Телефон или email
                  </label>
                  <input
                    id="callback-contact"
                    value={form.contact}
                    onChange={handleChange('contact')}
                    required
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label htmlFor="callback-company" className="mb-1 block text-sm text-slate-600">
                    Компания / ИП
                  </label>
                  <input
                    id="callback-company"
                    value={form.company}
                    onChange={handleChange('company')}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label htmlFor="callback-type" className="mb-1 block text-sm text-slate-600">
                    Тип бизнеса
                  </label>
                  <select
                    id="callback-type"
                    value={form.businessType}
                    onChange={handleChange('businessType')}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  >
                    {businessOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="callback-comment" className="mb-1 block text-sm text-slate-600">
                    Комментарий
                  </label>
                  <textarea
                    id="callback-comment"
                    value={form.comment}
                    onChange={handleChange('comment')}
                    rows={3}
                    placeholder="Задача: груз / такси / ЭДО / сроки"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  />
                </div>

                {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}

                <button
                  type="submit"
                  disabled={loading || !canSubmit}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Отправляем...
                    </>
                  ) : (
                    'Отправить'
                  )}
                </button>
              </form>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900"
              >
                <p className="mb-2 flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Заявка отправлена
                </p>
                <p>Менеджер свяжется в рабочее время. Номер заявки: #{submittedLeadId}.</p>
                <button
                  type="button"
                  onClick={handleClose}
                  className="mt-4 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Закрыть
                </button>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
