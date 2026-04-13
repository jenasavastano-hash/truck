import { useToastContext } from '../contexts/ToastContext';

/** Глобальный тост: использует ToastContext, если приложение обёрнуто в ToastProvider. */
export function useToast() {
  return useToastContext();
}
