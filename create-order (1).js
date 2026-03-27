// ─────────────────────────────────────────────────────────────
//  M2OM — Draft Order Creator
//  Vercel Serverless Function
//  Endpoint: POST /api/create-order
//
//  Uses Shopify Client Credentials OAuth (new Dev Dashboard apps)
//  No shpat_ token needed — uses Client ID + Secret instead.
//
//  Environment variables required (set in Vercel dashboard):
//    SHOPIFY_STORE_DOMAIN   → (set this in Vercel environment variables)
//    SHOPIFY_CLIENT_ID      → (set this in Vercel environment variables)
//    SHOPIFY_CLIENT_SECRET  → (set this in Vercel environment variables)
//    ALLOWED_ORIGIN         → https://made2ordermerch.com
// ─────────────────────────────────────────────────────────────

// Cache the access token in memory between invocations (warm functions reuse it)
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken(domain, clientId, clientSecret) {
  const now = Date.now();
  // Reuse cached token if still valid (with 60s buffer)
  if (cachedToken && now < tokenExpiry - 60000) {
    return cachedToken;
  }

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials'
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get Shopify access token: ${err}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // Shopify client_credentials tokens expire in 1 hour
  tokenExpiry = now + (data.expires_in ? data.expires_in * 1000 : 3600000);
  return cachedToken;
}

export default async function handler(req, res) {

  // ── CORS ──
  const allowed = process.env.ALLOWED_ORIGIN || 'https://made2ordermerch.com';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Env check ──
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET } = process.env;

  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    console.error('Missing Shopify env vars');
    return res.status(500).json({ error: 'Server misconfiguration. Please contact us at (614) 353-2369.' });
  }

  // ── Parse body ──
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  const { draft_order } = body;

  if (!draft_order) {
    return res.status(400).json({ error: 'Missing draft_order payload.' });
  }

  // ── Basic validation ──
  const email = draft_order.customer?.email;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid customer email is required.' });
  }

  // ── Get OAuth access token ──
  let accessToken;
  try {
    accessToken = await getAccessToken(SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET);
  } catch (err) {
    console.error('Token error:', err);
    return res.status(500).json({ error: 'Authentication failed. Please call (614) 353-2369.' });
  }

  // ── Call Shopify Admin API ──
  const shopifyUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2026-01/draft_orders.json`;

  let shopifyRes;
  try {
    shopifyRes = await fetch(shopifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      },
      body: JSON.stringify({ draft_order })
    });
  } catch (err) {
    console.error('Shopify fetch error:', err);
    return res.status(502).json({ error: 'Could not reach Shopify. Please try again or call (614) 353-2369.' });
  }

  const shopifyData = await shopifyRes.json();

  if (!shopifyRes.ok) {
    console.error('Shopify API error:', shopifyData);
    // If token expired mid-flight, clear cache and let user retry
    if (shopifyRes.status === 401) {
      cachedToken = null;
      tokenExpiry = 0;
    }
    const msg = shopifyData.errors
      ? JSON.stringify(shopifyData.errors)
      : 'Shopify rejected the order.';
    return res.status(shopifyRes.status).json({ error: msg });
  }

  const invoiceUrl = shopifyData.draft_order?.invoice_url;

  if (!invoiceUrl) {
    console.error('No invoice_url in Shopify response:', shopifyData);
    return res.status(500).json({ error: 'Order created but no checkout URL returned. Call us at (614) 353-2369.' });
  }

  // ── Success ──
  return res.status(200).json({ invoice_url: invoiceUrl });
}
