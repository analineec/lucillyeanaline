/* ══════════════════════════════════════════════════
   ⚙️  CONFIG — ajuste conforme seu backend
   ══════════════════════════════════════════════════ */
const CONFIG = {
  // Endpoint para abrir o checkout de um item:
  // Receberá POST { id, name, price, cat } e deve retornar { checkout_url: "https://..." }
  CHECKOUT_ENDPOINT: "/api/checkout",

  // Endpoint para buscar quais IDs já foram pagos:
  // Deve retornar { gifted_ids: [1, 5, 12, ...] }
  STATUS_ENDPOINT: "/api/gifted",

  // Intervalo de polling em milissegundos (padrão 10s)
  POLL_INTERVAL_MS: 10_000,

  // Se true, abre o checkout em nova aba; se false, redireciona na mesma
  OPEN_IN_NEW_TAB: true,
};
/* ══════════════════════════════════════════════════ */

/* ── STATE ── */
let giftedSet    = new Set();   // Set<id> — preenchido pelo polling
let activeFilter = "Todos";
let pollTimer    = null;

const CATEGORIES = [
  {key:"Todos",                emoji:"🏠"},
  {key:"Cozinha",              emoji:"🍳"},
  {key:"Sala de Estar/Jantar", emoji:"🍽️"},
  {key:"Quarto",               emoji:"🛏️"},
  {key:"Banheiro",             emoji:"🚿"},
  {key:"Lavanderia",           emoji:"🧺"},
  {key:"Área Externa",         emoji:"🪴"},
  {key:"Escritório",           emoji:"🗄️"},
  {key:"Ferramentas",          emoji:"⚒️"},
  {key:"Decoração",            emoji:"🖼️"},
];

/* ══════════════════════════════════════════════════
   🖼️  IMAGEM — gera URL consistente por produto
   ══════════════════════════════════════════════════ */
function imgUrl(p) {
  return `https://picsum.photos/seed/${p.id}/400/300`;
}

/* ══════════════════════════════════════════════════
   🔁  POLLING — busca status a cada POLL_INTERVAL_MS
   ══════════════════════════════════════════════════ */
async function fetchGiftedStatus() {
  setSyncState("syncing", "Atualizando lista...");
  try {
    const res  = await fetch(CONFIG.STATUS_ENDPOINT);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // data.gifted_ids = [1, 5, 12, ...]
    const ids      = (data.gifted_ids || []).map(Number);
    const incoming = new Set(ids);

    // Detecta novos presenteados desde o último ciclo
    const newlyGifted = [...incoming].filter(id => !giftedSet.has(id));

    if (newlyGifted.length > 0) {
      giftedSet = incoming;
      renderGrid(newlyGifted);
      updateStats();
      newlyGifted.forEach(id => {
        const p = PRODUCTS.find(x => x.id === id);
        if (p) showToast(`🎁 "${p.name}" acabou de ser presenteado!`);
      });
    } else {
      giftedSet = incoming;
      updateStats();
    }

    const now = new Date().toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit"});
    setSyncState("ok", `Atualizado às ${now}`);
  } catch (err) {
    console.warn("Polling falhou:", err);
    setSyncState("error", "Sem conexão — tentando novamente...");
  }
}

function startPolling() {
  fetchGiftedStatus(); // imediato na carga
  pollTimer = setInterval(fetchGiftedStatus, CONFIG.POLL_INTERVAL_MS);
}

/* ══════════════════════════════════════════════════
   🛒  CHECKOUT — chama o backend e redireciona
   ══════════════════════════════════════════════════ */
async function openCheckout(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p || giftedSet.has(id)) return;

  const btn = document.querySelector(`#card-${id} .btn-gift`);
  if (btn) btn.classList.add("loading");

  try {
    const res = await fetch(CONFIG.CHECKOUT_ENDPOINT, {
      method:  "POST",
      headers: {"Content-Type": "application/json"},
      body:    JSON.stringify({ id: p.id, name: p.name, price: p.price, cat: p.cat }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.checkout_url) {
      if (CONFIG.OPEN_IN_NEW_TAB) {
        window.open(data.checkout_url, "_blank");
      } else {
        window.location.href = data.checkout_url;
      }
    } else {
      throw new Error("checkout_url não retornado");
    }
  } catch (err) {
    console.error("Erro ao abrir checkout:", err);
    showToast("❌ Não foi possível abrir o checkout. Tente novamente.");
  } finally {
    if (btn) btn.classList.remove("loading");
  }
}

/* ── SYNC BAR ── */
function setSyncState(state, label) {
  const dot = document.getElementById("sync-dot");
  const lbl = document.getElementById("sync-label");
  dot.className = `sync-dot ${state}`;
  lbl.textContent = label;
}

/* ── RENDER FILTERS ── */
function renderFilters() {
  document.getElementById("filters").innerHTML = CATEGORIES.map(c =>
    `<button class="filter-btn ${c.key === activeFilter ? "active" : ""}" onclick="setFilter('${c.key}')">
       <span>${c.emoji}</span> ${c.key}
     </button>`
  ).join("");
}

/* ── RENDER GRID ── */
function renderGrid(newlyGifted = []) {
  const list = activeFilter === "Todos"
    ? PRODUCTS
    : PRODUCTS.filter(p => p.cat === activeFilter);

  document.getElementById("grid").innerHTML = list.map(p => {
    const gifted = giftedSet.has(p.id);
    const isNew  = newlyGifted.includes(p.id);
    return `
      <div class="card ${gifted ? "gifted" : ""} ${isNew ? "just-gifted" : ""}" id="card-${p.id}">
        ${isNew ? `<span class="new-gift-badge">PRESENTEADO!</span>` : ""}
        <img class="card-img" src="${imgUrl(p)}" alt="${p.name}" loading="lazy"
             onerror="this.src='https://images.unsplash.com/photo-1556909172-8c2f1b2d7e52?w=400&h=300&fit=crop'"/>
        <div class="card-body">
          <span class="card-category">${p.cat}</span>
          <span class="card-name">${p.name}</span>
          <div class="card-footer">
            <span class="card-price">R$&nbsp;${p.price.toFixed(2).replace(".", ",")}</span>
            ${gifted
              ? `<span class="btn-gifted">✓ Presenteado</span>`
              : `<button class="btn-gift" onclick="openCheckout(${p.id})">
                   <span class="spinner"></span>
                   <span class="btn-label">Presentear</span>
                 </button>`
            }
          </div>
        </div>
      </div>`;
  }).join("");
}

/* ── STATS ── */
function updateStats() {
  const total  = PRODUCTS.length;
  const gifted = giftedSet.size;
  document.getElementById("stat-total").textContent     = total;
  document.getElementById("stat-available").textContent = total - gifted;
  document.getElementById("stat-gifted").textContent    = gifted;
}

/* ── FILTER ── */
function setFilter(key) {
  activeFilter = key;
  renderFilters();
  renderGrid();
}

/* ── TOAST ── */
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 4000);
}

/* ── SCROLL TOP ── */
window.addEventListener("scroll", () => {
  document.getElementById("scroll-top").classList.toggle("visible", window.scrollY > 400);
});

/* ── INIT ── */
renderFilters();
renderGrid();
updateStats();
startPolling();
