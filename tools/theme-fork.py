#!/opt/homebrew/bin/python3
"""Restyle find3r's app.css to the thebenmeadows.com look (zinc ramp, Public Sans, flat).

usage: theme-fork.py <app.css in> <app.css out> <theme-dark.css out>

app.css        every color mapped to the light zinc ramp by lightness, plus the flat rules
theme-dark.css the same rules on the dark ramp, applied under html.dark, or under a dark
               system setting unless html.light (the class model of thebenmeadows.com's theme.js)
"""
import re
import sys
from pathlib import Path

HEX = re.compile(r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b")
LIGHT = ["#ffffff", "#fafafa", "#f4f4f5", "#e4e4e7", "#a1a1aa", "#71717a", "#52525b", "#3f3f46", "#18181b", "#000000"]
DARK = ["#000000", "#09090b", "#18181b", "#27272a", "#52525b", "#737373", "#a3a3a3", "#d4d4d4", "#e4e4e7", "#ffffff"]

FLAT = """
/* thebenmeadows.com look: Public Sans, no dotted background, no shadows, black/white accent. */
@font-face {
  font-family: "Public Sans";
  src: url("publicsans.woff2") format("woff2");
  font-weight: 100 900;
  font-display: swap;
}
:root,
button,
input,
select,
textarea {
  font-family: "Public Sans", system-ui, sans-serif;
}
body {
  background-image: none;
}
* {
  box-shadow: none !important;
}
.primary,
.primary:hover {
  background: #000000;
  border-color: #000000;
  color: #ffffff;
}
.wordmark span {
  color: inherit;
}
#theme-toggle {
  margin-left: 14px;
  font-size: 12px;
  padding: 4px 10px;
}
#theme-toggle::before {
  content: "Dark";
}
"""
DARK_EXTRA = """
.primary,
.primary:hover {
  background: #ffffff;
  border-color: #ffffff;
  color: #000000;
}
#theme-toggle::before {
  content: "Light";
}
"""


def lum(h):
    h = h[1:]
    if len(h) in (3, 4):
        h = "".join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b, (h[6:8] if len(h) == 8 else "")


def step(h):
    y, _ = lum(h)
    return min(len(LIGHT) - 1, round((1 - y) * (len(LIGHT) - 1)))


def recolor(css, ramp):
    return HEX.sub(lambda m: ramp[step(m.group(0))] + lum(m.group(0))[1], css)


def blocks(css):
    """Split top-level CSS into (prelude, body) pairs; body is None for statements ending in ';'."""
    out, i, n = [], 0, len(css)
    while i < n:
        j = i
        depth = 0
        while j < n and not (css[j] == "{" or (css[j] == ";" and depth == 0)):
            j += 1
        if j >= n:
            break
        prelude = css[i:j].strip()
        if css[j] == ";":
            out.append((prelude, None))
            i = j + 1
            continue
        k, depth = j + 1, 1
        while k < n and depth:
            depth += {"{": 1, "}": -1}.get(css[k], 0)
            k += 1
        out.append((prelude, css[j + 1:k - 1]))
        i = k
    return out


def prefix_selector(sel, scope):
    sel = sel.strip()
    if not sel:
        return sel
    if sel in (":root", "html"):
        return scope
    if sel.startswith("html"):
        return scope + sel[4:]
    return f"{scope} {sel}"


def declarations(body):
    """Split a rule body on top-level ';', respecting quotes and parentheses (data URIs hold ';')."""
    out, cur, depth, quote = [], [], 0, None
    for ch in body:
        if quote:
            quote = None if ch == quote else quote
        elif ch in "\"'":
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == ";" and depth == 0:
            out.append("".join(cur).strip())
            cur = []
            continue
        cur.append(ch)
    if "".join(cur).strip():
        out.append("".join(cur).strip())
    return [d for d in out if d]


COLOR_PROPS = ("color", "background-color", "border-color", "border-top-color", "border-right-color",
               "border-bottom-color", "border-left-color", "outline-color", "fill", "stroke", "caret-color",
               "accent-color", "text-decoration-color", "column-rule-color")


def color_decl(d):
    """The color-only form of one declaration, or None. Shorthands become their -color property, so
    a dark rule never re-adds a border, outline or background shape that the light rules removed."""
    prop, _, value = d.partition(":")
    prop, value = prop.strip().lower(), value.strip()
    if prop.startswith("--"):
        return d if HEX.search(value) else None
    if prop == "color-scheme":
        return d
    colors = HEX.findall(value)
    if not colors:
        return None
    if prop in COLOR_PROPS:
        return d
    if prop in ("background", "background-image") and "radial-gradient" in value:
        return None  # the dotted page texture the flat look drops
    if prop in ("background", "background-image") and "gradient" in value:
        return d  # stripes and fades, recolored onto the dark ramp
    if prop == "background" and "url(" not in value:
        return f"background-color: {colors[-1]}"
    if prop in ("border", "border-top", "border-right", "border-bottom", "border-left", "outline"):
        return f"{prop}-color: {colors[-1]}"
    return None  # box-shadow, background-image and gradients: the flat look drops them


def color_only(body):
    keep = [c for c in (color_decl(d) for d in declarations(body)) if c]
    return "\n  " + ";\n  ".join(keep) + ";\n" if keep else ""


def scoped(css, scope):
    parts = []
    for prelude, body in blocks(css):
        if body is None:
            continue  # @import / @charset: not repeated in the dark sheet
        if prelude.startswith("@media") or prelude.startswith("@supports"):
            parts.append(f"{prelude} {{\n{scoped(body, scope)}\n}}")
        elif prelude.startswith("@"):
            continue  # @font-face, @keyframes: defined once in app.css
        else:
            kept = color_only(body)
            if not kept:
                continue
            sels = ",\n".join(prefix_selector(s, scope) for s in re.split(r",(?![^()]*\))", prelude))
            parts.append(f"{sels} {{{kept}}}")
    return "\n".join(p for p in parts if not re.fullmatch(r"@\S[^{]*\{\s*\}", p, re.S))


def main():
    src, out_light, out_dark = (Path(a) for a in sys.argv[1:4])
    css = src.read_text()
    light = recolor(css, LIGHT) + FLAT
    dark_rules = recolor(css, DARK).replace("color-scheme: light", "color-scheme: dark")
    extra = lambda scope: "\n".join(  # hand-written dark rules: kept whole, not reduced to colors
        f"{', '.join(prefix_selector(s, scope) for s in pre.split(','))} {{{body}}}" for pre, body in blocks(DARK_EXTRA))
    dark = ("/* Dark theme for the thebenmeadows.com look: html.dark, or a dark system unless html.light. */\n"
            + scoped(dark_rules, "html.dark") + "\n" + extra("html.dark")
            + "\n@media (prefers-color-scheme: dark) {\n"
            + scoped(dark_rules, "html:not(.light)") + "\n" + extra("html:not(.light)") + "\n}\n")
    out_light.write_text(light)
    out_dark.write_text(dark)
    print(f"{len(set(HEX.findall(css)))} colors; {out_light} ({len(light)} bytes), {out_dark} ({len(dark)} bytes)")


main()
