/* ═══════════════════════════════════════════════════════════════════════
   Cure Và · version H — shared runtime
   ───────────────────────────────────────────────────────────────────────
   EXTRACTED from landing-page-h.template.html. Only the behaviours every
   page wants: the preloader, the reveal observer, the custom cursor and
   its magnets, the nav, the full-screen menu, and the live motion-
   preference listener. Nothing here knows about a section.

   The landing page's own blocks (manifesto, anatomy, lens, menu, rail,
   membership, waitlist, HUD, founder quote, ritual builder) are NOT here —
   they live with their sections. See GUIDE.md.
   ═══════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var doc = document, root = doc.documentElement;
function $(s,c){ return (c||doc).querySelector(s); }
function $$(s,c){ return Array.prototype.slice.call((c||doc).querySelectorAll(s)); }
var mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
var reduce   = mqReduce.matches;
var fine     = matchMedia('(pointer: fine)').matches;
var rich     = fine && !reduce;                 /* desktop toys allowed */
function raf(fn){ return requestAnimationFrame(fn); }

/* ═══════════════════════════════════════════════════════════════════════
   BUILD YOUR RITUAL · EDITABLE PLACEHOLDER DATA
   ───────────────────────────────────────────────────────────────────────
   These two arrays are the only source of truth for §07b. Nothing below
   hard-codes a service, a price or a package name: add a row and it
   appears, delete one and it goes, change a discount and every price on
   the page follows.

   THEY ARE PLACEHOLDERS. They do not match §06's menu — that one prices a
   Signature Manicure at $55, this one prices a Waterless Manicure at $45 —
   and both cannot be right. Replace them with the signed-off menu before
   this link reaches a real guest.

   THE DURATIONS CHANGED on 2026-08-29, and the reason is worth keeping:
   the first set made the whole model impossible to satisfy. The five
   shortest services totalled 65 minutes, so a 60-minute package could
   never hold five things; six items inside 60 minutes was arithmetically
   out of reach; and P45 could not be reached by ANY selection at all
   (only three services listed it, and all three together ran 50 minutes
   against its 45-minute cap). The presets below ask for five services in
   an hour and seven in ninety, so the clock had to become answerable.
   Names, groups, prices and eligibility are untouched.
   ═══════════════════════════════════════════════════════════════════════ */
var PACKAGES = [
  { code:'P45', name:'The Pause',       duration:45, itemMin:3, itemMax:4, discount:0.10 },
  { code:'P60', name:'The Ritual',      duration:60, itemMin:4, itemMax:6, discount:0.15 },
  { code:'P90', name:'The Restoration', duration:90, itemMin:5, itemMax:7, discount:0.20 }
];

var SERVICES = [
  { code:'S01', name:'Waterless Manicure',           group:'Hand', duration:20, retail:45, eligible:['P45','P60','P90'] },
  { code:'S02', name:'Waterless Pedicure',           group:'Foot', duration:25, retail:60, eligible:['P60','P90'] },
  { code:'S03', name:'Cuticle Care & Nail Shaping',  group:'Hand', duration:10, retail:20, eligible:['P45','P60','P90'] },
  { code:'S04', name:'Hand & Forearm Massage',       group:'Hand', duration:10, retail:30, eligible:['P45','P60','P90'] },
  { code:'S05', name:'Foot & Calf Massage',          group:'Foot', duration:10, retail:30, eligible:['P60','P90'] },
  { code:'S06', name:'Nourishing Hand Mask',         group:'Hand', duration: 5, retail:25, eligible:['P60','P90'] },
  { code:'S07', name:'Warm Stone Foot Ritual',       group:'Foot', duration:15, retail:40, eligible:['P90'] },
  { code:'S08', name:'Nail Strengthening Treatment', group:'Hand', duration:10, retail:35, eligible:['P60','P90'] },
  { code:'S09', name:'Callus Softening Ritual',      group:'Foot', duration:15, retail:35, eligible:['P90'] },
  { code:'S10', name:'Facial Pressure Point Ritual', group:'Face', duration:10, retail:55, eligible:['P45','P60','P90'] },
  { code:'S11', name:'Brow Shaping',                  group:'Face', duration:10, retail:25, eligible:['P45','P60','P90'] },
  { code:'S12', name:'Hydrating Facial Mask',         group:'Face', duration:15, retail:50, eligible:['P60','P90'] },
  { code:'S13', name:'Gua Sha Facial Massage',        group:'Face', duration:20, retail:65, eligible:['P60','P90'] },
  { code:'S14', name:'Lash Lift',                     group:'Face', duration:25, retail:70, eligible:['P90'] }
];

/* ── the two rituals offered on the page ──────────────────────────────
   A preset is a NAMED SELECTION, not a fourth pricing rule: `includes`
   goes through the same resolve() the custom builder uses, so the price
   on a card and the price a guest builds by hand can never drift apart.

   `gifts` sit OUTSIDE the engine on purpose. They are given, so they add
   nothing to the retail total; they run in the same recline as the rest
   (which is the studio's own claim — several treatments, one hour), so
   they add nothing to the clock; and they are not chosen, so they are not
   asked to pass the eligibility gate. They are an offer laid over a
   priced selection, and keeping them out of resolve() is what stops the
   card and the builder disagreeing. */
var PRESETS = [
  /* Both of these deliberately run on more than one track, because a
     ritual that is all Hand is just a list — the point of the studio is
     that the other two tracks cost no extra time. */
  { code:'R60', name:'The Ritual',      packageCode:'P60',
    includes:['S01','S03','S04','S05','S11'], gifts:['S12'] },
  { code:'R90', name:'The Restoration', packageCode:'P90',
    includes:['S01','S03','S02','S05','S07','S09','S13'], gifts:['S12','S11'] }
];

/* ── small readers over the data ─────────────────────────────────────── */
function svcByCode(code){
  for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].code === code) return SERVICES[i];
  return null;
}
function pkgByCode(code){
  for (var i = 0; i < PACKAGES.length; i++) if (PACKAGES[i].code === code) return PACKAGES[i];
  return null;
}
/* codes -> records. An unrecognised code is dropped rather than thrown:
   these can arrive from a pasted URL, which nobody controls. */
function expand(codes){
  return codes.map(svcByCode).filter(Boolean);
}
/* ── HOW LONG THE APPOINTMENT IS ──────────────────────────────────────
   NOT the sum. Hand, Foot and Face happen in the same recline at the same
   time — which is the studio's actual claim, and until now the only part
   of it this engine did not model. Two services on the SAME track run one
   after the other and add up; services on DIFFERENT tracks overlap.

   So the appointment lasts as long as its LONGEST track:

     Hand 20 + Foot 20 + Face 20  ->  20 minutes, not 60
     Hand 20 + Hand 10 + Foot 25  ->  30 minutes (hand 30, foot 25)

   Every gate, every gap and every price reads this one function, so the
   whole model changes here and nowhere else. */
function minutesOf(services){
  var track = {};
  services.forEach(function(s){
    track[s.group] = (track[s.group] || 0) + s.duration;
  });
  var longest = 0;
  for (var g in track) if (track[g] > longest) longest = track[g];
  return longest;
}

/* The same numbers, kept apart — the panel shows these so a guest can see
   why five services come to twenty-five minutes and not seventy. */
function tracksOf(services){
  var track = {};
  services.forEach(function(s){
    track[s.group] = (track[s.group] || 0) + s.duration;
  });
  return Object.keys(track).sort(function(a, b){ return track[b] - track[a]; })
    .map(function(g){ return { group:g, minutes:track[g] }; });
}

/* ═══ THE THREE GATES ═══════════════════════════════════════════════════
   A package qualifies only when ALL THREE pass. They are three separate
   named predicates so each can be read, argued with and changed without
   touching the other two. ═══════════════════════════════════════════════ */

/* Test 1 — DURATION FIT.
   The whole selection has to finish inside the length the package books.
   Equality PASSES: a 45-minute selection is a legitimate 45-minute
   package, not an overrun by zero. */
function fitsDuration(pkg, totalDuration){
  return totalDuration <= pkg.duration;
}

/* Test 2 — ITEM COUNT FIT.
   A real gate in BOTH directions, and independent of the clock. Too few
   services is not this package even when the minutes fit — the guest has
   booked a 60-minute room for two things. Too many is not this package
   even when the minutes also fit. */
function fitsItemCount(pkg, itemCount){
  return itemCount >= pkg.itemMin && itemCount <= pkg.itemMax;
}

/* Test 3 — ELIGIBILITY.
   Every selected service has to name this package in its own eligible
   list. One ineligible service disqualifies the package outright, however
   well the other two tests score. */
function isEligible(pkg, services){
  return services.every(function(s){ return s.eligible.indexOf(pkg.code) !== -1; });
}

/* ═══ resolve() — pure. Same codes in, same object out. No DOM, no
   globals, no clock. Everything the section renders comes from here.
   Returns { tier, price, retailTotal, savings, totalDuration, itemCount, gap }
   ═══════════════════════════════════════════════════════════════════════ */
function resolve(selectedCodes){
  // Codes -> records, once. Every number below reads this array.
  var services = expand(selectedCodes);

  // The three quantities the gates and the pricing both need.
  var itemCount     = services.length;
  var totalDuration = minutesOf(services);
  var retailTotal   = services.reduce(function(n, s){ return n + s.retail; }, 0);

  // Run all three gates against every package. No early exit and no
  // short-circuit across packages: findGap() below needs to know HOW each
  // one failed, not merely that one did.
  var qualifying = PACKAGES.filter(function(P){
    return fitsDuration(P, totalDuration)
        && fitsItemCount(P, itemCount)
        && isEligible(P, services);
  });

  // ── nothing qualifies -> à la carte ───────────────────────────────
  // price IS retailTotal: there is no package, so there is no discount,
  // and the guest is charged for exactly what they picked.
  if (!qualifying.length) {
    return {
      tier: null,
      price: retailTotal,
      retailTotal: retailTotal,
      savings: 0,
      totalDuration: totalDuration,
      itemCount: itemCount,
      // with nothing selected there is no shortfall to report — an empty
      // selection has not failed, it has not started
      gap: itemCount ? findGap(services, itemCount, totalDuration) : null
    };
  }

  // ── two or more qualify -> take the SMALLEST duration ─────────────
  // This favours the guest: the shortest package that legitimately holds
  // the selection is the cheapest room to book it in.
  // ◀── REVENUE SWITCH: this single comparison is the whole policy.
  //     Change `<` to `>` to favour the largest qualifying package.
  var P = qualifying.reduce(function(best, cur){
    return cur.duration < best.duration ? cur : best;
  });

  // Package price: retail less the package discount, rounded to the
  // nearest $5 so the result reads as a price and not as a division.
  var price = Math.round(retailTotal * (1 - P.discount) / 5) * 5;

  // A "discount" that rounds UP is not a discount. It cannot happen with
  // the numbers above, but it can the moment somebody sets a discount to
  // 0 or a retail price below $5 — and a package that costs more than its
  // own parts is the worst thing this section could ever show.
  if (price > retailTotal) price = retailTotal;

  return {
    tier: P,
    price: price,
    retailTotal: retailTotal,
    savings: retailTotal - price,
    totalDuration: totalDuration,
    itemCount: itemCount,
    gap: null
  };
}

/* ── why nothing matched ──────────────────────────────────────────────
   Returns the nearest miss as DATA, never as a sentence — the render
   layer owns every word:  { packageCode, reason, amount }

   Three rules, and the second one is the one that matters.

   1 · To open a package the guest must fix EVERY test it fails, so a
       package costs as much as its WORST failure — not its cheapest.

   2 · REMOVALS AND ADDITIONS ARE NOT INTERCHANGEABLE. "Add 2 more
       services" and "one of these is not part of that package" can both
       be true of the same package at once, and quoting the bigger number
       tells the guest to add services that still will not open it. So a
       package is ranked first on how many services must come OUT, and
       only then on how many must go in — and the wording always names a
       removal when one is outstanding.

   3 · `amount` stays in the unit its reason implies (services, or
       minutes). `steps` is the comparable one — services in or out — and
       it is what the ranking reads. */
function findGap(services, itemCount, totalDuration){
  var best = null;

  PACKAGES.forEach(function(P){
    var misses = [];

    // ineligible services: each one has to come out before P is possible
    var barred = services.filter(function(s){
      return s.eligible.indexOf(P.code) === -1;
    }).length;
    if (barred) misses.push({ reason:'notEligible', amount:barred, steps:barred });

    // over the clock: `amount` is the minutes over, but the COST is how
    // many services would have to leave to get back under it
    if (!fitsDuration(P, totalDuration)) {
      misses.push({ reason:'overDuration',
                    amount: totalDuration - P.duration,
                    steps:  removalsToFit(services, P.duration) });
    }

    // item count, both directions — one of these at most can be true
    if (itemCount < P.itemMin) {
      misses.push({ reason:'needMoreItems', amount:P.itemMin - itemCount,
                    steps:P.itemMin - itemCount });
    }
    if (itemCount > P.itemMax) {
      misses.push({ reason:'tooManyItems', amount:itemCount - P.itemMax,
                    steps:itemCount - P.itemMax });
    }

    if (!misses.length) return;                 // this package qualifies

    // split the failures by what the guest would physically do about them
    var out = misses.filter(function(m){ return m.reason !== 'needMoreItems'; });
    var add = misses.filter(function(m){ return m.reason === 'needMoreItems'; });

    // the binding removal: fixing a smaller one leaves P still shut
    var worstOut  = out.length ? out.reduce(function(a, b){ return b.steps > a.steps ? b : a; }) : null;
    var removals  = worstOut ? worstOut.steps : 0;
    var additions = add.length ? add[0].steps : 0;

    // rule 2: a package needing nothing removed beats one that does,
    // however many services it still wants added
    var better = !best
      || removals < best.removals
      || (removals === best.removals && additions < best.additions)
      || (removals === best.removals && additions === best.additions
          && P.duration < best.duration);
    if (!better) return;

    // and name the removal while one is outstanding — telling somebody to
    // add to a selection they must first cut is the one useless answer
    var say = worstOut || add[0];
    best = { packageCode:P.code, reason:say.reason, amount:say.amount,
             removals:removals, additions:additions, duration:P.duration };
  });

  return best && { packageCode:best.packageCode, reason:best.reason, amount:best.amount };
}

/* How many services would have to come out before the selection fits
   inside `limit` minutes.

   With a parallel clock "drop the longest service" is wrong: dropping a
   25-minute pedicure does nothing at all while the HAND track is the one
   running over. The only removal that shortens an appointment is one from
   the track that is currently the longest, so that is what this takes. */
function removalsToFit(services, limit){
  var left = services.slice(), n = 0;
  while (minutesOf(left) > limit && left.length) {
    var t = tracksOf(left)[0].group;            /* the track that decides */
    var pick = -1;
    left.forEach(function(s, i){
      if (s.group === t && (pick === -1 || s.duration > left[pick].duration)) pick = i;
    });
    if (pick === -1) break;
    left.splice(pick, 1);
    n++;
  }
  return n;
}

/* ── which packages the selection can still GROW into ─────────────────
   itemMin is deliberately NOT tested here: a selection with too few
   services has not failed, it is unfinished. Duration, itemMax and
   eligibility are one-way doors — adding a service can only ever make
   them worse — so a package that fails one of these can never come back,
   and that is exactly what makes a service "à la carte only". */
function reachable(services){
  var mins = minutesOf(services);
  return PACKAGES.filter(function(P){
    return mins <= P.duration
        && services.length <= P.itemMax
        && isEligible(P, services);
  });
}

/* Which one-way door closed, for the shortest package it closed on.
   Same shape as findGap() so the render layer has one wording function. */
function whyUnreachable(services){
  var mins = minutesOf(services);
  var best = null;

  PACKAGES.forEach(function(P){
    var reason = null, amount = 0;
    if (!isEligible(P, services)) {
      reason = 'notEligible';
      amount = services.filter(function(s){
        return s.eligible.indexOf(P.code) === -1;
      }).length;
    } else if (mins > P.duration) {
      reason = 'overDuration'; amount = mins - P.duration;
    } else if (services.length > P.itemMax) {
      reason = 'tooManyItems';  amount = services.length - P.itemMax;
    }
    if (!reason) return;
    if (!best || P.duration < best.duration) {
      best = { packageCode:P.code, reason:reason, amount:amount, duration:P.duration };
    }
  });

  return best && { packageCode:best.packageCode, reason:best.reason, amount:best.amount };
}

/* ── 1 · preloader ─────────────────────────────────────────────────────
   CSS hides it at 2.4s no matter what. This only ever hides it sooner,
   and it is the only thing on the page that locks the scroll. */
(function(){
  var pre = $('#pre');
  if (!pre) return;
  if (reduce){ pre.remove(); return; }
  doc.body.classList.add('lock');
  var done = false;
  function go(){
    if (done) return;
    done = true;
    doc.body.classList.remove('lock');
    pre.classList.add('gone');
    setTimeout(function(){ if (pre.parentNode) pre.remove(); }, 1000);
  }
  var t0 = performance.now();
  addEventListener('load', function(){
    /* never flash: give the curtain at least 900ms of life */
    setTimeout(go, Math.max(0, 900 - (performance.now() - t0)));
  });
  setTimeout(go, 2400);                          /* belt and braces */
})();

/* ── 2 · reveals — one observer, unobserving as it goes ──────────────── */
(function(){
  var items = $$('[data-r]');
  if (!items.length) return;
  if (reduce || !('IntersectionObserver' in window)){
    items.forEach(function(el){ el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: .08 });
  items.forEach(function(el){ io.observe(el); });
})();

/* ── 3 · custom cursor + magnetic buttons ─────────────────────────────
   Two properties on one element, updated from a pointermove that is
   already coalesced by the browser. The magnet only ever runs while a
   pointer is inside a button. */
if (rich) (function(){
  var cur = $('#cur');
  if (!cur) return;
  root.classList.add('cursor-on');
  var x = innerWidth / 2, y = innerHeight / 2, tick = 0;
  addEventListener('pointermove', function(e){
    if (e.pointerType !== 'mouse') return;
    x = e.clientX; y = e.clientY;
    if (tick) return;
    tick = raf(function(){
      tick = 0;
      cur.style.setProperty('--cx', x + 'px');
      cur.style.setProperty('--cy', y + 'px');
    });
  }, { passive:true });
  addEventListener('pointerdown', function(){ cur.style.setProperty('--cs','.7'); });
  addEventListener('pointerup',   function(){ cur.style.removeProperty('--cs'); });
  addEventListener('mouseleave',  function(){ cur.style.opacity = '0'; });
  addEventListener('mouseenter',  function(){ cur.style.opacity = '1'; });

  /* The cursor grows and names what it is over. DELEGATED, not bound per
     element: a forEach here only ever sees the markup that exists when
     this block runs, and §07b builds its ten service rows later — they
     carried data-cur and were never once picked up. Delegation also lets
     a row change its own word as its state changes. */
  var tag = cur.querySelector('b'), over = null;
  addEventListener('pointerover', function(e){
    if (!e.target.closest) return;
    /* a region that has opted out gets the system cursor and no ring */
    cur.classList.toggle('hide', !!e.target.closest('[data-nocursor]'));
    var el = e.target.closest('[data-cur]');
    if (!el) return;
    over = el;
    tag.textContent = el.getAttribute('data-cur');
    cur.classList.add('tag');
  }, { passive:true });
  addEventListener('pointerout', function(e){
    var el = e.target.closest && e.target.closest('[data-cur]');
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    over = null;
    cur.classList.remove('tag');
  }, { passive:true });
  /* A row whose word changes UNDER a stationary pointer never fires
     pointerover again, so the ring kept saying "Add" over a service it
     had just added. Anything that rewrites a data-cur it might be
     standing on says so. */
  addEventListener('cur:retag', function(){
    if (over) tag.textContent = over.getAttribute('data-cur');
  });

  $$('[data-mag]').forEach(function(el){
    var frame = 0, mx = 0, my = 0;
    function apply(){
      frame = 0;
      /* `translate`, not `transform`: it does not inherit .btn's .5s
         transform easing and it does not overwrite the hover lift */
      el.style.translate = mx + 'px ' + my + 'px';
    }
    el.addEventListener('pointermove', function(e){
      if (e.pointerType !== 'mouse') return;
      var r = el.getBoundingClientRect();          /* read once per move, not per frame */
      mx = (e.clientX - (r.left + r.width / 2)) * .22;
      my = (e.clientY - (r.top + r.height / 2)) * .3;
      el.classList.remove('mag-out');              /* follow instantly while inside */
      if (!frame) frame = raf(apply);
    });
    el.addEventListener('pointerleave', function(){
      if (frame){ cancelAnimationFrame(frame); frame = 0; }
      el.classList.add('mag-out');                 /* ...and ease on the way back */
      el.style.translate = '';
    });
  });
})();

/* ── 4 · nav: hide going down, show coming up, solid once past the hero ──
   `y > last` alone is a trap on a phone. Momentum scrolling, rubber-banding
   at the ends and the URL bar collapsing all deliver deltas that alternate
   sign for a pixel or two at a time, and the bar then slides in and out on
   every one of them. So: clamp away the overscroll, accumulate movement in
   one direction, and only act once it passes a deadband no jitter reaches. */
(function(){
  var nav = $('#nav');
  if (!nav) return;
  /* asymmetric on purpose: hiding the bar is a decision, showing it is a
     reflex. And it stays put entirely while the hero is still on screen —
     a bar sliding in and out over the opening image is the whole complaint. */
  var HIDE = 36, SHOW = 10;
  var last = scrollY, run = 0, hidden = false, ticking = false;
  addEventListener('scroll', function(){
    if (ticking) return;
    ticking = true;
    raf(function(){
      ticking = false;
      /* iOS reports scrollY past both ends while rubber-banding; those are
         not scrolls the visitor made */
      var max = Math.max(0, doc.documentElement.scrollHeight - innerHeight);
      var y = Math.min(Math.max(scrollY, 0), max);
      var d = y - last;
      last = y;

      nav.classList.toggle('stuck', y > 40);
      if (nav.classList.contains('open')) return;

      /* nothing moves until the hero is behind you */
      if (y < Math.max(320, innerHeight * 0.9)){
        run = 0;
        if (hidden){ hidden = false; nav.classList.remove('hide'); }
        return;
      }
      if (!d) return;
      if ((d > 0) !== (run > 0)) run = 0;   /* direction changed — start over */
      run += d;

      if (run > HIDE && !hidden){ hidden = true;  nav.classList.add('hide');    run = 0; }
      else if (run < -SHOW && hidden){ hidden = false; nav.classList.remove('hide'); run = 0; }
    });
  }, { passive:true });
})();

/* ── 5 · full-screen menu ─────────────────────────────────────────────── */
(function(){
  var nav = $('#nav'), btn = $('#burger'), panel = $('#menuPanel');
  if (!btn || !panel) return;
  var open = false, lastFocus = null;
  function set(v){
    open = v;
    panel.classList.toggle('on', v);
    panel.setAttribute('aria-hidden', v ? 'false' : 'true');
    nav.classList.toggle('open', v);
    nav.classList.remove('hide');
    btn.setAttribute('aria-expanded', v ? 'true' : 'false');
    $('.lbl', btn).textContent = v ? 'Close' : 'Menu';
    doc.body.classList.toggle('lock', v);
    if (v){ lastFocus = doc.activeElement; $('.mp-list a', panel).focus({preventScroll:true}); }
    else if (lastFocus){ lastFocus.focus({preventScroll:true}); }
  }
  btn.addEventListener('click', function(){ set(!open); });
  /* the guard that closed the panel above 1080px is gone with the width
     it guarded: the burger no longer disappears at any size, so a resize
     can never strand the panel open with no control left to close it. */
  /* the panel's picture is lazy and clipped to nothing, so it would begin
     loading only once the curtain is already up. Aiming at the button is
     enough warning to start it. */
  function warm(){
    $$('img', panel).forEach(function(im){ im.loading = 'eager'; });
    btn.removeEventListener('pointerenter', warm);
    btn.removeEventListener('focus', warm);
  }
  btn.addEventListener('pointerenter', warm);
  btn.addEventListener('focus', warm);
  $$('a', panel).forEach(function(a){ a.addEventListener('click', function(){ set(false); }); });
  addEventListener('keydown', function(e){
    if (e.key === 'Escape' && open) set(false);
    /* keep tabbing inside the panel while it is over everything else */
    if (e.key === 'Tab' && open){
      var f = $$('a,button', panel).filter(function(el){ return el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first){ e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last){ e.preventDefault(); first.focus(); }
    }
  });
})();

/* ── 14 · a motion preference can change mid-visit ────────────────────── */
mqReduce.addEventListener('change', function(e){
  if (!e.matches) return;
  reduce = true;
  $$('[data-r]').forEach(function(el){ el.classList.add('in'); });
  root.classList.remove('cursor-on');
});


})();
