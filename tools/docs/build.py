#!/usr/bin/env python3
"""Docs for the Docs screen: docs/SUMMARY.md and the pages it lists are checked
and copied to gui/frontend/src/docs/ (the gui module cannot embed files above
it). Images go through WebP when PIL is installed, with spaces in names replaced.

  python tools/docs/build.py          check, then rewrite gui/frontend/src/docs/
  python tools/docs/build.py --check  check only; also fails if the copy is stale
"""
import pathlib, re, shutil, sys, tempfile, filecmp

ROOT = pathlib.Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
OUT = ROOT / "gui" / "frontend" / "src" / "docs"
LANGS = ("ru", "en")
errors = []


def err(msg):
    errors.append(msg)


def slug(s):  # same as slug() in js/core/markdown.js
    s = re.sub(r"<[^>]+>", "", s.strip().lower())
    return re.sub(r"\s", "-", re.sub(r"[^\w\s-]", "", s))


def summary():
    """[(depth, title, name)] from the nested list in SUMMARY.md."""
    items = []
    for line in (DOCS / "SUMMARY.md").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^(\s*)[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*$", line)
        if not m:
            continue
        f = re.fullmatch(r"([\w-]+)\.ru\.md", m[3])
        if not f:
            err(f"SUMMARY: '{m[3]}' must look like name.ru.md")
            continue
        items.append((len(m[1].replace("\t", "  ")) // 2, m[2], f[1]))
    return items


def headings(text):
    out, fence = set(), False
    for l in text.splitlines():
        if l.startswith("```"):
            fence = not fence
        m = None if fence else re.match(r"^#{1,4}\s+(.*)$", l)
        if m:
            out.add(slug(m[1]))
    return out


def imgname(ref):  # imgs/my pic.png -> imgs/my-pic.webp (PIL) / .png
    p = pathlib.PurePosixPath(ref.replace("%20", " "))
    return str(p.with_name(re.sub(r"\s+", "-", p.name)))


def build(out):
    items = summary()
    names = [n for _, _, n in items]
    if len(set(names)) != len(names):
        err("SUMMARY: a page is listed twice")
    pages = {}
    for n in names:
        for lang in LANGS:
            f = DOCS / f"{n}.{lang}.md"
            if f.exists():
                pages[(n, lang)] = f.read_text(encoding="utf-8").replace("\r", "")
            else:
                err(f"missing {f.relative_to(ROOT)}" + (" (EN pair)" if lang == "en" else ""))
    for f in sorted(DOCS.glob("*.ru.md")) + sorted(DOCS.glob("*.en.md")):
        if f.name.split(".")[0] not in names:
            print(f"warning: {f.name} is not in SUMMARY.md")
    anchors = {k: headings(v) for k, v in pages.items()}
    try:
        from PIL import Image
    except ImportError:
        Image = None
    shutil.rmtree(out, ignore_errors=True)
    (out / "imgs").mkdir(parents=True)
    done = set()
    for (n, lang), text in pages.items():
        for ref in re.findall(r"!\[[^\]]*\]\(([^)\s]+)\)", text):
            src = DOCS / ref.replace("%20", " ")
            if not src.exists():
                err(f"{n}.{lang}.md: image '{ref}' not found")
                continue
            new = imgname(ref)
            if Image:
                new = str(pathlib.PurePosixPath(new).with_suffix(".webp"))
                if new not in done:
                    Image.open(src).save(out / new, "WEBP", quality=82, method=6)
            elif new not in done:
                shutil.copyfile(src, out / new)
            done.add(new)
            text = text.replace(f"({ref})", f"({new})")
        for target, frag in re.findall(r"\]\(([^)#\s]+\.md)(?:#([^)\s]*))?\)", text):
            if re.match(r"[a-z]+://", target):
                continue
            m = re.fullmatch(r"([\w-]+)\.(ru|en)\.md", target)
            if not m or (m[1], m[2]) not in pages:
                err(f"{n}.{lang}.md: link to missing page '{target}'")
            elif m[2] != lang:
                err(f"{n}.{lang}.md: '{target}' leaves the page's language")
            elif frag and frag not in anchors[(m[1], m[2])]:
                err(f"{n}.{lang}.md: no heading '#{frag}' in {target}")
        for frag in re.findall(r"\]\(#([^)\s]+)\)", text):
            if frag not in anchors[(n, lang)]:
                err(f"{n}.{lang}.md: no heading '#{frag}' on the page")
        (out / f"{n}.{lang}.md").write_text(text, encoding="utf-8", newline="\n")
    shutil.copyfile(DOCS / "SUMMARY.md", out / "SUMMARY.md")
    print(f"{len(names)} pages, {len(done)} images" + ("" if Image else " (no PIL: images copied as is)"))


def same(a, b):
    c = filecmp.dircmp(a, b)
    return not (c.left_only or c.right_only or c.diff_files) and all(same(a / d, b / d) for d in c.common_dirs)


if "--check" in sys.argv:
    with tempfile.TemporaryDirectory() as tmp:
        build(pathlib.Path(tmp) / "docs")
        if not errors and not (OUT.exists() and same(pathlib.Path(tmp) / "docs", OUT)):
            err("gui/frontend/src/docs is stale: run python tools/docs/build.py")
else:
    build(OUT)
for e in errors:
    print("error:", e)
sys.exit(1 if errors else 0)
