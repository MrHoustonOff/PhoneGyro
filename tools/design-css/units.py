"""px → rem for the app's stylesheets (the UI's unit standard, see
docs/internal/frontend_rework_log/README.md, "Единицы").

Kept in px on purpose:
  * hairlines (1px, 0.5px): a rem border would blur at fractional scales;
  * @container / @media conditions: they measure the window, not the UI;
  * anything inside url(...).
Everything else becomes rem (1rem = 16px), so the whole UI scales with the root
font size.
"""
import re

_TOKEN = re.compile(r'(@(?:container|media)[^{]*)|(url\([^)]*\))|(?<![\w.#-])(-?\d*\.?\d+)px')
HAIRLINES = {1.0, 0.5}


def _rem(value: float) -> str:
    text = f"{value / 16:.4f}".rstrip("0").rstrip(".")
    return (text if text not in ("", "-0") else "0") + "rem"


def px_to_rem(css: str) -> str:
    def swap(m):
        if m.group(1) or m.group(2):
            return m.group(0)
        v = float(m.group(3))
        if abs(v) in HAIRLINES:
            return m.group(0)
        return "0" if v == 0 else _rem(v)
    return _TOKEN.sub(swap, css)


if __name__ == "__main__":
    import pathlib
    import sys
    for name in sys.argv[1:]:
        p = pathlib.Path(name)
        p.write_text(px_to_rem(p.read_text(encoding="utf-8")), encoding="utf-8", newline="\n")
        print("rem:", p)
