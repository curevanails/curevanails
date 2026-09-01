"""Compile a version-H page template the way build-h.py compiles the landing page.

    python3 design/version-h/build/build-page.py html/coming-soon.html design/version-h/dist/soon/

What it does, in order:

  1 · inlines css/01…05 (plus the page's own <style>) into ONE <style> block,
      so the shipped page makes no stylesheet request but the fonts
  2 · inlines js/runtime.js (plus the page's own <script>) into ONE inline
      script, for the same reason
  3 · resolves __IMAGE_TOKENS__ against the system's own img/
  4 · stamps width/height on every image from img-dims.json, so a lazy image
      can never shift the page, and applies loading="lazy" below the fold
  5 · runs the guards that matter on every page (below)

The guards are the point. They are cheap, they run before anything is
written, and each one is a bug that has already happened once on this site.
Add to them; do not remove them.

Paths are derived from this file, so it runs from anywhere; a relative
OUT-DIR is resolved against the repo root.
"""
import os, re, sys, json, base64

# ── PORTED FOR THE curevanails REPO — the only edit to this file ────────
# Upstream (cureva-ui) this script lived at <repo>/version-h/build/ and read
# its images from <repo>/dist/public/img/ with <repo>/img-dims.json beside
# them. Here the system lives under design/version-h/ and the photography is
# a real site asset: it sits in public/img/, which Astro serves at /img/ —
# exactly where the `../img/…` this script stamps has to resolve. `dist` is
# git-ignored in this repo, so the build writes into design/version-h/dist/.
# Everything below this block is unchanged.
VH   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # design/version-h
ROOT = os.path.dirname(os.path.dirname(VH))                         # the repo root
IMGD = os.path.join(ROOT, 'public', 'img')
DIMS = json.load(open(os.path.join(VH, 'img-dims.json')))

LAYERS = ['01-tokens.css', '02-base.css', '03-components.css',
          '04-motion.css', '05-chrome.css', 'page-variants.css']

if len(sys.argv) < 3:
    sys.exit(__doc__)
src_rel, out_rel = sys.argv[1], sys.argv[2]
src = os.path.join(VH, src_rel) if not os.path.isabs(src_rel) else src_rel
out = os.path.join(ROOT, out_rel)
html = open(src, encoding='utf-8').read()
name = os.path.basename(src)

# ── 1 · one stylesheet ───────────────────────────────────────────────────
css = ''
for f in LAYERS:
    css += open(os.path.join(VH, 'css', f), encoding='utf-8').read() + '\n'
# the page's own <style>, if it has one, goes LAST so it can override
own = re.search(r'<style>(.*?)</style>', html, re.S)
if own:
    css += own.group(1)
    html = html.replace(own.group(0), '', 1)
# and the <link>s to the layers go away
html = re.sub(r'\n?\s*<link rel="stylesheet" href="\.\./css/[^"]+">', '', html)
html = re.sub(r'\n?\s*<!-- <link rel="stylesheet"[^>]*> *← [^>]*-->', '', html)

# ── guard: a stray brace silently eats the NEXT rule while the parser
#    resyncs, and nothing about the page tells you which one went missing ──
depth = 0
for ch in css:
    if ch == '{':
        depth += 1
    elif ch == '}':
        depth -= 1
        assert depth >= 0, "CSS: stray closing brace"
assert depth == 0, "CSS: %d unclosed block(s)" % depth

# ── guard: the component layer names no colour ───────────────────────────
#    This is the rule the whole theme rests on. See DESIGN-SYSTEM.md §2.3.
comp = open(os.path.join(VH, 'css', '03-components.css'), encoding='utf-8').read()
live = re.sub(r'/\*.*?\*/', '', comp, flags=re.S)
bad = re.findall(r'#[0-9a-fA-F]{3,8}\b|rgba?\(|color-mix\(', live)
assert not bad, "the component layer names a colour of its own: %r" % bad[:3]
for alias in ('var(--sage', 'var(--cream', 'var(--night', 'var(--paper',
              'var(--ink', 'var(--on-dark'):
    assert alias not in live, "component layer reads a brand alias: %s)" % alias

# ── guard: every token is defined on both grounds ────────────────────────
tok = open(os.path.join(VH, 'css', '01-tokens.css'), encoding='utf-8').read()
root  = tok[tok.index(':root{'):tok.index('.on-light{')]
light = tok[tok.index('.on-light{'):]
SHADCN = ('background', 'foreground', 'card', 'card-foreground', 'popover',
          'muted', 'muted-foreground', 'primary', 'primary-foreground',
          'secondary', 'secondary-foreground', 'accent', 'accent-foreground',
          'destructive', 'border', 'input', 'ring')
for t in SHADCN:
    assert re.search(r'\n\s*--%s:' % t, root),  "--%s is not defined" % t
    assert re.search(r'\n\s*--%s:' % t, light), "--%s is never re-themed for .on-light" % t
    for scope, blk in (('root', root), ('.on-light', light)):
        v = re.search(r'\n\s*--%s:([^;]+);' % t, blk).group(1).strip()
        assert re.match(r'^[\d.]+ [\d.]+% [\d.]+%$', v), \
            "--%s in %s is %r, not a bare HSL triplet" % (t, scope, v)
print("check  · CSS balanced · component layer names no colour · %d tokens on both grounds"
      % len(SHADCN))

# ── 2 · one script ───────────────────────────────────────────────────────
js = open(os.path.join(VH, 'js', 'runtime.js'), encoding='utf-8').read()
page_js = re.findall(r'<script>(.*?)</script>', html, re.S)
for block in page_js:
    js += '\n' + block
html = re.sub(r'<script>.*?</script>', '', html, flags=re.S)
html = html.replace('<script src="../js/runtime.js"></script>', '')

# ── guard: no external dependency, ever ──────────────────────────────────
for host in ('cdn.', 'unpkg', 'jsdelivr', 'esm.sh', 'node_modules', 'tailwind'):
    assert host not in html.lower(), "an external dependency appeared: %s" % host
assert html.count('<link rel="stylesheet"') == 1, \
    "one stylesheet link only: the fonts"

# ── 3 · images ───────────────────────────────────────────────────────────
tokens = sorted(set(re.findall(r'__[A-Z0-9_]+__', html)))
imgs = [t for t in tokens if t.startswith(('__D_', '__E_', '__G_', '__H_'))]
MAP = {}
for t in imgs:
    MAP[t] = t[2].lower() + '-' + t[4:-2].lower().replace('_', '-')
missing = [t for t, n in MAP.items() if not os.path.exists(os.path.join(IMGD, n + '.webp'))]
assert not missing, "tokens with no image on disk: %s" % missing
nodims = [n for n in MAP.values() if n not in DIMS]
assert not nodims, "images with no entry in img-dims.json: %s" % nodims

for t, n in MAP.items():
    html = html.replace(t, '../img/%s.webp' % n)

added = [0]
def stamp(m):
    tag = m.group(0)
    hit = re.search(r'src="\.\./img/([a-z0-9-]+)\.webp"', tag)
    if not hit or ' width=' in tag or hit.group(1) not in DIMS:
        return tag
    w, h = DIMS[hit.group(1)]
    added[0] += 1
    attrs = 'width="%d" height="%d" decoding="async" ' % (w, h)
    # anything already marked high priority is the LCP and must not be lazy
    if 'fetchpriority' not in tag:
        attrs += 'loading="lazy" '
    return tag.replace('<img ', '<img ' + attrs)
html = re.sub(r'<img [^>]*>', stamp, html)

# ── guard: a photograph with no alt is one a screen reader cannot skip ───
for m in re.finditer(r'<img\b[^>]*>', html):
    assert ' alt=' in m.group(0), "img without alt: %s" % m.group(0)[:90]

# ── 4 · reassemble ───────────────────────────────────────────────────────
html = html.replace('</head>', '<style>\n%s\n</style>\n</head>' % css, 1)
html = html.replace('</body>', '<script>\n%s\n</script>\n</body>' % js, 1)

os.makedirs(out, exist_ok=True)
dest = os.path.join(out, 'index.html')
open(dest, 'w', encoding='utf-8').write(html)
print("built  · %-34s %4d KB  (%d images sized + lazy)"
      % (os.path.relpath(dest, ROOT), len(html.encode()) // 1024, added[0]))
