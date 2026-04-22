import { motion } from 'framer-motion';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import MarketingBackdrop from '../components/landing/MarketingBackdrop';
import { loginDirections } from '../config/entryFlowConfig';

const placeholderMeta = {
  'taxi-login': 'Вход такси: URL не задан',
  'freight-login': 'Вход грузовых ЭПЛ: URL не задан',
};

export default function EntryPlaceholder() {
  const { target } = useParams();
  const targetMeta = placeholderMeta[target] || 'Точка входа не настроена';

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 text-slate-800">
      <MarketingBackdrop />
      <div className="relative z-[1] mx-auto max-w-4xl px-6 pb-16 pt-10">
        <Link to="/entry/login" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          Назад к входу
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8"
        >
          <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">{targetMeta}</h1>
          <p className="mt-3 text-sm text-slate-600">
            Задайте внешний адрес кабинета в переменных окружения <span className="font-mono text-slate-800">VITE_TAXI_LOGIN_URL</span> и{' '}
            <span className="font-mono text-slate-800">VITE_FREIGHT_LOGIN_URL</span>.
          </p>
          <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
            {loginDirections.map((direction) => (
              <p key={direction.id}>
                {direction.title}: <span className="font-mono text-teal-700">{direction.url}</span>
              </p>
            ))}
          </div>
          <Link
            to="/entry/login"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-500"
          >
            Другое направление
            <ExternalLink className="h-4 w-4" />
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
