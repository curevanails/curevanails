# Cure Và · Version H — email

**Email is a separate system that shares only the hexes.** Do not import
anything from `../css/`. Everything the web system is built on is unavailable
or unreliable in an inbox.

---

## 1 · Why none of the web system transfers

| the web system uses | in email |
|---|---|
| CSS custom properties (`--primary`) | **Outlook 2016–2021 ignores them entirely.** Every token would compute to nothing. This is the one that ends the discussion. |
| `hsl(… / .25)` | patchy; Outlook does not support the slash syntax |
| flexbox / grid | not in Outlook (Word rendering engine) |
| `clamp()` | not in Outlook, unreliable in older Gmail |
| external stylesheet | Gmail strips `<link>` |
| `<style>` in `<head>` | Gmail *clips* it on forward, Yahoo mangles it; usable but never the only carrier |
| web fonts | ~40 % of clients; Outlook falls back silently |

So: **tables for layout, hex for colour, inline `style` for anything that
matters, `<style>` only for progressive enhancement (hover, media queries).**

---

## 2 · The palette, as hex

Identical values to `css/01-tokens.css`. If a colour changes there, change it
here — nothing links the two automatically, and that is the cost of email.

### Ground: paper (recommended default)

| role | hex |
|---|---|
| page background | `#EEEBE0` |
| card / content background | `#F7F4EC` |
| text | `#221F1A` |
| secondary text | `#575146` |
| quiet text, labels | `#726B5C` |
| rule / border | `#DBD8D1` |
| primary button fill | `#0B1410` |
| primary button text | `#FCF5D6` |
| accent (links, marks) | `#386149` |

### Ground: night (headers, footers, feature bands)

| role | hex |
|---|---|
| background | `#0B1410` |
| raised band | `#111E17` |
| text | `#EFF3EA` |
| secondary text | `#9FB3A5` |
| accent | `#92C0A5` |
| button fill | `#FCF5D6` |
| button text | `#0B1410` |

**Use paper as the body ground and night only for bands.** The website is
dark-first; email is not, and it should not try to be. Many clients
force-invert dark emails, several render a full-bleed dark background as a
grey box, and a night email in a white inbox reads as an ad. A paper email
with a night header keeps the brand and survives the client.

---

## 3 · Type

Web fonts will not load for a large minority. Design for the fallback and
treat the web font as a bonus.

```
headings   font-family: Fraunces, Georgia, 'Times New Roman', serif;
body       font-family: Manrope, -apple-system, 'Segoe UI', Roboto,
                        Helvetica, Arial, sans-serif;
```

| | size | line-height |
|---|---|---|
| headline | 30 px (26 px on mobile) | 1.15 |
| sub-head | 20 px | 1.25 |
| body | 16 px | 1.6 |
| small / legal | 12 px | 1.5 |
| eyebrow | 11 px, `letter-spacing: .18em`, uppercase | 1 |

Never below 12 px. Gmail on Android bumps anything under ~13 px anyway and
your layout moves with it.

---

## 4 · Rules that are not style preferences

- **Max width 600 px.** Above that Outlook's reading pane clips.
- **One column.** Two-column collapses badly without `@media`, which Outlook
  ignores.
- **Every image needs `alt`, explicit `width`, and `display:block`** —
  images are blocked by default in Outlook and many corporate clients, so the
  email must still read with none of them.
- **Never put text in an image.** It disappears with images off, and it
  cannot be translated or read aloud.
- **A preheader is mandatory** — the hidden line after the subject in the
  inbox list. Without it the client shows your first visible text, which is
  usually "View in browser".
- **Bulletproof buttons.** A styled `<a>` is not a button in Outlook. Use the
  VML block in `email-base.html`; it is commented.
- **`role="presentation"` on every layout table**, so a screen reader does not
  announce a grid.
- **Physical unsubscribe link and postal address** in the footer. That is law
  (CAN-SPAM), not design.
- **Test with images off, in dark mode, and in Outlook.** Those three catch
  almost everything.

---

## 5 · Dark mode

Some clients (Apple Mail, Outlook.com) recolour light emails automatically.
You cannot stop it everywhere; you can stop the worst of it:

```html
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
```

and in `<style>`:

```css
@media (prefers-color-scheme: dark) {
  .body-bg   { background: #0B1410 !important }
  .card-bg   { background: #111E17 !important }
  .t-primary { color: #EFF3EA !important }
  .t-muted   { color: #9FB3A5 !important }
  .rule      { border-color: #2F3833 !important }
}
```

Give the night ground the brand's own dark values rather than letting the
client invert paper into a muddy grey. `email-base.html` has this wired.

---

## 6 · Files

- `email-base.html` — a complete transactional email. Copy it, replace the
  `__PLACEHOLDER__` tokens, delete the blocks you do not need.

The placeholders are `__PREHEADER__`, `__EYEBROW__`, `__HEADLINE__`,
`__BODY__`, `__CTA_LABEL__`, `__CTA_URL__`, `__HERO_URL__`, `__HERO_ALT__`,
and `__UNSUBSCRIBE_URL__`.
