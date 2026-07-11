// Zoho Books / Inventory API client.
//
// Setup (one time, in Zoho):
//   1. https://api-console.zoho.com → Add Client → "Self Client"
//   2. Generate Code with scopes:
//        ZohoBooks.fullaccess.READ,ZohoInventory.FullAccess.READ
//      (10-minute validity)
//   3. Exchange the code for a refresh token:
//        curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
//          -d grant_type=authorization_code -d code=GENERATED_CODE \
//          -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET
//   4. Put in .env: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,
//      ZOHO_ORG_ID (Books → Settings → Organization ID), ZOHO_DC (default com)
const axios = require('axios');

let _accessToken = null;
let _accessTokenExpiresAt = 0;

const dc = () => process.env.ZOHO_DC || 'com';
const accountsBase = () => `https://accounts.zoho.${dc()}`;
const apiBase = () => `https://www.zohoapis.${dc()}`;

function configured() {
  return !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET &&
            process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_ORG_ID);
}

async function getAccessToken() {
  if (_accessToken && Date.now() < _accessTokenExpiresAt - 60_000) return _accessToken;
  const res = await axios.post(`${accountsBase()}/oauth/v2/token`, null, {
    params: {
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token',
    },
  });
  if (!res.data.access_token) {
    throw new Error(`Zoho token refresh failed: ${JSON.stringify(res.data)}`);
  }
  _accessToken = res.data.access_token;
  _accessTokenExpiresAt = Date.now() + (res.data.expires_in || 3600) * 1000;
  return _accessToken;
}

// GET with auth, org id, 429/backoff handling
async function zGet(path, params = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await getAccessToken();
    try {
      const res = await axios.get(`${apiBase()}${path}`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: { organization_id: process.env.ZOHO_ORG_ID, ...params },
        timeout: 30000,
      });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      if (status === 401) { _accessToken = null; continue; }              // token expired — refresh
      if (status === 429 && attempt < 3) {                                 // rate limited — wait
        await new Promise(r => setTimeout(r, 45_000));
        continue;
      }
      throw new Error(`Zoho GET ${path} failed: ${status || ''} ${err.response?.data?.message || err.message}`);
    }
  }
  throw new Error(`Zoho GET ${path}: retries exhausted`);
}

// Fetch every page of a list endpoint. `key` is the array field in the response.
async function fetchAll(path, key, params = {}, onPage = null) {
  const all = [];
  let page = 1;
  for (;;) {
    const data = await zGet(path, { ...params, page, per_page: 200 });
    const rows = data[key] || [];
    all.push(...rows);
    if (onPage) onPage(all.length);
    if (!data.page_context?.has_more_page) break;
    page += 1;
    await new Promise(r => setTimeout(r, 250)); // stay well under rate limits
  }
  return all;
}

// ─── High-level fetchers ───────────────────────────────────────────────────────

const fetchContacts    = (onPage) => fetchAll('/books/v3/contacts', 'contacts', {}, onPage);
const fetchItems       = (onPage) => fetchAll('/books/v3/items', 'items', {}, onPage);
const fetchSalesOrders = (onPage) => fetchAll('/books/v3/salesorders', 'salesorders', {}, onPage);
const fetchInvoices    = (onPage) => fetchAll('/books/v3/invoices', 'invoices', {}, onPage);

// Packages live in Inventory; not all orgs have it enabled — return [] on 404
async function fetchPackages(onPage) {
  try {
    return await fetchAll('/inventory/v1/packages', 'packages', {}, onPage);
  } catch (err) {
    console.warn('[Zoho] packages fetch failed (Inventory may be disabled):', err.message);
    return [];
  }
}

// Detail calls (line items are only in the detail response)
async function fetchSalesOrderDetail(salesorderId) {
  const data = await zGet(`/books/v3/salesorders/${salesorderId}`);
  return data.salesorder;
}
async function fetchContactDetail(contactId) {
  const data = await zGet(`/books/v3/contacts/${contactId}`);
  return data.contact;
}

module.exports = {
  configured,
  fetchContacts, fetchItems, fetchSalesOrders, fetchInvoices, fetchPackages,
  fetchSalesOrderDetail, fetchContactDetail,
};
