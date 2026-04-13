/**
 * Утилиты для отладки: скриншоты, подсветка элементов, пошаговая отладка
 */

const path = require('path');
const fs = require('fs');

/** Подсвечивает элемент на странице для скриншота. */
async function highlightElement(page, element, color = '#ff0000', duration = 3000) {
  try {
    const box = await element.boundingBox();
    if (!box) return;
    
    // Создаём div-подсветку поверх элемента
    await page.evaluate(({ x, y, width, height, color }) => {
      const highlight = document.createElement('div');
      highlight.id = 'playwright-debug-highlight';
      highlight.style.position = 'fixed';
      highlight.style.left = `${x}px`;
      highlight.style.top = `${y}px`;
      highlight.style.width = `${width}px`;
      highlight.style.height = `${height}px`;
      highlight.style.border = `3px solid ${color}`;
      highlight.style.backgroundColor = `${color}33`;
      highlight.style.pointerEvents = 'none';
      highlight.style.zIndex = '999999';
      highlight.style.boxShadow = `0 0 10px ${color}`;
      document.body.appendChild(highlight);
      
      setTimeout(() => {
        const el = document.getElementById('playwright-debug-highlight');
        if (el) el.remove();
      }, duration);
    }, { x: box.x, y: box.y, width: box.width, height: box.height, color });
  } catch (e) {
    // Игнорируем ошибки подсветки
  }
}

/** Ждёт подтверждения пользователя в пошаговом режиме отладки. Возвращает 'next' | 'skip' | 'back' | 'stop'. */
function waitForUserConfirmation(stepName, env) {
  return new Promise((resolve) => {
    if (env.DEBUG_STEP_BY_STEP !== '1' && env.DEBUG_STEP_BY_STEP !== 'true') {
      resolve('next');
      return;
    }
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    console.log(`\n[DEBUG] ⏸  ШАГ: ${stepName}`);
    console.log('[DEBUG] Команды:');
    console.log('  Enter — продолжить дальше');
    console.log('  s + Enter — пропустить этот шаг');
    console.log('  b + Enter — вернуться назад (если возможно)');
    console.log('  Ctrl+C — остановить программу');
    console.log('[DEBUG] Проверь скриншот выше...');
    
    rl.once('line', (input) => {
      const cmd = input.trim().toLowerCase();
      rl.close();
      if (cmd === 's' || cmd === 'skip') {
        console.log('[DEBUG] ⏭  Шаг пропущен');
        resolve('skip');
      } else if (cmd === 'b' || cmd === 'back') {
        console.log('[DEBUG] ⏮  Возврат назад...');
        resolve('back');
      } else {
        resolve('next');
      }
    });
  });
}

/**
 * Чекпоинт: ждёт Enter в консоли перед продолжением.
 * По умолчанию паузы выключены. Включить: TAXCOM_CHECKPOINTS=1 в .env
 */
function waitForContinue(message, env) {
  return new Promise((resolve) => {
    if (env.TAXCOM_CHECKPOINTS !== '1' && env.TAXCOM_CHECKPOINTS !== 'true') {
      resolve();
      return;
    }
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    console.log(`\n[Taxcom] ⏸  ${message}`);
    console.log('[Taxcom] Нажми Enter в консоли чтобы продолжить...');
    rl.once('line', () => {
      rl.close();
      resolve();
    });
  });
}

/** Очищает папку скриншотов перед новым запуском (только если скриншоты включены). */
function clearScreenshotsDir(env) {
  const on = env.SCREENSHOTS === '1' || env.TAXCOM_SCREENSHOTS === '1' || env.SCREENSHOTS === 'true' || env.TAXCOM_SCREENSHOTS === 'true';
  if (!on) return;
  const dir = (env.SCREENSHOTS_DIR || 'screenshots').trim();
  if (!dir) return;
  const fullDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
  try {
    if (!fs.existsSync(fullDir)) return;
    const files = fs.readdirSync(fullDir);
    let n = 0;
    for (const f of files) {
      const fp = path.join(fullDir, f);
      if (fs.statSync(fp).isFile() && /\.(png|jpg|jpeg)$/i.test(f)) {
        fs.unlinkSync(fp);
        n++;
      }
    }
    if (n > 0) console.log('[Taxcom] Очищено старых скриншотов:', n, '→', fullDir);
  } catch (e) {
    console.warn('[Taxcom] Не удалось очистить скриншоты:', e.message);
  }
}

/** Скриншоты отключены для скорости. Включить: SCREENSHOTS=1 в .env (для отладки). */
async function takeScreenshot() {
  // No-op: скриншоты вырезаны — без записи на диск ворк быстрее
}

module.exports = {
  highlightElement,
  waitForUserConfirmation,
  waitForContinue,
  clearScreenshotsDir,
  takeScreenshot
};
