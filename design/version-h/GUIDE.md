# Cure Và · Version H — how to build on it

Practical. `DESIGN-SYSTEM.md` is the reference; this is the order you do
things in.

---

## 1 · A new page in five steps

```bash
cp version-h/html/_page.html version-h/html/pricing.html
# edit it: title, description, the __TOKENS__, your sections
python3 version-h/build/build-page.py html/pricing.html dist/public/pricing/
node version-h/build/smoke.js          # renders every built page, 2 viewports
cd dist && npx wrangler deploy
```

`build-page.py` inlines the CSS layers and the runtime into one `<style>` and
one `<script>`, resolves image tokens, stamps `width`/`height`, and refuses to
write if any guard fails. It prints what it did.

### Which chrome to use

| the page opens on… | do this |
|---|---|
| a full-bleed photograph (like the landing page) | `class="nav"` — the default |
| a paper section | `class="nav nav--paper"` **and** `.sec--first` on that section |
| a night section | `class="nav"` and `.sec--first` |

`.sec--first` adds the top padding that clears the fixed bar. The landing page
does not need it because its banner sits under the bar on purpose.

**`nav--paper` is not cosmetic.** Without it the cream wordmark is invisible on
paper until the visitor scrolls far enough for `.stuck` to paint a plate. It
is the first bug this system hits the moment it is used for a second page.

---

## 2 · A new section

```html
<section class="sec on-light" id="pricing" aria-labelledby="pricingH">
  <span class="ix" aria-hidden="true">02</span>
  <div class="wrap">
    <div class="head head--split">
      <div>
        <span class="eyebrow" data-r="fade">Pricing</span>
        <h2 class="h-lg" id="pricingH" data-r style="--d:60ms">What an hour
          <em>actually costs.</em></h2>
      </div>
      <p class="lede" data-r="fade" style="--d:120ms">One sentence.</p>
    </div>

    <!-- your content -->
  </div>
</section>
```

- `.sec` night · `.sec on-light` paper · add `.sec--tight` for a shorter one.
  **Alternate them.** Four dark sections in a row reads as one long section.
- `.head` for the heading block, `.head--split` to put the lede beside it.
- `.ix` is the corner index. Optional — several sections on the landing page
  do not have one, and the e2e asserts the numbering has no gaps, so if you
  add one, add it in sequence.
- Every heading gets an `<em>` somewhere. That italic turn is how every
  headline on this site resolves; a heading without one reads as unfinished.
- `data-r` on anything that should arrive. `--d` staggers it.

### Never write a colour

```css
/* wrong — it will not re-theme, and it will not survive review */
.pricing-note{color:#575146}
.pricing-note{color:var(--ink-2)}

/* right */
.pricing-note{color:hsl(var(--muted-foreground))}
```

On `.on-light` that token is already `#575146`. You get both grounds for free,
and `build-page.py` will not fail you.

---

## 3 · Using the components

```html
<!-- Button: variant × size -->
<a class="btn" href="#">Primary</a>
<a class="btn btn--outline btn--sm" href="#">Quiet, small</a>
<button class="btn btn--secondary" type="button">Secondary</button>

<!-- Badge -->
<span class="badge badge--secondary">Longer wear</span>
<span class="badge badge--outline"><span class="dot" aria-hidden="true"></span>Never expires</span>
<span class="badge badge--accent">Save $15</span>

<!-- Card -->
<article class="card">
  <div class="card-header">
    <h3 class="card-title">Title</h3>
    <p class="card-description">One line.</p>
  </div>
  <div class="card-content">…</div>
</article>

<!-- Field -->
<label class="label" for="email">Email address</label>
<input class="input" id="email" type="email" aria-describedby="emailErr">
<p class="alert alert--destructive" id="emailErr" role="alert">…</p>

<!-- Separator -->
<hr class="separator">
```

**`.card` gives ground, corner and ink — not elevation.** Add the shadow where
you use it, because a full-width card and a 200 px card do not want the same
one. See `DESIGN-SYSTEM.md` §4.

**Put `.num` on every price and count.** It turns on tabular figures, so a
column of numbers lines up and a changing price does not jitter.

---

## 4 · A form

Copy the block from `html/coming-soon.html`. Three things are not optional:

1. `novalidate` on the form, and validate in JS — the browser's native bubble
   cannot be styled and looks like a different website.
2. **`aria-invalid` on the input**, not only a class on the form. The field has
   to announce itself, not merely look wrong.
3. The success state gets focus (`tabindex="-1"` + `.focus()`), or a screen
   reader user never learns the form succeeded.

Every form in this system is **front-end only** today. Wire it before the page
is public, and delete the comment that says so when you do.

---

## 5 · Motion

- Anything that should arrive on scroll: `data-r` (+ `data-r="fade" | "left" |
  "zoom" | "clip"`), stagger with `style="--d:120ms"`. The runtime's single
  observer handles it and unobserves as it goes.
- Anything continuous and scroll-linked: a **CSS scroll-driven animation**
  (`animation-timeline: view()`), inside
  `@supports (animation-timeline:view())` with a static fallback.
- `data-mag` on a button for the magnetic pull. Desktop only, automatically.
- **Never animate a position with a `transition` that also covers something
  else.** That is exactly how the cursor came to lag 160 ms and the magnets
  500 ms. Use the separate `translate` / `scale` properties.
- Add `data-nocursor` to any region that should keep the system cursor.
  **Required inside a `<dialog>`** — see `DESIGN-SYSTEM.md` §6.

---

## 6 · A modal

Use `<dialog>` and `showModal()`. Not a div.

```js
open.addEventListener('click', function(){
  modal.showModal();
  document.body.classList.add('lock');
});
/* Release the lock on the dialog's own `close` EVENT, never in the close
   button's handler — Escape closes the dialog natively and never reaches
   that button, so the lock would leak and the page would stay unscrollable. */
modal.addEventListener('close', function(){
  document.body.classList.remove('lock');
});
/* a click that lands on the <dialog> itself is a click on the backdrop */
modal.addEventListener('click', function(e){ if (e.target === modal) modal.close(); });
```

Put `data-nocursor` on an ancestor, and remember the dialog is in the **top
layer**: it paints above every `z-index`, including the custom cursor.

---

## 7 · Email

Read `email/README.md` first. Short version: **email shares only the hexes.**
Custom properties do not work in Outlook, so none of `css/` transfers. Copy
`email/email-base.html`, replace the `__TOKENS__`, delete the blocks you do not
need, and test with images off, in dark mode, and in Outlook.

---

## 8 · Before you ship

```bash
python3 version-h/build/build-page.py html/<page>.html dist/public/<path>/
node version-h/build/smoke.js
```

`smoke.js` renders every built page at 1440 and 390 and fails on: a page
error, an HTTP error, horizontal scroll, a preloader that never leaves, a
reveal that never fired, a laid-out image that never loaded, or a `--primary`
that is not a bare HSL triplet.

For anything with real logic, write a suite like `e2e/version-h.test.js`. Its
two ideas are worth copying:

- **Test the shipped bytes.** It fetches the served HTML, slices the pure
  layer out between two markers, and runs it in Node — so production carries
  no `window.__test` seam.
- **Sweep the whole input space** when it is small enough. All 16 384 possible
  service selections run on every pass, which is what found three data faults
  that no amount of clicking would have.

---

## 9 · Things that will bite you

Each of these cost a debugging session already.

| | |
|---|---|
| **`.foot a` beats `.btn`** | `(0,1,1)` vs `(0,1,0)`. Moving the footer button's inline size into a class silently resized it. Scope the link rule or keep the inline style. |
| **`<figure>` has `margin-inline: 40px`** | From the UA sheet. Invisible in a narrow column; a 40 px gutter the moment the figure goes full width. |
| **A closed `<dialog>` is `display:none`** | Everything inside it has no box. Any test that measures it must open it first. |
| **`page.hover()` + `scroll-behavior:smooth`** | Playwright scrolls, then places the mouse mid-flight; the element slides away and `:hover` is genuinely gone. Park the scroll first. |
| **Chromium and WebKit disagree on `display:none`** | Chromium resolves `var()` through it; WebKit returns the pre-change value. An assertion reading computed style must own the state it reads in. |
| **`clamp()` in a `<style>` block that email will see** | Outlook ignores it and your layout collapses. Email is tables and pixels. |
| **A colour named inside a component** | It looks right on the ground you wrote it for and stops re-theming on the other one. The guard catches it; do not disable the guard. |
