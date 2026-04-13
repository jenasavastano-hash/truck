/**
 * Подпись титулов через КриптоПро
 */

const { takeScreenshot } = require('../utils/debug');
const { runCertPicker } = require('../utils/certificates');

/**
 * Закрывает модальные окна на странице
 */
async function closeModalDialogs(page, env) {
  try {
    console.log('[Taxcom] Проверяю наличие модальных окон...');
    
    // Ищем модальные окна: "Оповещение", "Уведомление", "Подтверждение" и т.д.
    const modalSelectors = [
      'div.modal.show[role="dialog"]',
      'div.modal.fade.show',
      '#errorModal',
      '.modal[data-show="true"]',
      'div[role="dialog"].show',
      '.modal.show'
    ];
    
    let modalFound = false;
    for (const selector of modalSelectors) {
      const modal = page.locator(selector).first();
      if ((await modal.count()) > 0) {
        const isVisible = await modal.isVisible().catch(() => false);
        if (isVisible) {
          modalFound = true;
          console.log(`[Taxcom] Найдено модальное окно (селектор: ${selector}), закрываю...`);
          
          // Пробуем закрыть через кнопку "Закрыть" (ищем в модальном окне и на всей странице)
          const closeBtnInModal = modal.locator('button:has-text("Закрыть"), button:has-text("ОК"), button:has-text("Понятно")').first();
          const closeBtnGlobal = page.locator('button:has-text("Закрыть"):visible').first();
          
          if ((await closeBtnInModal.count()) > 0) {
            await closeBtnInModal.click();
            console.log('[Taxcom] Модальное окно закрыто через кнопку "Закрыть" в модальном окне');
            await page.waitForTimeout(1500);
            return true;
          } else if ((await closeBtnGlobal.count()) > 0) {
            await closeBtnGlobal.click();
            console.log('[Taxcom] Модальное окно закрыто через кнопку "Закрыть" на странице');
            await page.waitForTimeout(1500);
            return true;
          }
          
          // Пробуем закрыть через крестик
          const closeIcon = modal.locator('button[aria-label="Close"], button.close, .close, [data-bs-dismiss="modal"], button[class*="close"]').first();
          if ((await closeIcon.count()) > 0) {
            await closeIcon.click();
            console.log('[Taxcom] Модальное окно закрыто через крестик');
            await page.waitForTimeout(1500);
            return true;
          }
          
          // Пробуем нажать Escape
          await page.keyboard.press('Escape');
          console.log('[Taxcom] Попытка закрыть модальное окно через Escape');
          await page.waitForTimeout(1500);
          
          // Проверяем, закрылось ли окно
          const stillVisible = await modal.isVisible().catch(() => false);
          if (!stillVisible) {
            console.log('[Taxcom] Модальное окно закрыто через Escape');
            return true;
          }
        }
      }
    }
    
    if (!modalFound) {
      console.log('[Taxcom] Модальные окна не найдены');
    }
    
    return false;
  } catch (err) {
    console.warn('[Taxcom] Ошибка при закрытии модального окна:', err.message);
    // Всё равно пробуем нажать Escape на случай, если окно есть
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    } catch (_) {}
    return false;
  }
}

/**
 * Подписывает титул через расширение КриптоПро
 */
async function signTitle(page, titleName, role, env, baseUrl, mintransId) {
  console.log(`[Taxcom] Пробую подписать ${titleName}...`);
  try {
    // Сначала проверяем, что титул сохранён
    console.log(`[Taxcom] Проверяю, что ${titleName} сохранён перед подписанием...`);
    await page.waitForTimeout(1000); // Краткая пауза после сохранения
    
    // Проверяем наличие сообщений об успешном сохранении
    const saveSuccessMsg = page.locator('text=/сохранён|сохранено|успешно.*сохран|saved/i').first();
    if ((await saveSuccessMsg.count()) > 0) {
      const msgText = await saveSuccessMsg.textContent().catch(() => '');
      console.log(`[Taxcom] ✓ Титул ${titleName} сохранён. Сообщение: ${msgText}`);
    }
    
    // Проверяем ошибки валидации - они могут блокировать подписание
    const validationErrors = await page.locator('input.is-invalid, select.is-invalid, textarea.is-invalid, [aria-invalid="true"], .invalid-feedback, .error-message, .alert-danger').all();
    if (validationErrors.length > 0) {
      console.warn(`[Taxcom] ⚠ Обнаружено ${validationErrors.length} ошибок валидации перед подписанием ${titleName}`);
      for (const errEl of validationErrors.slice(0, 5)) {
        const errText = await errEl.textContent().catch(() => '');
        if (errText && errText.trim()) {
          console.warn(`[Taxcom]   - Ошибка: ${errText.trim()}`);
        }
      }
      await takeScreenshot(page, `sign_${titleName}_validation_errors`, env, `Ошибки валидации перед подписанием ${titleName}`);
    }
    
    // Расширенный поиск кнопки "Подписать" с ожиданием активации (id из ЛК Такском)
    const signBtnSelectors = [
      page.locator('#sign_btn').first(),
      page.locator('button:has-text("Подписать")').first(),
      page.locator('button:has-text("подписать")').first(),
      page.locator('button[id*="sign"]').first(),
      page.locator('button[class*="sign"]').first(),
      page.locator('a:has-text("Подписать")').first(),
      page.locator('a:has-text("подписать")').first(),
      page.getByRole('button', { name: /подписать/i }).first(),
      page.locator('input[type="button"][value*="Подписать"]').first(),
      page.locator('input[type="submit"][value*="Подписать"]').first()
    ];
    
    let signButton = null;
    
    // Ждём до 15 секунд, пока кнопка станет enabled
    console.log(`[Taxcom] Ожидаю активации кнопки "Подписать" для ${titleName}...`);
    for (let waitAttempt = 0; waitAttempt < 30; waitAttempt++) {
      for (const btn of signBtnSelectors) {
        if ((await btn.count()) > 0) {
          const isVisible = await btn.isVisible().catch(() => false);
          const isEnabled = await btn.isEnabled().catch(() => false);
          
          if (isVisible) {
            if (isEnabled) {
              signButton = btn;
              console.log(`[Taxcom] ✓ Кнопка "Подписать" для ${titleName} активирована (попытка ${waitAttempt + 1})`);
              break;
            } else {
              // Кнопка найдена, но disabled — обычно из‑за ошибки валидации (например ИНН водителя)
              if (waitAttempt === 0 || waitAttempt % 5 === 0) {
                const btnText = await btn.textContent().catch(() => '');
                const btnDisabled = await btn.getAttribute('disabled').catch(() => null);
                console.log(`[Taxcom] Кнопка "Подписать" для ${titleName} найдена, но неактивна (disabled=${btnDisabled}). Ожидаю активации...`);
                if (waitAttempt === 0 && titleName === 'Т1') {
                  console.log(`[Taxcom] Подсказка: проверьте ИНН водителя (должно быть 12 цифр) и другие поля с красной обводкой.`);
                }
              }
            }
          }
        }
      }
      
      if (signButton) {
        break;
      }
      
      await page.waitForTimeout(500);
    }
    
    // Если не нашли активную кнопку, пробуем найти через текст на странице
    if (!signButton) {
      const signText = page.locator('text=/подписать/i').first();
      if ((await signText.count()) > 0) {
        const parentBtn = signText.locator('..').filter({ has: page.locator('button, a, input[type="button"], input[type="submit"]') }).first();
        if ((await parentBtn.count()) > 0) {
          const isVisible = await parentBtn.isVisible().catch(() => false);
          const isEnabled = await parentBtn.isEnabled().catch(() => false);
          if (isVisible && isEnabled) {
            signButton = parentBtn;
            console.log(`[Taxcom] Найдена кнопка "Подписать" для ${titleName} через текст`);
          }
        }
      }
    }
    
    if (signButton) {
      console.log(`[Taxcom] Найдена кнопка "Подписать" для ${titleName}, нажимаю...`);
      await signButton.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await takeScreenshot(page, `sign_${titleName}_before_click`, env, `Перед нажатием кнопки Подписать ${titleName}`);
      // Сначала вызываем клик через JS с полной эмуляцией события — так расширение КриптоПро чаще срабатывает
      const jsClicked = await page.evaluate(() => {
        const btn = document.getElementById('sign_btn') || document.querySelector('button[id*="sign"]') || document.querySelector('[id*="sign_btn"]');
        const byText = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')).find(el => /подписать/i.test(el.textContent || el.value || ''));
        const el = (btn && !btn.disabled) ? btn : (byText && !byText.disabled) ? byText : null;
        if (!el) return false;
        el.focus();
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        ['mousedown', 'mouseup', 'click'].forEach(type => {
          el.dispatchEvent(new MouseEvent(type, { view: window, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
        });
        return true;
      }).catch(() => false);
      if (jsClicked) console.log(`[Taxcom] Клик по "Подписать" через JS (события мыши — вызов КриптоПро).`);
      await page.waitForTimeout(400);
      await signButton.click({ force: true }).catch(() => signButton.click());
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const btn = document.getElementById('sign_btn') || document.querySelector('button[id*="sign"]');
        if (btn && !btn.disabled) btn.click();
      }).catch(() => {});
      await page.waitForTimeout(800);
      await takeScreenshot(page, `sign_${titleName}_dialog`, env, `Диалог подписания ${titleName}`);
      
      // Такском в доверенных → подпись без диалога «Да». Автоклик отключён.
      
      // Проверяем, появилась ли модалка про мобильное приложение
      const mobileAppModal = page.locator('text=/мобильном приложении|подтвердите подписание|отправлен на подпись/i').first();
      if ((await mobileAppModal.count()) > 0) {
        const modalText = await mobileAppModal.textContent().catch(() => '');
        console.warn(`[Taxcom] ⚠ Появилась модалка про мобильное приложение: ${modalText}`);
        console.warn(`[Taxcom] ⚠ Закрываю модалку и ищу способ подписания через КриптоПро...`);
        
        // Закрываем модалку
        await closeModalDialogs(page, env);
        await page.waitForTimeout(1000);
        
        // Ищем альтернативные способы подписания через КриптоПро
        const cryptoProButtons = [
          page.locator('button:has-text("Подписать через КриптоПро")').first(),
          page.locator('button:has-text("КриптоПро")').first(),
          page.locator('a:has-text("КриптоПро")').first(),
          page.locator('button[class*="crypto"], button[class*="cryptopro"]').first(),
          page.locator('select[name*="sign"], select[id*="sign"]').first() // Может быть выбор способа подписания
        ];
        
        let cryptoProButtonFound = false;
        for (const btn of cryptoProButtons) {
          if ((await btn.count()) > 0) {
            const isVisible = await btn.isVisible().catch(() => false);
            if (isVisible) {
              console.log(`[Taxcom] Найдена кнопка подписания через КриптоПро, нажимаю...`);
              await btn.click();
              await page.waitForTimeout(2000);
              await takeScreenshot(page, `sign_${titleName}_cryptopro_click`, env, `Нажата кнопка КриптоПро для ${titleName}`);
              cryptoProButtonFound = true;
              break;
            }
          }
        }
        
        // Если есть select для выбора способа подписания
        const signMethodSelect = page.locator('select[name*="sign"], select[id*="sign"], select[name*="method"]').first();
        if ((await signMethodSelect.count()) > 0) {
          const selectVisible = await signMethodSelect.isVisible().catch(() => false);
          if (selectVisible) {
            console.log(`[Taxcom] Найден select для выбора способа подписания, выбираю КриптоПро...`);
            // Пробуем выбрать вариант с КриптоПро
            await signMethodSelect.selectOption({ label: /криптопро/i });
            await page.waitForTimeout(1000);
            // Пробуем снова нажать "Подписать"
            const signBtnAgain = page.locator('button:has-text("Подписать")').first();
            if ((await signBtnAgain.count()) > 0) {
              await signBtnAgain.click();
              await page.waitForTimeout(2000);
              await takeScreenshot(page, `sign_${titleName}_after_method_select`, env, `После выбора способа подписания для ${titleName}`);
            }
          }
        }
        
        if (!cryptoProButtonFound) {
          console.warn(`[Taxcom] ⚠ Не найдено способа подписания через КриптоПро. Возможно, нужно настроить в профиле Такском.`);
          console.warn(`[Taxcom] ⚠ Проверь настройки профиля диспетчера в Такском - должен быть выбран способ подписания "КриптоПро" вместо мобильного приложения.`);
          await takeScreenshot(page, `sign_${titleName}_no_cryptopro_option`, env, `Нет опции КриптоПро для ${titleName}`);
        }
      }
      
      // Ждём появления диалога КриптоПро или модального окна
      console.log(`[Taxcom] Ожидаю подписание ${titleName} (до 60 сек)...`);
      
      // Показываем информацию о нужном сертификате
      const certMapping = {
        dispatcher: env.CERT_DISPATCHER || 'диспетчера (например, Амиргамзаев)',
        medic: env.CERT_MEDIC || 'медика (например, Поливода)',
        mechanic: env.CERT_MECHANIC || 'механика (например, Иванов)'
      };
      const certHint = certMapping[role] || role;
      console.log(`[Taxcom] Сертификат для роли "${role}": ${certHint}`);
      
      await runCertPicker(env, role);
      
      // Ждём завершения подписания — при доверенном сайте подпись почти мгновенная
      let signed = false;
      for (let i = 0; i < 30; i++) { // 30 * 2 = 60 сек макс, проверка каждые 2 сек
        await page.waitForTimeout(2000);
        
        // Проверяем, есть ли сообщение об успешной подписи или ошибке (не путать с модалкой выбора типа подписи: Подписант/Тип подписи)
        const successMsg = page.locator('text=/подписан|успешно|готов|подпись.*принята|Подписание документов/i').first();
        const errorMsg = page.locator('text=/ошибка|error|отклонен|не подписан|не удалось подписать|документ не подписан/i').first();
        
        if ((await successMsg.count()) > 0) {
          const msgText = await successMsg.textContent().catch(() => '');
          console.log(`[Taxcom] ✓ ${titleName} подписан успешно. Сообщение: ${msgText}`);
          await takeScreenshot(page, `sign_${titleName}_success`, env, `${titleName} подписан успешно`);
          signed = true;
          break;
        }
        
        if ((await errorMsg.count()) > 0) {
          const msgText = await errorMsg.textContent().catch(() => '');
          if (isSignatureTypeModalText(msgText)) {
            if (i === 0 || i % 5 === 0) {
              console.log(`[Taxcom] Открыта модалка выбора типа подписи — ждём подписание ${titleName}...`);
            }
          } else {
            console.error(`[Taxcom] ⛔ ОШИБКА ПОДПИСАНИЯ ${titleName}: ${msgText}`);
            await takeScreenshot(page, `sign_${titleName}_error`, env, `Ошибка при подписании ${titleName}`);
            // Проверяем наличие других ошибок на странице
            const allErrors = await page.locator('.error, .alert-danger, .alert-error, [class*="error"], [class*="Error"], .invalid-feedback, .text-danger').allTextContents().catch(() => []);
            if (allErrors.length > 0) {
              console.error(`[Taxcom] ⛔ Найдены дополнительные ошибки на странице:`, allErrors.filter(e => e.trim()).join('; '));
            }
            return false;
          }
        }
        
        // Проверяем наличие ошибок валидации в полях формы
        const validationErrors = await page.locator('input.is-invalid, select.is-invalid, textarea.is-invalid, [aria-invalid="true"]').count();
        if (validationErrors > 0) {
          console.warn(`[Taxcom] ⚠ Обнаружено ${validationErrors} полей с ошибками валидации`);
          const errorFields = await page.locator('input.is-invalid, select.is-invalid').all();
          for (const field of errorFields.slice(0, 5)) {
            let fieldName = await field.getAttribute('name').catch(() => null);
            if (!fieldName) {
              fieldName = await field.getAttribute('id').catch(() => null);
            }
            if (!fieldName) {
              fieldName = 'неизвестное поле';
            }
            const errorText = await field.evaluate(el => {
              const parent = el.closest('.form-group, .mb-3, .form-control-group');
              if (parent) {
                const errorMsg = parent.querySelector('.invalid-feedback, .error-message');
                return errorMsg ? errorMsg.textContent : '';
              }
              return '';
            }).catch(() => '');
            console.warn(`[Taxcom]   - Поле "${fieldName}": ${errorText || 'ошибка валидации'}`);
          }
        }
        
        // Проверяем, изменился ли URL (может быть редирект после подписания)
        const currentUrl = page.url();
        if (currentUrl.includes('/sign') || currentUrl.includes('/signed')) {
          console.log(`[Taxcom] URL изменился, возможно подписание завершено: ${currentUrl}`);
          signed = true;
          break;
        }
        
        if (i === 0 || i % 2 === 0) {
          console.log(`[Taxcom] Ожидание подписания ${titleName}... (${(i + 1) * 5} сек из 60)`);
        }
      }
      
      // Финальная проверка
      await takeScreenshot(page, `sign_${titleName}_after`, env, `Страница после подписания ${titleName}`);
      
      // Если уже зафиксировали успех — не ищем "ошибки" по тексту страницы: там могут быть подпись/Подписант/тип подписи и т.д.
      if (signed) {
        await closeModalDialogs(page, env);
        const titleStatus = page.locator('text=/титул.*подписан|статус.*подписан/i').first();
        if ((await titleStatus.count()) > 0) {
          const statusText = await titleStatus.textContent().catch(() => '');
          console.log(`[Taxcom] ✓ ${titleName} подписан успешно (подтверждено статусом: ${statusText.trim()})`);
        }
        return true;
      }
      
      // Финальная проверка на ошибки только если успех ещё не зафиксирован
      const finalErrorCss = page.locator('.error, .alert-danger, .alert-error, [class*="error"], [class*="Error"]').first();
      if ((await finalErrorCss.count()) > 0) {
        const errorText = await finalErrorCss.textContent().catch(() => '') || '';
        console.error(`[Taxcom] ⛔ ОШИБКА ПОДПИСАНИЯ ${titleName} (финальная проверка): ${errorText.trim()}`);
        await takeScreenshot(page, `sign_${titleName}_error_final`, env, `Ошибка подписания ${titleName} (финальная проверка)`);
        await closeModalDialogs(page, env);
        return false;
      }
      
      // Проверка статуса "Отправлен в Госключ" (особенно для Т1)
      const goskluchStatus = page.locator('text=/госключ|отправлен.*госключ|Госключ/i').first();
      if ((await goskluchStatus.count()) > 0) {
        const goskluchText = await goskluchStatus.textContent().catch(() => '');
        if (goskluchText.toLowerCase().includes('госключ') || goskluchText.toLowerCase().includes('отправлен')) {
          console.warn(`[Taxcom] ⚠ ${titleName} отправлен в Госключ, но не подписан через КриптоПро.`);
          console.warn(`[Taxcom] ⚠ Нужно подписать ${titleName} вручную через КриптоПро в браузере.`);
          await takeScreenshot(page, `sign_${titleName}_goskluch`, env, `${titleName} отправлен в Госключ`);
          await closeModalDialogs(page, env);
          return false;
        }
      }
      
      if (signed) {
        return true;
      }
      
      // Проверяем ещё раз наличие сообщения об успехе (в т.ч. «Подписание документов» от Такском)
      const finalSuccessMsg = page.locator('text=/подписан|успешно|готов|Подписание документов/i').first();
      if ((await finalSuccessMsg.count()) > 0) {
        const successText = await finalSuccessMsg.textContent().catch(() => '');
        console.log(`[Taxcom] ✓ ${titleName} подписан успешно (проверка после ожидания). Сообщение: ${successText}`);
        // Закрываем модальные окна после успешного подписания
        await closeModalDialogs(page, env);
        return true;
      }
      
      // Всё равно закрываем модальные окна перед завершением
      await closeModalDialogs(page, env);
      
      // Последняя проверка - может быть ошибка не видна в тексте, но есть в DOM
      const hasErrorClass = await page.locator('.error, .alert-danger, [class*="error"]').count();
      if (hasErrorClass > 0) {
        console.error(`[Taxcom] ⛔ Обнаружены элементы с классом ошибки на странице (${hasErrorClass} шт.)`);
        await takeScreenshot(page, `sign_${titleName}_suspected_error`, env, `Возможная ошибка подписания ${titleName}`);
        return false;
      }
      
      console.log(`[Taxcom] Подписание ${titleName} завершено (или ожидает подтверждения). Проверь скриншот sign_${titleName}_after.`);
      return true;
    } else {
      // Ищем кнопку "Подписать", даже если она disabled
      let disabledSignButton = null;
      for (const btn of signBtnSelectors) {
        if ((await btn.count()) > 0) {
          const isVisible = await btn.isVisible().catch(() => false);
          if (isVisible) {
            const isEnabled = await btn.isEnabled().catch(() => false);
            if (!isEnabled) {
              disabledSignButton = btn;
              break;
            }
          }
        }
      }
      
      if (disabledSignButton) {
        console.warn(`[Taxcom] ⚠ Кнопка "Подписать" для ${titleName} найдена, но НЕАКТИВНА (disabled).`);
        await takeScreenshot(page, `sign_${titleName}_button_disabled`, env, `Кнопка Подписать ${titleName} неактивна`);
        
        // Проверяем причину неактивности
        const disabledReason = await disabledSignButton.evaluate(el => {
          const disabled = el.hasAttribute('disabled');
          const ariaDisabled = el.getAttribute('aria-disabled');
          const classList = Array.from(el.classList);
          const parent = el.closest('.disabled, [class*="disabled"]');
          return {
            disabled,
            ariaDisabled,
            classList: classList.join(' '),
            parentDisabled: parent !== null,
            style: el.style.cssText
          };
        }).catch(() => ({}));
        
        console.warn(`[Taxcom] Причина неактивности кнопки:`, JSON.stringify(disabledReason, null, 2));
        
        // Проверяем, есть ли незаполненные обязательные поля
        const emptyRequiredFields = await page.locator('input[required]:not([value]), select[required]:not([value]), textarea[required]:not([value])').all();
        if (emptyRequiredFields.length > 0) {
          console.warn(`[Taxcom] ⚠ Найдено ${emptyRequiredFields.length} незаполненных обязательных полей - это может быть причиной неактивности кнопки`);
        }
        
        // Проверяем ошибки валидации
        const validationErrors = await page.locator('input.is-invalid, select.is-invalid, .invalid-feedback, .error-message').all();
        if (validationErrors.length > 0) {
          console.warn(`[Taxcom] ⚠ Найдено ${validationErrors.length} ошибок валидации - это может быть причиной неактивности кнопки`);
        }
        
        // Пробуем перезагрузить страницу и проверить снова
        console.log(`[Taxcom] Пробую перезагрузить страницу для ${titleName} и проверить кнопку снова...`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);
        await takeScreenshot(page, `sign_${titleName}_after_reload`, env, `Страница ${titleName} после перезагрузки`);
        
        // Повторно ищем кнопку после перезагрузки
        for (const btn of signBtnSelectors) {
          if ((await btn.count()) > 0) {
            const isVisible = await btn.isVisible().catch(() => false);
            const isEnabled = await btn.isEnabled().catch(() => false);
            if (isVisible && isEnabled) {
              signButton = btn;
              console.log(`[Taxcom] ✓ Кнопка "Подписать" для ${titleName} активирована после перезагрузки страницы`);
              break;
            }
          }
        }
        
        if (!signButton) {
          console.warn(`[Taxcom] ⚠ Кнопка "Подписать" для ${titleName} всё ещё неактивна после перезагрузки`);
          return false;
        }
      } else {
        console.warn(`[Taxcom] Кнопка "Подписать" для ${titleName} не найдена.`);
        // Если видна модалка входа (По логину, Закрыть) — закрываем и ищем кнопку ещё раз
        const loginModal = await page.locator('text=По логину').first().isVisible().catch(() => false);
        if (loginModal) {
          console.log('[Taxcom] Похоже на модалку входа — закрываю и повторно ищу кнопку "Подписать"...');
          await closeModalDialogs(page, env);
          await page.waitForTimeout(2000);
          for (const btn of signBtnSelectors) {
            if ((await btn.count()) > 0) {
              const isVisible = await btn.isVisible().catch(() => false);
              const isEnabled = await btn.isEnabled().catch(() => false);
              if (isVisible && isEnabled) {
                signButton = btn;
                console.log(`[Taxcom] ✓ Кнопка "Подписать" для ${titleName} найдена после закрытия модалки, нажимаю...`);
                await signButton.scrollIntoViewIfNeeded();
                await page.waitForTimeout(500);
                await signButton.click({ force: true }).catch(() => signButton.click());
                await page.waitForTimeout(3000);
                await runCertPicker(env, role);
                await page.waitForTimeout(5000);
                const successMsg = page.locator('text=/подписан|успешно|готов/i').first();
                if ((await successMsg.count()) > 0) {
                  console.log(`[Taxcom] ✓ ${titleName} подписан после закрытия модалки`);
                  return true;
                }
                break;
              }
            }
          }
        }
        if (!signButton) {
          await takeScreenshot(page, `sign_${titleName}_no_button`, env, `Кнопка Подписать ${titleName} не найдена - состояние страницы`);
        }
        // Пробуем найти все кнопки на странице для отладки (только если кнопка так и не найдена)
        const allButtons = signButton ? [] : await page.locator('button, a, input[type="button"], input[type="submit"]').all();
        if (allButtons.length > 0) {
          console.warn(`[Taxcom] На странице найдено ${allButtons.length} кнопок. Проверяю их текст...`);
          for (const btn of allButtons.slice(0, 10)) {
            try {
              const btnText = await btn.textContent().catch(() => '');
              const btnId = await btn.getAttribute('id').catch(() => '');
              const btnClass = await btn.getAttribute('class').catch(() => '');
              const isEnabled = await btn.isEnabled().catch(() => false);
              if (btnText && btnText.trim()) {
                console.warn(`[Taxcom]   - Кнопка: "${btnText.trim()}" (id=${btnId}, class=${btnClass}, enabled=${isEnabled})`);
              }
            } catch (btnErr) {
              // Игнорируем ошибки
            }
          }
        }
        return false;
      }
    }
  } catch (signErr) {
    console.warn(`[Taxcom] Ошибка при подписании ${titleName}:`, signErr.message);
    return false;
  }
}

/**
 * Ждёт подтверждения подписи после нажатия «Подписать» (без повторного клика).
 * Используется когда кнопка уже нажата (Т3/Т4 в воркере) — проверяем успех/ошибку на странице.
 * @param {import('playwright').Page} page
 * @param {string} titleName - например 'Т3', 'Т4'
 * @param {object} env
 * @param {number} [maxWaitMs] - макс. время ожидания (по умолчанию 60000)
 * @returns {Promise<boolean>} - true если подпись подтверждена, false если ошибка или таймаут
 */
/** Текст из модалки выбора типа подписи (КриптоПро/Такском) — не считать ошибкой подписания */
function isSignatureTypeModalText(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.replace(/\s+/g, ' ').trim();
  return (
    /Подписант/i.test(t) ||
    /Тип подписи/i.test(t) ||
    /Способ подтверждения полномочий/i.test(t) ||
    (/усиленная\s+(квалифицированная|неквалифицированная)\s+электронная\s+подпись/i.test(t) && /подписант|тип подписи/i.test(t))
  );
}

async function waitForSignSuccess(page, titleName, env, maxWaitMs = 60000) {
  const stepMs = 2000;
  const maxSteps = Math.floor(maxWaitMs / stepMs);
  for (let i = 0; i < maxSteps; i++) {
    await page.waitForTimeout(stepMs);
    const successMsg = page.locator('text=/подписан|успешно|готов|подпись.*принята|Подписание документов/i').first();
    const errorMsg = page.locator('text=/ошибка|error|отклонен|не подписан|не удалось подписать|документ не подписан/i').first();
    if ((await successMsg.count()) > 0) {
      const msgText = await successMsg.textContent().catch(() => '');
      console.log(`[Taxcom] ✓ ${titleName} подпись подтверждена. Сообщение: ${msgText}`);
      await takeScreenshot(page, `sign_${titleName}_success`, env, `${titleName} подписан успешно`);
      await closeModalDialogs(page, env);
      return true;
    }
    if ((await errorMsg.count()) > 0) {
      const msgText = await errorMsg.textContent().catch(() => '');
      if (isSignatureTypeModalText(msgText)) {
        if (i === 0 || i % 5 === 0) {
          console.log(`[Taxcom] На странице открыта модалка выбора типа подписи — ждём завершения подписания ${titleName}...`);
        }
        continue;
      }
      console.error(`[Taxcom] ⛔ Ошибка подписания ${titleName}: ${msgText}`);
      await takeScreenshot(page, `sign_${titleName}_error`, env, `Ошибка при подписании ${titleName}`);
      return false;
    }
    if (i === 0 || i % 5 === 0) {
      console.log(`[Taxcom] Ожидание подтверждения подписи ${titleName}... (${(i + 1) * stepMs / 1000} сек)`);
    }
  }
  console.warn(`[Taxcom] Таймаут ожидания подписи ${titleName} (${maxWaitMs / 1000} сек). Подпись не подтверждена.`);
  await takeScreenshot(page, `sign_${titleName}_timeout`, env, `Таймаут подписания ${titleName}`);
  return false;
}

module.exports = {
  signTitle,
  closeModalDialogs,
  waitForSignSuccess
};
