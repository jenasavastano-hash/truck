/**
 * Единые списки/хелперы по статусам ЭПЛ.
 * ВАЖНО: эти списки используются для SQL и бизнес-логики.
 */

const EPL_STATUS = Object.freeze({
  DRAFT: 'draft',
  PENDING_CLINIC: 'pending_clinic',
  PENDING: 'pending',
  APPROVED: 'approved',
  SIGNED: 'signed',
  SUBMITTED: 'submitted',
  REJECTED: 'rejected',
  FAILED: 'failed',
});

const EPL_STATUSES = Object.freeze(Object.values(EPL_STATUS));

// ЭПЛ, которые ещё “в создании” и могут быть отменены при закрытии смены.
const CANCELABLE_BEFORE_TAXCOM = Object.freeze([EPL_STATUS.PENDING_CLINIC, EPL_STATUS.DRAFT]);

// ЭПЛ, которые можно принудительно “закрыть/пометить failed” при close-shift (локально прекращаем попытки).
const CLOSE_SHIFT_FAIL_STATUSES = Object.freeze([EPL_STATUS.PENDING_CLINIC, EPL_STATUS.DRAFT, EPL_STATUS.PENDING]);

// ЭПЛ, где можно ожидать документы/QR через фоновые джобы.
const DOC_POLLABLE = Object.freeze([EPL_STATUS.PENDING, EPL_STATUS.APPROVED]);

// “В создании”: заявка в клинике или уже создана, но ещё не финализирована.
const IN_CREATION = Object.freeze([EPL_STATUS.PENDING_CLINIC, EPL_STATUS.PENDING]);

function sqlQuoteList(list) {
  return (list || []).map((s) => `'${String(s).replace(/'/g, "''")}'`).join(', ');
}

module.exports = {
  EPL_STATUS,
  EPL_STATUSES,
  CANCELABLE_BEFORE_TAXCOM,
  CLOSE_SHIFT_FAIL_STATUSES,
  DOC_POLLABLE,
  IN_CREATION,
  sqlQuoteList,
};

