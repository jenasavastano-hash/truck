import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CarTaxiFront,
  CheckCircle2,
  ExternalLink,
  Loader2,
  LogIn,
  PackageCheck,
  ShieldCheck,
  Store,
  Truck,
  UserPlus,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { isExternalUrl, loginDirections, registrationTypes } from '../../config/entryFlowConfig';
import { createCallbackLead } from '../../api/crmLeadApi';

const stepTitles = {
  root: 'Вход или заявка',
  login: 'Направление входа',
  register: 'Тип заявки',
};

export default function EntryFlowModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [step, setStep] = useState('root');
  const [selectedRegistrationId, setSelectedRegistrationId] = useState(registrationTypes[0]?.id || '');
  const [registrationForm, setRegistrationForm] = useState({
    name: '',
    contact: '',
    company: '',
    comment: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submittedLeadId, setSubmittedLeadId] = useState(null);

  const selectedRegistrationType = useMemo(
    () => registrationTypes.find((item) => item.id === selectedRegistrationId) || registrationTypes[0],
    [selectedRegistrationId]
  );

  const registrationIconMap = {
    'taxi-private': CarTaxiFront,
    'taxi-park': Building2,
    'freight-park': Truck,
    'freight-private': PackageCheck,
    'mini-business': Store,
  };

  const subtitle = useMemo(() => {
    if (step === 'login') return 'Такси или груз — дальше ваш URL из настроек.';
    if (step === 'register') return 'Тип бизнеса, контакты — менеджер подготовит КП и следующий шаг.';
    return 'Уже в сервисе — во вход. Новый клиент — короткая заявка.';
  }, [step]);

  const canSubmitRegistration = useMemo(
    () => registrationForm.name.trim() && registrationForm.contact.trim(),
    [registrationForm]
  );

  useEffect(() => {
    if (!isOpen) return;
    setError('');
  }, [isOpen]);

  const closeAndReset = () => {
    setStep('root');
    setSelectedRegistrationId(registrationTypes[0]?.id || '');
    setRegistrationForm({
      name: '',
      contact: '',
      company: '',
      comment: '',
    });
    setLoading(false);
    setError('');
    setSubmittedLeadId(null);
    onClose();
  };

  const handleLoginDirection = (direction) => {
    closeAndReset();
    if (isExternalUrl(direction.url)) {
      window.location.href = direction.url;
      return;
    }
    navigate(direction.url);
  };

  const handleRegistrationField = (field) => (event) => {
    setRegistrationForm((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const handleRegistrationSubmit = async (event) => {
    event.preventDefault();
    if (!selectedRegistrationType || !canSubmitRegistration) return;

    setLoading(true);
    setError('');
    try {
      const response = await createCallbackLead({
        name: registrationForm.name,
        contact: registrationForm.contact,
        company: registrationForm.company,
        businessType: selectedRegistrationType.title,
        comment: registrationForm.comment || `Регистрация через модалку. Тип: ${selectedRegistrationType.title}`,
        sourcePage: 'entry-modal-register',
      });
      setSubmittedLeadId(response?.id || null);
    } catch (err) {
      setError(err?.response?.data?.error || 'Не удалось отправить заявку. Попробуйте еще раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm"
          onClick={closeAndReset}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="relative w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-300/40"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(45,212,191,0.08),transparent_28%),radial-gradient(circle_at_100%_0%,rgba(20,184,166,0.06),transparent_30%)]" />
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="relative z-10">
                {step !== 'root' && (
                  <button
                    type="button"
                    onClick={() => setStep('root')}
                    className="mb-3 inline-flex items-center gap-2 text-xs text-slate-500 hover:text-slate-800"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Назад
                  </button>
                )}
                <p className="mb-2 text-xs uppercase tracking-wide text-teal-700">Сервис</p>
                <h3 className="text-2xl font-bold text-slate-900">{stepTitles[step]}</h3>
                <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    { id: 'root', label: 'Старт' },
                    { id: 'login', label: 'Вход' },
                    { id: 'register', label: 'Регистрация' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setStep(item.id)}
                      className={`rounded-full px-3 py-1 text-xs transition ${
                        step === item.id
                          ? 'border border-teal-300 bg-teal-50 text-teal-900'
                          : 'border border-slate-200 bg-slate-50 text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={closeAndReset}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-slate-300 hover:text-slate-800"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {step === 'root' && (
              <div className="grid gap-4 md:grid-cols-2">
                <motion.button
                  type="button"
                  whileHover={{ y: -4 }}
                  onClick={() => setStep('login')}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left shadow-sm hover:border-teal-300"
                >
                  <div className="mb-3 inline-flex rounded-xl bg-teal-50 p-2.5 ring-1 ring-teal-100">
                    <LogIn className="h-5 w-5 text-teal-600" />
                  </div>
                  <h4 className="text-xl font-bold text-slate-900">Вход</h4>
                  <p className="mt-2 text-sm text-slate-600">Действующий доступ — выбор такси или груза.</p>
                  <span className="mt-5 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white">
                    Далее
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ y: -4 }}
                  onClick={() => setStep('register')}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left shadow-sm hover:border-teal-300"
                >
                  <div className="mb-3 inline-flex rounded-xl bg-teal-50/80 p-2.5 ring-1 ring-teal-100">
                    <UserPlus className="h-5 w-5 text-teal-700" />
                  </div>
                  <h4 className="text-xl font-bold text-slate-900">Заявка</h4>
                  <p className="mt-2 text-sm text-slate-600">Новый контур: ЭПЛ, ЭТРН, такси, ЭДО, маркировка.</p>
                  <span className="mt-5 inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white">
                    Далее
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </motion.button>
              </div>
            )}

            {step === 'login' && (
              <div className="grid gap-4 md:grid-cols-2">
                {loginDirections.map((direction, idx) => (
                  <motion.button
                    key={direction.id}
                    type="button"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    whileHover={{ y: -4 }}
                    onClick={() => handleLoginDirection(direction)}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left shadow-sm hover:border-teal-300"
                  >
                    <div className="mb-3 inline-flex rounded-xl bg-teal-50 p-2.5 ring-1 ring-teal-100">
                      <Truck className="h-5 w-5 text-teal-600" />
                    </div>
                    <h4 className="text-xl font-bold text-slate-900">{direction.title}</h4>
                    <p className="mt-2 text-sm text-slate-600">{direction.description}</p>
                    <span className="mt-5 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white">
                      Перейти
                      {isExternalUrl(direction.url) ? <ExternalLink className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                    </span>
                  </motion.button>
                ))}
              </div>
            )}

            {step === 'register' && (
              <div className="grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">Тип</p>
                  <div className="space-y-2">
                    {registrationTypes.map((item, idx) => {
                      const Icon = registrationIconMap[item.id] || ShieldCheck;
                      const active = selectedRegistrationId === item.id;
                      return (
                        <motion.button
                          key={item.id}
                          type="button"
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.04 }}
                          onClick={() => setSelectedRegistrationId(item.id)}
                          className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                            active
                              ? 'border-teal-300 bg-teal-50 shadow-sm'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`rounded-xl p-2 ${active ? 'bg-teal-100' : 'bg-slate-100'}`}>
                              <Icon className={`h-4 w-4 ${active ? 'text-teal-700' : 'text-slate-500'}`} />
                            </div>
                            <div className="min-w-0">
                              <p className={`text-sm font-semibold ${active ? 'text-teal-950' : 'text-slate-800'}`}>{item.title}</p>
                              <p className="mt-1 text-xs text-slate-500">{item.shortDescription}</p>
                            </div>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                <motion.div
                  key={selectedRegistrationType?.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="mb-4">
                    <p className="mb-2 inline-flex rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs text-teal-800">
                      Выбрано
                    </p>
                    <h4 className="text-xl font-bold text-slate-900">{selectedRegistrationType?.title}</h4>
                    <p className="mt-2 text-sm text-slate-600">{selectedRegistrationType?.shortDescription}</p>
                  </div>

                  <div className="mb-5 grid gap-2">
                    {selectedRegistrationType?.points.map((point) => (
                      <div key={point} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-teal-600" />
                        <span>{point}</span>
                      </div>
                    ))}
                  </div>

                  {!submittedLeadId ? (
                    <form onSubmit={handleRegistrationSubmit} className="grid gap-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor="entry-register-name" className="mb-1 block text-sm text-slate-600">
                            Имя
                          </label>
                          <input
                            id="entry-register-name"
                            value={registrationForm.name}
                            onChange={handleRegistrationField('name')}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                            required
                          />
                        </div>
                        <div>
                          <label htmlFor="entry-register-contact" className="mb-1 block text-sm text-slate-600">
                            Телефон / email
                          </label>
                          <input
                            id="entry-register-contact"
                            value={registrationForm.contact}
                            onChange={handleRegistrationField('contact')}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                            required
                          />
                        </div>
                      </div>
                      <div>
                        <label htmlFor="entry-register-company" className="mb-1 block text-sm text-slate-600">
                          Компания / ИП
                        </label>
                        <input
                          id="entry-register-company"
                          value={registrationForm.company}
                          onChange={handleRegistrationField('company')}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label htmlFor="entry-register-comment" className="mb-1 block text-sm text-slate-600">
                          Что нужно подключить
                        </label>
                        <textarea
                          id="entry-register-comment"
                          value={registrationForm.comment}
                          onChange={handleRegistrationField('comment')}
                          rows={3}
                          placeholder="Например: ЭДО + Честный ЗНАК + ЭПЛ для 40 водителей"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                        />
                      </div>

                      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="submit"
                          disabled={loading || !canSubmitRegistration}
                          className="landing-cta inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {loading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Отправляем
                            </>
                          ) : (
                            <>
                              Отправить
                              <ArrowRight className="h-4 w-4" />
                            </>
                          )}
                        </button>
                        <span className="text-xs text-slate-500">Заявка в CRM — ответ в рабочее время.</span>
                      </div>
                    </form>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900"
                    >
                      <p className="mb-2 flex items-center gap-2 font-semibold">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        Заявка отправлена
                      </p>
                      <p>Менеджер свяжется по выбранному типу. Номер заявки: #{submittedLeadId}.</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={closeAndReset}
                          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                        >
                          Закрыть
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSubmittedLeadId(null);
                            setRegistrationForm({
                              name: '',
                              contact: '',
                              company: '',
                              comment: '',
                            });
                          }}
                          className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100/80"
                        >
                          Ещё заявка
                        </button>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
