require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const fs         = require("fs");
const path       = require("path");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

const required = ["MP_ACCESS_TOKEN", "MP_PUBLIC_KEY", "BACKEND_URL", "FRONTEND_URL"];
required.forEach(key => {
  if (!process.env[key]) {
    console.error(`Variável de ambiente ausente: ${key}`);
    process.exit(1);
  }
});

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 10000 },
});

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL,
  methods: ["GET", "POST"],
}));

app.use(express.json());

const DATA_FILE = path.join(__dirname, "data/gifted.json");

function readGifted() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { gifted_ids: [] };
  }
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

app.get("/api/gifted", (req, res) => {
  res.json(readGifted());
});

app.get("/api/public-key", (req, res) => {
  res.json({ public_key: process.env.MP_PUBLIC_KEY });
});

app.post("/api/create-preference", async (req, res) => {
  const { id, name, price } = req.body;
  if (!id || !name || !price) {
    return res.status(400).json({ error: "Dados do produto incompletos" });
  }
  try {
    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [{
          id:          String(id),
          title:       name,
          quantity:    1,
          unit_price:  Number(price),
          currency_id: "BRL",
        }],
        metadata: { product_id: id },
        notification_url: `${process.env.BACKEND_URL}/api/webhook`,
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

app.post("/api/process-payment", async (req, res) => {
  const { formData, productId } = req.body;
  if (!formData || !productId) {
    return res.status(400).json({ error: "Dados incompletos" });
  }
  try {
    // Data de expiração: 24 horas a partir de agora
    const expiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const payment = new Payment(client);
    const result = await payment.create({
      body: {
        transaction_amount: Number(formData.transaction_amount),
        payment_method_id:  formData.payment_method_id,
        payer:              formData.payer,
        token:              formData.token        || undefined,
        installments:       formData.installments || 1,
        issuer_id:          formData.issuer_id    || undefined,
        // Expiração de 24h para PIX
        date_of_expiration: expiration,
        metadata:           { product_id: productId },
        notification_url:   `${process.env.BACKEND_URL}/api/webhook`,
      },
    });

    console.log(`Pagamento ${result.id} — status: ${result.status}`);

    if (result.status === "approved") {
      markAsGifted(productId);
    }

    res.json({
      status:               result.status,
      status_detail:        result.status_detail,
      point_of_interaction: result.point_of_interaction || null,
    });
  } catch (err) {
    console.error("Erro ao processar pagamento:", err);
    res.status(500).json({ error: "Erro ao processar pagamento" });
  }
});

app.post("/api/webhook", async (req, res) => {
  res.sendStatus(200);
  const { type, data } = req.body;
  if (type !== "payment" || !data?.id) return;
  try {
    const payment = new Payment(client);
    const paymentData = await payment.get({ id: data.id });
    console.log(`Webhook — payment ${data.id} status: ${paymentData.status}`);
    if (paymentData.status === "approved") {
      const productId = paymentData.metadata?.product_id;
      if (productId) markAsGifted(productId);
    }
  } catch (err) {
    console.error("Erro no webhook:", err);
  }
});

app.get("/", (req, res) => res.json({ ok: true, service: "Cha de Casa Nova API" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});
