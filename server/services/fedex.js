const axios = require('axios');

let tokenCache = { token: null, expiresAt: 0 };

function getBaseUrl() {
  return process.env.FEDEX_SANDBOX === 'true'
    ? 'https://apis-sandbox.fedex.com'
    : 'https://apis.fedex.com';
}

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt - now > 60000) {
    return tokenCache.token;
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.FEDEX_CLIENT_ID || '',
    client_secret: process.env.FEDEX_CLIENT_SECRET || '',
  });

  const resp = await axios.post(`${getBaseUrl()}/oauth/token`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  tokenCache = {
    token: resp.data.access_token,
    expiresAt: now + (resp.data.expires_in || 3600) * 1000,
  };

  return tokenCache.token;
}

async function createShipment({ service_type, box_type, weight_lbs, recipient }) {
  const token = await getAccessToken();

  // Build shipper address from company settings (fall back to env defaults)
  const shipperName    = process.env.COMPANY_NAME || 'Sender';
  const shipperStreet  = process.env.COMPANY_ADDRESS_1 || '';
  const shipperStreet2 = process.env.COMPANY_ADDRESS_2 || '';
  const shipperCity    = process.env.COMPANY_CITY || '';
  const shipperState   = process.env.COMPANY_STATE || '';
  const shipperZip     = process.env.COMPANY_ZIP || '';
  const shipperCountry = process.env.COMPANY_COUNTRY || 'US';

  const streetLines = [shipperStreet, shipperStreet2].filter(Boolean);

  const payload = {
    labelResponseOptions: 'URL_ONLY',
    requestedShipment: {
      shipper: {
        contact: { companyName: shipperName },
        address: {
          streetLines: streetLines.length ? streetLines : ['123 Main St'],
          city: shipperCity || 'Unknown',
          stateOrProvinceCode: shipperState || 'CA',
          postalCode: shipperZip || '00000',
          countryCode: shipperCountry,
        },
      },
      recipients: [
        {
          contact: { personName: recipient.name },
          address: {
            streetLines: [recipient.street],
            city: recipient.city,
            stateOrProvinceCode: recipient.state,
            postalCode: recipient.zip,
            countryCode: recipient.country || 'US',
          },
        },
      ],
      serviceType: service_type,
      packagingType: box_type,          // FEDEX_LARGE_BOX or FEDEX_EXTRA_LARGE_BOX
      pickupType: 'USE_SCHEDULED_PICKUP',
      shippingChargesPayment: {
        paymentType: 'SENDER',
        payor: { responsibleParty: { accountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER } } },
      },
      labelSpecification: {
        labelStockType: 'PAPER_85X11_TOP_HALF_LABEL',
        imageType: 'PDF',
      },
      requestedPackageLineItems: [
        {
          // No dimensions block — FedEx knows the dimensions of its own boxes
          weight: { units: 'LB', value: weight_lbs },
        },
      ],
    },
    accountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER },
  };

  const resp = await axios.post(`${getBaseUrl()}/ship/v1/shipments`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale': 'en_US',
    },
  });

  const output = resp.data?.output?.transactionShipments?.[0];
  const pieceResponse = output?.pieceResponses?.[0];
  const trackingNumber = pieceResponse?.trackingNumber || output?.masterTrackingNumber?.trackingNumber;
  const labelData = pieceResponse?.packageDocuments?.[0]?.encodedLabel;
  const labelUrl = pieceResponse?.packageDocuments?.[0]?.url;

  return {
    trackingNumber,
    labelData,
    labelUrl,
    estimatedDelivery: output?.operationalDetail?.estimatedDeliveryTimestamp,
  };
}

async function trackShipment(trackingNumber) {
  const token = await getAccessToken();

  const payload = {
    includeDetailedScans: true,
    trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
  };

  const resp = await axios.post(`${getBaseUrl()}/track/v1/trackingnumbers`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale': 'en_US',
    },
  });

  return resp.data?.output?.completeTrackResults?.[0]?.trackResults?.[0] || null;
}

module.exports = { getAccessToken, createShipment, trackShipment };
