/**
 * Такском-Транспорт API интеграция
 * Документация: API v2.0
 * Базовый URL: https://api-epl.taxcom.ru/v1.1/
 * Аутентификация: Bearer токен в заголовке Authorization
 *
 * Сайт собирает данные (парк, авто, водители) → по API создаёт ЭПЛ для водителей.
 * Титулы Т1–Т6 заполняются через методы createEPL, addTitle2–addTitle6.
 * Подписание документов своими ключами (медик, механик, диспетчер) — по API/документации Такском
 * (эндпоинты подписания и передача сертификатов/ключей).
 *
 * === СВОДКА: ЧТО КУДА ИДЁТ ПО ТИТУЛАМ ===
 *
 * Т1 (createEPL / POST /epl/add):
 *   - driver: ФИО, ВУ (серия, номер, дата DD.MM.YYYY), табельный, ИНН — из профиля ВОДИТЕЛЯ.
 *   - vehicle: марка, модель, госномер — из привязки АВТО водителя.
 *   - address, issuePerson: парк (адрес, OGRN и т.д.).
 *   - signature: ФИО и должность ДИСПЕТЧЕРА из park_staff (role=dispatcher).
 *
 * Т2 (addTitle2 / POST .../t2) — предрейсовый медосмотр:
 *   - driver: ФИО и ВУ ВОДИТЕЛЯ (licenseSerial/Number/Date), personnelNumber, inn.
 *   - medic: ФИО и должность МЕДИКА из park_staff; license — лицензия МЕДИКА (serial, number, dateStart/End YYYY-MM-DD).
 *   - inspection: дата, время HH:MM, результат.
 *
 * Т3 (addTitle3 / POST .../t3) — техконтроль:
 *   - technic: ФИО и должность МЕХАНИКА из park_staff.
 *   - vehicle: Type, Brand, Model, RegistrationNumber — из авто водителя.
 *   - examination, trip: дата, время HH:MM.
 *
 * Т4 (addTitle4 / POST .../t4) — одометр выезда:
 *   - odometer: startDate, startTime (HH:MM), value (пробег при выезде). Без authorized/signature.
 *
 * Т5 (addTitle5 / POST .../t5) — одометр заезда (завершение рейса):
 *   - odometer: дата, время HH:MM, value (пробег при заезде).
 *   - authorized: ФИО и должность МЕХАНИКА из park_staff (authorizedName).
 *
 * Т6 (addTitle6 / POST .../t6) — послерейсовый медосмотр:
 *   - driver: ФИО и ВУ ВОДИТЕЛЯ, personnelNumber, inn.
 *   - medic: ФИО и должность МЕДИКА из park_staff; license — лицензия МЕДИКА (из park_staff при complete).
 *   - inspection: дата, время, результат.
 */

const axios = require('axios');
require('dotenv').config();

const TAKSKOM_API_BASE = process.env.TAKSKOM_API_BASE || 'https://api-epl.taxcom.ru/v1.1/';
const API_KEY = process.env.TAKSKOM_API_KEY || process.env.TAKSKOM_TOKEN || '';
const TAKSKOM_TIMEOUT = Math.max(15000, parseInt(process.env.TAKSKOM_TIMEOUT, 10) || 60000);

// Логирование для отладки
const DEBUG = process.env.DEBUG_TAKSKOM === 'true';

// Сетевые ошибки, при которых имеет смысл повторить запрос (интерцептор подменяет error, поэтому смотрим message)
const isRetryableNetworkError = (err) => {
  const msg = (err && err.message) ? String(err.message) : '';
  return msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED');
};

// Создаем axios инстанс с правильной конфигурацией
const takskAxios = axios.create({
  baseURL: TAKSKOM_API_BASE,
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  timeout: TAKSKOM_TIMEOUT
});

// Логирование запросов
takskAxios.interceptors.request.use(
  config => {
    if (DEBUG) {
      console.log(`[Takskom Request] ${config.method.toUpperCase()} ${config.url}`);
      if (config.data) console.log(`[Takskom Data]`, JSON.stringify(config.data, null, 2));
    }
    return config;
  },
  error => Promise.reject(error)
);

// Обработчик ошибок
takskAxios.interceptors.response.use(
  response => {
    if (DEBUG) {
      console.log(`[Takskom Response] Status ${response.status}`);
      console.log(`[Takskom Response Data]`, JSON.stringify(response.data, null, 2));
    }
    return response.data;
  },
  error => {
    const errorData = error.response?.data || error.message;
    const errorMsg = error.response?.data?.errors?.[0]?.message || error.message;
    // Проверяем, что customErrors - массив
    const customErrorsRaw = error.response?.data?.errors?.[0]?.customData?.errors;
    const customErrors = Array.isArray(customErrorsRaw) ? customErrorsRaw : [];
    const details = customErrors.map(e => e.text || e.code || JSON.stringify(e)).filter(Boolean).join('; ');
    const fullMsg = details ? `${errorMsg}: ${details}` : errorMsg;

    console.error(`[Takskom API Error] Status ${error.response?.status || 'N/A'}:`, fullMsg);
    console.error(`[Takskom Error Response]`, JSON.stringify(errorData, null, 2));
    if (error.response?.data?.errors) {
      console.error(`[Takskom Validation Errors]`, JSON.stringify(error.response.data.errors, null, 2));
    }
    if (error.config?.data) {
      console.error(`[Takskom Request Payload (that failed)]:`, JSON.stringify(JSON.parse(error.config.data), null, 2));
    }
    // Логируем полный ответ для отладки
    if (error.response) {
      console.error(`[Takskom Full Error Response Headers]`, error.response.headers);
      console.error(`[Takskom Full Error Response Status]`, error.response.status);
      console.error(`[Takskom Full Error Response Data]`, JSON.stringify(error.response.data, null, 2));
    }

    throw new Error(fullMsg);
  }
);

class TakskornAPI {
  /**
   * GET /info - Получение данных участника
   * Используется для проверки валидности токена и получения доступных парков
   */
  static async getInfo() {
    try {
      const response = await takskAxios.get('/info');
      
      // Парки по доке в data.carParks; допускаем и верхний уровень
      let carParks = response.data?.carParks ?? response.carParks ?? response.data;
      if (!Array.isArray(carParks)) {
        carParks = [];
      }
      
      console.log(`[Takskom] getInfo found ${carParks.length} car parks`);
      
      return {
        success: true,
        token: response.token,
        memberId: response.token?.memberId,
        carParks: carParks,
        rawResponse: response
      };
    } catch (error) {
      console.error('[Takskom] getInfo error:', error.message);
      throw error;
    }
  }

  /**
   * Создание автопарка в Такском — в API v2.0.3 не предусмотрено.
   * Парки только получают через GET /info (carParks) и привязывают локально.
   * Метод оставлен для совместимости; вызов приведёт к ошибке от API.
   */
  static async createPark(payload) {
    try {
      console.warn('[Takskom] createPark: API Такском не поддерживает создание парков (v2.0.3). Используйте привязку к существующему автопарку из GET /info.');
      const response = await takskAxios.post('/carparks', payload);
      
      // Ищем ID в разных полях ответа
      let carParkId = null;
      if (response.id) carParkId = response.id;
      else if (response.carParkId) carParkId = response.carParkId;
      else if (response.memberId) carParkId = response.memberId;
      else if (response.carParks && response.carParks.length > 0) carParkId = response.carParks[0].id;
      
      console.log(`[Takskom] createPark response keys: ${Object.keys(response).join(', ')}`);
      console.log(`[Takskom] Extracted carParkId: ${carParkId}`);
      
      return { 
        success: true, 
        carParkId: carParkId,
        id: carParkId,
        rawResponse: response 
      };
    } catch (error) {
      console.error('[Takskom] createPark error (best-effort):', error.message);
      throw error;
    }
  }

  /**
   * Обновление автопарка в Такском — в API v2.0.3 не предусмотрено.
   * Используйте привязку парка к существующему автопарку из GET /info.
   */
  static async updatePark(carParkId, payload) {
    try {
      console.log(`[Takskom] Updating car park ${carParkId}`);
      const response = await takskAxios.put(`/carparks/${carParkId}`, payload);
      return { success: true, rawResponse: response };
    } catch (error) {
      console.error('[Takskom] updatePark error (best-effort):', error.message);
      throw error;
    }
  }

  /**
   * POST /epl/add - Создание ЭПЛ (Титул 1)
   * ВАЖНО: Это создает только основные данные!
   * Остальные титулы должны добавляться отдельными запросами
   */
  static async createEPL(payload) {
    const maxAttempts = 3;
    const retryDelayMs = 3000;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[Takskom] Creating EPL for waybill: ${payload.waybillNumber} (попытка ${attempt}/${maxAttempts})`);
        if (attempt === 1) {
          console.log(`[Takskom] Full payload being sent:`, JSON.stringify(payload, null, 2));
        }
        const response = await takskAxios.post('/epl/add', payload);
        // Interceptor возвращает response.data, поэтому response здесь — тело ответа
        const result = response?.data?.result || response?.result || {};
        const eplId = result.id ?? response?.data?.id ?? response?.id;
        const eplGuid = result.guid ?? response?.data?.result?.guid;
        console.log(`[Takskom] EPL created successfully, id: ${eplId}, guid: ${eplGuid}`);
        if (!eplId) {
          console.error(`[Takskom] Warning: Could not extract id from response:`, JSON.stringify(response, null, 2));
        }
        return {
          success: true,
          mintransId: eplId,
          eplGuid: eplGuid,
          eplId: eplId,
          waybillNumber: payload.waybillNumber,
          status: response?.status ?? response?.data?.status,
          rawResponse: response
        };
      } catch (error) {
        lastError = error;
        const retryable = isRetryableNetworkError(error) && attempt < maxAttempts;
        if (retryable) {
          console.warn(`[Takskom] createEPL попытка ${attempt} не удалась (${error.message}), повтор через ${retryDelayMs / 1000} с...`);
          await new Promise(r => setTimeout(r, retryDelayMs));
        } else {
          console.error(`[Takskom] createEPL error for ${payload.waybillNumber}:`, error.message);
          throw error;
        }
      }
    }
    throw lastError;
  }

  /**
   * Helper: Формирование объекта ФИО
   */
  static _formatFio(fullName) {
    const fioParts = (fullName || '').trim().split(/\s+/);
    return {
      lastName: (fioParts[0] || '').trim() || '-',
      name: (fioParts[1] || '').trim() || '-',
      secondName: (fioParts[2] || '').trim() || '-'
    };
  }

  /**
   * API Такском: время должно соответствовать regex ^([01][0-9]|2[0-3]):[0-5][0-9]$ — только HH:MM (без секунд).
   */
  static _timeHHMM(timeStr) {
    if (!timeStr) return new Date().toTimeString().split(' ')[0].slice(0, 5);
    const s = String(timeStr).trim();
    if (s.match(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)) return s.slice(0, 5);
    if (s.match(/^([01][0-9]|2[0-3]):[0-5][0-9]:/)) return s.slice(0, 5);
    return new Date().toTimeString().split(' ')[0].slice(0, 5);
  }

  /**
   * Формат лицензии медика для Т2/Т6: API ожидает serial, number, dateStart, dateEnd (lowercase).
   * dateEnd — дата окончания действия; при отсутствии берём +10 лет от dateStart.
   * API требует даты в формате YYYY-MM-DD (не DD.MM.YYYY).
   */
  static _medicLicenseFormat(licenseSerial, licenseNumber, licenseDate) {
    const serial = (licenseSerial || '77 АВ').trim();
    const number = (licenseNumber || '000000').trim();
    let dateStartRaw = (licenseDate || '01.01.2000').trim();
    let dateStart = '2000-01-01';
    let dateEnd = '2030-01-01';
    const m = dateStartRaw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (m) {
      const day = m[1];
      const month = m[2];
      const year = m[3];
      dateStart = `${year}-${month}-${day}`;
      const y = parseInt(year, 10) + 10;
      dateEnd = `${y}-${month}-${day}`;
    } else if (dateStartRaw.match(/^\d{4}-\d{2}-\d{2}$/)) {
      dateStart = dateStartRaw;
      const parts = dateStartRaw.split('-');
      const y = parseInt(parts[0], 10) + 10;
      dateEnd = `${y}-${parts[1]}-${parts[2]}`;
    }
    return { serial, number, dateStart, dateEnd };
  }

  /**
   * Helper: Формирование объекта подписи
   */
  static _formatSignature(fullName, position = 'Диспетчер') {
    return {
      Fio: this._formatFio(fullName),
      Position: position,
      Type: '1',
      PowersType: '1'
    };
  }

  /**
   * POST /epl/add/{mintransId}/t2 - Добавление Титула 2 (предрейсовый медосмотр)
   * API требует medic с ключами fio, position, license (lowercase); время HH:MM (без секунд).
   */
  static async addTitle2(mintransId, payload) {
    try {
      console.log(`[Takskom] Adding Title 2 (medical pre-exam) to ${mintransId}`);
      const examDate = payload.examDate || new Date().toISOString().split('T')[0];
      const examTime = this._timeHHMM(payload.examTime);
      const driverFio = payload.driver?.Fio || this._formatFio(payload.driverName || 'Водитель');
      const driverLicense = payload.driver?.License || {
        LicenseSerial: payload.licenseSerial || '77 АВ',
        LicenseNumber: payload.licenseNumber || '000000',
        LicenseDate: payload.licenseDate || '01.01.2000'
      };
      const medicLicense = (payload.medic && typeof payload.medic.license === 'object') ? payload.medic.license : this._medicLicenseFormat(
        payload.licenseSerial || driverLicense.LicenseSerial,
        payload.licenseNumber || driverLicense.LicenseNumber,
        payload.licenseDate || driverLicense.LicenseDate
      );
      // API Такском: только lowercase fio, position (не Fio/Position)
      const medic = {
        fio: this._formatFio(payload.medicName || 'Медицинский работник'),
        position: (payload.medicPosition || 'Медицинский работник').trim() || 'Медицинский работник',
        license: medicLicense
      };
      const fullPayload = {
        medicalExaminationType: payload.medicalExaminationType || '2',
        medicType: payload.medicType || 'COMPANY',
        medic,
        inspection: {
          result: payload.examResult === 'suitable' || payload.examResult === 'ALLOWED' ? 'ALLOWED' : 'NOT_ALLOWED',
          date: examDate,
          time: examTime
        },
        driver: payload.driver || {
          Fio: driverFio,
          License: driverLicense,
          PersonnelNumber: payload.personnelNumber || payload.driver?.PersonnelNumber || '000000',
          Inn: payload.inn || payload.driver?.Inn || '000000000000'
        },
        signature: payload.signature || this._formatSignature(payload.medicName || 'Медицинский работник', 'Медицинский работник')
      };
      console.log(`[Takskom] T2 payload:`, JSON.stringify(fullPayload, null, 2));
      const response = await takskAxios.post(`/epl/add/${mintransId}/t2`, fullPayload);
      console.log(`[Takskom] T2 response:`, JSON.stringify(response, null, 2));
      return { success: true, message: 'Title 2 added', rawResponse: response };
    } catch (error) {
      console.error(`[Takskom] addTitle2 error:`, error.message);
      if (error.response) {
        console.error(`[Takskom] T2 error response:`, JSON.stringify(error.response.data || error.response, null, 2));
      }
      throw error;
    }
  }

  /**
   * POST /epl/add/{mintransId}/t3 - Добавление Титула 3 (техконтроль)
   * API ожидает: examination/trip время HH:MM; technic с fio, position (lowercase); vehicle — объект (Type, Brand, Model, RegistrationNumber).
   */
  static async addTitle3(mintransId, payload) {
    try {
      console.log(`[Takskom] Adding Title 3 (tech control) to ${mintransId}`);
      const recordDate = payload.examDate || new Date().toISOString().split('T')[0];
      const recordTime = this._timeHHMM(payload.examTime);
      const technicFio = this._formatFio(payload.technicName || 'Механик');
      const vehicleObj = payload.vehicle && typeof payload.vehicle === 'object' && !Array.isArray(payload.vehicle)
        ? payload.vehicle
        : {
            Type: (payload.vehicleType || '1').toString(),
            Brand: (payload.vehicleBrand || '').trim() || '-',
            Model: (payload.vehicleModel || '').trim() || '-',
            RegistrationNumber: (payload.vehicleRegistrationNumber || '').replace(/\s+/g, '') || '-'
          };
      const fullPayload = {
        examination: {
          result: payload.examResult === 'suitable' || payload.examResult === '1' ? '1' : '2',
          date: recordDate,
          time: recordTime
        },
        trip: {
          startDate: recordDate,
          startTime: recordTime
        },
        technic: payload.technic || {
          fio: technicFio,
          position: payload.technicPosition || 'Механик'
        },
        vehicle: vehicleObj,
        signature: payload.signature || this._formatSignature(payload.technicName || 'Механик', 'Механик')
      };
      console.log(`[Takskom] T3 payload:`, JSON.stringify(fullPayload, null, 2));
      const response = await takskAxios.post(`/epl/add/${mintransId}/t3`, fullPayload);
      console.log(`[Takskom] T3 response:`, JSON.stringify(response, null, 2));
      return { success: true, message: 'Title 3 added', rawResponse: response };
    } catch (error) {
      console.error(`[Takskom] addTitle3 error:`, error.message);
      if (error.response) {
        console.error(`[Takskom] T3 error response:`, JSON.stringify(error.response.data || error.response, null, 2));
      }
      throw error;
    }
  }

  /**
   * POST /epl/add/{mintransId}/t4 - Добавление Титула 4 (одометр выезда)
   * API принимает только tripFeature и odometer (startDate, startTime в HH:MM, value). authorized/signature не допускаются (400).
   * Поля «Сведения о лице, уполномоченном...» и «Подписант» заполняются при подписании механиком в Такском.
   */
  static async addTitle4(mintransId, payload) {
    try {
      console.log(`[Takskom] Adding Title 4 (odometer departure) to ${mintransId}`);
      const recordDate = payload.recordDate || new Date().toISOString().split('T')[0];
      const recordTime = this._timeHHMM(payload.recordTime);
      const odometerValue = payload.odometerReading ?? payload.odometer ?? 0;
      const fullPayload = {
        tripFeature: payload.tripFeature || '1',
        odometer: {
          startDate: recordDate,
          startTime: recordTime,
          value: Number(odometerValue)
        }
      };
      if (payload.fuelValue != null && !isNaN(Number(payload.fuelValue)) && Number(payload.fuelValue) >= 0) {
        fullPayload.fuel = { value: Number(payload.fuelValue) };
      }
      console.log(`[Takskom] T4 payload:`, JSON.stringify(fullPayload, null, 2));
      const response = await takskAxios.post(`/epl/add/${mintransId}/t4`, fullPayload);
      console.log(`[Takskom] T4 response:`, JSON.stringify(response, null, 2));
      return { success: true, message: 'Title 4 added', rawResponse: response };
    } catch (error) {
      console.error(`[Takskom] addTitle4 error:`, error.message);
      if (error.response) {
        console.error(`[Takskom] T4 error response:`, JSON.stringify(error.response.data || error.response, null, 2));
      }
      throw error;
    }
  }

  /**
   * POST /epl/add/{mintransId}/t5 - Добавление Титула 5 (одометр заезда)
   * API ожидает: odometer.startTime в HH:MM; authorized (fio, position); signature обязателен.
   */
  static async addTitle5(mintransId, payload) {
    try {
      console.log(`[Takskom] Adding Title 5 (odometer arrival) to ${mintransId}`);
      const recordDate = payload.recordDate || payload.startDate || new Date().toISOString().split('T')[0];
      const recordTime = this._timeHHMM(payload.recordTime || payload.startTime);
      const odometerValue = payload.odometerReading ?? payload.odometer ?? payload.value ?? 0;
      const authorizedFio = this._formatFio(payload.authorizedName || 'Механик');
      const fullPayload = {
        tripFeature: payload.tripFeature || '1',
        odometer: {
          startDate: recordDate,
          startTime: recordTime,
          value: Number(odometerValue)
        },
        authorized: payload.authorized || {
          fio: authorizedFio,
          position: payload.authorizedPosition || 'Механик'
        },
        signature: payload.signature || this._formatSignature(payload.authorizedName || 'Механик', 'Механик')
      };
      const response = await takskAxios.post(`/epl/add/${mintransId}/t5`, fullPayload);
      return { success: true, message: 'Title 5 added', rawResponse: response };
    } catch (error) {
      console.error(`[Takskom] addTitle5 error:`, error.message);
      throw error;
    }
  }

  /**
   * POST /epl/add/{mintransId}/t6 - Добавление Титула 6 (послерейсовый медосмотр)
   * API ожидает: medic (fio, position, license lowercase); driver (Fio, License, PersonnelNumber, Inn); время HH:MM.
   */
  static async addTitle6(mintransId, payload) {
    try {
      console.log(`[Takskom] Adding Title 6 (medical post-exam) to ${mintransId}`);
      const examDate = payload.examDate || new Date().toISOString().split('T')[0];
      const examTime = this._timeHHMM(payload.examTime);
      const driverFio = payload.driver?.Fio || this._formatFio(payload.driverName || 'Водитель');
      const driverLicense = payload.driver?.License || {
        LicenseSerial: payload.licenseSerial || '77 АВ',
        LicenseNumber: payload.licenseNumber || '000000',
        LicenseDate: payload.licenseDate || '01.01.2000'
      };
      const medicLicenseT6 = (payload.medic && typeof payload.medic.license === 'object') ? payload.medic.license : this._medicLicenseFormat(
        payload.licenseSerial || driverLicense.LicenseSerial,
        payload.licenseNumber || driverLicense.LicenseNumber,
        payload.licenseDate || driverLicense.LicenseDate
      );
      // API Такском: только lowercase fio, position (не Fio/Position)
      const medicT6 = {
        fio: this._formatFio(payload.medicName || 'Медицинский работник'),
        position: (payload.medicPosition || 'Медицинский работник').trim() || 'Медицинский работник',
        license: medicLicenseT6
      };
      const fullPayload = {
        medicalExaminationType: payload.medicalExaminationType || '2',
        medicType: payload.medicType || 'COMPANY',
        medic: medicT6,
        inspection: {
          result: payload.examResult === 'suitable' || payload.examResult === 'ALLOWED' ? 'ALLOWED' : 'NOT_ALLOWED',
          date: examDate,
          time: examTime
        },
        driver: payload.driver || {
          Fio: driverFio,
          License: driverLicense,
          PersonnelNumber: payload.personnelNumber || payload.driver?.PersonnelNumber || '000000',
          Inn: payload.inn || payload.driver?.Inn || '000000000000'
        },
        signature: payload.signature || this._formatSignature(payload.medicName || 'Медицинский работник', 'Медицинский работник')
      };
      const response = await takskAxios.post(`/epl/add/${mintransId}/t6`, fullPayload);
      return { success: true, message: 'Title 6 added', rawResponse: response };
    } catch (error) {
      console.error(`[Takskom] addTitle6 error:`, error.message);
      throw error;
    }
  }

  /**
   * GET /epl/status/{mintransId} - Получение статуса ЭПЛ
   */
  static async getEPLStatus(mintransId) {
    try {
      const response = await takskAxios.get(`/epl/status/${mintransId}`);
      return {
        success: true,
        status: response.transportation?.status,
        qrStatus: response.qrStatus?.status,
        titles: response.statuses || [],
        rawResponse: response
      };
    } catch (error) {
      console.error('[Takskom] getEPLStatus error:', error.message);
      throw error;
    }
  }

  /**
   * GET /qr/waybill-number/{waybillNumber} — получение QR по номеру путевого листа.
   * Ответ API: { status: "success", data: { qr: { content: base64, type: "image/png", ext: "png" }, mintransId, eplId }, errors: [] }
   * Собираем data URL для отображения: data:image/png;base64,{content}
   */
  static async getQRByWaybillNumber(waybillNumber) {
    try {
      const response = await takskAxios.get(`/qr/waybill-number/${encodeURIComponent(waybillNumber)}`);
      const top = response?.data ?? response;
      const data = top?.data ?? top;
      let qr = null;
      const qrObj = data?.qr ?? top?.qr;
      if (qrObj && typeof qrObj.content === 'string') {
        const mime = qrObj.type || 'image/png';
        qr = `data:${mime};base64,${qrObj.content}`;
      } else if (typeof data?.qr === 'string' && data.qr.startsWith('data:image')) {
        qr = data.qr;
      }
      if (!qr && DEBUG) {
        const emptyBody = data == null || data === '' || (typeof data === 'object' && Object.keys(data || {}).length === 0);
        console.log('[Takskom] getQRByWaybillNumber: QR по API не вернулся' + (emptyBody ? ' (пустой ответ — используйте qr-fetcher/перезалив)' : ''), data?.qr ? 'keys: ' + Object.keys(data.qr).join(',') : '');
      }
      return {
        success: top?.status === 'success' || data?.mintransId != null,
        qr,
        mintransId: data?.mintransId ?? top?.mintransId,
        eplId: data?.eplId ?? top?.eplId,
        rawResponse: response
      };
    } catch (error) {
      console.error('[Takskom] getQRByWaybillNumber error:', error.message);
      throw error;
    }
  }

  /**
   * Получение документа ЭПЛ в формате PDF по mintransId.
   * URL задаётся в TAKSKOM_DOCUMENT_PDF_URL (подстановка {mintransId}) или по умолчанию: {base}/waybill/{mintransId}/document/pdf
   */
  static async getDocumentPdf(mintransId) {
    const url = process.env.TAKSKOM_DOCUMENT_PDF_URL
      ? process.env.TAKSKOM_DOCUMENT_PDF_URL.replace(/\{mintransId\}/g, String(mintransId))
      : `${TAKSKOM_API_BASE}waybill/${mintransId}/document/pdf`;
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/pdf'
      },
      timeout: TAKSKOM_TIMEOUT
    });
    return Buffer.from(response.data);
  }

  /**
   * GET /qr/personal-number/{personnelNumber} - Получение QR по табельному номеру водителя
   */
  static async getQRByPersonnelNumber(personnelNumber) {
    try {
      const response = await takskAxios.get(`/qr/personal-number/${personnelNumber}`);
      return {
        success: true,
        qr: response.qr,
        driverData: response.driverData,
        mintransId: response.mintransId,
        rawResponse: response
      };
    } catch (error) {
      console.error('[Takskom] getQRByPersonnelNumber error:', error.message);
      throw error;
    }
  }

  /**
   * Создание ЭПЛ в Такском. Все данные приходят из БД (менеджер создал авто, водителей, связи).
   * carParkId, driverData, vehicleData, parkInfo — уже заполнены из привязок парка/водитель/авто.
   * Схема API: tripFeature "1"|"2", shippingType "КП"|"СН"|"СТ", areaShippingType "Г"|"П"|"М",
   * phone — массив, address/issuePerson/signature — объекты, driver — массив, vehicle — PascalCase.
   */
  static async createSimpleEPL(carParkId, waybillNumber, driverData, vehicleData, date = null, parkInfo = {}) {
    try {
      const parkName = parkInfo.name || parkInfo.parkName || 'Парк';
      const parkAddress = parkInfo.address || '';
      const parkPhone = parkInfo.phone || driverData.phone || '';

      console.log(`[Takskom] Creating simple EPL: ${waybillNumber}`);
      console.log(`[Takskom] Park info received:`, {
        name: parkName,
        ogrn: parkInfo.ogrn,
        inn: parkInfo.inn,
        kpp: parkInfo.kpp,
        address: parkAddress
      });

      // Такском: Fio поля по regex ^[- \`\'А-Яа-яЁё]+$ — пустая строка не подходит, используем "-"
      const driverFioRaw = driverData.fio || driverData.fullName || 'Not provided';
      const fioParts = driverFioRaw.trim().split(/\s+/);
      const rawSecond = (fioParts[2] || '').trim();
      const driverFioObj = {
        lastName: (fioParts[0] || '').trim() || '-',
        name: (fioParts[1] || '').trim() || '-',
        secondName: rawSecond || '-', // Всегда используем "-" если отчество пустое
      };
      const licenseRaw = (driverData.license || '').trim();
      const licenseParts = licenseRaw.split(/\s+/);
      // Документация 4.3: LicenseDate — формат «дата» YYYY-MM-DD
      let licenseDateFormatted = '2000-01-01';
      if (driverData.licenseDate) {
        const dateStr = (driverData.licenseDate || '').trim();
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
          licenseDateFormatted = dateStr;
        } else if (dateStr.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
          const [day, month, year] = dateStr.split('.');
          licenseDateFormatted = `${year}-${month}-${day}`;
        } else {
          licenseDateFormatted = dateStr;
        }
      }
      const driverLicenseObj = {
        LicenseSerial: driverData.licenseSerial || (licenseParts.length >= 2 ? licenseParts.slice(0, -1).join(' ') : licenseRaw),
        LicenseNumber: driverData.licenseNumber || (licenseParts.length >= 2 ? licenseParts[licenseParts.length - 1] : ''),
        LicenseDate: licenseDateFormatted,
      };
      const regNumber = (vehicleData.regNumber || vehicleData.licensePlate || '').trim();
      // Убираем пробелы из госномера для валидации (формат: А123АА77)
      const cleanRegNumber = regNumber ? regNumber.replace(/\s+/g, '') : '';
      const vehicleBrand = (vehicleData.brand || '').trim() || '-';
      const vehicleModel = (vehicleData.model || '').trim() || '-';
      
      // Валидация: госномер обязателен
      if (!cleanRegNumber || cleanRegNumber === '') {
        throw new Error('Vehicle registration number is required');
      }

      const parkIndex = parkInfo.postalIndex || '';
      // Region должен быть кодом субъекта РФ, а не названием (согласно документации)
      // Маппинг основных регионов: название -> код
      const regionCodeMap = {
        'Москва': '77',
        'Московская область': '50',
        'Санкт-Петербург': '78',
        'Ленинградская область': '47',
        // Добавь другие регионы по необходимости
      };
      const parkRegionName = parkInfo.region || '';
      const parkRegionCode = parkInfo.regionCode || regionCodeMap[parkRegionName] || parkRegionName || '77'; // Дефолт Москва
      const parkCity = parkInfo.city || '';
      const parkStreet = parkInfo.street || '';
      const parkHouse = parkInfo.house || '';
      const parkOgrn = parkInfo.ogrn || null; // Не используем невалидный OGRN

      const now = new Date();
      const useWaybillDateOnly = now.toISOString().split('T')[0];
      const dayWaybillFeature = parkInfo.dayWaybillFeature ?? '1';
      // При dayWaybillFeature=1 передаём только useWaybillDate (обязательно). waybillDate не передаём — иначе oneOf может не сработать.
      const waybillDateTime = `${useWaybillDateOnly}T00:00:00+03:00`;

      // Формируем issuePerson в зависимости от типа владельца (ЮЛ / ИП)
      const isIndividual = parkInfo.ownerType === 'individual';
      let issuePersonObj;

      if (isIndividual) {
        // ИП — используем issuePersonIndividual (type: '2')
        const ownerName = parkInfo.ownerName || parkName;
        let ogrnip = parkInfo.ownerOgrnip || '';
        ogrnip = String(ogrnip).trim();
        if (ogrnip.length !== 15) ogrnip = '000000000000000';

        const issuePersonIndividual = { name: ownerName, ogrnip: ogrnip };

        const ownerInn = parkInfo.ownerInn ? String(parkInfo.ownerInn).trim() : '';
        if (ownerInn.length === 12) {
          issuePersonIndividual.inn = ownerInn;
        }

        issuePersonObj = { type: '2', issuePersonIndividual };
        console.log(`[Takskom] issuePersonIndividual (ИП):`, JSON.stringify(issuePersonIndividual, null, 2));
      } else {
        // ЮЛ — используем issuePersonLegal (type: '1')
        let ogrn = parkOgrn && parkOgrn !== '0000000000000' && parkOgrn.length === 13
          ? parkOgrn
          : null;

        if (!ogrn && parkName && parkName.includes('БЕНЕФИС')) {
          ogrn = '5157746091300';
        }
        if (!ogrn) {
          ogrn = '0000000000000';
        }

        const issuePersonLegal = { name: parkInfo.ownerName || parkName, ogrn: ogrn };

        if (parkInfo.inn) {
          const inn = String(parkInfo.inn).trim();
          if (inn.length === 10 || inn.length === 12) {
            issuePersonLegal.inn = inn;
          }
        }
        if (parkInfo.kpp) {
          const kpp = String(parkInfo.kpp).trim();
          if (kpp.length === 9) {
            issuePersonLegal.kpp = kpp;
          }
        }

        issuePersonObj = { type: '1', issuePersonLegal };
        console.log(`[Takskom] issuePersonLegal (ЮЛ):`, JSON.stringify(issuePersonLegal, null, 2));
      }

      // API ожидает camelCase на верхнем уровне и обязательное поле autoparkName.
      // При dayWaybillFeature=1 передаём только useWaybillDate (oneOf), waybillDate не включаем.
      const basePayload = {
        autoparkId: String(carParkId),
        autoparkName: parkName || '',
        waybillNumber: waybillNumber,
        ...(dayWaybillFeature !== '1' && { waybillDate: waybillDateTime }),
        tripFeature: String(parkInfo.tripFeature ?? '1'),
        shippingType: parkInfo.shippingType ?? 'КП',
        medicalExamFeature: String(parkInfo.medicalExamFeature ?? '1'),
        areaShippingType: parkInfo.areaShippingType ?? 'Г',
        dayWaybillFeature: String(dayWaybillFeature),
        useWaybillDate: useWaybillDateOnly,
        issuePerson: issuePersonObj,
        phone: (() => {
          const phoneValue = (parkPhone || driverData.phone || '').trim();
          // phone обязателен и должен быть массивом строк (согласно документации)
          return phoneValue ? [phoneValue] : ['+79999999999']; // Дефолтный телефон если нет
        })(),
        address: {
          AddressRf: {
            Index: parkIndex || '000000',
            Region: parkRegionCode, // Код субъекта РФ (например "77" для Москвы)
            City: parkCity || parkName,
            Street: parkStreet || '',
            House: parkHouse || '',
            // Добавляем дополнительные поля адреса если есть
            ...(parkInfo.district && { District: parkInfo.district }),
            ...(parkInfo.locality && { Locality: parkInfo.locality }),
            ...(parkInfo.housing && { Housing: parkInfo.housing }),
            ...(parkInfo.flat && { Flat: parkInfo.flat })
          },
        },
        // API ожидает PascalCase: Type, Brand, Model, RegistrationNumber, InventoryNumber.
        vehicle: {
          Type: (vehicleData.type || '1').toString(),
          Brand: vehicleBrand,
          Model: vehicleModel,
          RegistrationNumber: cleanRegNumber,
          InventoryNumber: vehicleData.inventoryNumber || cleanRegNumber || '',
        },
        driver: [
          {
            Fio: {
              lastName: driverFioObj.lastName,
              name: driverFioObj.name,
              secondName: driverFioObj.secondName || '-', // Используем "-" если отчество пустое
            },
            License: driverLicenseObj,
            PersonnelNumber: driverData.personnelNumber || '000000', // Обязательное поле, не может быть пустым
            Inn: driverData.inn || '000000000000', // Обязательное поле, не может быть пустым
          },
        ],
        signature: (() => {
          // Используем данные диспетчера из parkInfo, если есть
          let signatureFio = driverFioObj;
          if (parkInfo.signatureFio) {
            const dispatcherFioRaw = parkInfo.signatureFio || '';
            const dispatcherFioParts = dispatcherFioRaw.trim().split(/\s+/);
            signatureFio = {
              lastName: (dispatcherFioParts[0] || '').trim() || '-',
              name: (dispatcherFioParts[1] || '').trim() || '-',
              secondName: (dispatcherFioParts[2] || '').trim() || '-',
            };
          }
          return {
            Fio: signatureFio,
            Position: parkInfo.signaturePosition || 'Диспетчер',
            Type: parkInfo.signatureType || '1',
            PowersType: parkInfo.signaturePowersType || '1',
          };
        })(),
      };
      
      // Добавляем commercialShippingType только если shippingType="КП" (коммерческие перевозки).
      // ЛТ — типично легковое такси; ПГ — перевозка грузов по договору (см. формат ЭПЛ / ЛК Такском).
      // Переопределение: parkInfo.commercialShippingType или TAKSKOM_COMMERCIAL_SHIPPING_TYPE в .env
      const shippingType = parkInfo.shippingType ?? 'КП';
      if (shippingType === 'КП') {
        const envCommercial = (process.env.TAKSKOM_COMMERCIAL_SHIPPING_TYPE || '').trim();
        basePayload.commercialShippingType =
          parkInfo.commercialShippingType || envCommercial || 'ПГ';
      }

      // Верхний уровень — camelCase; вложенные объекты (address, vehicle, driver, signature) — PascalCase.
      const response = await this.createEPL(basePayload);

      return {
        success: true,
        mintransId: response.mintransId,
        eplGuid: response.eplGuid,
        waybillNumber,
        status: response.status,
        message: 'EPL created successfully (Title 1 only)',
        payload: basePayload
      };

    } catch (error) {
      console.error(`[Takskom] createSimpleEPL error:`, error.message);
      throw error;
    }
  }

  /**
   * Завершение рейса: добавляет Титулы 5 и 6
   * @param {string} mintransId - ID ЭПЛ в Такском
   * @param {number} odometerEndReading - Пробег при заезде
   * @param {string} postExamResult - Результат послерейсового медосмотра ('suitable' или 'ALLOWED')
   * @param {object} options - Дополнительные опции (driverName, medicName, authorizedName)
   */
  static async completeRide(mintransId, odometerEndReading, postExamResult = 'suitable', options = {}) {
    try {
      console.log(`[Takskom] Completing ride: ${mintransId}`);
      const now = new Date();
      const driverName = options.driverName || 'Водитель';
      const medicName = options.medicName || driverName;
      const authorizedName = options.authorizedName || driverName;

      const recordDate = now.toISOString().split('T')[0];
      const recordTime = now.toTimeString().split(' ')[0].slice(0, 5);
      try {
        const title5Data = {
          odometerReading: odometerEndReading,
          recordDate,
          recordTime,
          authorizedName: authorizedName
        };
        await this.addTitle5(mintransId, title5Data);
      } catch (e) {
        console.warn(`[Takskom] Title 5 warning:`, e.message);
      }

      // Т6 (послерейсовый медосмотр) по запросу не заполняем — не вызываем addTitle6

      let status = null;
      try {
        status = await this.getEPLStatus(mintransId);
      } catch (e) {
        console.warn(`[Takskom] getEPLStatus after complete failed (T5/T6 уже отправлены):`, e.message);
      }

      return {
        success: true,
        mintransId,
        status,
        message: 'Ride completed'
      };

    } catch (error) {
      console.error('[Takskom] completeRide error:', error.message);
      throw error;
    }
  }
}

module.exports = TakskornAPI;
