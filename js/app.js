/* ══════════════════════════════════════════════════
   ⚙️  CONFIG
   ══════════════════════════════════════════════════ */
const CONFIG = {
  BACKEND_URL:      "https://cha-casa-nova-a0ey.onrender.com",
  STATUS_ENDPOINT:  "/api/gifted",
  POLL_INTERVAL_MS: 10_000,
};

/* ── STATE ── */
let giftedSet      = new Set();
let activeFilter   = "Todos";
let mpPublicKey    = null;
let currentProduct = null;

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

function imgUrl(p) {
  return `images/${p.name}.jpg`;
}

/* ── CHAVE PÚBLICA MP ── */
async function loadPublicKey() {
  try {
    const res  = await fetch(`${CONFIG.BACKEND_URL}/api/public-key`);
    const data = await res.json();
    mpPublicKey = data.public_key;
  } catch (err) {
    console.warn("Não foi possível carregar a chave pública do MP:", err);
  }
}

/* ══════════════════════════════════════════════════
   🛒  CHECKOUT TRANSPARENTE — Payment Brick
   ══════════════════════════════════════════════════ */
async function openCheckout(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p || giftedSet.has(id)) return;

  currentProduct = p;
  openModal(p);

  if (!mpPublicKey) await loadPublicKey();
  if (!mpPublicKey) {
    showModalError("Não foi possível conectar ao sistema de pagamento. Tente novamente.");
    return;
  }

  let preferenceId;
  try {
    const res  = await fetch(`${CONFIG.BACKEND_URL}/api/create-preference`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ id: p.id, name: p.name, price: p.price, cat: p.cat }),
    });
    const data = await res.json();
    preferenceId = data.preference_id;
  } catch (err) {
    showModalError("Erro ao iniciar o pagamento. Tente novamente.");
    return;
  }

  try {
    const mp     = new MercadoPago(mpPublicKey, { locale: "pt-BR" });
    const bricks = mp.bricks();

    if (window._brickController) {
      await window._brickController.unmount();
    }

    document.getElementById("modal-brick-loading").style.display = "none";

    window._brickController = await bricks.create("payment", "modal-brick-container", {
      initialization: {
        amount:       p.price,
        preferenceId: preferenceId,
      },
      customization: {
        paymentMethods: {
          bankTransfer: "all",  // PIX
          creditCard:   "all",
          debitCard:    "all",
        },
        visual: {
          style: { theme: "default" },
          hideFormTitle: true,
        },
      },
      callbacks: {
        onReady: () => {
          document.getElementById("modal-brick-loading").style.display = "none";
        },
        onSubmit: ({ formData }) => {
          return new Promise(async (resolve, reject) => {
            try {
              const res = await fetch(`${CONFIG.BACKEND_URL}/api/process-payment`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ formData, productId: currentProduct.id }),
              });
              const data = await res.json();

              if (data.status === "approved") {
                resolve();
                showModalSuccess("✅ Pagamento confirmado! Obrigada pelo presente! 🎁🌈");
                giftedSet.add(currentProduct.id);
                renderGrid();
                updateStats();

              } else if (data.status === "pending") {
                resolve();
                // PIX pendente — mostra o QR Code
                const poi = data.point_of_interaction;
                const qr  = poi?.transaction_data?.qr_code;
                const img = poi?.transaction_data?.qr_code_base64;

                if (qr || img) {
                  showQrCode(qr, img);
                } else {
                  showModalSuccess("🎁 PIX gerado! Verifique seu e-mail para concluir o pagamento.");
                }

              } else {
                reject();
                showModalError("Pagamento não aprovado. Verifique os dados e tente novamente.");
              }
            } catch (err) {
              reject();
              showModalError("Erro ao processar o pagamento. Tente novamente.");
            }
          });
        },
        onError: (err) => {
          console.error("Brick error:", err);
        },
      },
    });
  } catch (err) {
    console.error("Erro ao inicializar Brick:", err);
    showModalError("Erro ao carregar o formulário de pagamento.");
  }
}

/* ══════════════════════════════════════════════════
   📱  QR CODE PIX
   ══════════════════════════════════════════════════ */
function showQrCode(qrCode, qrBase64) {
  // Limpa o brick
  document.getElementById("modal-brick-container").innerHTML = "";
  document.getElementById("modal-brick-loading").style.display = "none";
  document.getElementById("modal-message").style.display = "none";

  const container = document.getElementById("modal-brick-container");
  container.innerHTML = `
    <div class="pix-container">
      <p class="pix-title">🏦 Pague com PIX</p>
      <p class="pix-subtitle">Escaneie o QR Code ou copie o código. Válido por <strong>24 horas</strong>.</p>
      ${qrBase64
        ? `<img class="pix-qr" src="data:image/png;base64,${qrBase64}" alt="QR Code PIX"/>`
        : ""
      }
      ${qrCode
        ? `<div class="pix-copy-wrap">
             <textarea class="pix-code" readonly onclick="this.select()">${qrCode}</textarea>
             <button class="pix-copy-btn" onclick="copyPix('${qrCode}')">📋 Copiar código</button>
           </div>`
        : ""
      }
      <p class="pix-info">Após o pagamento, o presente será marcado automaticamente ✓</p>
    </div>
  `;
}

function copyPix(code) {
  navigator.clipboard.writeText(code).then(() => {
    showToast("✅ Código PIX copiado!");
  }).catch(() => {
    showToast("Selecione o código e copie manualmente.");
  });
}

/* ══════════════════════════════════════════════════
   🪟  MODAL
   ══════════════════════════════════════════════════ */
function openModal(p) {
  document.getElementById("modal-product-name").textContent    = p.name;
  document.getElementById("modal-product-price").textContent   = `R$ ${p.price.toFixed(2).replace(".", ",")}`;
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
  if (window._brickController) {
    window._brickController.unmount().catch(() => {});
    window._brickController = null;
  }
}

function showModalError(msg) {
  const el = document.getElementById("modal-message");
  el.className     = "modal-message error";
  el.textContent   = msg;
  el.style.display = "block";
  document.getElementById("modal-brick-loading").style.display = "none";
}

function showModalSuccess(msg) {
  document.getElementById("modal-brick-container").innerHTML = "";
  const el = document.getElementById("modal-message");
  el.className     = "modal-message success";
  el.textContent   = msg;
  el.style.display = "block";
  document.getElementById("modal-brick-loading").style.display = "none";
  setTimeout(closeModal, 4000);
}

document.getElementById("modal-overlay").addEventListener("click", function(e) {
  if (e.target === this) closeModal();
});

/* ══════════════════════════════════════════════════
   🔁  POLLING
   ══════════════════════════════════════════════════ */
async function fetchGiftedStatus() {
  setSyncState("syncing", "Atualizando lista...");
  try {
    const res  = await fetch(`${CONFIG.BACKEND_URL}${CONFIG.STATUS_ENDPOINT}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const ids         = (data.gifted_ids || []).map(Number);
    const incoming    = new Set(ids);
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
