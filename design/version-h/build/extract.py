# -*- coding: utf-8 -*-
"""Split the running version-H template into reusable layers.
   Extraction, never transcription: every byte below is the bytes that ship."""
import os, re
SRC = 'landing-page-h.template.html'
s = open(SRC, encoding='utf-8').read()
css = s[s.index('<style>') + 8 : s.index('</style>')]
js  = s[s.index('<script>') + 9 : s.rindex('</script>')]

def slice_between(text, a, b, label):
    i = text.index(a)
    j = text.index(b, i + 1) if b else len(text)
    assert j > i, label
    return text[i:j].rstrip() + '\n'

HDR = ("/* ═══════════════════════════════════════════════════════════════════════\n"
       "   Cure Và · version H — %s\n"
       "   ───────────────────────────────────────────────────────────────────────\n"
       "   EXTRACTED, NOT REWRITTEN. This is byte-for-byte the CSS running at\n"
       "   /version-h/. If you change it here, change it in\n"
       "   landing-page-h.template.html too — or better, make that file the\n"
       "   source and re-run version-h/build/extract.py.\n"
       "   ═══════════════════════════════════════════════════════════════════════ */\n\n")

LAYERS = [
    ('01-tokens.css', 'the theme — every colour on the site, twice',
     [('/* ═══ shadcn/ui theme tokens', '*,*::before,*::after{box-sizing:border-box}')]),
    ('02-base.css', 'reset, document defaults, type atoms',
     [('*,*::before,*::after{box-sizing:border-box}', '/* ═══ shadcn/ui component layer')]),
    ('03-components.css', 'the shadcn/ui primitives, at D\'s measurements',
     [('/* ═══ shadcn/ui component layer', '/* ── reveal — transform')]),
    ('04-motion.css', 'reveals, frames, preloader, cursor, grain, reduced motion',
     [('/* ── reveal — transform', '/* ═══ NAV + full-screen menu'),
      ('/* ═══ reduced motion', None)]),
    ('05-chrome.css', 'nav, menu panel, section shell, footer, contour — every page needs these',
     [('/* ═══ NAV + full-screen menu', '/* ═══ HERO'),
      ('/* ═══ section shell', '/* ═══ 01 · MANIFESTO'),
      ('/* ═══ FOOTER', '/* ═══ chapter HUD'),
      ('/* ── the contour', '/* ── the founder gets the room')]),
    ('06-landing-sections.css', 'the landing page\'s own eleven sections — reference only',
     [('/* ═══ HERO', '/* ═══ section shell'),
      ('/* ═══ 01 · MANIFESTO', '/* ═══ FOOTER'),
      ('/* ═══ chapter HUD', '/* ═══════════════════════════════════════════════════════════════════════\n   VERSION F'),
      ('/* ── the founder gets the room', '/* ═══ reduced motion')]),
]

total = 0
for name, desc, parts in LAYERS:
    out = HDR % desc
    for a, b in parts:
        out += slice_between(css, a, b, name) + '\n'
    p = os.path.join('version-h/css', name)
    open(p, 'w', encoding='utf-8').write(out)
    n = out.count('{')
    total += n
    print("  %-28s %6d bytes  ~%d rules" % (name, len(out.encode()), n))

# ── the shared runtime: helpers + the behaviours every page wants ────────
JSHDR = ("/* ═══════════════════════════════════════════════════════════════════════\n"
 "   Cure Và · version H — shared runtime\n"
 "   ───────────────────────────────────────────────────────────────────────\n"
 "   EXTRACTED from landing-page-h.template.html. Only the behaviours every\n"
 "   page wants: the preloader, the reveal observer, the custom cursor and\n"
 "   its magnets, the nav, the full-screen menu, and the live motion-\n"
 "   preference listener. Nothing here knows about a section.\n"
 "\n"
 "   The landing page's own blocks (manifesto, anatomy, lens, menu, rail,\n"
 "   membership, waitlist, HUD, founder quote, ritual builder) are NOT here —\n"
 "   they live with their sections. See GUIDE.md.\n"
 "   ═══════════════════════════════════════════════════════════════════════ */\n"
 "(function(){\n'use strict';\n")

helpers = slice_between(js, "var doc = document", "/* ── 1 · preloader", 'helpers')
blocks = []
for a, b in [("/* ── 1 · preloader", "/* ── 2 · reveals"),
             ("/* ── 2 · reveals", "/* ── 3 · custom cursor"),
             ("/* ── 3 · custom cursor", "/* ── 4 · nav:"),
             ("/* ── 4 · nav:", "/* ── 5 · full-screen menu"),
             ("/* ── 5 · full-screen menu", "/* ── 6 · manifesto"),
             ("/* ── 14 · a motion preference", None)]:
    blk = slice_between(js, a, b, a).rstrip()
    # Blocks 1–5 are each their own IIFE and end with their own `})();`.
    # The LAST one is not — it is a bare listener, and slicing it to
    # end-of-file swallows the OUTER wrapper's terminator, which we then
    # write again. Strip it from that block only.
    if b is None and blk.endswith('})();'):
        blk = blk[:-len('})();')].rstrip() + '\n'
    blocks.append(blk + '\n')
run = JSHDR + helpers + '\n' + '\n'.join(blocks) + '\n})();\n'
open('version-h/js/runtime.js', 'w', encoding='utf-8').write(run)
print("  %-28s %6d bytes" % ('js/runtime.js', len(run.encode())))
