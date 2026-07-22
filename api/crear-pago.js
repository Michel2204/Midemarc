// api/crear-pago.js
// Función serverless de Vercel. Recibe el carrito, calcula el 50% (seña)
// y crea una preferencia de pago en Mercado Pago. Devuelve el link (init_point)
// al que el frontend redirige al comprador.

const { MercadoPagoConfig, Preference } = require("mercadopago");

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "El carrito está vacío" });
      return;
    }

    // Validamos y calculamos el total en el SERVIDOR (nunca confiar en precios
    // enviados desde el navegador). Acá lo hacemos con lo que llega del cart,
    // pero lo ideal es cruzar cada item contra tu catálogo real de precios.
    let total = 0;
    for (const it of items) {
      if (
        typeof it.unit_price !== "number" ||
        typeof it.quantity !== "number" ||
        it.unit_price <= 0 ||
        it.quantity <= 0
      ) {
        res.status(400).json({ error: "Item inválido en el carrito" });
        return;
      }
      total += it.unit_price * it.quantity;
    }

    const sena = Math.round(total * 0.5 * 100) / 100;

    const preference = new Preference(client);

    const result = await preference.create({
      body: {
        items: [
          {
            title: "Seña (50%) - Pedido Midemarc",
            quantity: 1,
            unit_price: sena,
            currency_id: "ARS",
          },
        ],
        back_urls: {
          success: `${process.env.SITE_URL}/pago-exitoso`,
          failure: `${process.env.SITE_URL}/pago-fallido`,
          pending: `${process.env.SITE_URL}/pago-pendiente`,
        },
        auto_return: "approved",
        // metadata opcional para identificar el pedido en el webhook
        metadata: {
          total_pedido: total,
          sena,
        },
      },
    });

    res.status(200).json({ init_point: result.init_point });
  } catch (err) {
    console.error("Error creando preferencia de Mercado Pago:", err);
    res.status(500).json({ 
      error: "No se pudo generar el pago",
      detalle: err.message || String(err)
    });
  }
