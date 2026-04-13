import os

import fitz  # PyMuPDF


def _pick_font_path() -> str | None:
    # Prefer common Windows fonts with Cyrillic support.
    candidates = [
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\ARIAL.TTF",
        r"C:\Windows\Fonts\times.ttf",
        r"C:\Windows\Fonts\TIMES.TTF",
        r"C:\Windows\Fonts\calibri.ttf",
        r"C:\Windows\Fonts\CALIBRI.TTF",
        r"C:\Windows\Fonts\verdana.ttf",
        r"C:\Windows\Fonts\VERDANA.TTF",
        r"C:\Windows\Fonts\tahoma.ttf",
        r"C:\Windows\Fonts\TAHOMA.TTF",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def _pick_bold_font_path() -> str | None:
    candidates = [
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\ARIALBD.TTF",
        r"C:\Windows\Fonts\calibrib.ttf",
        r"C:\Windows\Fonts\CALIBRIB.TTF",
        r"C:\Windows\Fonts\verdanab.ttf",
        r"C:\Windows\Fonts\VERDANAB.TTF",
        r"C:\Windows\Fonts\tahomabd.ttf",
        r"C:\Windows\Fonts\TAHOMABD.TTF",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def _wrap_words(text: str, font: fitz.Font, fontsize: float, max_width: float) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur: list[str] = []
    for w in words:
        trial = (" ".join(cur + [w])).strip()
        if not trial:
            cur = [w]
            continue
        if font.text_length(trial, fontsize=fontsize) <= max_width:
            cur.append(w)
        else:
            if cur:
                lines.append(" ".join(cur))
            # very long single token fallback
            if font.text_length(w, fontsize=fontsize) <= max_width:
                cur = [w]
            else:
                # hard split long token
                part = ""
                for ch in w:
                    trial2 = part + ch
                    if font.text_length(trial2, fontsize=fontsize) <= max_width:
                        part = trial2
                    else:
                        if part:
                            lines.append(part)
                        part = ch
                cur = [part] if part else []
    if cur:
        lines.append(" ".join(cur))
    return lines


def _ensure_space(page_h: float, margin: float, y: float, need_h: float) -> bool:
    return (y + need_h) <= (page_h - margin)


def _draw_paragraph(
    page: fitz.Page,
    text: str,
    *,
    x: float,
    y: float,
    width: float,
    fontfile: str,
    font: fitz.Font,
    fontsize: float,
    leading: float,
    space_after: float,
) -> float:
    for line in _wrap_words(text, font, fontsize, width):
        page.insert_text(fitz.Point(x, y), line, fontfile=fontfile, fontsize=fontsize)
        y += leading
    return y + space_after


def _draw_bullets(
    page: fitz.Page,
    items: list[str],
    *,
    x: float,
    y: float,
    width: float,
    fontfile: str,
    font: fitz.Font,
    fontsize: float,
    leading: float,
    bullet_gap: float,
    space_after: float,
) -> float:
    bullet = "•"
    bullet_w = font.text_length(bullet + " ", fontsize=fontsize)
    text_x = x + bullet_w + 4
    text_width = width - (bullet_w + 4)
    for it in items:
        # first line with bullet
        lines = _wrap_words(it, font, fontsize, text_width)
        if not lines:
            continue
        page.insert_text(fitz.Point(x, y), bullet, fontfile=fontfile, fontsize=fontsize)
        page.insert_text(fitz.Point(text_x, y), lines[0], fontfile=fontfile, fontsize=fontsize)
        y += leading
        for l in lines[1:]:
            page.insert_text(fitz.Point(text_x, y), l, fontfile=fontfile, fontsize=fontsize)
            y += leading
        y += bullet_gap
    return y + space_after


def main() -> None:
    company_name = "TaxiSite"
    contact_line = "Тел.: ____________________   Telegram: ____________________"
    title = "Коммерческое предложение\nПереход на ЭПЛ для таксопарка"

    out_path = os.path.join(os.path.dirname(__file__), "КП_ЭПЛ_для_парка.pdf")

    font_regular = _pick_font_path()
    if not font_regular:
        raise RuntimeError(
            "Не найден системный TTF шрифт (например arial.ttf). "
            "Нужен шрифт с поддержкой кириллицы."
        )
    font_bold = _pick_bold_font_path()
    # Use the regular font if bold isn't found.
    font_bold = font_bold or font_regular

    doc = fitz.open()

    page_w, page_h = fitz.paper_size("a4")
    margin = 56  # ~2cm
    width = page_w - 2 * margin

    def new_page() -> fitz.Page:
        p = doc.new_page(width=page_w, height=page_h)
        return p

    page = new_page()
    # Create font objects for correct text measurement (Cyrillic-safe).
    font_obj = fitz.Font(fontfile=font_regular)
    font_bold_obj = fitz.Font(fontfile=font_bold)

    # Typography
    title_size = 20
    h_size = 13
    text_size = 11
    small_size = 10
    leading = 15
    leading_small = 13

    y = margin

    # ===== Header =====
    page.insert_text(
        fitz.Point(margin, y),
        company_name,
        fontfile=font_bold,
        fontsize=14,
    )
    page.insert_text(
        fitz.Point(page_w - margin - font_obj.text_length(contact_line, fontsize=small_size), y + 2),
        contact_line,
        fontfile=font_regular,
        fontsize=small_size,
    )
    y += 18
    # Divider line
    page.draw_line(
        fitz.Point(margin, y),
        fitz.Point(page_w - margin, y),
        color=(0.7, 0.7, 0.7),
        width=0.8,
    )
    y += 18

    # ===== Title =====
    for line in title.split("\n"):
        page.insert_text(fitz.Point(margin, y), line, fontfile=font_bold, fontsize=title_size)
        y += 24
    y += 8

    # Intro
    y = _draw_paragraph(
        page,
        "Здравствуйте!",
        x=margin,
        y=y,
        width=width,
        fontfile=font_bold,
        font=font_bold_obj,
        fontsize=text_size,
        leading=leading,
        space_after=6,
    )
    y = _draw_paragraph(
        page,
        "Мы помогаем таксопаркам перейти на электронные путевые листы (ЭПЛ) без лишней рутины и без сбоев в выпуске.",
        x=margin,
        y=y,
        width=width,
        fontfile=font_regular,
        font=font_obj,
        fontsize=text_size,
        leading=leading,
        space_after=12,
    )

    # Section 1
    page.insert_text(fitz.Point(margin, y), "Как это работает (просто)", fontfile=font_bold, fontsize=h_size)
    y += 18
    y = _draw_bullets(
        page,
        [
            "Один раз подключаем парк: заносим/синхронизируем парк, автомобили и водителей.",
            "Дальше водители работают сами: водитель заходит в личный кабинет и создаёт ЭПЛ в нашей системе без сложностей — всё ведётся централизованно и прозрачно для парка.",
            "Парк всегда видит контроль: статусы, документы/QR, смены, история — в одном месте, без “потерянных” путевых и ручных сверок.",
        ],
        x=margin,
        y=y,
        width=width,
        fontfile=font_regular,
        font=font_obj,
        fontsize=text_size,
        leading=leading,
        bullet_gap=4,
        space_after=10,
    )

    # Section 2
    if not _ensure_space(page_h, margin, y, 120):
        page = new_page()
        y = margin
    page.insert_text(fitz.Point(margin, y), "Почему выгодно подключиться уже сейчас", fontfile=font_bold, fontsize=h_size)
    y += 18
    y = _draw_bullets(
        page,
        [
            "Плавный переход без аврала: когда требования станут массовыми, у тех, кто начнёт “в последний момент”, будет хаос и ошибки. Сейчас можно спокойно настроить и обучить.",
            "Если не подключиться заранее — почти всегда будут потери времени и денег: ручное оформление и разрозненные процессы приводят к ошибкам в данных, возвратам/переделкам, простоям водителей, лишним звонкам и “разбору полётов”. В итоге парк платит временем сотрудников и потерянной выручкой.",
            "Экономия времени и меньше ошибок: один раз настроили — дальше процесс у водителя проходит быстро и одинаково для всех.",
        ],
        x=margin,
        y=y,
        width=width,
        fontfile=font_regular,
        font=font_obj,
        fontsize=text_size,
        leading=leading,
        bullet_gap=4,
        space_after=10,
    )

    # Startup requirements block
    if not _ensure_space(page_h, margin, y, 140):
        page = new_page()
        y = margin
    page.insert_text(fitz.Point(margin, y), "Что нужно от парка для старта (3 пункта)", fontfile=font_bold, fontsize=h_size)
    y += 18
    y = _draw_bullets(
        page,
        [
            "Доступ/данные по парку и ответственному: название, ИНН/реквизиты (если нужны в ЭПЛ), контактное лицо.",
            "Список автомобилей (или доступ к выгрузке): госномер, марка/модель, VIN (если есть).",
            "Список водителей (или доступ к выгрузке): ФИО, телефон, привязка к авто (если уже есть).",
        ],
        x=margin,
        y=y,
        width=width,
        fontfile=font_regular,
        font=font_obj,
        fontsize=text_size,
        leading=leading,
        bullet_gap=4,
        space_after=8,
    )

    # Section 3 (hard block)
    if not _ensure_space(page_h, margin, y, 210):
        page = new_page()
        y = margin
    page.insert_text(
        fitz.Point(margin, y),
        "Почему “выбора нет” и почему важно готовиться заранее (про 1 сентября 2026)",
        fontfile=font_bold,
        fontsize=h_size,
    )
    y += 18
    y = _draw_paragraph(
        page,
        "С 1 сентября 2026 года рынок перевозок переходит на электронные перевозочные документы, включая электронный путевой лист (ЭПЛ), с передачей/регистрацией через ГИС ЭПД (государственную систему электронных перевозочных документов).",
        x=margin,
        y=y,
        width=width,
        fontfile=font_regular,
        font=font_obj,
        fontsize=text_size,
        leading=leading,
        space_after=8,
    )
    y = _draw_paragraph(
        page,
        "Это не “мода”, а смена обязательного формата работы: документы формируются в системе, подписываются электронной подписью и проходят проверку/статусы в цифровом контуре. Бумажный подход перестаёт быть рабочей моделью — придётся выстроить электронный процесс.",
        x=margin,
        y=y,
        width=width,
        fontfile=font_regular,
        font=font_obj,
        fontsize=text_size,
        leading=leading,
        space_after=10,
    )
    y = _draw_bullets(
        page,
        [
            "Меняется не бумажка на PDF, а процессы и ответственность: кто формирует, кто подписывает, кто контролирует, как исправляются ошибки. В электронном контуре “подтереть ручкой” нельзя — при ошибке оформляется новая версия документа по регламенту.",
            "Без электронных подписей и системы, которая поддерживает формат и обмен, документ не будет считаться оформленным корректно.",
            "В последний момент будет дорого: неподготовленные парки упираются в хаос с данными водителей/ТС, подписью, регламентом по ролям, обучением персонала — это прямые потери времени, простоев и денег.",
        ],
        x=margin,
        y=y,
        width=width,
        fontfile=font_regular,
        font=font_obj,
        fontsize=text_size,
        leading=leading,
        bullet_gap=4,
        space_after=10,
    )

    # Offer / CTA
    if not _ensure_space(page_h, margin, y, 120):
        page = new_page()
        y = margin
    page.insert_text(fitz.Point(margin, y), "Что мы предлагаем", fontfile=font_bold, fontsize=h_size)
    y += 18
    y = _draw_paragraph(
        page,
        "Мы подключаем парк “под ключ”: настроим парк/авто/водителей один раз, выдадим доступы, обучим ответственных и запустим пилот на нескольких водителях. У вас всё будет готово заранее — остаётся только масштабироваться.",
        x=margin,
        y=y,
        width=width,
        fontfile=font_regular,
        font=font_obj,
        fontsize=text_size,
        leading=leading,
        space_after=10,
    )

    y = _draw_paragraph(
        page,
        "Источник с понятным разбором (для руководителя):",
        x=margin,
        y=y,
        width=width,
        fontfile=font_bold,
        font=font_bold_obj,
        fontsize=text_size,
        leading=leading,
        space_after=2,
    )
    y = _draw_paragraph(
        page,
        "https://companies.rbc.ru/news/O7ROzajvr7/epl-2026-prakticheskaya-instruktsiya-dlya-biznesa/",
        x=margin,
        y=y,
        width=width,
        fontfile=font_regular,
        font=font_obj,
        fontsize=small_size,
        leading=leading_small,
        space_after=10,
    )

    page.insert_text(fitz.Point(margin, y), "Контакт для связи: ____________________", fontfile=font_regular, fontsize=text_size)
    y += 18
    page.draw_line(
        fitz.Point(margin, y),
        fitz.Point(page_w - margin, y),
        color=(0.7, 0.7, 0.7),
        width=0.8,
    )
    y += 12
    page.insert_text(
        fitz.Point(margin, y),
        "С уважением, ____________________",
        fontfile=font_regular,
        fontsize=text_size,
    )
    y += 14
    page.insert_text(
        fitz.Point(margin, y),
        contact_line,
        fontfile=font_regular,
        fontsize=small_size,
    )

    doc.save(out_path)
    doc.close()
    print("OK:", out_path)


if __name__ == "__main__":
    main()

