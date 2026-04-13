const axios = require('axios');
require('dotenv').config();

const TAKSKOM_API_BASE = process.env.TAKSKOM_API_BASE || 'https://api-epl.taxcom.ru/v1.1/';
const TAKSKOM_API_KEY = process.env.TAKSKOM_API_KEY;

const client = axios.create({
  baseURL: TAKSKOM_API_BASE,
  headers: {
    'Authorization': `Bearer ${TAKSKOM_API_KEY}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

/**
 * Синхронизация парка с Такском
 * @param {Object} parkData - Данные парка
 * @returns {Promise<Object>} Результат с takskornId
 */
async function syncParkWithTakskom(parkData) {
  try {
    console.log(`[TAKSKOM] Синхронизирую парк: ${parkData.name}`);
    
    const response = await client.post('parks', {
      name: parkData.name,
      address: parkData.address,
      memberid: parkData.memberId || '',
      password: parkData.takskornPassword || ''
    });

    console.log(`[TAKSKOM] Парк синхронизирован, ID: ${response.data.id}`);
    
    return {
      takskornId: response.data.id,
      success: true,
      data: response.data
    };
  } catch (error) {
    console.error('[TAKSKOM] Ошибка синхронизации парка:', error.message);
    return {
      success: false,
      error: error.message,
      takskornId: null
    };
  }
}

/**
 * Синхронизация автомобиля с Такском
 * @param {Object} carData - Данные автомобиля
 * @param {number} parkTakskornId - ID парка в Такском
 * @returns {Promise<Object>} Результат с inventoryNumber и takskornId
 */
async function syncCarWithTakskom(carData, parkTakskornId) {
  try {
    console.log(`[TAKSKOM] Синхронизирую авто: ${carData.regNumber}`);
    
    // Генерируем инвентарный номер если его нет
    const inventoryNumber = carData.inventoryNumber || `INV-${Date.now()}`;
    
    const response = await client.post(`parks/${parkTakskornId}/vehicles`, {
      regNumber: carData.regNumber,
      brand: carData.brand,
      model: carData.model,
      vin: carData.vin,
      fuelType: carData.fuelType,
      tankVolume: carData.tankVolume,
      seasonality: carData.seasonality,
      fuelUnit: carData.fuelUnit,
      inventoryNumber: inventoryNumber
    });

    console.log(`[TAKSKOM] Авто синхронизировано, ID: ${response.data.id}`);
    
    return {
      takskornId: response.data.id,
      inventoryNumber: inventoryNumber,
      success: true,
      data: response.data
    };
  } catch (error) {
    console.error('[TAKSKOM] Ошибка синхронизации авто:', error.message);
    return {
      success: false,
      error: error.message,
      takskornId: null,
      inventoryNumber: null
    };
  }
}

/**
 * Синхронизация водителя с Такском
 * @param {Object} driverData - Данные водителя
 * @param {number} parkTakskornId - ID парка в Такском
 * @returns {Promise<Object>} Результат с personnelNumber и takskornId
 */
async function syncDriverWithTakskom(driverData, parkTakskornId) {
  try {
    console.log(`[TAKSKOM] Синхронизирую водителя: ${driverData.fullName}`);
    
    // Генерируем personnelNumber если его нет
    const personnelNumber = driverData.personnelNumber || `DRV-${Date.now()}`;
    
    const response = await client.post(`parks/${parkTakskornId}/drivers`, {
      fullName: driverData.fullName,
      phone: driverData.phone,
      license: driverData.license,
      inn: driverData.inn,
      snils: driverData.snils,
      personnelNumber: personnelNumber
    });

    console.log(`[TAKSKOM] Водитель синхронизирован, ID: ${response.data.id}`);
    
    return {
      takskornId: response.data.id,
      personnelNumber: personnelNumber,
      success: true,
      data: response.data
    };
  } catch (error) {
    console.error('[TAKSKOM] Ошибка синхронизации водителя:', error.message);
    return {
      success: false,
      error: error.message,
      takskornId: null,
      personnelNumber: null
    };
  }
}

/**
 * Создание ЭПЛ (путевого листа) в Такском
 * @param {Object} eplData - Данные путевого листа
 * @returns {Promise<Object>} Результат
 */
async function createEplInTakskom(eplData) {
  try {
    console.log(`[TAKSKOM] Создаю ЭПЛ для парка ${eplData.parkTakskornId}`);
    
    const response = await client.post(`parks/${eplData.parkTakskornId}/epls`, {
      driverId: eplData.driverTakskornId,
      vehicleId: eplData.carTakskornId,
      waybillNumber: eplData.waybillNumber || `WB-${Date.now()}`,
      date: eplData.date || new Date().toISOString().split('T')[0]
    });

    console.log(`[TAKSKOM] ЭПЛ создан, ID: ${response.data.id}`);
    
    return {
      mintransId: response.data.id,
      success: true,
      data: response.data
    };
  } catch (error) {
    console.error('[TAKSKOM] Ошибка создания ЭПЛ:', error.message);
    return {
      success: false,
      error: error.message,
      mintransId: null
    };
  }
}

/**
 * Подписание документа по API (используя .cer сертификат)
 * @param {string} documentId - ID документа в Такском
 * @param {string} certPath - Путь к .cer файлу
 * @returns {Promise<Object>} Результат подписания
 */
async function signDocumentWithTakskom(documentId, certPath) {
  try {
    console.log(`[TAKSKOM] Подписываю документ ${documentId}`);
    
    // На тестовой стадии: генерируем простую подпись
    const signature = Buffer.from(`SIGNED-${documentId}-${Date.now()}`).toString('base64');
    
    const response = await client.post(`documents/${documentId}/sign`, {
      signature: signature,
      certPath: certPath
    });

    console.log(`[TAKSKOM] Документ подписан`);
    
    return {
      success: true,
      signature: signature,
      data: response.data
    };
  } catch (error) {
    console.error('[TAKSKOM] Ошибка подписания документа:', error.message);
    return {
      success: false,
      error: error.message,
      signature: null
    };
  }
}

/**
 * Получение списка ЭПЛ для парка
 * @param {number} parkTakskornId - ID парка в Такском
 * @param {string} date - Дата (YYYY-MM-DD)
 * @returns {Promise<Array>} Список ЭПЛ
 */
async function getEplsForDate(parkTakskornId, date) {
  try {
    console.log(`[TAKSKOM] Получаю ЭПЛ для парка ${parkTakskornId} на дату ${date}`);
    
    const response = await client.get(`parks/${parkTakskornId}/epls`, {
      params: { date }
    });

    return {
      success: true,
      epls: response.data || [],
      data: response.data
    };
  } catch (error) {
    console.error('[TAKSKOM] Ошибка получения ЭПЛ:', error.message);
    return {
      success: false,
      error: error.message,
      epls: []
    };
  }
}

/**
 * Получение статистики парка из Такском
 * @param {number} parkTakskornId - ID парка в Такском
 * @param {string} dateFrom - Дата начала (YYYY-MM-DD)
 * @param {string} dateTo - Дата окончания (YYYY-MM-DD)
 * @returns {Promise<Object>} Статистика
 */
async function getParkStatistics(parkTakskornId, dateFrom, dateTo) {
  try {
    console.log(`[TAKSKOM] Получаю статистику парка ${parkTakskornId} за период ${dateFrom} - ${dateTo}`);
    
    const response = await client.get(`parks/${parkTakskornId}/statistics`, {
      params: { dateFrom, dateTo }
    });

    return {
      success: true,
      stats: response.data || {},
      data: response.data
    };
  } catch (error) {
    console.error('[TAKSKOM] Ошибка получения статистики:', error.message);
    return {
      success: false,
      error: error.message,
      stats: {}
    };
  }
}

// Health check для проверки соединения с Такском
async function healthCheck() {
  try {
    const response = await client.get('health');
    console.log('[TAKSKOM] ✓ API доступен');
    return { ok: true, status: response.status };
  } catch (error) {
    console.error('[TAKSKOM] ✗ API недоступен:', error.message);
    return { ok: false, error: error.message };
  }
}

module.exports = {
  syncParkWithTakskom,
  syncCarWithTakskom,
  syncDriverWithTakskom,
  createEplInTakskom,
  signDocumentWithTakskom,
  getEplsForDate,
  getParkStatistics,
  healthCheck
};
