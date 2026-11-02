"""i18n/strings.json integrity: every key complete in every language, placeholders match."""
import json
import re
from pathlib import Path

import iec_calc.i18n as i18n

DOC = json.loads((Path(__file__).resolve().parent.parent / "i18n" / "strings.json").read_text(encoding="utf-8"))
PLACEHOLDER = re.compile(r"\{(\w+)\}")


def test_every_key_exists_in_every_language():
    langs = set(DOC["languages"])
    missing = [
        (key, lang) for key, entry in DOC["strings"].items() for lang in langs
        if not entry.get(lang)
    ]
    assert not missing, f"keys missing a translation: {missing[:5]}"


def test_placeholders_match_across_languages():
    for key, entry in DOC["strings"].items():
        sets = {lang: set(PLACEHOLDER.findall(text)) for lang, text in entry.items()}
        assert len({frozenset(s) for s in sets.values()}) <= 1, f"{key}: placeholders differ {sets}"


def test_exactly_one_default_language():
    assert sum(1 for m in DOC["languages"].values() if m.get("default")) == 1
    for code, meta in DOC["languages"].items():
        assert meta.get("name") and meta.get("dir") in ("rtl", "ltr"), code


def test_t_substitutes_and_falls_back():
    assert i18n.t("app.days_measured", days=3) == "3 ימי מדידה"
    assert i18n.t("no.such.key") == "no.such.key"
    # unknown placeholder stays visible rather than raising
    assert "{days}" in i18n.t("app.days_measured")
