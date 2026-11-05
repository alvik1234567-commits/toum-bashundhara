(() => {
  // ---- Settings: put the restaurant's WhatsApp number here (country code, no +), e.g. "8801712345678"
  const WHATSAPP_NUMBER = "";
  const DELIVERY_FEE = 29;

  const MENU = window.TOUM_MENU;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const tk = n => "Tk " + n.toLocaleString("en-IN");
  const img = slug => `img/menu/${slug}.jpg`;
  const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // flatten
  const ITEMS = {};
  MENU.forEach(cat => cat.items.forEach(([slug, name, price, desc, serves, tags]) => {
    ITEMS[slug] = { slug, name, price, desc, serves, tags: tags.split(" ").filter(Boolean), cat: cat.id };
  }));
  const total = Object.keys(ITEMS).length;
  $$(".strip-head a").forEach(el => { el.textContent = `See all ${total} dishes ↓`; });

  const badges = it => [
    it.tags.includes("p") ? `<span class="badge b-p">🔥 Popular</span>` : "",
    it.tags.includes("v") ? `<span class="badge b-v">🌿 Veg</span>` : "",
    it.tags.includes("s") ? `<span class="badge b-s">🌶 Spicy</span>` : "",
  ].join("");

  // ---------- Cart ----------
  let cart = {};
  try { cart = JSON.parse(localStorage.getItem("toum-cart") || "{}") || {}; } catch (e) { cart = {}; }
  Object.keys(cart).forEach(k => { if (!ITEMS[k]) delete cart[k]; });
  const save = () => { try { localStorage.setItem("toum-cart", JSON.stringify(cart)); } catch (e) {} };
  const count = () => Object.values(cart).reduce((a, b) => a + b, 0);
  const subtotal = () => Object.entries(cart).reduce((a, [k, q]) => a + ITEMS[k].price * q, 0);

  function add(slug, q = 1) {
    cart[slug] = (cart[slug] || 0) + q;
    save(); syncCart();
    toast(`Added ${q > 1 ? q + " × " : ""}${ITEMS[slug].name}`);
    const c = $("#cartCount"); c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump");
  }
  function setQty(slug, q) {
    if (q <= 0) delete cart[slug]; else cart[slug] = q;
    save(); syncCart();
  }
  function syncCart() {
    const n = count(), sub = subtotal();
    $("#cartCount").textContent = n;
    $("#fabCount").textContent = n;
    $("#fabTotal").textContent = tk(sub);
    const fab = $("#fab"); fab.hidden = n === 0; fab.classList.toggle("has", n > 0);
    $("#dSub").textContent = tk(sub);
    $("#dTotal").textContent = tk(n ? sub + DELIVERY_FEE : 0);
    $("#waBtn").disabled = n === 0;
    $("#dItems").innerHTML = n ? Object.entries(cart).map(([k, q]) => `
      <div class="d-item">
        <img src="${img(k)}" alt="">
        <div class="n"><b>${esc(ITEMS[k].name)}</b><span>${tk(ITEMS[k].price * q)}</span></div>
        <div class="qty"><button data-q="${k}" data-d="-1" aria-label="Less">−</button><span>${q}</span><button data-q="${k}" data-d="1" aria-label="More">+</button></div>
      </div>`).join("")
      : `<div class="d-empty"><div>🧄</div><b>Nothing here yet.</b><br>Add something garlicky from the menu.</div>`;
    $$(".item-add").forEach(b => {
      const q = cart[b.dataset.add];
      b.classList.toggle("in", !!q); b.textContent = q ? "×" + q : "+";
    });
  }
  $("#dItems").addEventListener("click", e => {
    const b = e.target.closest("[data-q]"); if (!b) return;
    setQty(b.dataset.q, (cart[b.dataset.q] || 0) + +b.dataset.d);
  });

  // ---------- Popular ----------
  const popular = Object.values(ITEMS).filter(i => i.tags.includes("p"));
  $("#popGrid").innerHTML = popular.map((it, i) => `
    <article class="sitem" data-open="${it.slug}" tabindex="0">
      <div class="sitem-img"><img src="${img(it.slug)}" alt="${esc(it.name)}"><span class="num">0${i + 1}</span></div>
      <h3>${esc(it.name)}</h3>
      <div class="sitem-row"><span>${tk(it.price)}</span><button data-add="${it.slug}" aria-label="Add ${esc(it.name)}">+ Add</button></div>
    </article>`).join("");

  // ---------- Menu ----------
  $("#catScroll").innerHTML = MENU.map(c => `<a class="cat" href="#cat-${c.id}" data-cat="${c.id}">${c.name}</a>`).join("");
  let filter = "all", query = "";
  function renderMenu() {
    const q = query.trim().toLowerCase();
    let shown = 0;
    $("#menuBody").innerHTML = MENU.map(cat => {
      const list = cat.items.map(a => ITEMS[a[0]]).filter(it =>
        (filter === "all" || it.tags.includes(filter)) &&
        (!q || (it.name + " " + it.desc + " " + cat.name).toLowerCase().includes(q)));
      if (!list.length) return "";
      shown += list.length;
      return `<div class="cat-block" id="cat-${cat.id}" data-cat="${cat.id}">
        <div class="cat-title"><h3>${cat.name}</h3><span class="ar">${cat.ar}</span></div>
        <p class="cat-blurb">${cat.blurb}</p>
        <div class="items">${list.map(it => `
          <article class="item" data-open="${it.slug}" tabindex="0">
            <div class="item-txt">
              <h4>${esc(it.name)}</h4>
              <p>${esc(it.desc)}</p>
              <div class="item-meta"><span class="price-tag">${tk(it.price)}</span>${it.serves && it.serves !== "1:1" ? `<span class="badge b-serve">${it.serves === "1:2" ? "Serves 2" : esc(it.serves)}</span>` : ""}${badges(it)}</div>
            </div>
            <div class="item-pic"><img src="${img(it.slug)}" alt="${esc(it.name)}" loading="lazy"><button class="item-add" data-add="${it.slug}" aria-label="Add ${esc(it.name)}">+</button></div>
          </article>`).join("")}</div>
      </div>`;
    }).join("");
    $("#empty").hidden = shown > 0;
    $$(".cat").forEach(a => a.style.display = $(`#cat-${a.dataset.cat}`) ? "" : "none");
    syncCart(); spy();
  }
  $("#search").addEventListener("input", e => { query = e.target.value; renderMenu(); });
  $$(".chip").forEach(c => c.addEventListener("click", () => {
    $$(".chip").forEach(x => x.classList.toggle("on", x === c));
    filter = c.dataset.f; renderMenu();
  }));

  // scrollspy for category bar
  let spyObs;
  function spy() {
    spyObs && spyObs.disconnect();
    spyObs = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        const id = en.target.dataset.cat;
        $$(".cat").forEach(a => {
          const on = a.dataset.cat === id; a.classList.toggle("on", on);
          if (on) { const s = $("#catScroll"); s.scrollTo({ left: a.offsetLeft - s.clientWidth / 2 + a.clientWidth / 2, behavior: "smooth" }); }
        });
      });
    }, { rootMargin: "-140px 0px -65% 0px" });
    $$(".cat-block").forEach(b => spyObs.observe(b));
  }

  // ---------- Modal ----------
  let mSlug = null, mQty = 1;
  const modal = $("#modal");
  function openModal(slug) {
    const it = ITEMS[slug]; mSlug = slug; mQty = 1;
    $("#mImg").src = img(slug); $("#mImg").alt = it.name;
    $("#mName").textContent = it.name; $("#mDesc").textContent = it.desc;
    $("#mTags").innerHTML = badges(it) + (it.serves && it.serves !== "1:1" ? `<span class="badge b-serve">${it.serves === "1:2" ? "Serves 2" : esc(it.serves)}</span>` : "");
    updM(); modal.hidden = false; document.body.style.overflow = "hidden";
  }
  const updM = () => { $("#mQty").textContent = mQty; $("#mTotal").textContent = tk(ITEMS[mSlug].price * mQty); };
  const closeModal = () => { modal.hidden = true; document.body.style.overflow = ""; };
  $("#mMinus").onclick = () => { mQty = Math.max(1, mQty - 1); updM(); };
  $("#mPlus").onclick = () => { mQty++; updM(); };
  $("#mAdd").onclick = () => { add(mSlug, mQty); closeModal(); };
  $$("[data-close]", modal).forEach(b => b.onclick = closeModal);

  // ---------- Drawer ----------
  const drawer = $("#drawer");
  const openDrawer = () => { drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; };
  const closeDrawer = () => { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; };
  $("#cartOpen").onclick = openDrawer; $("#fab").onclick = openDrawer;
  $$("[data-dclose]").forEach(b => b.onclick = closeDrawer);
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeModal(); closeDrawer(); } });

  $("#waBtn").onclick = () => {
    const lines = Object.entries(cart).map(([k, q]) => `• ${q} × ${ITEMS[k].name} — ${tk(ITEMS[k].price * q)}`);
    const sub = subtotal();
    const msg = `Hi TOUM! I'd like to order:\n\n${lines.join("\n")}\n\nSubtotal: ${tk(sub)}\nDelivery: ${tk(DELIVERY_FEE)}\n*Total: ${tk(sub + DELIVERY_FEE)}*\n\nName:\nAddress:\nPhone:`;
    const base = WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER}` : "https://wa.me/";
    window.open(`${base}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  };

  // ---------- Global clicks ----------
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-add]");
    if (a) { e.stopPropagation(); add(a.dataset.add); return; }
    const o = e.target.closest("[data-open]");
    if (o) { openModal(o.dataset.open); return; }
    const j = e.target.closest("[data-jump]");
    if (j) { e.preventDefault(); const t = $(`#cat-${j.dataset.jump}`); t && t.scrollIntoView({ behavior: "smooth" }); }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.matches("[data-open]")) openModal(e.target.dataset.open);
  });

  // ---------- Toast ----------
  let tT;
  function toast(t) { const el = $("#toast"); el.textContent = "✓ " + t; el.classList.add("show"); clearTimeout(tT); tT = setTimeout(() => el.classList.remove("show"), 1800); }

  $("#yr").textContent = new Date().getFullYear();
  renderMenu();
})();
