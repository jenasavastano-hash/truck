import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, ExternalLink, Truck, CarTaxiFront } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import MarketingBackdrop from '../components/landing/MarketingBackdrop';
import { isExternalUrl, loginDirections } from '../config/entryFlowConfig';

const iconByDirection = {
  taxi: CarTaxiFront,
  freight: Truck,
};

export default function EntryLoginChoice() {
  const navigate = useNavigate();

  const handleDirectionSelect = (direction) => {
    if (isExternalUrl(direction.url)) {
      window.location.href = direction.url;
      return;
    }
    navigate(direction.url);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 text-slate-800">
      <MarketingBackdrop />
      <div className="relative z-[1] mx-auto max-w-5xl px-6 pb-16 pt-10">
        <Link to="/entry" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          Назад к выбору
        </Link>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-teal-700">Вход</p>
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Направление входа</h1>
          <p className="mt-3 text-sm text-slate-600 md:text-base">
            Откроется кабинет такси или грузового контура по вашему URL.
          </p>
        </motion.div>

        <div className="grid gap-4 md:grid-cols-2">
          {loginDirections.map((direction, idx) => {
            const Icon = iconByDirection[direction.id] || Truck;
            return (
              <motion.button
                key={direction.id}
                type="button"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.06 }}
                whileHover={{ y: -4 }}
                onClick={() => handleDirectionSelect(direction)}
                className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-teal-300 hover:shadow-md"
              >
                <div className="mb-3 inline-flex rounded-xl bg-teal-50 p-2.5 ring-1 ring-teal-100">
                  <Icon className="h-5 w-5 text-teal-600" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900">{direction.title}</h2>
                <p className="mt-2 text-sm text-slate-600">{direction.description}</p>
                <span className="mt-6 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white shadow-sm">
                  Войти
                  {isExternalUrl(direction.url) ? <ExternalLink className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
