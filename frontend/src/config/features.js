/**
 * UI для эвакуаторов и комиссаров. При false разделы скрыты (маршруты и API в проекте сохраняются).
 * Чтобы снова показать — выставить true или VITE_FEATURE_EVACUATOR_COMMISSIONER=true при сборке.
 */
export const FEATURE_EVACUATOR_AND_COMMISSIONER =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_FEATURE_EVACUATOR_COMMISSIONER === 'true'
    ? true
    : false;
