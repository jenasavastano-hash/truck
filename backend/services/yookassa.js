/**
 * Сервис интеграции с Юкассой (ЮKassa)
 * Для обработки платежей без вебхука
 * 
 * Документация: https://yookassa.ru/developers
 */

const axios = require('axios');
const crypto = require('crypto');

const SHOP_ID = process.env.YOOKASSA_SHOP_ID || '1105269';
const API_KEY = process.env.YOOKASSA_API_KEY || 'live_LP-37Tuh2eW5E7gs-jc86vsK9QJpTyPOUP9Dh-PdSxI';

// Базовая аутентификация для Юкассы
const auth = Buffer.from(`${SHOP_ID}:${API_KEY}`).toString('base64');

const yookassaAPI = axios.create({
  baseURL: 'https://api.yookassa.ru/v3',
  headers: {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

yookassaAPI.interceptors.response.use(
  response => response.data,
  error => {
    const errorData = error.response?.data || error.message;
    console.error('[Yookassa] Error:', errorData);
    throw new Error(errorData?.description || error.message);
  }
);

class YookassaService {
  /**
   * Создать платёж
   * 
   * @param {Object} options
   * @param {number} options.amount - Сумма в копейках (например, 100 = 1 рубль)
   * @param {string} options.description - Описание платежа
   * @param {string} options.returnUrl - URL для возврата после платежа
   * @param {Object} options.metadata - Дополнительные данные
   * @returns {Promise<Object>} Данные платежа с URL для подтверждения
   */
  static async createPayment(options) {
    try {
      const { amount, description, returnUrl, metadata = {} } = options;

      // Юкасса требует сумму в копейках
      const amountInKopecks = Math.round(amount * 100);

      // Генерируем уникальный ключ идемпотентности для каждого запроса
      const idempotenceKey = crypto.randomUUID();

      const payload = {
        amount: {
          value: (amountInKopecks / 100).toFixed(2), // Юкасса принимает рубли с копейками
          currency: 'RUB'
        },
        confirmation: {
          type: 'redirect',
          return_url: returnUrl
        },
        description: description || 'Payment',
        metadata: metadata,
        capture: true // Автоматический захват платежа
      };

      console.log('[Yookassa] Creating payment:', { amount, description, idempotenceKey });

      const response = await yookassaAPI.post('/payments', payload, {
        headers: {
          'Idempotence-Key': idempotenceKey
        }
      });

      return {
        id: response.id,
        status: response.status,
        amount: response.amount,
        description: response.description,
        confirmation: response.confirmation,
        metadata: response.metadata,
        createdAt: response.created_at
      };
    } catch (error) {
      console.error('[Yookassa] createPayment error:', error.message);
      throw error;
    }
  }

  /**
   * Получить статус платежа
   * 
   * @param {string} paymentId - ID платежа из Юкассы
   * @returns {Promise<Object>} Информация о платеже и его статусе
   */
  static async getPaymentStatus(paymentId) {
    try {
      // Генерируем уникальный ключ идемпотентности для каждого запроса
      const idempotenceKey = crypto.randomUUID();
      
      console.log(`[Yookassa] Checking payment status: ${paymentId}`);

      const response = await yookassaAPI.get(`/payments/${paymentId}`, {
        headers: {
          'Idempotence-Key': idempotenceKey
        }
      });

      return {
        id: response.id,
        status: response.status, // 'pending', 'succeeded', 'canceled', 'failed'
        amount: response.amount,
        description: response.description,
        metadata: response.metadata,
        createdAt: response.created_at,
        capturedAt: response.captured_at,
        failReason: response.cancellation_details?.reason
      };
    } catch (error) {
      console.error('[Yookassa] getPaymentStatus error:', error.message);
      throw error;
    }
  }

  /**
   * Проверить несколько платежей (для синхронизации с БД)
   * Используется для обновления статусов платежей без вебхука
   */
  static async checkPendingPayments(paymentIds) {
    try {
      const results = [];
      
      for (const paymentId of paymentIds) {
        try {
          const status = await this.getPaymentStatus(paymentId);
          results.push(status);
        } catch (err) {
          console.warn(`[Yookassa] Failed to check payment ${paymentId}:`, err.message);
          results.push({ id: paymentId, error: err.message });
        }
      }

      return results;
    } catch (error) {
      console.error('[Yookassa] checkPendingPayments error:', error.message);
      throw error;
    }
  }

  /**
   * Отменить платёж (возврат)
   * 
   * @param {string} paymentId - ID платежа
   * @param {Object} options - Опции возврата
   * @returns {Promise<Object>} Информация о возврате
   */
  static async refundPayment(paymentId, options = {}) {
    try {
      // Генерируем уникальный ключ идемпотентности для каждого запроса
      const idempotenceKey = crypto.randomUUID();
      
      const payload = {
        payment_id: paymentId,
        description: options.description || 'Refund'
      };

      console.log(`[Yookassa] Refunding payment: ${paymentId}`);

      const response = await yookassaAPI.post('/refunds', payload, {
        headers: {
          'Idempotence-Key': idempotenceKey
        }
      });

      return {
        id: response.id,
        paymentId: response.payment_id,
        status: response.status,
        amount: response.amount,
        createdAt: response.created_at
      };
    } catch (error) {
      console.error('[Yookassa] refundPayment error:', error.message);
      throw error;
    }
  }
}

module.exports = YookassaService;
