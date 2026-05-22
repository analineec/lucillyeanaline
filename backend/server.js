require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const fs         = require("fs");
const path       = require("path");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

/* ── VALIDAÇÃO DE VARIÁVEIS ── */
const required = ["MP_ACCESS_TOKEN", "MP_PUBLIC_KEY", "BACKEND_URL", "FRONTEND_URL"];
required.forEach(key => {
  if (!process.env[key]) {
    console.error(`Variável de ambiente ausente: ${key}`);
    process.exit(1);
  }
});

/* ── MERCADO PAGO ── */
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 10000 },
});

/* ── EXPRESS ── */
const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL, methods: ["GET", "POST"] }));
app.use(express.json());

/* ── DADOS (gifted.json) ── */
const DATA_FILE = path.join(__dirname, "data/gifted.json");

function readGifted() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { gifted_ids: [] }; }
}

function saveGifted(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function markAsGifted(productId) {
  const gifted = readGifted();
  const id = Number(productId);
  if (!gifted.gifted_ids.includes(id)) {
    gifted.gifted_ids.push(id);
    saveGifted(gifted);
    console.log(`Produto ${id} marcado como presenteado`);
  }
}

/* ── GET /api/gifted ── */
app.get("/api/gifted", (req, res) => res.json(readGifted()));

/* ── GET /api/public-key ── */
app.get("/api/public-key", (req, res) => res.json({ public_key: process.env.MP_PUBLIC_KEY }));

/* ══════════════════════════════════════════════════
   🔵 POST /api/create-pix
   Cria pagamento PIX imediatamente e retorna o QR code
   ══════════════════════════════════════════════════ */
app.post("/api/create-pix", async (req, res) => {
  const { id, name, price } = req.body;
  if (!id || !name || !price) {
    return res.status(400).json({ error: "Dados do produto incompletos" });
  }

  const pixExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  try {
    const payment = new Payment(client);
    const result = await payment.create({
      body: {
        transaction_amount:  Number(price),
        payment_method_id:   "pix",
        description:         `Chá de Casa Nova — ${name}`,
        date_of_expiration:  pixExpiration,
        external_reference:  `product_${id}`,
        metadata:            { product_id: id },
        notification_url:    `${process.env.BACKEND_URL}/api/webhook`,
        payer: {
          email: "convidado@chadenova.com.br",
        },
      },
    });

    console.log(`PIX criado ${result.id} — produto ${id}`);

    const poi = result.point_of_interaction?.transaction_data;
    if (!poi) throw new Error("QR code não retornado pelo MP");

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
   Para pagamento com cartão via Payment Brick
   ══════════════════════════════════════════════════ */
app.post("/api/create-preference", async (req, res) => {
  const { id, name, price } = req.body;
  if (!id || !name || !price) {
    return res.status(400).json({ error: "Dados do produto incompletos" });
  }

  const expiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  try {
    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [{
          id:          String(id),
          title:       name,
          description: `Chá de Casa Nova — ${name}`,
          quantity:    1,
          unit_price:  Number(price),
          currency_id: "BRL",
        }],
        // PCI: external_reference para correlacionar com seu sistema
        external_reference:  `product_${id}`,
        // PCI: statement_descriptor reduz chances de contestação
        statement_descriptor: "CHA CASA NOVA",
        metadata:            { product_id: id },
        notification_url:    `${process.env.BACKEND_URL}/api/webhook`,
        expiration_date_to:  expiration,
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
   Processa pagamento de cartão via Payment Brick
   ══════════════════════════════════════════════════ */
app.post("/api/process-payment", async (req, res) => {
  const { formData, productId } = req.body;
  if (!formData || !productId) {
    return res.status(400).json({ error: "Dados incompletos" });
  }

  try {
    const payment = new Payment(client);
    const result = await payment.create({
      body: {
        transaction_amount:  Number(formData.transaction_amount),
        payment_method_id:   formData.payment_method_id,
        description:         `Chá de Casa Nova — produto ${productId}`,
        external_reference:  `product_${productId}`,
        statement_descriptor: "CHA CASA NOVA",
        payer:               formData.payer,
        token:               formData.token        || undefined,
        installments:        formData.installments || 1,
        issuer_id:           formData.issuer_id    || undefined,
        metadata:            { product_id: productId },
        notification_url:    `${process.env.BACKEND_URL}/api/webhook`,
      },
    });

    console.log(`Pagamento ${result.id} — status: ${result.status}`);

    if (result.status === "approved") markAsGifted(productId);

    res.json({
      status:        result.status,
      status_detail: result.status_detail,
    });
  } catch (err) {
    console.error("Erro ao processar pagamento:", err);
    res.status(500).json({ error: "Erro ao processar pagamento" });
  }
});

/* ── POST /api/webhook ── */
app.post("/api/webhook", async (req, res) => {
  res.sendStatus(200);
  const { type, data } = req.body;
  if (type !== "payment" || !data?.id) return;
  try {
    const payment = new Payment(client);
    const paymentData = await payment.get({ id: data.id });
    console.log(`Webhook — payment ${data.id} status: ${paymentData.status}`);
    if (paymentData.status === "approved") {
      // Tenta pegar product_id do metadata ou do external_reference
      const productId = paymentData.metadata?.product_id
        || paymentData.external_reference?.replace("product_", "");
      if (productId) markAsGifted(productId);
    }
  } catch (err) {
    console.error("Erro no webhook:", err);
  }
});

/* ── HEALTH CHECK ── */
app.get("/", (req, res) => res.json({ ok: true, service: "Cha de Casa Nova API" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend rodando na porta ${PORT}`));
