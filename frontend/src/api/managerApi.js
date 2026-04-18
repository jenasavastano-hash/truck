import axios from 'axios';
import { getResolvedApiRoot } from '../utils/apiRoot';

export function getRoleApiPrefix() {
  try {
    const saved = localStorage.getItem('user');
    if (!saved) return 'manager';
    const u = JSON.parse(saved);
    return u?.role === 'director' ? 'director' : 'manager';
  } catch (_) {
    return 'manager';
  }
}

function getApiBase() {
  const prefix = getRoleApiPrefix();
  return `${getResolvedApiRoot()}/${prefix}`;
}

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

// === СПИСОК ПАРКОВ МЕНЕДЖЕРА ===
export const getManagerParks = async () => {
  const res = await axios.get(`${getApiBase()}/parks`, {
    headers: getAuthHeader()
  });
  return res.data;
};

// === STATISTICS ===
export const getStatistics = async (parkId, period = 'today', extra = {}) => {
  const res = await axios.get(`${getApiBase()}/statistics`, {
    params: { ...(parkId ? { parkId } : {}), period, ...extra },
    headers: getAuthHeader()
  });
  return res.data;
};

// === DASHBOARD ===
export const getDashboard = async (parkId) => {
  const res = await axios.get(`${getApiBase()}/dashboard`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

// === CARS ===
export const getCars = async (parkId) => {
  const res = await axios.get(`${getApiBase()}/cars`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const searchCars = async (query, parkId) => {
  const res = await axios.get(`${getApiBase()}/cars/search`, {
    params: { q: query, ...(parkId ? { parkId } : {}) },
    headers: getAuthHeader()
  });
  return res.data;
};

export const getCarDetail = async (carId, parkId) => {
  const res = await axios.get(`${getApiBase()}/cars/${carId}`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const addCar = async (carData, parkId) => {
  const res = await axios.post(`${getApiBase()}/cars`, carData, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const updateCar = async (carId, carData, parkId) => {
  const res = await axios.put(`${getApiBase()}/cars/${carId}`, carData, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const deleteCar = async (carId, parkId) => {
  const res = await axios.delete(`${getApiBase()}/cars/${carId}`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

// === DRIVERS ===
export const getDrivers = async (parkId) => {
  const res = await axios.get(`${getApiBase()}/drivers`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const searchDrivers = async (query, parkId) => {
  const res = await axios.get(`${getApiBase()}/drivers/search`, {
    params: { q: query, ...(parkId ? { parkId } : {}) },
    headers: getAuthHeader()
  });
  return res.data;
};

export const getDriverDetail = async (driverId, parkId) => {
  const res = await axios.get(`${getApiBase()}/drivers/${driverId}`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const addDriver = async (driverData, parkId) => {
  const res = await axios.post(`${getApiBase()}/drivers`, driverData, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const updateDriver = async (driverId, driverData, parkId) => {
  const res = await axios.put(`${getApiBase()}/drivers/${driverId}`, driverData, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const deleteDriver = async (driverId, parkId) => {
  const res = await axios.delete(`${getApiBase()}/drivers/${driverId}`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

// Доступы менеджера (вкл/выкл в админке)
export const getPermissions = async (parkId) => {
  const res = await axios.get(`${getApiBase()}/permissions`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

// === SHIFT OPEN REQUESTS (manager/director) ===
export const getShiftOpenRequests = async (params = {}) => {
  const res = await axios.get(`${getApiBase()}/shift-open-requests`, {
    params,
    headers: getAuthHeader(),
  });
  return res.data;
};

export const approveShiftOpenRequest = async (requestId, payload = {}) => {
  const res = await axios.post(`${getApiBase()}/shift-open-requests/${requestId}/approve`, payload, {
    headers: getAuthHeader(),
  });
  return res.data;
};

export const rejectShiftOpenRequest = async (requestId, payload = {}) => {
  const res = await axios.post(`${getApiBase()}/shift-open-requests/${requestId}/reject`, payload, {
    headers: getAuthHeader(),
  });
  return res.data;
};

export const getShiftPlans = async (params = {}) => {
  const res = await axios.get(`${getApiBase()}/shift-plans`, {
    params,
    headers: getAuthHeader(),
  });
  return res.data;
};

export const upsertShiftPlan = async (payload = {}) => {
  const res = await axios.post(`${getApiBase()}/shift-plans`, payload, {
    headers: getAuthHeader(),
  });
  return res.data;
};

export const cancelShiftPlan = async (planId) => {
  const res = await axios.post(`${getApiBase()}/shift-plans/${planId}/cancel`, {}, {
    headers: getAuthHeader(),
  });
  return res.data;
};

// Действия по водителям (если есть доступ)
export const driverTopupBalance = async (userId, amount, amountType = 'real', parkId) => {
  const res = await axios.post(`${getApiBase()}/drivers/${userId}/balance`, { amount, amountType }, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const driverFine = async (userId, amount, description = 'Штраф', parkId) => {
  const res = await axios.post(`${getApiBase()}/drivers/${userId}/fine`, { amount, description }, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const driverDismiss = async (userId, parkId) => {
  const res = await axios.post(`${getApiBase()}/drivers/${userId}/dismiss`, {}, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const driverRemoveFromSystem = async (userId, parkId) => {
  const res = await axios.delete(`${getApiBase()}/drivers/${userId}/remove`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

/** Войти от имени водителя своего парка (токен на 1 ч). Для кнопки «Режим: Водитель». */
export const impersonateDriver = async (driverUserId, parkId) => {
  const res = await axios.post(`${getApiBase()}/impersonate-driver/${driverUserId}`, {}, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

// === ЭПЛ (путевые листы) ===
// filters: { group, waybillNumber, driverName, regNumber }
export const getEplList = async (parkId, filters = {}) => {
  const res = await axios.get(`${getApiBase()}/epl`, {
    params: {
      ...(parkId ? { parkId } : {}),
      ...(filters?.group ? { group: filters.group } : {}),
      ...(filters?.waybillNumber ? { waybillNumber: filters.waybillNumber } : {}),
      ...(filters?.driverName ? { driverName: filters.driverName } : {}),
      ...(filters?.regNumber ? { regNumber: filters.regNumber } : {}),
    },
    headers: getAuthHeader()
  });
  return res.data;
};

export const getEplLogs = async (eplId, parkId) => {
  const res = await axios.get(`${getApiBase()}/epl/${eplId}/logs`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const requeueEplQr = async (eplId, parkId) => {
  const res = await axios.post(`${getApiBase()}/epl/${eplId}/requeue-qr`, {}, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const requeueEplCreation = async (eplId, parkId) => {
  const res = await axios.post(`${getApiBase()}/epl/${eplId}/requeue-creation`, {}, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

/** Завершить рейс без водителя. endOdometer опционально — если не передан, подставится startOdometer + 50 км. Т6 не заполняем. */
export const completeEplWithoutDriver = async (eplId, endOdometer, parkId) => {
  const res = await axios.post(
    `${getApiBase()}/epl/${eplId}/complete-without-driver`,
    endOdometer != null ? { endOdometer } : {},
    { params: parkId ? { parkId } : {}, headers: getAuthHeader() }
  );
  return res.data;
};

// === ФОТОКОНТРОЛЬ ===
export const getPhotoControlApplications = async (status, parkId) => {
  const res = await axios.get(`${getApiBase()}/photo-control/applications`, {
    params: { ...(status ? { status } : {}), ...(parkId ? { parkId } : {}) },
    headers: getAuthHeader()
  });
  return res.data;
};

// Закрыть смену по ЭПЛ без списания (менеджер)
export const closeShiftByManager = async (eplId, parkId) => {
  const res = await axios.post(
    `${getApiBase()}/epl/${eplId}/close-shift`,
    {},
    { params: parkId ? { parkId } : {}, headers: getAuthHeader() }
  );
  return res.data;
};

// Закрыть смену по ЭПЛ со списанием (менеджер)
export const closeShiftWithChargeByManager = async (eplId, amount, comment, parkId) => {
  const payload = { amount };
  if (comment && comment.trim()) payload.comment = comment.trim();
  const res = await axios.post(
    `${getApiBase()}/epl/${eplId}/close-shift-with-charge`,
    payload,
    { params: parkId ? { parkId } : {}, headers: getAuthHeader() }
  );
  return res.data;
};

// Скачать наш PDF (fast) по ЭПЛ для менеджера
export const downloadEplFastPdf = async (eplId, parkId) => {
  const res = await axios.get(`${getApiBase()}/epl/${eplId}/document-fast`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader(),
    responseType: 'blob',
  });
  return res;
};

// Скачать Минтранс PDF по ЭПЛ для менеджера
export const downloadEplMintransPdf = async (eplId, parkId) => {
  const res = await axios.get(`${getApiBase()}/epl/${eplId}/document-mintrans`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader(),
    responseType: 'blob',
  });
  return res;
};

// Получить QR Минтранса (documentQr) по ЭПЛ для менеджера
export const getEplMintransQr = async (eplId, parkId) => {
  const res = await axios.get(`${getApiBase()}/epl/${eplId}/qr-mintrans`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader(),
  });
  return res.data;
};

export const getPhotoControlApplication = async (id, parkId) => {
  const res = await axios.get(`${getApiBase()}/photo-control/applications/${id}`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const approvePhotoControl = async (id, parkId) => {
  const res = await axios.patch(`${getApiBase()}/photo-control/applications/${id}/approve`, {}, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const rejectPhotoControl = async (id, reason, parkId) => {
  const res = await axios.patch(`${getApiBase()}/photo-control/applications/${id}/reject`, { reason }, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const setPhotoControlStepVerdicts = async (id, steps, parkId) => {
  const res = await axios.patch(`${getApiBase()}/photo-control/applications/${id}/steps`, { steps }, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

export const requestPhotoControlCorrection = async (id, parkId) => {
  const res = await axios.patch(`${getApiBase()}/photo-control/applications/${id}/request-correction`, {}, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader()
  });
  return res.data;
};

// ===== РАССЫЛКИ (мониторинг + уведомления) =====

export const getDriversMonitoring = async (meta = {}, parkId) => {
  const res = await axios.get(`${getApiBase()}/drivers/monitoring`, {
    params: { ...(meta || {}), ...(parkId ? { parkId } : {}) },
    headers: getAuthHeader(),
  });
  return res.data;
};

export const getDriversMonitoringIds = async (meta = {}, parkId) => {
  const res = await axios.get(`${getApiBase()}/drivers/monitoring/ids`, {
    params: { ...(meta || {}), ...(parkId ? { parkId } : {}) },
    headers: getAuthHeader(),
  });
  return res.data;
};

export const sendDriversBroadcast = async (userIds, title, body, parkId, options = {}) => {
  const res = await axios.post(
    `${getApiBase()}/drivers/broadcast`,
    { userIds, title, body, ...(options || {}) },
    { params: parkId ? { parkId } : {}, headers: getAuthHeader() }
  );
  return res.data;
};

export const getBroadcastTemplates = async (parkId) => {
  const res = await axios.get(`${getApiBase()}/broadcast-templates`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader(),
  });
  return res.data;
};

export const createBroadcastTemplate = async (title, body, parkId) => {
  const res = await axios.post(
    `${getApiBase()}/broadcast-templates`,
    { title, body },
    { params: parkId ? { parkId } : {}, headers: getAuthHeader() }
  );
  return res.data;
};

export const updateBroadcastTemplate = async (id, title, body, parkId) => {
  const res = await axios.put(
    `${getApiBase()}/broadcast-templates/${id}`,
    { title, body },
    { params: parkId ? { parkId } : {}, headers: getAuthHeader() }
  );
  return res.data;
};

export const deleteBroadcastTemplate = async (id, parkId) => {
  const res = await axios.delete(`${getApiBase()}/broadcast-templates/${id}`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader(),
  });
  return res.data;
};

// ===== ТРЕДЫ РАССЫЛОК (inbox ответов) =====

export const getBroadcastThreads = async (filters = {}, parkId) => {
  const res = await axios.get(`${getApiBase()}/broadcast-threads`, {
    params: { ...(filters || {}), ...(parkId ? { parkId } : {}) },
    headers: getAuthHeader(),
  });
  return res.data;
};

// ===== Точки выгрузки / «магазины» (справочник парка) =====

export const getFreightStores = async (parkId) => {
  const res = await axios.get(`${getApiBase()}/freight-stores`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader(),
  });
  return res.data;
};

export const createFreightStore = async (parkId, body) => {
  const res = await axios.post(`${getApiBase()}/freight-stores`, body, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader(),
  });
  return res.data;
};

export const updateFreightStore = async (parkId, storeId, body) => {
  const res = await axios.put(`${getApiBase()}/freight-stores/${storeId}`, body, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader(),
  });
  return res.data;
};

export const deleteFreightStore = async (parkId, storeId) => {
  const res = await axios.delete(`${getApiBase()}/freight-stores/${storeId}`, {
    params: parkId ? { parkId } : {},
    headers: getAuthHeader(),
  });
  return res.data;
};
