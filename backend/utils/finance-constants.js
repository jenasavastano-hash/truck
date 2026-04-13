const YUKASSA_COMMISSION = 0.047;
const TAX_RATE = 0.13;
const EPL_PRICE = 25;
const AUTO_CLOSE_PRICE = 10;
const SALARY_EPL_REGULAR = 3;
const SALARY_EPL_TULA_SPB = 5;
const SALARY_AUTO_CLOSE = 3;
const MEDIC_FEE = 5;
const TAXCOM_FEE = 2;

function isTulaSPb(parkName) {
  if (!parkName) return false;
  const n = parkName.toLowerCase();
  return n.includes('тула') || n.includes('тульск') ||
    n.includes('питер') || n.includes('петербург') || n.includes('спб') || n.includes('spb');
}

module.exports = {
  YUKASSA_COMMISSION,
  TAX_RATE,
  EPL_PRICE,
  AUTO_CLOSE_PRICE,
  SALARY_EPL_REGULAR,
  SALARY_EPL_TULA_SPB,
  SALARY_AUTO_CLOSE,
  MEDIC_FEE,
  TAXCOM_FEE,
  isTulaSPb,
};
