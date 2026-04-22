import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, UserPlus2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import MarketingBackdrop from '../components/landing/MarketingBackdrop';
import { registrationTypes } from '../config/entryFlowConfig';

export default function EntryRegistrationChoice() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 text-slate-800">
      <MarketingBackdrop />
      <div className="relative z-[1] mx-auto max-w-6xl px-6 pb-16 pt-10">
        <Link to="/entry" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          Назад к выбору
        </Link>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-teal-700">Регистрация</p>
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Тип заявки</h1>
          <p className="mt-3 text-sm text-slate-600 md:text-base">
            Подберём внедрение под ваш парк или формат бизнеса.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {registrationTypes.map((item, idx) => (
            <motion.article
              key={item.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              whileHover={{ y: -4 }}
              className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-teal-300 hover:shadow-md"
            >
              <div className="mb-3 inline-flex rounded-xl bg-teal-50 p-2.5 ring-1 ring-teal-100">
                <UserPlus2 className="h-5 w-5 text-teal-600" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">{item.title}</h2>
              <p className="mt-2 flex-1 text-sm text-slate-600">{item.shortDescription}</p>
              <Link
                to={`/entry/register/${item.id}`}
                className="mt-5 inline-flex w-fit items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-teal-500"
              >
                Заявка
                <ArrowRight className="h-4 w-4" />
              </Link>
            </motion.article>
          ))}
        </div>
      </div>
    </div>
  );
}
