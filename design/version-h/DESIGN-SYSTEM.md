# Cure Và · Version H — the design system

The spec. Every number here is read off the running stylesheet, not
remembered. `css/` holds the same rules as files you can copy.

---

## 1 · What this system is

**shadcn/ui's architecture, wearing Cure Và's design.**

That distinction is the whole thing. From shadcn we take the token contract,
the parts a component is built from, the variant × size axes, and one rule
(§2.3). We do **not** take its look: shadcn's rounded rectangle, its 14 px
medium label and its bordered field are defaults, not a contract, and this
brand already has a shape language — the pill, 700 at .83 rem, the underlined
field. Every measurement in `03-components.css` is the brand's.

There is no npm, no bundler and no framework. These are ordinary CSS classes
carrying shadcn's names and shadcn's structure.

---

## 2 · Colour

### 2.1 · The tokens

Nineteen semantic tokens, defined twice: once on `:root` (the dark ground,
which is the default) and once under `.on-light` (the paper ground). Values
are **bare HSL channels**, never colours — see §2.2.

| token | dark `:root` | hex | light `.on-light` | hex |
|---|---|---|---|---|
| `--background` | `153.3333 29.0323% 6.0784%` | `#0B1410` | `43.6 40.7% 94.7%` | `#F7F4EC` |
| `--foreground` | `86.7 27.3% 93.5%` | `#EFF3EA` | `37.5 13.3% 11.8%` | `#221F1A` |
| `--card` | `147.7 27.7% 9.2%` | `#111E17` | `0 0% 100%` | `#FFFFFF` |
| `--card-foreground` | `86.7 27.3% 93.5%` | `#EFF3EA` | `37.5 13.3% 11.8%` | `#221F1A` |
| `--popover` | `144.7 26.2% 12.7%` | `#18291F` | `0 0% 100%` | `#FFFFFF` |
| `--muted` | `147.7 27.7% 9.2%` | `#111E17` | `47.1 29.2% 90.6%` | `#EEEBE0` |
| `--muted-foreground` | `138 11.6% 66.3%` | `#9FB3A5` | `38.8 10.8% 30.8%` | `#575146` |
| `--primary` | `48.9 86.4% 91.4%` | `#FCF5D6` | `153 29% 6%` | `#0B1410` |
| `--primary-foreground` | `153 29% 6%` | `#0B1410` | `48.9 86.4% 91.4%` | `#FCF5D6` |
| `--secondary` | `144.7 26.2% 12.7%` | `#18291F` | `47.1 29.2% 90.6%` | `#EEEBE0` |
| `--secondary-foreground` | `86.7 27.3% 93.5%` | `#EFF3EA` | `46 15.8% 37.3%` | `#6E6750` |
| `--accent` | `144.8 26.7% 66.3%` | `#92C0A5` | `145 27% 30%` | `#386149` |
| `--accent-foreground` | `153 29% 6%` | `#0B1410` | `0 0% 100%` | `#FFFFFF` |
| `--destructive` | `14.6 71.2% 79.6%` | `#F0B8A6` | `14.6 62% 34%` | `#8C3B21` |
| `--border` / `--input` | `146.7 8.7% 20.2%` | `#2F3833` | `42 12% 84%` | `#DBD8D1` |
| `--ring` | `144.8 26.7% 66.3%` | `#92C0A5` | `145 27% 30%` | `#386149` |

Plus two translucent line tokens for hairlines drawn **over photography**,
where a solid border reads as a box drawn on top of the picture rather than an
edge belonging to it:

| | dark | light |
|---|---|---|
| `--border-hairline` | `rgba(239,243,234,.16)` | `rgba(34,31,26,.13)` |
| `--border-hairline-2` | `rgba(239,243,234,.07)` | `rgba(34,31,26,.06)` |

### 2.2 · Why bare channels, and why full precision

`--ring: 144.8 26.7% 66.3%`, not `#92C0A5`. It looks like a formatting choice
and it is not: it is the only form that lets a component write
`hsl(var(--ring) / .25)` for a focus ring. **The moment a token resolves to a
hex, every alpha use of it computes to nothing and the ring silently
disappears.**

`--background` carries four decimals — `153.3333 29.0323% 6.0784%` — where the
others carry one. Both `153 29% 6%` and the long form render `#0B1410` in 8
bits, but `color-mix()` works in floating point, and this ground is mixed at
55 % (the `.kind` chip's plate) and 68 % (the waitlist panel). The rounded
triplet drifts 0.13/255 there. Invisible, and free to get right.

Every triplet in the table round-trips to the hex beside it. **Nothing about
the colour moved when the palette became tokens.**

### 2.3 · The rule that holds it together

> **A component reads tokens and never names a colour.**

Not a hex, not `rgb(`, not `color-mix(`, not a brand alias like `var(--sage)`.
Only `hsl(var(--token))`. `build-h.py` guard 6 parses the component layer and
fails the build on any of them.

This is what lets one theme edit reach the whole page, and it is what makes
the same Card work on night in §04 and on paper in §10 as **one rule** instead
of a rule plus six `.on-light` overrides.

### 2.4 · Brand aliases

The delivered brand names still exist, but they are now aliases **of** the
tokens rather than the source of them:

```css
--night: hsl(var(--background));   --cream: hsl(var(--primary));
--sage:  hsl(var(--accent));       --on-dark: hsl(var(--foreground));
```

Custom properties substitute at the element that **declares** them, so each
alias resolves once at `:root` and then inherits as a flat colour. That is
deliberate: `--night-2` stays night inside `.on-light`, where `--card` has
become white.

Use tokens in new work. The aliases exist so the 418 rules of section CSS
written for versions D–G keep working.

### 2.5 · Contrast

Every pair on the page clears WCAG AA. The tightest are worth knowing because
they constrain what you may pair:

| pair | ratio |
|---|---|
| `--ink-3` `#726B5C` on paper | **4.81** — the floor. Small uppercase labels. |
| `badge--secondary` `#6E6750` on `#EEEBE0` | **4.73** |
| `--muted-foreground` on paper | 7.15 |
| `--muted-foreground` on ground | 8.44 |
| `--accent` on ground | 9.19 |
| `--destructive` on ground | 10.80 |
| `--foreground` on ground | 16.65 |

The e2e measures ten of these on every run, on every profile. If you add a
colour pair, add it to that list.

---

## 3 · Type

Two families. **Fraunces** for anything editorial, **Manrope** for everything
else.

```css
h1,h2,h3,h4 { font-family: Fraunces; font-weight: 300;
              font-variation-settings: "opsz" 144, "SOFT" 12, "WONK" 0;
              line-height: .98; letter-spacing: -.028em; text-wrap: balance }
em          { font-style: italic; font-variation-settings: "opsz" 144, "SOFT" 40, "WONK" 1 }
body        { font-family: Manrope; font-size: 1rem; line-height: 1.65; font-weight: 400 }
```

Fraunces runs **optically large and barely soft** — an editorial cut. Version C
runs the same family soft and wonky; same typeface, opposite end of the axes,
and the two builds do not look related. `em` inside a heading is the one place
the axes open up, and it is how every headline on the site turns.

### The scale

| class | size | notes |
|---|---|---|
| `.h-xxl` | `clamp(3rem, 11.5vw, 10rem)` | the footer wordmark |
| `.h-xl` | `clamp(2.6rem, 7.4vw, 6rem)` | hero |
| `.h-lg` | `clamp(2.05rem, 4.6vw, 3.9rem)` | every section heading |
| `.h-md` | `clamp(1.45rem, 2.4vw, 2.15rem)` | |
| `.h-sm` | `clamp(1.15rem, 1.6vw, 1.4rem)` | line-height 1.14 |
| `.lede` | `clamp(1.02rem, 1.15vw, 1.16rem)` | line-height 1.7, `max-width: 58ch` |
| `.mono` | `.68rem` / 700 / `.2em` / uppercase | the small caps label |
| `.eyebrow` | `.68rem` / 800 / `.22em` / uppercase | with a 22 px rule before it |
| `.num` | — | `tabular-nums`. **Use on every price and count.** |

---

## 4 · Space and shape

| | value |
|---|---|
| `--maxw` | `1320px` — `.wrap` centres to this |
| `--gut` | `clamp(1.15rem, 4.5vw, 3.4rem)` — `.wrap`'s inline padding |
| `--nav-h` | `64px` |
| `.sec` | `padding-block: clamp(6.5rem, 15vh, 12.5rem)` |
| `.sec--tight` | `padding-block: clamp(5rem, 11vh, 8.5rem)` |
| `.head` | `max-width: 62ch`, `margin-bottom: clamp(3.4rem, 6.5vw, 5.5rem)` |

### Radii

shadcn derives every corner from one number; this brand has three, and they
are load-bearing — the image frames and the §05 masks are cut to them. So
`--radius` is the middle one and the other two are offsets that reproduce the
original exactly, rather than shadcn's stock −2 px / −4 px steps.

```css
--radius:    0.875rem;                          /* 14px */
--radius-lg: calc(var(--radius) + 0.5rem);      /* 22px */
--radius-md: var(--radius);                     /* 14px */
--radius-sm: calc(var(--radius) - 0.3125rem);   /*  9px */
```

**The controls do not read it.** Button, Badge and the Tabs tray are full pills
at `999px`. `--radius` governs Cards and image frames, which is where the brand
actually uses a measured corner.

### Elevation

```css
--shadow-btn: 0 1px 2px rgba(0,0,0,.16), 0 18px 34px -26px rgba(0,0,0,.8);
--shadow-sm:  0 1px 2px 0 rgba(11,20,16,.30);
--sh:         0 1px 2px rgba(34,31,26,.05), 0 24px 60px -44px rgba(34,31,26,.7);
--sh-d:       0 30px 80px -50px #000;
```

Cards deliberately do **not** share one shadow. A ledger card is 40 % of the
viewport and a careers card is a hairline box; flattening them to one
`shadow-sm` was the most visible thing the first pass got wrong. `.card` gives
the ground, the corner and the ink; elevation belongs to the usage.

---

## 5 · Components

All in `css/03-components.css`. Variants are classes, not attributes.

### Button — `.btn`

`variant`: *(default)* · `--secondary` · `--outline` · `--ghost` · `--link`
`size`: `--sm` · *(default)* · `--lg`

Pill, `.83rem`/700, `padding: 1.05em 1.9em`, and a fill that **rises from the
bottom edge** on hover (one transform, no repaint of the label).

There is no `--dark` variant and there must not be one. It existed so a cream
button had a hand-written opposite on paper; with `--primary` re-themed under
`.on-light`, the default variant *is* that opposite. **A plain `.btn` is cream
on night and night on paper, automatically.**

### Badge — `.badge`

`variant`: *(default)* · `--secondary` · `--outline` · `--accent`

The one primitive that stays fully round. Four private chip styles collapsed
into it. **No variant has a border** — `--outline` draws its ring with an inset
shadow, so the chip does not grow by 2 px.

`display` is deliberately **not** on the base. The brand's chips are bare
`<span>`s, blockified by their flex parents or by `position:absolute`; forcing
`inline-flex` made them compute `flex` instead — same box to the hundredth of a
pixel, different formatting context. Only `--outline` (which has two children)
sets it.

### Card — `.card`

Parts: `.card-header` · `.card-title` · `.card-description` · `.card-content`
· `.card-footer`

Ground, corner and ink only. See §4 on elevation.

**On a light ground `--card` is white and `--muted` is paper-2** — raised and
recessed. Getting that pair the wrong way round is the one mistake that makes
a themed page look unthemed: every card sinks into its own section and the lift
disappears. A screenshot of a single card does not show it.

### Label · Input · Checkbox — `.label` `.input` `.checkbox`

The brand's field: an underline under an 11 px uppercase label, and the native
checkbox tinted with `accent-color`. Not shadcn's bordered box.

One thing from the kit did stay, because it is not a look: **the invalid state
lives on the control.** `aria-invalid` on the input, not only `.invalid` on an
ancestor — so the field announces itself instead of only looking wrong.

### Alert — `.alert` `.alert--destructive`
### Separator — `.separator` (add `data-orientation="vertical"` for a rule)
### Tabs — `.tabs-list` `.tabs-trigger`

A tray with one step of padding and the active trigger raised out of it. The
marker **travels** between positions rather than appearing under the new one —
one transform against three repaints.

---

## 6 · Motion

`css/04-motion.css`. Five rules, and they are performance rules first:

1. **Every continuous, scroll-linked motion is a CSS scroll-driven animation**
   (`scroll()` / `view()`), which runs off the main thread. The one scroll
   listener in the runtime reads `window.scrollY` to decide whether the bar
   hides; it measures no element and writes no style.
2. **JavaScript handles discrete events only** — a pointer move, a click, a
   form — and everything it touches is **one custom property**.
3. **Nothing is measured per frame.** No `getBoundingClientRect` in a loop.
4. **Desktop toys are `(pointer:fine)` only** — pointer parallax, the custom
   cursor, the floating menu preview, the grain. A phone gets the layout and
   the reveals.
5. **Every horizontal pin degrades to a native swipe carousel** when
   `animation-timeline` is missing or the pointer is coarse. The pin is an
   enhancement, never the mechanism.

### Easing

| token | curve | for |
|---|---|---|
| `--ease` | `cubic-bezier(.22,1,.36,1)` | the default |
| `--ease-io` | `cubic-bezier(.65,0,.35,1)` | symmetrical in-out |
| `--ease-soft` | `cubic-bezier(.32,.72,0,1)` | big moves — leaves instantly, lands over a long tail, so a room arriving reads as *settling* rather than stopping |
| `--ease-spring` | `cubic-bezier(.16,1.06,.3,1)` | chips and pills; a half-degree of overshoot |

Never use `--ease-soft` or `--ease-spring` for anything a visitor has to read
mid-flight.

### Reveals

`[data-r]` on any element; the runtime's one `IntersectionObserver` adds `.in`
and unobserves. Variants: `data-r="fade"` · `"left"` · `"zoom"` · `"clip"`.
Stagger with `style="--d:120ms"`.

### Position is never animated

Two latency bugs shipped for three versions because one `transition` covered
both a position and a scale:

- The **custom cursor** trailed the pointer by 160 ms. On a page that sets
  `cursor:none`, the ring *is* the pointer — and it was not where the click
  landed. Position and scale are separate properties now (`translate` /
  `scale`), and only `scale` transitions.
- **Magnetic buttons** lagged by 500 ms, because the magnet wrote `transform`
  and `.btn` eases `transform` over `.5s`. It also overwrote the hover lift.
  The magnet writes `translate`; the two compose.

The e2e asserts both position properties have a zero transition duration.

### Opting out of the custom cursor

Put `data-nocursor` on any region. It restores the system cursor and hides the
ring. **Required for anything inside a `<dialog>`**: `showModal()` puts the
dialog in the top layer, which paints above every `z-index`, so the ring is
drawn *underneath* the open modal while `cursor:none` is still in force — and
the visitor has no pointer at all. Put the attribute on an ancestor in the DOM;
both the CSS selector and `closest()` walk the DOM, not the paint order.

---

## 7 · Accessibility contract

- **Semantic elements.** A toggle is `<button aria-pressed>`, never a div. A
  modal is `<dialog>` opened with `showModal()` — it supplies focus
  containment, Escape, the inert background and the top layer. Hand-rolling any
  of that is how a modal ends up trapping a keyboard.
- **Focus is the system's.** `:focus-visible` draws a 2 px `--sage` outline at
  3 px offset, `--sage-ink` under `.on-light`. Do not restyle it per component.
- **Every `<img>` carries `alt`.** Decorative photography gets `alt=""`; the
  build fails on a missing attribute. Overlay text that is decoration is
  `aria-hidden`; text that is a **claim** is not.
- **Live regions for computed values.** A price or a state that changes without
  a page load goes in `aria-live="polite"`.
- **`prefers-reduced-motion` removes motion, not information.**
- **The page works with JavaScript off.** The one exception is §07b, which is a
  calculator; it is `display:none` until the script adds `.ready`, because an
  empty shell of a calculator is worse than none.

---

## 8 · Where the guards live

`build-h.py` runs 11 before it writes anything. Worth copying the shape into
any new page:

| # | asserts |
|---|---|
| 1–5 | no page state, no competitor photography, no comparative copy, the banner is five things, the contour is drawn |
| 6 | **the component layer names no colour** — 49 rules, 0 literals |
| 7 | 19 tokens, all bare HSL, all re-themed under `.on-light` |
| 8 | no pre-kit class survives, every primitive is actually used |
| 9 | 0 CDN hosts, no `tailwind`/`react`/`node_modules`, 1 inline script, 1 stylesheet |
| 10 | §05 carries its six names, five ingredient chips, both legends, full width |
| 11 | §07b's `resolve()` is pure, keeps its three named gates, data in one place |

The e2e adds 500 assertions across 7 profiles, including one with JavaScript
disabled and one that lifts the pure pricing layer out of the **served HTML**
and runs all 16 384 possible selections through it in Node — so the rules are
tested as the bytes a guest downloads, and production carries no test seam.
