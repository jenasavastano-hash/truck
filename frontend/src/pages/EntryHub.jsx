import { motion } from 'framer-motion';
import { ArrowRight, LogIn, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import MarketingBackdrop from '../components/landing/MarketingBackdrop';

const options = [
  {
    id: 'login',
    title: 'Вход',
    description: 'Грузовые ЭПЛ или такси — дальше выбор направления и ваш URL из настроек.',
    cta: 'Вход',
    to: '/entry/login',
    icon: LogIn,
  },
  {
    id: 'register',
    title: 'Регистрация',
    description: 'Тип парка или бизнеса и короткая форма — заявка уходит менеджеру.',
    cta: 'Регистрация',
    to: '/entry/register',
    icon: UserPlus,
  },
];

export default function EntryHub() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 text-slate-800">
      <MarketingBackdrop />
      <div className="relative z-[1] mx-auto max-w-5xl px-6 pb-16 pt-10">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-teal-700">Вход в сервис</p>
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Вход или регистрация</h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-600 md:text-base">
            Два сценария: действующий клиент — во вход; новый — в форму заявки по типу бизнеса.
          </p>
        </motion.div>

        <div className="grid gap-4 md:grid-cols-2">
          {options.map((option, idx) => {
            const Icon = option.icon;
            return (
              <motion.article
                key={option.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.07 }}
                whileHover={{ y: -4 }}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-teal-300 hover:shadow-md"
              >
                <div className="mb-3 inline-flex rounded-xl bg-teal-50 p-2.5 ring-1 ring-teal-100">
                  <Icon className="h-5 w-5 text-teal-600" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900">{option.title}</h2>
                <p className="mt-2 flex-1 text-sm text-slate-600">{option.description}</p>
                <Link
                  to={option.to}
                  className="mt-6 inline-flex w-fit items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-500"
                >
                  {option.cta}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </motion.article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
