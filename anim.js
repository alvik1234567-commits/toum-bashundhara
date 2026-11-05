// TOUM — motion layer. Everything here is decorative; the site works without it.
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---- split a heading into masked words (keeps nested spans like .hl) ----
  function split(el, base = 0, step = 0.055) {
    let i = 0;
    const walk = node => {
      [...node.childNodes].forEach(n => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            const w = document.createElement("span"); w.className = "w";
            const inner = document.createElement("span"); inner.textContent = part;
            inner.style.transitionDelay = (base + i++ * step).toFixed(3) + "s";
            w.appendChild(inner); frag.appendChild(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && !n.matches("svg")) walk(n);
      });
    };
    walk(el);
    el.classList.add("split");
    return i;
  }

  // ---- hero intro ----
  const h1 = $(".hero h1");
  const hl = $(".hero .hl");
  if (hl) hl.insertAdjacentHTML("beforeend",
    '<svg class="scribble" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true"><path d="M3 14 C 60 4, 120 4, 170 10 S 260 17, 297 6"/></svg>');
  const words = split(h1, 0.1);
  const after = 0.1 + words * 0.055;
  if (hl) hl.style.setProperty("--d", after + 0.15 + "s");
  [[".hero-side p", after - 0.2], [".order-block", after], [".strip-head", after + 0.05]]
    .forEach(([s, d]) => { const el = $(s); if (el) { el.classList.add("fx"); el.style.setProperty("--d", d + "s"); } });
  $$(".sitem").forEach((el, i) => { el.classList.add("fx"); el.style.setProperty("--d", after + 0.15 + i * 0.08 + "s"); });
  requestAnimationFrame(() => requestAnimationFrame(() =>
    [h1, hl, ...$$(".hero .fx")].forEach(el => el && el.classList.add("in"))));

  // ---- scroll reveals ----
  const io = new IntersectionObserver(es => es.forEach(en => {
    if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
  }), { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });

  $$(".section h2, .party h2").forEach(h => { split(h, 0, 0.04); io.observe(h); });
  $$(".kicker, .cat-blurb, .story-copy p, .party-copy p, .party-row, .info li, .pillar").forEach((el, i, all) => {
    el.classList.add("fx");
    const sib = [...el.parentElement.children].filter(c => c.classList.contains("fx")).indexOf(el);
    el.style.setProperty("--d", Math.max(0, sib) * 0.08 + "s");
    io.observe(el);
  });
  // menu: cards stagger per category on first render
  $$(".cat-block").forEach(block => {
    $$(".item", block).forEach((it, i) => { it.classList.add("fx"); it.style.setProperty("--d", Math.min(i, 6) * 0.06 + "s"); io.observe(it); });
    const t = $(".cat-title", block); t.classList.add("fx"); io.observe(t);
  });
  const pimg = $(".party-img"); if (pimg) { pimg.classList.add("fx-spin"); io.observe(pimg); }
  const map = $(".map"); if (map) { map.classList.add("fx"); io.observe(map); }

  // ---- fly-to-cart ----
  function fly(fromImg) {
    if (reduce || !fromImg) return;
    const target = $("#fab.has") && getComputedStyle($("#fab")).display !== "none" ? $("#fab") : $("#cartOpen");
    const a = fromImg.getBoundingClientRect(), b = target.getBoundingClientRect();
    if (!a.width) return;
    const ghost = fromImg.cloneNode();
    ghost.className = "ghost";
    Object.assign(ghost.style, { left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px" });
    document.body.appendChild(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    ghost.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1, borderRadius: "6px" },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 80}px) scale(.55) rotate(-8deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.12) rotate(-16deg)`, opacity: 0.4, borderRadius: "50%" },
    ], { duration: 750, easing: "cubic-bezier(.5,0,.3,1)" }).onfinish = () => {
      ghost.remove();
      target.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 300 });
    };
  }
  document.addEventListener("click", e => {
    const add = e.target.closest("[data-add]");
    if (add) {
      const host = add.closest(".sitem, .item, .party-in");
      fly(host && $("img", host));
    } else if (e.target.closest("#mAdd")) fly($("#mImg"));
  }, true);
})();
