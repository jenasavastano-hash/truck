from __future__ import annotations

"""
Worker: генерация быстрого путевого листа.

Берёт ОРИГИНАЛЬНЫЙ 2702.pdf, находит в нём конкретные строки (несколько
вариантов якорей под разные версии бланка), стирает и пишет новые значения.

Вывод:
  - в файл (--output path.pdf)
  - в stdout как base64 (--output -)  ← для вызова из Node.js

Опционально для ПГ: --route-line / --trip-start-line и якоря из JSON
(см. worker_ep_l.freight-defaults.json или --extras-json).
"""

import argparse
import base64
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

import fitz  # PyMuPDF


BODY_FONTSIZE = 7
HEADER_FONTSIZE = 11

_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "C:/Windows/Fonts/arial.ttf",
]
_BOLD_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]


def _find_font(candidates: list[str]) -> str:
    for p in candidates:
        if os.path.isfile(p):
            return p
    return candidates[-1]


FONT_PATH = _find_font(_FONT_CANDIDATES)
FONT_BOLD_PATH = _find_font(_BOLD_FONT_CANDIDATES)
FONT_NAME = "eplfont"
FONT_BOLD_NAME = "eplfontbold"


def _sp_variants(s: str) -> tuple[str, ...]:
    """Пробел / неразрывный пробел — в бланке встречаются оба варианта."""
    if not s:
        return (s,)
    nb = s.replace(" ", "\u00a0")
    if nb == s:
        return (s,)
    return (s, nb)


@dataclass
class FieldSpec:
    """Одно логическое поле: несколько якорей (первая подходящая версия бланка)."""

    name: str
    anchors: tuple[str, ...]
    date_prefix: Optional[str] = None  # "from" | "to"
    optional: bool = False


HEADER_Y_THRESHOLD = 35.0
_MAX_OCCURRENCES_PER_FIELD = 24


def _norm_pdf_text(s: str) -> str:
    return (s or "").replace("\u00a0", " ").replace("\u2009", " ")


def _expand_anchors(anchors: Iterable[str]) -> tuple[str, ...]:
    out: list[str] = []
    seen: set[str] = set()
    for a in anchors:
        for v in _sp_variants(a):
            if v not in seen:
                seen.add(v)
                out.append(v)
    return tuple(out)


# Якоря — дословные фрагменты из эталонного 2702.pdf (пассажирский мастер) + типовые варианты.
# «Вид перевозки» / «Вид сообщения» подставляет Node по коду ПГ/РП/…
def _base_field_specs() -> list[FieldSpec]:
    return [
        FieldSpec("date_from", _expand_anchors(("от 27.02.2026",)), date_prefix="from"),
        FieldSpec("date_to", _expand_anchors(("до 28.02.2026",)), date_prefix="to"),
        FieldSpec(
            "org_line",
            _expand_anchors(
                (
                    'ООО "БЕНЕФИС" ИНН: 7737548088 КПП: 772401001 ОГРН: 1097746138159',
                )
            ),
        ),
        FieldSpec(
            "vehicle_line",
            _expand_anchors(
                (
                    "Тип: легковой, Марка: SKODА , Модель: RAPID Rest, Регистрационный номер: К214ТН797",
                    "Тип: грузовой, Марка: SKODА , Модель: RAPID Rest, Регистрационный номер: К214ТН797",
                )
            ),
        ),
        FieldSpec(
            "driver_line",
            _expand_anchors(
                (
                    "Овакимян Рафик Артёмович , ИНН: 693200308732 Водительское удостоверение: 9939 972827",
                )
            ),
        ),
        FieldSpec(
            "med_datetime",
            _expand_anchors(
                (
                    "27.02.2026 19:24:00 (+03:00 UTC)",
                    "27.02.2026 19:24:00 (+03:00)",
                )
            ),
        ),
        FieldSpec(
            "tech_datetime",
            _expand_anchors(
                (
                    "27.02.2026 19:28:00 (+03:00 UTC)",
                    "27.02.2026 19:28:00 (+03:00)",
                )
            ),
        ),
        FieldSpec(
            "release_datetime",
            _expand_anchors(
                (
                    "27.02.2026 19:33:00 (+03:00 UTC)",
                    "27.02.2026 19:33:00 (+03:00)",
                )
            ),
        ),
        FieldSpec(
            "start_datetime",
            _expand_anchors(
                (
                    "27.02.2026 20:27:00 (+03:00 UTC)",
                    "27.02.2026 20:27:00 (+03:00)",
                )
            ),
        ),
        FieldSpec("start_odometer", _expand_anchors(("4125",))),
        FieldSpec(
            "shipping_line",
            _expand_anchors(
                (
                    "коммерческие перевозки, регулярная перевозка пассажиров и багажа",
                    "коммерческие перевозки, Перевозка грузов на основании договора перевозки грузов",
                )
            ),
        ),
        FieldSpec("message_kind", _expand_anchors(("городское", "пригородное"))),
    ]


@dataclass
class EpLData:
    date_from: str
    date_to: str
    shipping_line: str
    message_kind: str
    org_line: str
    vehicle_line: str
    driver_line: str
    med_datetime: str
    tech_datetime: str
    release_datetime: str
    start_datetime: str
    start_odometer: str
    route_line: str = ""
    trip_start_line: str = ""


def _format_value_for_field(spec: FieldSpec, raw: str) -> str:
    v = raw
    if spec.date_prefix == "from":
        v = f"от {raw}"
    elif spec.date_prefix == "to":
        v = f"до {raw}"
    return _norm_pdf_text(v)


def _shipping_body_fontsize(new_value: str) -> Optional[float]:
    if len(new_value) > 72:
        return 5.85
    return None


def _replace_one_hit(
    page: fitz.Page,
    rect: fitz.Rect,
    new_text: str,
    *,
    body_fontsize: Optional[float] = None,
) -> None:
    page.add_redact_annot(rect, fill=(1, 1, 1))
    page.apply_redactions()

    is_header = rect.y0 < HEADER_Y_THRESHOLD
    if is_header:
        fs = HEADER_FONTSIZE
        fname = FONT_BOLD_NAME
        ffile = FONT_BOLD_PATH
    else:
        fs = body_fontsize if body_fontsize is not None else BODY_FONTSIZE
        fname = FONT_NAME
        ffile = FONT_PATH

    page.insert_text(
        (rect.x0, rect.y1 - 1.5),
        new_text,
        fontsize=fs,
        fontname=fname,
        fontfile=ffile,
    )


def _apply_field_to_doc(doc: fitz.Document, spec: FieldSpec, new_text: str) -> bool:
    """Ищет первый подходящий якорь на любой странице; снимает все вхождения этого якоря."""
    new_text = _norm_pdf_text(new_text)
    body_fs: Optional[float] = None
    if spec.name == "shipping_line":
        body_fs = _shipping_body_fontsize(new_text)

    any_replaced = False
    for anchor in spec.anchors:
        anchor_had_hits = False
        for pi in range(doc.page_count):
            page = doc[pi]
            for _ in range(_MAX_OCCURRENCES_PER_FIELD):
                hits = page.search_for(anchor)
                if not hits:
                    break
                anchor_had_hits = True
                any_replaced = True
                rect = hits[0]
                _replace_one_hit(page, rect, new_text, body_fontsize=body_fs)
        if anchor_had_hits:
            return any_replaced
    return any_replaced


def _warn_missing(spec: FieldSpec) -> None:
    if not spec.optional:
        print(f"  [WARN] field {spec.name!r}: no matching anchor in PDF", file=sys.stderr)


def _load_json_path(p: Optional[Path]) -> dict[str, Any]:
    if not p:
        return {}
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"  [WARN] extras JSON unreadable {p}: {e}", file=sys.stderr)
        return {}


def _merge_freight_anchors(
    base: list[FieldSpec],
    freight_defaults: dict[str, Any],
    extras: dict[str, Any],
) -> list[FieldSpec]:
    """Добавляет/переопределяет поля route_line / trip_start_line по якорям из JSON."""
    merged = {s.name: s for s in base}

    def pick(key: str) -> list[str]:
        v = extras.get(key) or freight_defaults.get(key) or []
        if isinstance(v, list):
            return [str(x) for x in v if x]
        return []

    rl_anchors = pick("route_line_anchors")
    ts_anchors = pick("trip_start_line_anchors")

    if rl_anchors:
        merged["route_line"] = FieldSpec(
            "route_line",
            _expand_anchors(rl_anchors),
            optional=True,
        )
    if ts_anchors:
        merged["trip_start_line"] = FieldSpec(
            "trip_start_line",
            _expand_anchors(ts_anchors),
            optional=True,
        )

    return list(merged.values())


def _ordered_specs(specs: list[FieldSpec]) -> list[FieldSpec]:
    """Стабильный порядок как в исходном бланке (сверху вниз по типичному макету)."""
    order = [
        "date_from",
        "date_to",
        "org_line",
        "vehicle_line",
        "driver_line",
        "med_datetime",
        "tech_datetime",
        "release_datetime",
        "start_datetime",
        "start_odometer",
        "shipping_line",
        "message_kind",
        "route_line",
        "trip_start_line",
    ]
    by_name = {s.name: s for s in specs}
    out: list[FieldSpec] = []
    for name in order:
        if name in by_name:
            out.append(by_name[name])
    for s in specs:
        if s.name not in order:
            out.append(s)
    return out


def render_ep_l(
    source_path: Path,
    data: EpLData,
    *,
    freight_defaults_path: Optional[Path] = None,
    extras_json_path: Optional[Path] = None,
) -> bytes:
    doc = fitz.open(str(source_path))
    try:
        fd = _load_json_path(freight_defaults_path)
        ex = _load_json_path(extras_json_path)
        merged_ex = {**fd, **ex}

        specs = _merge_freight_anchors(_base_field_specs(), fd, ex)
        specs = _ordered_specs(specs)

        for spec in specs:
            raw = getattr(data, spec.name, None)
            if raw is None:
                continue
            if spec.optional and isinstance(raw, str) and not raw.strip():
                continue
            val = _format_value_for_field(spec, raw) if spec.date_prefix else _norm_pdf_text(str(raw))
            ok = _apply_field_to_doc(doc, spec, val)
            if not ok and not spec.optional:
                _warn_missing(spec)
            elif not ok and spec.optional:
                print(
                    f"  [INFO] optional field {spec.name!r} skipped (no anchor; check JSON)",
                    file=sys.stderr,
                )

        return doc.tobytes()
    finally:
        doc.close()


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Render fast EPL PDF.")
    p.add_argument("--source", default="2702.pdf")
    p.add_argument("--output", required=True, help="File path or '-' for base64 stdout.")
    p.add_argument("--date-from", required=True)
    p.add_argument("--date-to", required=True)
    p.add_argument(
        "--shipping-line",
        required=True,
        help="Строка «Вид перевозки» (для ПГ — перевозка грузов по договору).",
    )
    p.add_argument(
        "--message-kind",
        required=True,
        help="Строка «Вид сообщения» (напр. пригородное / городское).",
    )
    p.add_argument("--org-line", required=True)
    p.add_argument("--vehicle-line", required=True)
    p.add_argument("--driver-line", required=True)
    p.add_argument("--med-datetime", required=True)
    p.add_argument("--tech-datetime", required=True)
    p.add_argument("--release-datetime", required=True)
    p.add_argument("--start-datetime", required=True)
    p.add_argument("--start-odometer", required=True)
    p.add_argument(
        "--route-line",
        default="",
        help="ПГ: доп. строка (маршрут); нужны якоря в JSON рядом с воркером или --extras-json.",
    )
    p.add_argument(
        "--trip-start-line",
        default="",
        help="ПГ: доп. строка (начало рейса); якоря — как у --route-line.",
    )
    p.add_argument(
        "--extras-json",
        default="",
        help="JSON с route_line_anchors / trip_start_line_anchors (списки строк-якорей из вашего 2702.pdf).",
    )
    p.add_argument(
        "--freight-defaults-json",
        default="",
        help="Путь к JSON по умолчанию; если не задан — worker_ep_l.freight-defaults.json рядом со скриптом.",
    )
    return p


def main() -> int:
    args = build_arg_parser().parse_args()
    source = Path(args.source).expanduser().resolve()

    if not source.exists():
        raise FileNotFoundError(f"Source PDF not found: {source}")

    script_dir = Path(__file__).resolve().parent
    default_fd = script_dir / "worker_ep_l.freight-defaults.json"
    freight_path = Path(args.freight_defaults_json).expanduser().resolve() if args.freight_defaults_json else default_fd
    extras_path = Path(args.extras_json).expanduser().resolve() if args.extras_json else None

    data = EpLData(
        date_from=args.date_from,
        date_to=args.date_to,
        shipping_line=args.shipping_line,
        message_kind=args.message_kind,
        org_line=args.org_line,
        vehicle_line=args.vehicle_line,
        driver_line=args.driver_line,
        med_datetime=args.med_datetime,
        tech_datetime=args.tech_datetime,
        release_datetime=args.release_datetime,
        start_datetime=args.start_datetime,
        start_odometer=args.start_odometer,
        route_line=(args.route_line or "").strip(),
        trip_start_line=(args.trip_start_line or "").strip(),
    )

    pdf_bytes = render_ep_l(
        source,
        data,
        freight_defaults_path=freight_path if freight_path.is_file() else None,
        extras_json_path=extras_path,
    )

    if args.output == "-":
        sys.stdout.write(base64.b64encode(pdf_bytes).decode("ascii"))
    else:
        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(pdf_bytes)
        print(f"OK: {output}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
