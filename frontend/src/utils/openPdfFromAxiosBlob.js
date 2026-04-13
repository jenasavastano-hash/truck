/**
 * Открывает PDF из ответа axios с responseType: 'blob'.
 * Пересобирает Blob с type application/pdf — иначе Edge/Chrome иногда показывают пустую вкладку.
 */
export async function openPdfFromAxiosBlob(res) {
  const raw = res?.data;
  if (!(raw instanceof Blob)) {
    throw new Error('Неверный ответ сервера');
  }

  const buf = await raw.arrayBuffer();
  if (buf.byteLength < 5) {
    throw new Error('Документ ещё не загружен или пустой. Подождите или обновите страницу.');
  }

  const head = new Uint8Array(buf.slice(0, 4));
  const isPdf =
    head[0] === 0x25 &&
    head[1] === 0x50 &&
    head[2] === 0x44 &&
    head[3] === 0x46; // %PDF

  if (!isPdf) {
    const text = new TextDecoder().decode(buf.slice(0, 800));
    const t = text.trimStart();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const j = JSON.parse(new TextDecoder().decode(buf));
        if (j && typeof j.error === 'string') throw new Error(j.error);
      } catch (e) {
        if (e instanceof Error && e.message && !e.message.includes('JSON')) throw e;
      }
    }
    throw new Error('Сервер вернул не PDF. Проверьте, что документ уже сформирован.');
  }

  const pdfBlob = new Blob([buf], { type: 'application/pdf' });
  const url = URL.createObjectURL(pdfBlob);

  const newWin = window.open(url, '_blank', 'noopener,noreferrer');
  if (!newWin) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
