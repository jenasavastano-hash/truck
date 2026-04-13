import React, { useState, useEffect, useCallback } from 'react';
import { Store, Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../../api';
import { getRoleApiPrefix } from '../../api/managerApi';

/**
 * Справочник «магазины» / точки выгрузки парка.
 * @param {boolean} [props.useAdminApi] — true: запросы к /api/admin/parks/:parkId/…
 */
export default function FreightStoresTab({ parkId, sceneNight = false, useAdminApi = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', addressText: '', contactNote: '', sortOrder: 0 });
  const [editingId, setEditingId] = useState(null);

  const shell = sceneNight
    ? 'border border-white/15 bg-white/[0.06] text-slate-100'
    : 'border border-slate-200 bg-white text-slate-800';

  const load = useCallback(async () => {
    if (!parkId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (useAdminApi) {
        const res = await api.get(`/admin/parks/${parkId}/freight-stores`);
        setRows(res.data || []);
      } else {
        const prefix = getRoleApiPrefix();
        const res = await api.get(`/${prefix}/freight-stores`, { params: { parkId } });
        setRows(Array.isArray(res.data) ? res.data : []);
      }
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [parkId, useAdminApi]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setForm({ name: '', addressText: '', contactNote: '', sortOrder: 0 });
    setEditingId(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!parkId) return;
    const name = form.name.trim();
    const addressText = form.addressText.trim();
    if (!name || !addressText) return;
    setSaving(true);
    try {
      const prefix = getRoleApiPrefix();
      if (useAdminApi) {
        if (editingId) {
          await api.put(`/admin/parks/${parkId}/freight-stores/${editingId}`, {
            name,
            addressText,
            contactNote: form.contactNote.trim() || null,
            sortOrder: Number(form.sortOrder) || 0,
            isActive: 1,
          });
        } else {
          await api.post(`/admin/parks/${parkId}/freight-stores`, {
            name,
            addressText,
            contactNote: form.contactNote.trim() || null,
            sortOrder: Number(form.sortOrder) || 0,
          });
        }
      } else if (editingId) {
        await api.put(`/${prefix}/freight-stores/${editingId}`, {
          name,
          addressText,
          contactNote: form.contactNote.trim() || null,
          sortOrder: Number(form.sortOrder) || 0,
          isActive: 1,
        }, { params: { parkId } });
      } else {
        await api.post(`/${prefix}/freight-stores`, {
          name,
          addressText,
          contactNote: form.contactNote.trim() || null,
          sortOrder: Number(form.sortOrder) || 0,
        }, { params: { parkId } });
      }
      resetForm();
      await load();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (r) => {
    setEditingId(r.id);
    setForm({
      name: r.name || '',
      addressText: r.addressText || '',
      contactNote: r.contactNote || '',
      sortOrder: r.sortOrder ?? 0,
    });
  };

  const remove = async (id) => {
    if (!window.confirm('Удалить точку из справочника?')) return;
    try {
      if (useAdminApi) {
        await api.delete(`/admin/parks/${parkId}/freight-stores/${id}`);
      } else {
        const prefix = getRoleApiPrefix();
        await api.delete(`/${prefix}/freight-stores/${id}`, { params: { parkId } });
      }
      if (editingId === id) resetForm();
      await load();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  };

  if (!parkId) {
    return <p className={`text-sm ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>Выберите парк.</p>;
  }

  return (
    <div className="space-y-4">
      <p className={`text-xs sm:text-sm ${sceneNight ? 'text-slate-400' : 'text-slate-600'}`}>
        Сохраняйте сюда адреса магазинов и точек выгрузки — потом их можно подставлять в ЭПЛ и в Такском (список доступен водителю в приложении через API). Отправление и погрузка часто совпадают с базой парка; в справочнике удобнее держать именно <strong>выгрузки</strong>.
      </p>

      <form onSubmit={submit} className={`rounded-xl p-3 sm:p-4 space-y-3 ${shell}`}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Store className="w-4 h-4" />
          {editingId ? 'Редактирование точки' : 'Новая точка'}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs font-medium opacity-80">Название</span>
            <input
              className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
                sceneNight ? 'border-white/20 bg-white/10' : 'border-slate-200 bg-white'
              }`}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Магазин X"
              required
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium opacity-80">Порядок сортировки</span>
            <input
              type="number"
              className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
                sceneNight ? 'border-white/20 bg-white/10' : 'border-slate-200 bg-white'
              }`}
              value={form.sortOrder}
              onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-medium opacity-80">Адрес одной строкой (как в Такском)</span>
          <input
            className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
              sceneNight ? 'border-white/20 bg-white/10' : 'border-slate-200 bg-white'
            }`}
            value={form.addressText}
            onChange={(e) => setForm((f) => ({ ...f, addressText: e.target.value }))}
            placeholder="индекс, город, улица, дом"
            required
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium opacity-80">Комментарий (необязательно)</span>
          <input
            className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
              sceneNight ? 'border-white/20 bg-white/10' : 'border-slate-200 bg-white'
            }`}
            value={form.contactNote}
            onChange={(e) => setForm((f) => ({ ...f, contactNote: e.target.value }))}
            placeholder="время работы, контакт"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {editingId ? 'Сохранить' : 'Добавить'}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="px-4 py-2 rounded-lg border border-slate-300 text-sm">
              Отмена
            </button>
          )}
        </div>
      </form>

      <div className={`rounded-xl overflow-hidden ${shell}`}>
        {loading ? (
          <div className="p-6 text-center text-sm opacity-70">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm opacity-70">Пока нет точек. Добавьте первую.</div>
        ) : (
          <ul className="divide-y divide-slate-200/30">
            {rows.map((r) => (
              <li key={r.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div>
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-sm opacity-90 mt-0.5">{r.addressText}</div>
                  {r.contactNote ? <div className="text-xs opacity-70 mt-1">{r.contactNote}</div> : null}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(r)}
                    className="p-2 rounded-lg border border-slate-300/50 hover:bg-white/10"
                    title="Изменить"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    className="p-2 rounded-lg border border-red-300/40 text-red-600 hover:bg-red-50"
                    title="Удалить"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
