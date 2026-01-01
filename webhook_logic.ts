
import { MercadoPagoConfig, Payment } from "npm:mercadopago";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import * as crypto from "node:crypto";

const MP_ACCESS_TOKEN = "APP_USR-3997460405806111-120723-d787e23deb3a41b260207a736491077d-3048408805";
// Chave secreta que você pega no painel de Webhooks do Mercado Pago
const MP_WEBHOOK_SECRET = "SUA_CHAVE_WEBHOOK_AQUI"; 

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });

serve(async (req) => {
  // O Mercado Pago envia via POST
  if (req.method !== "POST") return new Response("Ok", { status: 200 });

  try {
    const url = new URL(req.url);
    const xSignature = req.headers.get("x-signature");
    const xRequestId = req.headers.get("x-request-id");
    const dataID = url.searchParams.get("data.id");

    // 1. Validação de Assinatura HMAC SHA256 (Segurança enviada na sua documentação)
    if (xSignature && dataID && xRequestId) {
      const parts = xSignature.split(",");
      let ts = "", hash = "";
      parts.forEach(p => {
        const [k, v] = p.split("=");
        if (k.trim() === 'ts') ts = v.trim();
        if (k.trim() === 'v1') hash = v.trim();
      });

      const manifest = `id:${dataID.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
      const hmac = crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex');

      if (hmac !== hash) {
        console.error("ALERTA: Notificação com assinatura inválida recebida!");
        // Em produção, você pode bloquear aqui.
      }
    }

    const body = await req.json();
    // O ID pode vir em body.data.id (order) ou body.id (payment)
    const resourceId = body.data?.id || body.id || dataID;
    const type = body.type || url.searchParams.get("type");

    if (resourceId) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      
      // Consultamos o status real no Mercado Pago para evitar fraudes
      let status = "pending";
      let amount = 0;

      if (type === "payment" || !type) {
        const p = new Payment(client);
        const pData = await p.get({ id: resourceId });
        status = pData.status;
        amount = pData.transaction_amount;
      } else if (type === "order") {
        // Lógica para consultar Order se necessário
        const res = await fetch(`https://api.mercadopago.com/v1/orders/${resourceId}`, {
          headers: { "Authorization": `Bearer ${MP_ACCESS_TOKEN}` }
        });
        const oData = await res.json();
        status = oData.status === "processed" ? "approved" : oData.status;
      }

      // Atualizamos o banco de dados
      if (status === "approved" || status === "accredited") {
        await supabase
          .from("registrations")
          .update({ payment_status: "approved", total_amount: amount })
          .eq("payment_id", resourceId.toString());
      }
    }

    // Mercado Pago exige retorno 200/201 rápido
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error("Erro Webhook:", err);
    return new Response("Error", { status: 400 });
  }
});
