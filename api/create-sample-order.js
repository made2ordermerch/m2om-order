// ─────────────────────────────────────────────────────────────
//  M2OM — Sample Order Draft Creator
//  Vercel Serverless Function
//  Endpoint: POST /api/create-sample-order
//
//  Uses same OAuth Client Credentials as create-order.js
//
//  Environment variables (already set in Vercel):
//    SHOPIFY_STORE_DOMAIN   → made2ordermerch.myshopify.com
//    SHOPIFY_CLIENT_ID      → (from Shopify app)
//    SHOPIFY_CLIENT_SECRET  → (from Shopify app)
// ─────────────────────────────────────────────────────────────

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken(domain, clientId, clientSecret) {
  const now = Date.now();
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
    console.error('OAuth token error:', err);
    // Fallback: use secret directly as token
    return clientSecret;
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in ? data.expires_in * 1000 : 3600000);
  return cachedToken;
}

module.exports = async function handler(req, res) {

  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Env check ──
  const STORE = process.env.SHOPIFY_STORE_DOMAIN;
  const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
  const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

  console.log('Store:', STORE, '| Client ID set:', !!CLIENT_ID, '| Secret set:', !!CLIENT_SECRET);

  if (!STORE || !CLIENT_ID || !CLIENT_SECRET) {
    console.error('Missing Shopify env vars');
    return res.status(500).json({ error: 'Server misconfiguration. Please call us at (614) 353-2369.' });
  }

  // ── Get token ──
  let TOKEN;
  try {
    TOKEN = await getAccessToken(STORE, CLIENT_ID, CLIENT_SECRET);
    console.log('Token obtained, length:', TOKEN ? TOKEN.length : 0);
  } catch (err) {
    console.error('Token error:', err);
    return res.status(500).json({ error: 'Authentication failed. Please call us at (614) 353-2369.' });
  }

  // ── Parse body ──
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  const {
    sampleType,
    fullName,
    email,
    brandName,
    productCategory,
    website,
    social,
    phone,
    monthlyVolume,
    bagSize,
    finish,
    artworkNotes,
    artworkUrl,
  } = body;

  // ── Validate ──
  if (!sampleType || !fullName || !email || !brandName || !productCategory || !phone) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  if (!website && !social) {
    return res.status(400).json({ error: 'Website or social media handle required for verification.' });
  }

  if (sampleType === 'custom' && (!bagSize || !finish)) {
    return res.status(400).json({ error: 'Bag size and finish required for custom sample.' });
  }

  // ── Build Draft Order ──
  const isCustom = sampleType === 'custom';

  const orderNotes = [
    `M2OM SAMPLE REQUEST — ${isCustom ? 'CUSTOM PRINTED SAMPLE ($99)' : 'FREE SAMPLE PACK'}`,
    ``,
    `CONTACT`,
    `Name: ${fullName}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Brand: ${brandName}`,
    `Category: ${productCategory}`,
    `Website: ${website || 'N/A'}`,
    `Social: ${social || 'N/A'}`,
    `Est. Monthly Volume: ${monthlyVolume || 'Not specified'}`,
    ``,
    ...(isCustom ? [
      `CUSTOM SAMPLE SPECS`,
      `Bag Size: ${bagSize}`,
      `Finish: ${finish}`,
      `Artwork/Notes: ${artworkNotes || 'None provided'}`,
      `Artwork File: ${artworkUrl || 'No file uploaded'}`,
      ``,
      `NOTE: $99 to be credited toward first production order.`,
    ] : [
      `SAMPLE PACK: Ship pre-printed showcase bags (4-5 bags, mixed finishes).`,
    ]),
    ``,
    `⚠ VERIFY business before shipping: ${website || social}`,
  ].join('\n');

  const properties = [
    { name: 'Brand', value: brandName },
    { name: 'Category', value: productCategory },
    { name: 'Contact', value: `${fullName} — ${phone}` },
  ];

  if (isCustom) {
    properties.push(
      { name: 'Bag Size', value: bagSize },
      { name: 'Finish', value: finish },
    );
    if (artworkNotes) {
      properties.push({ name: 'Artwork Notes', value: artworkNotes.substring(0, 250) });
    }
    if (artworkUrl) {
      properties.push({ name: 'Artwork File', value: artworkUrl });
    }
  }

  const nameParts = fullName.split(' ');
  const firstName = nameParts[0] || fullName;
  const lastName = nameParts.slice(1).join(' ') || '';

  const draftOrder = {
    draft_order: {
      line_items: [
        {
          title: isCustom
            ? 'Custom Printed Sample — Your Design, Your Size'
            : 'M2OM Sample Pack — Pre-Printed Showcase Bags',
          quantity: 1,
          price: isCustom ? '99.00' : '0.00',
          taxable: false,
          requires_shipping: true,
          properties: properties,
        },
      ],
      customer: {
        first_name: firstName,
        last_name: lastName,
        email: email,
        phone: phone,
      },
      shipping_address: {
        first_name: firstName,
        last_name: lastName,
      },
      billing_address: {
        first_name: firstName,
        last_name: lastName,
      },
      note: orderNotes,
      email: email,
      shipping_line: { title: 'Free Shipping', price: '0.00' },
      tags: isCustom
        ? 'sample-custom, lead, verify-before-ship'
        : 'sample-pack, lead, verify-before-ship',
      use_customer_default_address: false,
    },
  };

  // ── Call Shopify ──
  try {
    console.log('Sending draft order to Shopify...');
    const shopifyRes = await fetch(
      `https://${STORE}/admin/api/2024-10/draft_orders.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': TOKEN,
        },
        body: JSON.stringify(draftOrder),
      }
    );

    const shopifyData = await shopifyRes.json();
    console.log('Shopify response status:', shopifyRes.status);

    if (!shopifyRes.ok) {
      console.error('Shopify API error:', JSON.stringify(shopifyData));
      const msg = shopifyData.errors
        ? typeof shopifyData.errors === 'string'
          ? shopifyData.errors
          : JSON.stringify(shopifyData.errors)
        : 'Shopify rejected the order.';
      return res.status(shopifyRes.status).json({ error: msg });
    }

    const invoiceUrl = shopifyData.draft_order?.invoice_url;

    if (!invoiceUrl) {
      console.error('No invoice_url:', JSON.stringify(shopifyData));
      return res.status(500).json({
        error: 'Order created but no checkout URL returned. Call us at (614) 353-2369.',
      });
    }

    return res.status(200).json({ invoice_url: invoiceUrl });

  } catch (err) {
    console.error('Fetch error:', err);
    return res.status(500).json({
      error: 'Failed to connect to Shopify. Please try again or call us at (614) 353-2369.',
    });
  }
};
