import React, { useEffect, useState } from 'react';
import api from '../../api';

export default function DirectorParkSettingsTab({ sceneNight = false, parkId = null }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    ogrn: '',
    inn: '',
    kpp: '',
    regionCode: '',
    phone: '',
    eplPrintMode: 'our_then_taxcom',
    balanceDeductionOrder: 'real_first',
    freightAddressEntryMode: 'manager',
    freightDefaultOriginAddress: '',
    freightDefaultLoadAddress: '',
    broadcastRepliesRouting: 'park',
    eplPrice: 25,
    autoClosePrice: 10,
    photoControlEnabled: false,
    photoControlPrice: 150,
    photoControlValidDays: 10,
    photoControlNotifyHoursBefore: 24,
  });

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const params = parkId ? { parkId } : {};
    api
      .get('/director/park/settings', { params })
      .then((res) => {
        if (!mounted) return;
        const d = res.data || {};
        setForm((prev) => ({
          ...prev,
          ogrn: d.ogrn || '',
          inn: d.inn || '',
          kpp: d.kpp || '',
          regionCode: d.regionCode || '',
          phone: d.phone || '',
          eplPrintMode: d.eplPrintMode || 'our_then_taxcom',
          balanceDeductionOrder: d.balanceDeductionOrder || 'real_first',
          freightAddressEntryMode: d.freightAddressEntryMode === 'driver' ? 'driver' : 'manager',
          freightDefaultOriginAddress: d.freightDefaultOriginAddress || '',
          freightDefaultLoadAddress: d.freightDefaultLoadAddress || '',
          broadcastRepliesRouting: d.broadcastRepliesRouting === 'sender' ? 'sender' : 'park',
          eplPrice: d.eplPrice != null ? Number(d.eplPrice) : 25,
          autoClosePrice: d.autoClosePrice != null ? Number(d.autoClosePrice) : 10,
          photoControlEnabled: !!d.photoControlEnabled,
          photoControlPrice: d.photoControlPrice != null ? Number(d.photoControlPrice) : 150,
          photoControlValidDays: d.photoControlValidDays != null ? Number(d.photoControlValidDays) : 10,
          photoControlNotifyHoursBefore:
            d.photoControlNotifyHoursBefore != null ? Number(d.photoControlNotifyHoursBefore) : 24,
        }));
      })
      .catch((e) => {
        alert(e.response?.data?.error || e.message || 'Не удалось загрузить настройки парка');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [parkId]);

  const shell = sceneNight
    ? 'border border-white/12 bg-white/[0.05] text-slate-100'
    : 'border border-slate-200 bg-white text-slate-800';

  const save = async () => {
    try {
      setSaving(true);
      const params = parkId ? { parkId } : {};
      await api.put('/director/park/settings', form, { params });
      alert('Настройки парка сохранены');
    } catch (e) {
      alert(e.response?.data?.error || e.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={`rounded-2xl p-5 ${shell}`}>Загрузка настроек…</div>;

  const inputClass = sceneNight
    ? 'w-full rounded-xl border border-white/20 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400/40'
    : 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/30';

  return (
    <div className={`rounded-2xl p-4 sm:p-5 space-y-4 ${shell}`}>
      <h3 className="text-base font-bold">Настройки парка</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input className={inputClass} placeholder="ОГРН" value={form.ogrn} onChange={(e) => setForm({ ...form, ogrn: e.target.value })} />
        <input className={inputClass} placeholder="ИНН" value={form.inn} onChange={(e) => setForm({ ...form, inn: e.target.value })} />
        <input className={inputClass} placeholder="КПП" value={form.kpp} onChange={(e) => setForm({ ...form, kpp: e.target.value })} />
        <input className={inputClass} placeholder="Код региона" value={form.regionCode} onChange={(e) => setForm({ ...form, regionCode: e.target.value })} />
        <input className={inputClass} placeholder="Телефон парка" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <select className={inputClass} value={form.eplPrintMode} onChange={(e) => setForm({ ...form, eplPrintMode: e.target.value })}>
          <option value="our_then_taxcom">Печать: наш PDF, затем Такском</option>
          <option value="our_only">Печать: только наш PDF</option>
          <option value="taxcom_only">Печать: только Такском</option>
        </select>
        <select className={inputClass} value={form.balanceDeductionOrder} onChange={(e) => setForm({ ...form, balanceDeductionOrder: e.target.value })}>
          <option value="real_first">Списание: сначала реал</option>
          <option value="unreal_first">Списание: сначала фантики</option>
        </select>
        <select className={inputClass} value={form.freightAddressEntryMode} onChange={(e) => setForm({ ...form, freightAddressEntryMode: e.target.value })}>
          <option value="manager">Адреса заполняет менеджер</option>
          <option value="driver">Адреса может вводить водитель</option>
        </select>
        <select className={inputClass} value={form.broadcastRepliesRouting} onChange={(e) => setForm({ ...form, broadcastRepliesRouting: e.target.value })}>
          <option value="park">Ответы на рассылки — в парк</option>
          <option value="sender">Ответы на рассылки — отправителю</option>
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <input
          className={inputClass}
          placeholder="Адрес отправления по умолчанию"
          value={form.freightDefaultOriginAddress}
          onChange={(e) => setForm({ ...form, freightDefaultOriginAddress: e.target.value })}
        />
        <input
          className={inputClass}
          placeholder="Адрес погрузки по умолчанию"
          value={form.freightDefaultLoadAddress}
          onChange={(e) => setForm({ ...form, freightDefaultLoadAddress: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <input className={inputClass} type="number" min="0" placeholder="Цена ЭПЛ" value={form.eplPrice} onChange={(e) => setForm({ ...form, eplPrice: Number(e.target.value || 0) })} />
        <input className={inputClass} type="number" min="0" placeholder="Автозакрытие" value={form.autoClosePrice} onChange={(e) => setForm({ ...form, autoClosePrice: Number(e.target.value || 0) })} />
        <input className={inputClass} type="number" min="1" placeholder="ФК цена" value={form.photoControlPrice} onChange={(e) => setForm({ ...form, photoControlPrice: Number(e.target.value || 0) })} />
        <input className={inputClass} type="number" min="1" placeholder="ФК дней" value={form.photoControlValidDays} onChange={(e) => setForm({ ...form, photoControlValidDays: Number(e.target.value || 1) })} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!form.photoControlEnabled}
          onChange={(e) => setForm({ ...form, photoControlEnabled: e.target.checked })}
        />
        Включить фотоконтроль
      </label>

      <div className="pt-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-teal-800 text-white text-sm font-semibold disabled:opacity-60"
        >
          {saving ? 'Сохраняем…' : 'Сохранить настройки'}
        </button>
      </div>
    </div>
  );
}
