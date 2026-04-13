# -*- coding: utf-8 -*-
"""
Проверка worker_ep_l.py на бланке backend/2702.pdf (положите файл рядом с воркером).

Запуск из корня backend:
  python scripts/test-fast-pdf-freight.py

Или: npm run test:fast-pdf-freight
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
PDF = BACKEND / "2702.pdf"
OUT = BACKEND / "_test_freight_out.pdf"
WORKER = BACKEND / "worker_ep_l.py"


def main() -> int:
    if not PDF.is_file():
        print(
            f"ОШИБКА: нет {PDF}\n"
            "Положите оригинальный бланк 2702.pdf в папку backend/ и повторите.",
            file=sys.stderr,
        )
        return 1

    r = subprocess.run(
        [sys.executable, "-m", "py_compile", str(WORKER)],
        cwd=str(BACKEND),
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        print(r.stderr or r.stdout, file=sys.stderr)
        return r.returncode

    try:
        import fitz  # PyMuPDF
    except ImportError:
        print("ОШИБКА: установите PyMuPDF: pip install pymupdf", file=sys.stderr)
        return 1

    cmd = [
        sys.executable,
        str(WORKER),
        "--source",
        str(PDF),
        "--output",
        str(OUT),
        "--date-from",
        "12.04.2026",
        "--date-to",
        "13.04.2026",
        "--shipping-line",
        "коммерческие перевозки, Перевозка грузов на основании договора перевозки грузов",
        "--message-kind",
        "пригородное",
        "--org-line",
        'ООО "Тест" ИНН: 123',
        "--vehicle-line",
        "Тип: грузовой, Марка: ГАЗ , Модель: 3302, Регистрационный номер: А123ВВ77",
        "--driver-line",
        "Иванов Иван Иванович , ИНН: 770000000000 Водительское удостоверение: 99 88 777777",
        "--med-datetime",
        "27.02.2026 19:24:00 (+03:00 UTC)",
        "--tech-datetime",
        "27.02.2026 19:28:00 (+03:00 UTC)",
        "--release-datetime",
        "27.02.2026 19:33:00 (+03:00 UTC)",
        "--start-datetime",
        "27.02.2026 20:27:00 (+03:00 UTC)",
        "--start-odometer",
        "4125",
    ]
    proc = subprocess.run(cmd, cwd=str(BACKEND))
    if proc.returncode != 0:
        return proc.returncode

    doc = fitz.open(str(OUT))
    try:
        text_n = ""
        for i in range(doc.page_count):
            text_n += doc[i].get_text()
        text_n = text_n.replace("\u00a0", " ")
    finally:
        doc.close()

    (BACKEND / "_test_freight_extract.txt").write_text(text_n, encoding="utf-8")

    assert "Перевозка грузов на основании договора перевозки грузов" in text_n, text_n[:1200]
    assert "пригородное" in text_n
    assert "от 12.04.2026" in text_n
    assert "Тип: грузовой" in text_n or "грузовой" in text_n

    OUT.unlink(missing_ok=True)
    print("OK: freight PDF phrases present (все страницы проверены по тексту)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
