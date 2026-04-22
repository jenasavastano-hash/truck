import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import MarketingBackdrop from '../components/landing/MarketingBackdrop';
import { getRegistrationTypeById } from '../config/entryFlowConfig';

export default function EntryRegistrationForm() {
  const { typeId } = useParams();
  const registrationType = getRegistrationTypeById(typeId || '');
  const [submitted, setSubmitted] = useState(false);

  if (!registrationType) {
    return <Navigate to="/entry/register" replace />;
  }

  const handleSubmit = (event) => {
    event.preventDefault();
    setSubmitted(true);
  };

  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500';

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 text-slate-800">
      <MarketingBackdrop />
      <div className="relative z-[1] mx-auto max-w-4xl px-6 pb-16 pt-10">
        <Link to="/entry/register" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          Назад к типам заявки
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8"
        >
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-teal-700">Заявка</p>
          <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">{registrationType.title}</h1>
          <p className="mt-3 text-sm text-slate-600">{registrationType.shortDescription}</p>

          <div className="mt-5 grid gap-2">
            {registrationType.points.map((point) => (
              <div key={point} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                {point}
              </div>
            ))}
          </div>

          {!submitted ? (
            <form onSubmit={handleSubmit} className="mt-7 grid gap-4">
              <div>
                <label htmlFor="name" className="mb-1 block text-sm text-slate-600">
                  Имя
                </label>
                <input id="name" name="name" required className={inputClass} />
              </div>
              <div>
                <label htmlFor="company" className="mb-1 block text-sm text-slate-600">
                  Компания / ИП
                </label>
                <input id="company" name="company" required className={inputClass} />
              </div>
              <div>
                <label htmlFor="contact" className="mb-1 block text-sm text-slate-600">
                  Телефон или email
                </label>
                <input id="contact" name="contact" required className={inputClass} />
              </div>
              <div>
                <label htmlFor="comment" className="mb-1 block text-sm text-slate-600">
                  Задача и сроки
                </label>
                <textarea id="comment" name="comment" rows={4} className={inputClass} />
              </div>
              <button
                type="submit"
                className="rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-500"
              >
                Отправить
              </button>
            </form>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-7 rounded-xl border border-teal-200 bg-teal-50 px-4 py-4 text-sm text-teal-900"
            >
              <div className="mb-2 flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4 text-teal-600" />
                Заявка принята
              </div>
              Менеджер свяжется в рабочее время и уточнит детали для коммерческого предложения.
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
