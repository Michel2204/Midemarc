// api/webhook-pago.js
// Mercado Pago llama a esta URL automáticamente cuando cambia el estado
// de un pago. Nosotros filtramos solo los que quedaron "approved" y
// mandamos el email con el detalle del carrito.
const crypto = require("crypto");
const { MercadoPagoConfig, Payment } = require("mercadopago");

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

// Valida que el webhook realmente venga de Mercado Pago (recomendado).
// El secret se obtiene en: Tu integración > Webhooks > Firma secreta.
function firmaValida(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true; // si todavía no lo configuraste, no bloqueamos

  const xSignature = req.headers["x-signature"];
  const xRequestId = req.headers["x-request-id"];
  const dataId = req.query["data.id"] || req.body?.data?.id;
  if (!xSignature || !dataId) return false;

  const parts = Object.fromEntries(
    xSignature.split(",").map((p) => p.trim().split("="))
  );
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${parts.ts};`;
  const hash = crypto
    .createHmac("sha256", secret)
    .update(manifest)
    .digest("hex");

  return hash === parts.v1;
}

async function enviarEmail({ cart, total, sena, paymentId }) {
  const lineas = cart
    .map((it) => `• ${it.quantity}x ${it.title} — $${it.unit_price * it.quantity}`)
    .join("\n");

  const texto = [
    `Nuevo pedido pagado (Pago ID: ${paymentId})`,
    ``,
    lineas,
    ``,
    `Total del pedido: $${total}`,
    `Seña acreditada (50%): $${sena}`,
    `Saldo restante: $${total - sena}`,
  ].join("\n");

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM_EMAIL, // ej: "Midemarc <onboarding@resend.dev>"
      to: [process.env.NOTIFY_TO_EMAIL],   // tu email, donde querés recibir el aviso
      subject: `Nuevo pedido pagado — Seña $${sena}`,
      text: texto,
    }),
  });
}

module.exports = async (req, res) => {
  // Respondemos 200 rápido siempre (si no, Mercado Pago reintenta sin parar)
  try {
    if (req.method !== "POST") {
      res.status(200).end();
      return;
    }

    if (!firmaValida(req)) {
      console.warn("Webhook con firma inválida, ignorado");
      res.status(200).end();
      return;
    }

    const type = req.body?.type || req.query.type;
    const paymentId = req.body?.data?.id || req.query["data.id"];
    if (type !== "payment" || !paymentId) {
      res.status(200).end();
      return;
    }

    const payment = new Payment(client);
    const info = await payment.get({ id: paymentId });

    if (info.status !== "approved") {
      res.status(200).end();
      return;
    }

    const cart = JSON.parse(info.metadata?.cart || "[]");
    const total = info.metadata?.total_pedido;
    const sena = info.metadata?.sena;

    await enviarEmail({ cart, total, sena, paymentId });

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Error en webhook-pago:", err);
    res.status(200).json({ received: true }); // igual 200, para no generar reintentos infinitos
  }
};
