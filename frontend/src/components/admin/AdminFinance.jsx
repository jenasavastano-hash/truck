import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Wallet, TrendingUp, TrendingDown, Calendar, Building2,
  BarChart3, Download, RefreshCw, ArrowUpRight, ArrowDownRight,
  Users, Banknote, Receipt,
} from 'lucide-react';
import api from '../../api';
import { operationsShell } from '../../utils/operationsUi';

function fmt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
}

function StatCard({ icon: Icon, label, value, color = 'slate', sub, night }) {
  const colors = {
    green: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    blue: 'bg-teal-50 text-teal-700 border-teal-200',
    orange: 'bg-orange-50 text-orange-600 border-orange-200',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  const nightColors = {
    green: 'border border-emerald-400/25 bg-emerald-500/[0.12] text-emerald-100',
    red: 'border border-red-400/25 bg-red-500/[0.12] text-red-100',
    blue: 'border border-teal-400/25 bg-teal-500/[0.12] text-teal-100',
    orange: 'border border-orange-400/25 bg-orange-500/[0.12] text-orange-100',
    slate: 'border border-white/12 bg-white/[0.06] text-slate-200',
  };
  return (
    <div className={`rounded-xl p-4 border ${night ? nightColors[color] : colors[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 opacity-90" />
        <span className={`text-xs font-medium ${night ? 'text-slate-300' : 'opacity-70'}`}>{label}</span>
      </div>
      <div className="text-lg font-bold">{value}</div>
      {sub && <div className={`text-xs mt-1 ${night ? 'text-slate-400' : 'opacity-60'}`}>{sub}</div>}
    </div>
  );
}

function SummaryRow({ label, value, bold, negative, indent, night }) {
  return (
    <div
      className={`flex justify-between items-center py-2 px-3 ${bold ? (night ? 'bg-white/[0.06] rounded-lg' : 'bg-slate-50 rounded-lg') : ''} ${indent ? 'pl-6' : ''}`}
    >
      <span
        className={`text-sm ${bold ? (night ? 'font-bold text-slate-100' : 'font-bold text-slate-900') : night ? 'text-slate-300' : 'text-slate-700'}`}
      >
        {label}
      </span>
      {value != null && (
        <span
          className={`text-sm font-mono ${bold ? 'font-bold' : ''} ${
            negative || value < 0
              ? night
                ? 'text-red-300'
                : 'text-red-600'
              : bold
                ? night
                  ? 'text-slate-100'
                  : 'text-slate-900'
                : night
                  ? 'text-slate-200'
                  : 'text-slate-900'
          }`}
        >
          {fmt(value)}
        </span>
      )}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, color = 'slate', night }) {
  const colors = {
    green: 'text-emerald-600 bg-emerald-50',
    red: 'text-red-600 bg-red-50',
    blue: 'text-teal-700 bg-teal-50',
    orange: 'text-orange-600 bg-orange-50',
    slate: 'text-slate-700 bg-slate-50',
  };
  const nightColors = {
    green: 'text-emerald-200 bg-emerald-500/10 border border-emerald-400/20',
    red: 'text-red-200 bg-red-500/10 border border-red-400/20',
    blue: 'text-teal-200 bg-teal-500/10 border border-teal-400/20',
    orange: 'text-orange-200 bg-orange-500/10 border border-orange-400/20',
    slate: 'text-slate-200 bg-white/[0.06] border border-white/12',
  };
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg mt-4 mb-1 ${night ? nightColors[color] : colors[color]}`}>
      <Icon className="w-4 h-4" />
      <span className="text-sm font-bold">{title}</span>
    </div>
  );
}

export default function AdminFinance({ sceneNight = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('kassa');
  const [exporting, setExporting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/finance');
      setData(res.data);
      const p = res.data.permissions;
      if (!p.showKassa && p.showSalary) setTab('salary');
      else if (!p.showKassa && !p.showSalary && p.showParks) setTab('parks');
      else if (!p.showKassa && !p.showSalary && !p.showParks && p.showMonthly) setTab('monthly');
    } catch (err) {
      console.error('Finance load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get('/admin/finance/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Kassa_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className={`w-6 h-6 animate-spin ${sceneNight ? 'text-slate-500' : 'text-slate-400'}`} />
        <span className={`ml-3 ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>Загрузка данных...</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={`text-center py-20 ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
        Не удалось загрузить данные
      </div>
    );
  }

  const perms = data.permissions;
  const tabs = [
    perms.showKassa && { id: 'kassa', label: 'Касса', icon: Wallet },
    perms.showSalary && { id: 'salary', label: 'ЗП по дням', icon: Calendar },
    perms.showParks && { id: 'parks', label: 'По паркам', icon: Building2 },
    perms.showMonthly && { id: 'monthly', label: 'Помесячно', icon: BarChart3 },
  ].filter(Boolean);

  const s = data.summary;
  const tabColors = { kassa: 'blue', salary: 'emerald', parks: 'orange', monthly: 'purple' };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className={`text-xl font-bold flex items-center gap-2 ${sceneNight ? 'text-slate-100' : 'text-slate-800'}`}>
          <Wallet className={`w-6 h-6 ${sceneNight ? 'text-teal-300' : 'text-teal-600'}`} />
          Касса
        </h2>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            className={`p-2 rounded-lg transition ${
              sceneNight ? 'bg-white/[0.08] hover:bg-white/[0.12] text-slate-200' : 'bg-slate-100 hover:bg-slate-200'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${sceneNight ? 'text-slate-300' : 'text-slate-600'}`} />
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition text-sm font-medium disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Скачивание...' : 'Excel'}
          </button>
        </div>
      </div>

      <div
        className={`flex gap-1 rounded-xl p-1 backdrop-blur-md ${
          sceneNight ? 'bg-white/[0.06] border border-white/15 ring-1 ring-white/10' : 'bg-slate-100/90 border border-slate-200/80'
        }`}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition flex-1 justify-center ${
              tab === t.id
                ? sceneNight
                  ? 'bg-white/15 text-white shadow-sm border border-white/10'
                  : 'bg-white text-slate-900 shadow-sm'
                : sceneNight
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      <div className={`rounded-2xl shadow-lg overflow-hidden ${operationsShell(sceneNight)}`}>
        {tab === 'kassa' && s && <KassaTab data={data} sceneNight={sceneNight} />}
        {tab === 'salary' && data.daily && <SalaryTab daily={data.daily} sceneNight={sceneNight} />}
        {tab === 'parks' && data.parks && (
          <ParksTab parks={data.parks} formulas={data.parkFormulas} sceneNight={sceneNight} />
        )}
        {tab === 'monthly' && data.monthly && <MonthlyTab monthly={data.monthly} sceneNight={sceneNight} />}
      </div>
    </motion.div>
  );
}

function KassaTab({ data, sceneNight: night }) {
  const s = data.summary;
  return (
    <div className="p-4 space-y-1">
      {/* Top cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard icon={ArrowUpRight} label="Реальный приход" value={fmt(s.realTotal)} color="green" night={night} />
        <StatCard icon={ArrowDownRight} label="Расходы" value={fmt(-s.totalExp)} color="red" night={night} />
        <StatCard
          icon={Banknote}
          label="Остаток с парков"
          value={fmt(s.remainder)}
          color="blue"
          sub={`ЭПЛ: ${s.totEplAll} | АЗ: ${s.totACAll}`}
          night={night}
        />
        <StatCard
          icon={Wallet}
          label="Реал на карте"
          value={fmt(s.freeCash)}
          color={s.freeCash >= 0 ? 'green' : 'red'}
          night={night}
        />
      </div>

      <SectionHeader icon={ArrowUpRight} title="Приход" color="green" night={night} />
      <SummaryRow label="Приход ЮКасса (succeeded)" value={s.yukassaTotal} night={night} />
      <SummaryRow label={`  кол-во платежей: ${s.yukassaCnt}`} value={null} indent night={night} />
      <SummaryRow label="Приход админ (реальные)" value={s.adminReal} night={night} />
      <SummaryRow label="ИТОГО реальный приход" value={s.realTotal} bold night={night} />

      <SectionHeader icon={Receipt} title="Комиссии и налоги" color="red" night={night} />
      <SummaryRow label="Комиссия ЮКассы (4.7%)" value={-s.yukassaComm} negative night={night} />
      <SummaryRow label="Налог (13%)" value={-s.tax} negative night={night} />
      <SummaryRow label="ЧИСТЫЙ ПРИХОД" value={s.cleanMoney} bold night={night} />

      <SectionHeader icon={ArrowDownRight} title="Расходы" color="red" night={night} />
      <SummaryRow label={`Всего ЭПЛ: ${s.totEplAll} шт.`} value={null} night={night} />
      <SummaryRow label={`Всего автозакрытий: ${s.totACAll} шт.`} value={null} night={night} />
      <SummaryRow label="ЗП — Ты" value={-s.salaryMe} negative night={night} />
      <SummaryRow label="ЗП — Масис" value={-s.salaryMasis} negative night={night} />
      <SummaryRow label="ЗП — Инал" value={-s.salaryInal} negative night={night} />
      <SummaryRow label="Медик" value={-s.medic} negative night={night} />
      <SummaryRow label="Такском" value={-s.taxcom} negative night={night} />
      <SummaryRow label="ИТОГО расходов" value={-s.totalExp} bold night={night} />

      <SectionHeader icon={Users} title="Оборотные деньги" color="blue" night={night} />
      <SummaryRow label="На балансах водителей (реал)" value={s.driverBalReal} night={night} />
      <SummaryRow label="На балансах водителей (бонус)" value={s.driverBalUnreal} night={night} />
      <SummaryRow label={`Водителей в системе: ${s.driverCnt}`} value={null} night={night} />

      <SectionHeader icon={TrendingUp} title="Остаток с парков" color="green" night={night} />
      <SummaryRow label="Остаток с ЭПЛ и АЗ" value={s.remainder} bold night={night} />
      <div className={`text-xs px-3 py-1 ${night ? 'text-slate-500' : 'text-slate-500'}`}>
        Обычн парк: ~{s.cleanEplPrice ? (s.cleanEplPrice - 9 - 5 - 2).toFixed(2) : '4.73'}₽/ЭПЛ | Тула/СПб: ~
        {s.cleanEplPrice ? (s.cleanEplPrice - 15).toFixed(2) : '5.73'}₽/ЭПЛ
      </div>

      <div className={`mt-4 pt-4 ${night ? 'border-t border-white/10' : 'border-t border-slate-200'}`}>
        <div
          className={`flex justify-between items-center px-3 py-3 rounded-xl ${
            night ? 'bg-white/[0.06] border border-white/10' : 'bg-gradient-to-r from-sky-50 to-emerald-50'
          }`}
        >
          <span className={`font-bold ${night ? 'text-slate-100' : 'text-slate-900'}`}>РЕАЛ НА КАРТЕ</span>
          <span
            className={`text-xl font-bold ${s.freeCash >= 0 ? (night ? 'text-emerald-300' : 'text-emerald-600') : night ? 'text-red-300' : 'text-red-600'}`}
          >
            {fmt(s.freeCash)}
          </span>
        </div>
        <div className={`text-xs px-3 mt-2 ${night ? 'text-slate-500' : 'text-slate-400'}`}>
          Чистый приход − расходы − оборотные (балансы водителей)
        </div>
      </div>
    </div>
  );
}

function SalaryTab({ daily, sceneNight: night }) {
  const totals = daily.reduce((acc, d) => ({
    eplReg: acc.eplReg + d.eplReg,
    eplTS: acc.eplTS + d.eplTS,
    ac: acc.ac + d.ac,
    salaryPer: acc.salaryPer + d.salaryPer,
    medic: acc.medic + d.medic,
    taxcom: acc.taxcom + d.taxcom,
    totalExp: acc.totalExp + d.totalExp,
    remainder: acc.remainder + d.remainder,
  }), { eplReg: 0, eplTS: 0, ac: 0, salaryPer: 0, medic: 0, taxcom: 0, totalExp: 0, remainder: 0 });

  const th = night ? 'text-slate-400' : 'text-slate-600';
  const td = night ? 'text-slate-300' : 'text-slate-700';
  const tdMuted = night ? 'text-slate-400' : 'text-slate-800';
  const theadTr = night ? 'bg-white/[0.06] border-b border-white/10' : 'bg-slate-50 border-b border-slate-200';
  const rowBorder = night ? 'border-white/10' : 'border-slate-100';
  const rowAlt = night ? 'bg-white/[0.03]' : 'bg-slate-50/50';
  const rowHover = night ? 'hover:bg-white/[0.06]' : 'hover:bg-teal-50/50';
  const footTr = night ? 'bg-white/[0.08] border-t-2 border-white/15' : 'bg-slate-100 border-t-2 border-slate-300';
  const red = night ? 'text-red-300' : 'text-red-600';
  const em = night ? 'text-emerald-300' : 'text-emerald-600';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className={theadTr}>
            {['Дата', 'ЭПЛ обычн', 'ЭПЛ Тула/СПб', 'АЗ', 'ЗП (×1)', 'Медик', 'Такском', 'Расход', 'Остаток'].map((h) => (
              <th key={h} className={`px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap ${th}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {daily.map((d, i) => (
            <tr
              key={i}
              className={`border-b ${rowBorder} ${i % 2 === 1 ? rowAlt : ''} ${rowHover} transition`}
            >
              <td className={`px-3 py-2 font-medium whitespace-nowrap ${tdMuted}`}>{d.day}</td>
              <td className={`px-3 py-2 ${td}`}>{d.eplReg}</td>
              <td className={`px-3 py-2 ${td}`}>{d.eplTS}</td>
              <td className={`px-3 py-2 ${td}`}>{d.ac}</td>
              <td className={`px-3 py-2 font-mono ${td}`}>{fmt(d.salaryPer)}</td>
              <td className={`px-3 py-2 font-mono ${td}`}>{fmt(d.medic)}</td>
              <td className={`px-3 py-2 font-mono ${td}`}>{fmt(d.taxcom)}</td>
              <td className={`px-3 py-2 font-mono ${red}`}>{fmt(-d.totalExp)}</td>
              <td className={`px-3 py-2 font-mono font-medium ${d.remainder >= 0 ? em : red}`}>{fmt(d.remainder)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={`font-bold ${footTr}`}>
            <td className={`px-3 py-2.5 ${night ? 'text-slate-100' : 'text-slate-900'}`}>ИТОГО</td>
            <td className={`px-3 py-2.5 ${night ? 'text-slate-200' : ''}`}>{totals.eplReg}</td>
            <td className={`px-3 py-2.5 ${night ? 'text-slate-200' : ''}`}>{totals.eplTS}</td>
            <td className={`px-3 py-2.5 ${night ? 'text-slate-200' : ''}`}>{totals.ac}</td>
            <td className={`px-3 py-2.5 font-mono ${night ? 'text-slate-200' : ''}`}>{fmt(totals.salaryPer)}</td>
            <td className={`px-3 py-2.5 font-mono ${night ? 'text-slate-200' : ''}`}>{fmt(totals.medic)}</td>
            <td className={`px-3 py-2.5 font-mono ${night ? 'text-slate-200' : ''}`}>{fmt(totals.taxcom)}</td>
            <td className={`px-3 py-2.5 font-mono ${red}`}>{fmt(-totals.totalExp)}</td>
            <td className={`px-3 py-2.5 font-mono ${totals.remainder >= 0 ? em : red}`}>{fmt(totals.remainder)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ParksTab({ parks, formulas, sceneNight: night }) {
  const totalExp = parks.reduce((a, p) => a + p.expenses, 0);
  const totalRem = parks.reduce((a, p) => a + p.remainder, 0);
  const totalEpl = parks.reduce((a, p) => a + p.epl, 0);
  const totalAC = parks.reduce((a, p) => a + p.ac, 0);

  const theadTr = night ? 'bg-white/[0.06] border-b border-white/10' : 'bg-slate-50 border-b border-slate-200';
  const th = night ? 'text-slate-400' : 'text-slate-600';
  const rowBorder = night ? 'border-white/10' : 'border-slate-100';
  const rowAlt = night ? 'bg-white/[0.03]' : 'bg-slate-50/50';
  const rowHover = night ? 'hover:bg-white/[0.06]' : 'hover:bg-teal-50/50';
  const td = night ? 'text-slate-300' : 'text-slate-700';
  const tdName = night ? 'text-slate-100' : 'text-slate-800';
  const footTr = night ? 'bg-white/[0.08] border-t-2 border-white/15' : 'bg-slate-100 border-t-2 border-slate-300';
  const red = night ? 'text-red-300' : 'text-red-600';
  const em = night ? 'text-emerald-300' : 'text-emerald-600';
  const typeTula = night ? 'bg-sky-500/20 text-sky-200 border border-sky-400/25' : 'bg-sky-100 text-sky-800';
  const typeReg = night ? 'bg-white/[0.08] text-slate-300 border border-white/10' : 'bg-slate-100 text-slate-600';

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={theadTr}>
              {['Парк', 'Тип', 'ЭПЛ', 'АЗ', 'ЗП/ЭПЛ', 'Медик', 'Такском', 'Остаток/ЭПЛ', 'Расходы', 'Остаток'].map((h) => (
                <th key={h} className={`px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap ${th}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parks.map((p, i) => (
              <tr key={i} className={`border-b ${rowBorder} ${i % 2 === 1 ? rowAlt : ''} ${rowHover} transition`}>
                <td className={`px-3 py-2 font-medium whitespace-nowrap max-w-[200px] truncate ${tdName}`}>{p.name}</td>
                <td className="px-3 py-2">
                  <span
                    className={`px-2 py-0.5 rounded-md text-xs font-medium ${p.type === 'Тула/СПб' ? typeTula : typeReg}`}
                  >
                    {p.type}
                  </span>
                </td>
                <td className={`px-3 py-2 ${td}`}>{p.epl}</td>
                <td className={`px-3 py-2 ${td}`}>{p.ac}</td>
                <td className={`px-3 py-2 font-mono ${td}`}>{fmt(p.salaryPerEpl)}</td>
                <td className={`px-3 py-2 font-mono ${td}`}>{fmt(p.medicPerEpl)}</td>
                <td className={`px-3 py-2 font-mono ${td}`}>{fmt(p.taxcomPerEpl)}</td>
                <td className={`px-3 py-2 font-mono font-medium ${em}`}>{fmt(p.remainderPerEpl)}</td>
                <td className={`px-3 py-2 font-mono ${red}`}>{fmt(-p.expenses)}</td>
                <td className={`px-3 py-2 font-mono font-bold ${p.remainder >= 0 ? em : red}`}>{fmt(p.remainder)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={`font-bold ${footTr}`}>
              <td className={`px-3 py-2.5 ${night ? 'text-slate-100' : 'text-slate-900'}`}>ИТОГО</td>
              <td className="px-3 py-2.5"></td>
              <td className={`px-3 py-2.5 ${night ? 'text-slate-200' : ''}`}>{totalEpl}</td>
              <td className={`px-3 py-2.5 ${night ? 'text-slate-200' : ''}`}>{totalAC}</td>
              <td className="px-3 py-2.5" colSpan={3}></td>
              <td className="px-3 py-2.5"></td>
              <td className={`px-3 py-2.5 font-mono ${red}`}>{fmt(-totalExp)}</td>
              <td className={`px-3 py-2.5 font-mono ${totalRem >= 0 ? em : red}`}>{fmt(totalRem)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {formulas && (
        <div
          className={`p-4 border-t text-xs space-y-1 ${
            night ? 'bg-white/[0.04] border-white/10 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-500'
          }`}
        >
          <div className={`font-semibold mb-2 ${night ? 'text-slate-200' : 'text-slate-700'}`}>
            Формула остатка за 1 ЭПЛ:
          </div>
          <div>Чистая цена ЭПЛ = 25₽ − 4.7% − 13% = {formulas.cleanEplPrice.toFixed(2)}₽</div>
          <div>
            Обычный парк: {formulas.cleanEplPrice.toFixed(2)} − 3₽×3(зп) − 5₽(мед) − 2₽(такс) ={' '}
            {formulas.regularRemainder.toFixed(2)}₽
          </div>
          <div>
            Тула/СПб: {formulas.cleanEplPrice.toFixed(2)} − 5₽×3(зп) = {formulas.tulaSPbRemainder.toFixed(2)}₽
          </div>
          <div>
            АЗ: 10₽ − 4.7% − 13% = {formulas.cleanACPrice.toFixed(2)}₽ − 3₽×3(зп) = {formulas.acRemainder.toFixed(2)}₽
          </div>
        </div>
      )}
    </div>
  );
}

function MonthlyTab({ monthly, sceneNight: night }) {
  const totals = monthly.reduce((acc, m) => ({
    topupReal: acc.topupReal + m.topupReal,
    topupUnreal: acc.topupUnreal + m.topupUnreal,
    eplCount: acc.eplCount + m.eplCount,
    acCount: acc.acCount + m.acCount,
    spentReal: acc.spentReal + m.spentReal,
    spentUnreal: acc.spentUnreal + m.spentUnreal,
    netIncome: acc.netIncome + m.netIncome,
    estSalary: acc.estSalary + m.estSalary,
  }), { topupReal: 0, topupUnreal: 0, eplCount: 0, acCount: 0, spentReal: 0, spentUnreal: 0, netIncome: 0, estSalary: 0 });

  const theadTr = night ? 'bg-white/[0.06] border-b border-white/10' : 'bg-slate-50 border-b border-slate-200';
  const th = night ? 'text-slate-400' : 'text-slate-600';
  const rowBorder = night ? 'border-white/10' : 'border-slate-100';
  const rowAlt = night ? 'bg-white/[0.03]' : 'bg-slate-50/50';
  const rowHover = night ? 'hover:bg-white/[0.06]' : 'hover:bg-teal-50/50';
  const td = night ? 'text-slate-300' : 'text-slate-700';
  const footTr = night ? 'bg-white/[0.08] border-t-2 border-white/15' : 'bg-slate-100 border-t-2 border-slate-300';
  const red = night ? 'text-red-300' : 'text-red-600';
  const em = night ? 'text-emerald-300' : 'text-emerald-600';
  const muted = night ? 'text-slate-500' : 'text-slate-500';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className={theadTr}>
            {['Месяц', 'Приход реал', 'Бонусы', 'ЭПЛ', 'АЗ', 'Расход реал', 'Расход бонус', 'Чистый приход', 'ЗП (×1)'].map((h) => (
              <th key={h} className={`px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap ${th}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthly.map((m, i) => (
            <tr key={i} className={`border-b ${rowBorder} ${i % 2 === 1 ? rowAlt : ''} ${rowHover} transition`}>
              <td className={`px-3 py-2 font-medium whitespace-nowrap ${night ? 'text-slate-100' : 'text-slate-800'}`}>
                {m.month}
              </td>
              <td className={`px-3 py-2 font-mono ${em}`}>{fmt(m.topupReal)}</td>
              <td className={`px-3 py-2 font-mono ${muted}`}>{fmt(m.topupUnreal)}</td>
              <td className={`px-3 py-2 ${td}`}>{m.eplCount}</td>
              <td className={`px-3 py-2 ${td}`}>{m.acCount}</td>
              <td className={`px-3 py-2 font-mono ${red}`}>{fmt(m.spentReal)}</td>
              <td className={`px-3 py-2 font-mono ${muted}`}>{fmt(m.spentUnreal)}</td>
              <td className={`px-3 py-2 font-mono font-medium ${em}`}>{fmt(m.netIncome)}</td>
              <td className={`px-3 py-2 font-mono ${td}`}>{fmt(m.estSalary)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={`font-bold ${footTr}`}>
            <td className={`px-3 py-2.5 ${night ? 'text-slate-100' : 'text-slate-900'}`}>ИТОГО</td>
            <td className={`px-3 py-2.5 font-mono ${em}`}>{fmt(totals.topupReal)}</td>
            <td className={`px-3 py-2.5 font-mono ${muted}`}>{fmt(totals.topupUnreal)}</td>
            <td className={`px-3 py-2.5 ${night ? 'text-slate-200' : ''}`}>{totals.eplCount}</td>
            <td className={`px-3 py-2.5 ${night ? 'text-slate-200' : ''}`}>{totals.acCount}</td>
            <td className={`px-3 py-2.5 font-mono ${red}`}>{fmt(totals.spentReal)}</td>
            <td className={`px-3 py-2.5 font-mono ${muted}`}>{fmt(totals.spentUnreal)}</td>
            <td className={`px-3 py-2.5 font-mono ${em}`}>{fmt(totals.netIncome)}</td>
            <td className={`px-3 py-2.5 font-mono ${night ? 'text-slate-200' : ''}`}>{fmt(totals.estSalary)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
