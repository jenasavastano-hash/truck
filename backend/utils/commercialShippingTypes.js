/**
 * Вид коммерческой перевозки (коды в духе Такском / приказа).
 * ПГ — грузовые перевозки по договору (основной сценарий «Грузовые ЭПЛ»).
 * Подстрока — для выбора option в веб-форме ЛК (см. applyFreightWaybillTaxcomFields).
 */
/**
 * pdfShippingLine / pdfMessageKind — подстановка в быстрый PDF (2702.pdf): «Вид перевозки» и «Вид сообщения».
 * Якоря в шаблоне: пассажирская строка и «городское»; для ПГ заменяем на формулировки грузового договора и пригород.
 */
const BY_CODE = {
  ПГ: {
    label: 'Перевозка грузов по договору',
    taxcomLabel: 'перевозка грузов',
    pdfShippingLine: 'коммерческие перевозки, Перевозка грузов на основании договора перевозки грузов',
    pdfMessageKind: 'пригородное',
    /** Строка для опциональной ячейки бланка (если в 2702.pdf есть якорь — см. worker_ep_l.extras.example.json). */
    pdfFreightRouteHint: 'по договору перевозки груза, маршрут согласован с заказчиком',
    /** Согласовано с подстрочником ЛК Такском: выезд с парковки / площадки. */
    pdfFreightTripStartHint: 'рейс начинается с территории автопарка (парковки) организации',
  },
  РП: {
    label: 'Регулярные перевозки пассажиров и багажа',
    taxcomLabel: 'регулярная перевозка',
    pdfShippingLine: 'коммерческие перевозки, регулярная перевозка пассажиров и багажа',
    pdfMessageKind: 'городское',
  },
  ЗП: {
    label: 'Пассажиры и багаж по заказу',
    taxcomLabel: 'по заказу',
    pdfShippingLine: 'коммерческие перевозки, перевозка пассажиров и багажа по договору перевозки пассажира',
    pdfMessageKind: 'городское',
  },
  ТЛ: {
    label: 'Легковое такси',
    taxcomLabel: 'легковым такси',
    pdfShippingLine: 'коммерческие перевозки, перевозка пассажиров и багажа легковым такси',
    pdfMessageKind: 'городское',
  },
  ОД: {
    label: 'Организованная перевозка детей (автобусы)',
    taxcomLabel: 'групп детей',
    pdfShippingLine: 'коммерческие перевозки, организованная перевозка групп детей автобусами',
    pdfMessageKind: 'городское',
  },
};

const ALLOWED = new Set(Object.keys(BY_CODE));

function normalizeCommercialShippingType(code) {
  const c = String(code ?? '')
    .trim()
    .toUpperCase();
  if (ALLOWED.has(c)) return c;
  return 'ПГ';
}

function getCommercialShippingTaxcomLabel(code) {
  const c = normalizeCommercialShippingType(code);
  return BY_CODE[c].taxcomLabel;
}

function getCommercialShippingHumanLabel(code) {
  const c = normalizeCommercialShippingType(code);
  return BY_CODE[c].label;
}

function getCommercialOptionsForApi() {
  return Object.entries(BY_CODE).map(([code, v]) => ({
    code,
    label: v.label,
  }));
}

/** Строки для подстановки в worker_ep_l.py (замена якорей в 2702.pdf). */
function getPdfHeaderLinesForWorker(code) {
  const c = normalizeCommercialShippingType(code);
  const v = BY_CODE[c];
  return {
    shippingLine: v.pdfShippingLine,
    messageKind: v.pdfMessageKind,
  };
}

/** Доп. строки для worker_ep_l.py (ПГ): маршрут / признак начала рейса — подставляются в optional extras. */
function getPdfFreightExtrasForWorker(code, ctx = {}) {
  const c = normalizeCommercialShippingType(code);
  const v = BY_CODE[c];
  if (c !== 'ПГ' || !v.pdfFreightRouteHint) {
    return { routeLine: '', tripStartLine: '' };
  }
  const city = (ctx.parkCity || ctx.city || '').trim();
  const routeLine = city
    ? `Маршрут: ${city} — ${v.pdfFreightRouteHint}`
    : `Маршрут: ${v.pdfFreightRouteHint}`;
  return {
    routeLine,
    tripStartLine: v.pdfFreightTripStartHint || '',
  };
}

module.exports = {
  BY_CODE,
  normalizeCommercialShippingType,
  getCommercialShippingTaxcomLabel,
  getCommercialShippingHumanLabel,
  getCommercialOptionsForApi,
  getPdfHeaderLinesForWorker,
  getPdfFreightExtrasForWorker,
};
