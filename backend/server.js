require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const fs         = require("fs");
const path       = require("path");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

/* ── VALIDAÇÃO ── */
const required = ["MP_ACCESS_TOKEN", "MP_PUBLIC_KEY", "BACKEND_URL", "FRONTEND_URL", "ADMIN_PASSWORD"];
required.forEach(key => {
  if (!process.env[key]) { console.error(`Variável ausente: ${key}`); process.exit(1); }
});

/* ── MERCADO PAGO ── */
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 10000 },
});

/* ── EXPRESS ── */
const app = express();
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "https://sdk.mercadopago.com",
  "https://www.mercadopago.com.br",
  "https://www.mercadopago.com",
];

app.use(cors({
  origin: (origin, callback) => {
    // Permite requisições sem origin (ex: Render health check, webhook)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(o => origin.startsWith(o))) return callback(null, true);
    callback(null, true); // Em produção pode restringir aqui
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "x-admin-password"],
}));
app.use(express.json());

/* ══════════════════════════════════════════════════
   💾  DADOS
   ══════════════════════════════════════════════════ */
const DATA_DIR      = path.join(__dirname, "data");
const GIFTED_FILE   = path.join(DATA_DIR, "gifted.json");
const PAYMENTS_FILE = path.join(DATA_DIR, "payments.json");

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readGifted() {
  try { return JSON.parse(fs.readFileSync(GIFTED_FILE, "utf8")); }
  catch { return { gifted_ids: [] }; }
}

function readPayments() {
  try { return JSON.parse(fs.readFileSync(PAYMENTS_FILE, "utf8")); }
  catch { return { payments: [] }; }
}

function saveGifted(data) {
  ensureDataDir();
  fs.writeFileSync(GIFTED_FILE, JSON.stringify(data, null, 2));
}

function savePayments(data) {
  ensureDataDir();
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(data, null, 2));
}

function markAsGifted(productId, paymentInfo = {}) {
  const id = Number(productId);

  // Salva no gifted.json
  const gifted = readGifted();
  if (!gifted.gifted_ids.includes(id)) {
    gifted.gifted_ids.push(id);
    saveGifted(gifted);
  }

  // Salva detalhes do pagamento em payments.json
  const paymentsData = readPayments();
  const alreadyLogged = paymentsData.payments.some(p => p.product_id === id);
  if (!alreadyLogged) {
    paymentsData.payments.push({
      product_id:    id,
      product_name:  paymentInfo.product_name  || `Produto ${id}`,
      amount:        paymentInfo.amount         || 0,
      method:        paymentInfo.method         || "desconhecido",
      payer_email:   paymentInfo.payer_email    || "—",
      payer_name:    paymentInfo.payer_name     || "—",
      payment_id:    paymentInfo.payment_id     || null,
      status:        paymentInfo.status         || "approved",
      paid_at:       new Date().toISOString(),
    });
    savePayments(paymentsData);
    console.log(`✅ Produto ${id} (${paymentInfo.product_name}) — R$ ${paymentInfo.amount}`);
  }
}

/* ── GET /api/gifted ── */
app.get("/api/gifted", (req, res) => res.json(readGifted()));

/* ── GET /api/public-key ── */
app.get("/api/public-key", (req, res) => res.json({ public_key: process.env.MP_PUBLIC_KEY }));

/* ══════════════════════════════════════════════════
   🔒  GET /api/admin/summary
   Protegido por senha — retorna resumo dos pagamentos
   ══════════════════════════════════════════════════ */
app.get("/api/admin/summary", (req, res) => {
  const pwd = req.headers["x-admin-password"];
  if (pwd !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Senha incorreta" });
  }

  const paymentsData = readPayments();
  const payments     = paymentsData.payments || [];

  const total_arrecadado = payments
    .filter(p => p.status === "approved")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const por_metodo = payments.reduce((acc, p) => {
    acc[p.method] = (acc[p.method] || 0) + 1;
    return acc;
  }, {});

  res.json({
    total_presenteados: payments.length,
    total_arrecadado,
    por_metodo,
    payments: payments.sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at)),
  });
});

/* ══════════════════════════════════════════════════
   🔵 POST /api/create-pix
   ══════════════════════════════════════════════════ */
app.post("/api/create-pix", async (req, res) => {
  const { id, name, price } = req.body;
  if (!id || !name || !price) return res.status(400).json({ error: "Dados incompletos" });

  const pixExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  try {
    const payment = new Payment(client);
    const result  = await payment.create({
      body: {
        transaction_amount: Number(price),
        payment_method_id:  "pix",
        description:        `Chá de Casa Nova — ${name}`,
        date_of_expiration: pixExpiration,
        external_reference: `product_${id}`,
        metadata:           { product_id: id, product_name: name },
        notification_url:   `${process.env.BACKEND_URL}/api/webhook`,
        payer: { email: "convidado@chadenova.com.br" },
      },
    });

    console.log(`PIX criado ${result.id} — produto ${id}`);

    const poi = result.point_of_interaction?.transaction_data;
    if (!poi) throw new Error("QR code não retornado");

    res.json({
      payment_id:     result.id,
      qr_code:        poi.qr_code,
      qr_code_base64: poi.qr_code_base64,
    });
  } catch (err) {
    console.error("Erro ao criar PIX:", err);
    res.status(500).json({ error: "Erro ao gerar PIX" });
  }
});

/* ══════════════════════════════════════════════════
   💳 POST /api/create-preference
   ══════════════════════════════════════════════════ */
app.post("/api/create-preference", async (req, res) => {
  const { id, name, price } = req.body;
  if (!id || !name || !price) return res.status(400).json({ error: "Dados incompletos" });

  const expiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  try {
    const preference = new Preference(client);
    const result     = await preference.create({
      body: {
        items: [{
          id:          String(id),
          title:       name,
          description: `Chá de Casa Nova — ${name}`,
          quantity:    1,
          unit_price:  parseFloat(Number(price).toFixed(2)),
          currency_id: "BRL",
        }],
        external_reference:   `product_${id}`,
        statement_descriptor: "CHA CASA NOVA",
        metadata:             { product_id: id, product_name: name },
        notification_url:     `${process.env.BACKEND_URL}/api/webhook`,
        expiration_date_to:   expiration,
        back_urls: {
          success: process.env.FRONTEND_URL,
          failure: process.env.FRONTEND_URL,
          pending: process.env.FRONTEND_URL,
        },
      },
    });
    res.json({ preference_id: result.id });
  } catch (err) {
    console.error("Erro ao criar preferência:", err);
    res.status(500).json({ error: "Erro ao criar preferência" });
  }
});

/* ══════════════════════════════════════════════════
   💳 POST /api/process-payment
   ══════════════════════════════════════════════════ */
app.post("/api/process-payment", async (req, res) => {
  const { formData, productId, productName, productPrice } = req.body;
  if (!formData || !productId) return res.status(400).json({ error: "Dados incompletos" });

  try {
    const payment = new Payment(client);
    const result  = await payment.create({
      body: {
        transaction_amount:  Number(formData.transaction_amount),
        payment_method_id:   formData.payment_method_id,
        description:         `Chá de Casa Nova — produto ${productId}`,
        external_reference:  `product_${productId}`,
        statement_descriptor: "CHA CASA NOVA",
        payer:               { ...formData.payer, email: formData.payer?.email || "convidado@chadenova.com.br" },
        token:               formData.token        || undefined,
        installments:        formData.installments || 1,
        issuer_id:           formData.issuer_id    || undefined,
        metadata:            { product_id: productId, product_name: productName },
        notification_url:    `${process.env.BACKEND_URL}/api/webhook`,
      },
    });

    console.log(`Pagamento ${result.id} — status: ${result.status}`);

    if (result.status === "approved") {
      markAsGifted(productId, {
        product_name: productName || `Produto ${productId}`,
        amount:       result.transaction_amount,
        method:       result.payment_method_id,
        payer_email:  result.payer?.email || "—",
        payer_name:   result.payer?.first_name
                        ? `${result.payer.first_name} ${result.payer.last_name || ""}`.trim()
                        : "—",
        payment_id:   result.id,
        status:       result.status,
      });
    }

    res.json({ status: result.status, status_detail: result.status_detail });
  } catch (err) {
    console.error("Erro ao processar pagamento:", err);
    res.status(500).json({ error: "Erro ao processar pagamento" });
  }
});

/* ══════════════════════════════════════════════════
   🔔 POST /api/webhook
   ══════════════════════════════════════════════════ */
app.post("/api/webhook", async (req, res) => {
  res.sendStatus(200);
  const { type, data } = req.body;
  if (type !== "payment" || !data?.id) return;

  try {
    const payment     = new Payment(client);
    const paymentData = await payment.get({ id: data.id });

    console.log(`Webhook — payment ${data.id} status: ${paymentData.status}`);

    if (paymentData.status === "approved") {
      const productId   = paymentData.metadata?.product_id
        || paymentData.external_reference?.replace("product_", "");
      const productName = paymentData.metadata?.product_name || `Produto ${productId}`;

      if (productId) {
        markAsGifted(productId, {
          product_name: productName,
          amount:       paymentData.transaction_amount,
          method:       paymentData.payment_method_id,
          payer_email:  paymentData.payer?.email || "—",
          payer_name:   paymentData.payer?.first_name
                          ? `${paymentData.payer.first_name} ${paymentData.payer.last_name || ""}`.trim()
                          : "—",
          payment_id:   paymentData.id,
          status:       paymentData.status,
        });
      }
    }
  } catch (err) {
    console.error("Erro no webhook:", err);
  }
});

/* ── HEALTH CHECK ── */
app.get("/", (req, res) => res.json({ ok: true, service: "Cha de Casa Nova API" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend rodando na porta ${PORT}`));
