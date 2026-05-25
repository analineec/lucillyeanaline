/* ══════════════════════════════════════════════════
   ⚙️  CONFIG
   ══════════════════════════════════════════════════ */
const CONFIG = {
  BACKEND_URL:      "https://cha-casa-nova-a0ey.onrender.com",
  STATUS_ENDPOINT:  "/api/gifted",
  POLL_INTERVAL_MS: 10_000,
  ADMIN_PASSWORD:   "lucilly2025",  // troque por uma senha sua
};

/* ── STATE ── */
let giftedSet      = new Set();
let activeFilter   = "Todos";
let sortOrder      = "az";
let mpPublicKey    = null;
let currentProduct = null;

const CATEGORIES = [
  {key:"Todos",                emoji:"🏠"},
  {key:"Cozinha",              emoji:"🍳"},
  {key:"Sala & Jantar",        emoji:"🍽️"},
  {key:"Quarto",               emoji:"🛏️"},
  {key:"Banheiro",             emoji:"🚿"},
  {key:"Lavanderia",           emoji:"🧺"},
  {key:"Área Externa",         emoji:"🪴"},
  {key:"Escritório",           emoji:"🗄️"},
  {key:"Ferramentas",          emoji:"⚒️"},
  {key:"Decoração",            emoji:"🖼️"},
];

// Mapeia nome antigo para novo (para não quebrar os produtos)
const CAT_MAP = { "Sala de Estar/Jantar": "Sala & Jantar" };
function catLabel(cat) { return CAT_MAP[cat] || cat; }

const SORT_OPTIONS = [
  {key:"az",    label:"A–Z"},
  {key:"za",    label:"Z–A"},
  {key:"asc",   label:"Menor preço"},
  {key:"desc",  label:"Maior preço"},
];

/* ── IMAGEM ── */
function imgUrl(p) { return `images/${p.name}.jpg`; }

/* ══════════════════════════════════════════════════
   🔑  MERCADO PAGO
   ══════════════════════════════════════════════════ */
async function loadPublicKey() {
  try {
    const res  = await fetch(`${CONFIG.BACKEND_URL}/api/public-key`);
    const data = await res.json();
    mpPublicKey = data.public_key;
  } catch (err) { console.warn("Chave pública MP falhou:", err); }
}

/* ══════════════════════════════════════════════════
   🛒  CHECKOUT
   ══════════════════════════════════════════════════ */
async function openCheckout(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p || giftedSet.has(id)) return;
  currentProduct = p;
  openModal(p);
  showPaymentMethodSelect();
}

function showPaymentMethodSelect() {
  document.getElementById("modal-brick-loading").style.display = "none";
  document.getElementById("modal-brick-container").innerHTML = `
    <div class="method-select">
      <p class="method-title">Como você quer pagar?</p>
      <button class="method-btn method-pix" onclick="choosePix()">
        <span class="method-icon">🔵</span>
        <div><strong>PIX</strong><span>QR code na hora • Aprovação imediata</span></div>
      </button>
      <button class="method-btn method-card" onclick="chooseCard()">
        <span class="method-icon">💳</span>
        <div><strong>Cartão de crédito</strong><span>Em até 3x</span></div>
      </button>
    </div>`;
}

async function choosePix() {
  document.getElementById("modal-brick-container").innerHTML = "";
  document.getElementById("modal-brick-loading").style.display = "flex";
  showLoadingMessage("Gerando seu PIX...");

  const MAX_RETRIES = 3;
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      attempt++;
      if (attempt > 1) showLoadingMessage(`Conectando... (tentativa ${attempt}/${MAX_RETRIES})`);
      const res  = await fetch(`${CONFIG.BACKEND_URL}/api/create-pix`, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({id:currentProduct.id, name:currentProduct.name, price:currentProduct.price}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao gerar PIX");
      document.getElementById("modal-brick-loading").style.display = "none";
      showPixQrCode(data);
      return;
    } catch (err) {
      console.warn(`Tentativa ${attempt} falhou:`, err);
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 3000));
    }
  }
  showModalError("Não foi possível gerar o PIX. Aguarde alguns segundos e tente novamente.");
}

async function chooseCard() {
  document.getElementById("modal-brick-container").innerHTML = "";
  document.getElementById("modal-brick-loading").style.display = "flex";
  showLoadingMessage("Carregando formulário de pagamento...");

  if (!mpPublicKey) await loadPublicKey();
  if (!mpPublicKey) { showModalError("Não foi possível conectar ao sistema de pagamento."); return; }

  let preferenceId;
  try {
    const res  = await fetch(`${CONFIG.BACKEND_URL}/api/create-preference`, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({id:currentProduct.id, name:currentProduct.name, price:currentProduct.price, cat:currentProduct.cat}),
    });
    const data = await res.json();
    preferenceId = data.preference_id;
  } catch (err) {
    console.warn("Retry cartão...", err);
    await new Promise(r => setTimeout(r, 3000));
    try {
      const res2  = await fetch(`${CONFIG.BACKEND_URL}/api/create-preference`, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({id:currentProduct.id, name:currentProduct.name, price:currentProduct.price, cat:currentProduct.cat}),
      });
      const data2 = await res2.json();
      preferenceId = data2.preference_id;
    } catch (err2) {
      showModalError("Não foi possível conectar ao servidor. Tente novamente em alguns segundos.");
      return;
    }
  }

  try {
    const mp = new MercadoPago(mpPublicKey, {locale:"pt-BR"});
    const bricks = mp.bricks();
    if (window._brickController) await window._brickController.unmount().catch(() => {});
    document.getElementById("modal-brick-loading").style.display = "none";

    window._brickController = await bricks.create("payment", "modal-brick-container", {
      initialization: { amount: currentProduct.price, preferenceId },
      customization: {
        paymentMethods: { creditCard:"all", debitCard:"all", maxInstallments:3 },
        visual: { style:{theme:"default"}, hideFormTitle:true },
      },
      callbacks: {
        onReady: () => { document.getElementById("modal-brick-loading").style.display = "none"; },
        onSubmit: ({formData}) => new Promise(async (resolve, reject) => {
          try {
            const res  = await fetch(`${CONFIG.BACKEND_URL}/api/process-payment`, {
              method:"POST", headers:{"Content-Type":"application/json"},
              body: JSON.stringify({formData, productId:currentProduct.id, productName:currentProduct.name, productPrice:currentProduct.price}),
            });
            const data = await res.json();
            if (data.status === "approved") {
              resolve();
              launchConfetti();
              showModalSuccess("Pagamento confirmado! Obrigada pelo presente! 🎁🌈");
              giftedSet.add(currentProduct.id);
              renderGrid(); updateStats();
            } else if (data.status === "pending") {
              resolve();
              showModalSuccess("Pagamento recebido e em processamento! Obrigada! 🎁");
            } else {
              reject();
              showModalError("Pagamento não aprovado. Verifique os dados e tente novamente.");
            }
          } catch (err) { reject(); showModalError("Erro ao processar o pagamento. Tente novamente."); }
        }),
        onError: (err) => console.error("Brick error:", err),
      },
    });
  } catch (err) {
    console.error("Erro Brick:", err);
    showModalError("Erro ao carregar o formulário de pagamento.");
  }
}

/* ══════════════════════════════════════════════════
   🪟  MODAL
   ══════════════════════════════════════════════════ */
function openModal(p) {
  document.getElementById("modal-product-name").textContent  = p.name;
  document.getElementById("modal-product-price").textContent = `R$ ${p.price.toFixed(2).replace(".",",")}`;
  document.getElementById("modal-brick-loading").style.display = "flex";
  document.getElementById("modal-brick-container").innerHTML   = "";
  document.getElementById("modal-message").style.display       = "none";
  document.getElementById("modal-overlay").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
  document.body.style.overflow = "";
  currentProduct = null;
  if (window._brickController) { window._brickController.unmount().catch(()=>{}); window._brickController = null; }
}

function showModalError(msg) {
  document.getElementById("modal-brick-loading").style.display = "none";
  const el = document.getElementById("modal-message");
  el.className = "modal-message error"; el.textContent = msg; el.style.display = "block";
}

function showModalSuccess(msg) {
  document.getElementById("modal-brick-container").innerHTML = "";
  document.getElementById("modal-brick-loading").style.display = "none";
  const el = document.getElementById("modal-message");
  el.className = "modal-message success"; el.textContent = msg; el.style.display = "block";
  setTimeout(closeModal, 4000);
}

function showLoadingMessage(msg) {
  const el = document.querySelector("#modal-brick-loading span");
  if (el) el.textContent = msg;
}

/* ── PIX QR CODE ── */
function showPixQrCode(pix) {
  document.getElementById("modal-brick-container").innerHTML = `
    <div class="pix-container">
      <p class="pix-title">QR Code PIX gerado! 🎉</p>
      <p class="pix-subtitle">Escaneie com o app do seu banco ou copie o código.<br>Válido por <strong>24 horas</strong>.</p>
      ${pix.qr_code_base64 ? `<img class="pix-qr" src="data:image/png;base64,${pix.qr_code_base64}" alt="QR Code PIX"/>` : ""}
      <div class="pix-copy-wrap">
        <input class="pix-code" id="pix-code-input" value="${pix.qr_code}" readonly/>
        <button class="pix-copy-btn" onclick="copyPix()">Copiar código</button>
      </div>
      <p class="pix-obs">✅ Após o pagamento, o presente será marcado automaticamente!</p>
      <button class="pix-back-btn" onclick="showPaymentMethodSelect()">← Voltar</button>
    </div>`;
  document.getElementById("modal-brick-loading").style.display = "none";
}

function copyPix() {
  const input = document.getElementById("pix-code-input");
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.querySelector(".pix-copy-btn");
    btn.textContent = "Copiado! ✓"; btn.style.background = "#388E3C";
    setTimeout(() => { btn.textContent = "Copiar código"; btn.style.background = ""; }, 2000);
  });
}

document.getElementById("modal-overlay").addEventListener("click", function(e) {
  if (e.target === this) closeModal();
});

/* ══════════════════════════════════════════════════
   🎊  CONFETE
   ══════════════════════════════════════════════════ */
function launchConfetti() {
  const colors = ["#d4a373","#C9956E","#8B5E3C","#a8c5a0","#f5e0d0","#ffd6e7"];
  const container = document.getElementById("confetti-container");
  container.innerHTML = "";
  for (let i = 0; i < 80; i++) {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    el.style.cssText = `
      left: ${Math.random()*100}vw;
      background: ${colors[Math.floor(Math.random()*colors.length)]};
      width: ${6+Math.random()*8}px;
      height: ${6+Math.random()*8}px;
      animation-delay: ${Math.random()*.8}s;
      animation-duration: ${1.2+Math.random()*1.2}s;
      border-radius: ${Math.random()>0.5?"50%":"2px"};
    `;
    container.appendChild(el);
  }
  setTimeout(() => { container.innerHTML = ""; }, 3500);
}

/* ══════════════════════════════════════════════════
   🔁  POLLING
   ══════════════════════════════════════════════════ */
async function fetchGiftedStatus() {
  setSyncState("syncing", "Atualizando lista...");
  try {
    const res  = await fetch(`${CONFIG.BACKEND_URL}${CONFIG.STATUS_ENDPOINT}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const ids      = (data.gifted_ids || []).map(Number);
    const incoming = new Set(ids);
    const newlyGifted = [...incoming].filter(id => !giftedSet.has(id));
    if (newlyGifted.length > 0) {
      giftedSet = incoming;
      renderGrid(newlyGifted);
      updateStats();
      newlyGifted.forEach(id => {
        const p = PRODUCTS.find(x => x.id === id);
        if (p) { showToast(`🎁 "${p.name}" acabou de ser presenteado!`); launchConfetti(); }
      });
    } else { giftedSet = incoming; updateStats(); }
    const now = new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
    setSyncState("ok", `Atualizado às ${now}`);
  } catch (err) {
    console.warn("Polling falhou:", err);
    setSyncState("error", "Sem conexão — tentando novamente...");
  }
}

function startPolling() {
  fetch(`${CONFIG.BACKEND_URL}/`).catch(()=>{});
  fetchGiftedStatus();
  setInterval(fetchGiftedStatus, CONFIG.POLL_INTERVAL_MS);
}

/* ── SYNC BAR ── */
function setSyncState(state, label) {
  document.getElementById("sync-dot").className     = `sync-dot ${state}`;
  document.getElementById("sync-label").textContent = label;
}

/* ── RENDER FILTERS ── */
function renderFilters() {
  document.getElementById("filters").innerHTML = CATEGORIES.map(c =>
    `<button class="filter-btn ${c.key === activeFilter ? "active" : ""}" onclick="setFilter('${c.key}')">
        <span>${c.emoji}</span> ${c.key}
      </button>`
  ).join("");
}


/* ── RENDER SORT ── */
function renderSort() {
  document.getElementById("sort-select").value = sortOrder;
}

function onSort(val) { sortOrder = val; renderGrid(); }

function applySort(list) {
  return [...list].sort((a, b) => {
    if (sortOrder === "az")   return a.name.localeCompare(b.name, "pt-BR");
    if (sortOrder === "za")   return b.name.localeCompare(a.name, "pt-BR");
    if (sortOrder === "asc")  return a.price - b.price;
    if (sortOrder === "desc") return b.price - a.price;
    return 0;
  });
}

/* ── RENDER GRID ── */
function renderGrid(newlyGifted = []) {
  let list = activeFilter === "Todos"
    ? [...PRODUCTS]
    : PRODUCTS.filter(p => catLabel(p.cat) === activeFilter);

  list = applySort(list);

  const grid = document.getElementById("grid");

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <p>🔍 Nenhum presente encontrado com esses filtros.</p>
      <button onclick="clearFilters()">Limpar filtros</button>
    </div>`;
    return;
  }

  grid.innerHTML = list.map(p => {
    const gifted = giftedSet.has(p.id);
    const isNew  = newlyGifted.includes(p.id);
    return `
      <div class="card ${gifted?"gifted":""} ${isNew?"just-gifted":""}" id="card-${p.id}">
        ${isNew ? `<span class="new-gift-badge">PRESENTEADO!</span>` : ""}
        ${gifted ? `<div class="gifted-overlay"><span class="gifted-ribbon">🎀 Presenteado</span></div>` : ""}
        <img class="card-img" src="${imgUrl(p)}" alt="${p.name}" loading="lazy"
             onerror="this.src='https://images.unsplash.com/photo-1556909172-8c2f1b2d7e52?w=400&h=300&fit=crop'"/>
        <div class="card-body">
          <span class="card-category">${catLabel(p.cat)}</span>
          <span class="card-name">${p.name}</span>
          <div class="card-footer">
            <span class="card-price">R$&nbsp;${p.price.toFixed(2).replace(".",",")}</span>
            ${gifted
              ? `<span class="btn-gifted">✓ Presenteado</span>`
              : `<button class="btn-gift" onclick="openCheckout(${p.id})">
                   <span class="spinner"></span><span class="btn-label">Presentear</span>
                 </button>`}
          </div>
        </div>
      </div>`;
  }).join("");

  renderFilters();
}

function clearFilters() {
  activeFilter = "Todos"; sortOrder = "az";
  renderFilters(); renderSort(); renderGrid();
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
function setFilter(key) { activeFilter = key; renderFilters(); renderGrid(); }

/* ── TOAST ── */
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 4000);
}

/* ── SCROLL TOP ── */
window.addEventListener("scroll", () => {
  document.getElementById("scroll-top").classList.toggle("visible", window.scrollY > 400);
});

/* ── INIT ── */
renderFilters();
renderSort();
renderGrid();
updateStats();
startPolling();
