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
    grant_type:    'client_credentials',
    client_id:     process.env.FEDEX_CLIENT_ID || '',
    client_secret: process.env.FEDEX_CLIENT_SECRET || '',
  });

  const resp = await axios.post(`${getBaseUrl()}/oauth/token`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  tokenCache = {
    token:     resp.data.access_token,
    expiresAt: now + (resp.data.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

// ─── Shipper address from env ─────────────────────────────────────────────────
function getShipperAddress() {
  const street  = process.env.FEDEX_SHIPPER_STREET  || '';
  const street2 = process.env.FEDEX_SHIPPER_STREET2 || '';
  return {
    name:    process.env.FEDEX_SHIPPER_NAME    || process.env.COMPANY_NAME || 'Sender',
    phone:   process.env.FEDEX_SHIPPER_PHONE   || '5555555555',
    street:  [street, street2].filter(Boolean),
    city:    process.env.FEDEX_SHIPPER_CITY    || '',
    state:   process.env.FEDEX_SHIPPER_STATE   || '',
    zip:     process.env.FEDEX_SHIPPER_ZIP     || '',
    country: process.env.FEDEX_SHIPPER_COUNTRY || 'US',
  };
}

// ─── Valid packaging types per service (FedEx API constraint) ─────────────────
// Ground services ONLY accept YOUR_PACKAGING — FedEx does not provide packaging.
// Express and International accept both FedEx-supplied and customer packaging.
const SERVICE_VALID_PACKAGES = {
  FEDEX_GROUND:           ['YOUR_PACKAGING'],
  FEDEX_HOME_DELIVERY:    ['YOUR_PACKAGING'],
  FEDEX_EXPRESS_SAVER:    ['YOUR_PACKAGING', 'FEDEX_ENVELOPE', 'FEDEX_PAK', 'FEDEX_TUBE', 'FEDEX_SMALL_BOX', 'FEDEX_MEDIUM_BOX', 'FEDEX_LARGE_BOX', 'FEDEX_EXTRA_LARGE_BOX'],
  FEDEX_2_DAY:            ['YOUR_PACKAGING', 'FEDEX_ENVELOPE', 'FEDEX_PAK', 'FEDEX_SMALL_BOX', 'FEDEX_MEDIUM_BOX', 'FEDEX_LARGE_BOX', 'FEDEX_EXTRA_LARGE_BOX'],
  FEDEX_2_DAY_AM:         ['YOUR_PACKAGING', 'FEDEX_ENVELOPE', 'FEDEX_PAK', 'FEDEX_SMALL_BOX', 'FEDEX_MEDIUM_BOX', 'FEDEX_LARGE_BOX', 'FEDEX_EXTRA_LARGE_BOX'],
  STANDARD_OVERNIGHT:     ['YOUR_PACKAGING', 'FEDEX_ENVELOPE', 'FEDEX_PAK', 'FEDEX_SMALL_BOX', 'FEDEX_MEDIUM_BOX', 'FEDEX_LARGE_BOX', 'FEDEX_EXTRA_LARGE_BOX'],
  PRIORITY_OVERNIGHT:     ['YOUR_PACKAGING', 'FEDEX_ENVELOPE', 'FEDEX_PAK', 'FEDEX_TUBE', 'FEDEX_SMALL_BOX', 'FEDEX_MEDIUM_BOX', 'FEDEX_LARGE_BOX', 'FEDEX_EXTRA_LARGE_BOX'],
  FIRST_OVERNIGHT:        ['YOUR_PACKAGING', 'FEDEX_ENVELOPE', 'FEDEX_PAK', 'FEDEX_SMALL_BOX', 'FEDEX_MEDIUM_BOX', 'FEDEX_LARGE_BOX', 'FEDEX_EXTRA_LARGE_BOX'],
  INTERNATIONAL_ECONOMY:  ['YOUR_PACKAGING', 'FEDEX_ENVELOPE', 'FEDEX_PAK', 'FEDEX_10KG_BOX', 'FEDEX_25KG_BOX'],
  INTERNATIONAL_PRIORITY: ['YOUR_PACKAGING', 'FEDEX_ENVELOPE', 'FEDEX_PAK', 'FEDEX_10KG_BOX', 'FEDEX_25KG_BOX'],
};

// FedEx returns transitTime as enum strings — map to business day numbers for display
const TRANSIT_TIME_DAYS = {
  ONE_DAY:    1, TWO_DAYS:   2, THREE_DAYS: 3,
  FOUR_DAYS:  4, FIVE_DAYS:  5, SIX_DAYS:   6,
  SEVEN_DAYS: 7,
};

function parseDimensions(box_type, length_in, width_in, height_in) {
  if (box_type === 'YOUR_PACKAGING' && length_in && width_in && height_in) {
    return {
      length: Math.round(parseFloat(length_in)),
      width:  Math.round(parseFloat(width_in)),
      height: Math.round(parseFloat(height_in)),
      units:  'IN',
    };
  }
  return null;
}

// ─── Rate Quotes ──────────────────────────────────────────────────────────────
// Returns array of { serviceType, serviceName, packagingType, netCharge, currency, transitDays, deliveryDate }
// sorted cheapest first. Omitting serviceType asks FedEx for all available services.
async function getRates({ package_type, weight_lbs, length_in, width_in, height_in, recipient }) {
  const token   = await getAccessToken();
  const shipper = getShipperAddress();
  const shipDateStamp = new Date().toISOString().split('T')[0];

  // Require at minimum a postal code and country to get accurate rates
  if (!recipient.zip && !recipient.postal) {
    throw new Error('Recipient postal code is required for rate quotes. Please add a zip code to the patient address.');
  }
  if (!recipient.country) {
    throw new Error('Recipient country is required for rate quotes. Please add a country to the patient address.');
  }

  const packageLineItem = {
    weight: { units: 'LB', value: parseFloat(weight_lbs) },
  };
  const dims = parseDimensions(package_type, length_in, width_in, height_in);
  if (dims) packageLineItem.dimensions = dims;

  // Build recipient address — only include fields that are populated
  const recipientAddress = {
    postalCode:  recipient.zip || recipient.postal || '',
    countryCode: recipient.country || 'US',
  };
  if (recipient.street) recipientAddress.streetLines = [recipient.street];
  if (recipient.city)   recipientAddress.city = recipient.city;
  if (recipient.state)  recipientAddress.stateOrProvinceCode = recipient.state;
  // Do NOT force residential:true — let FedEx determine based on address;
  // forcing it adds residential surcharges to all commercial addresses.

  const payload = {
    accountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER },
    requestedShipment: {
      shipper: {
        address: {
          streetLines:         shipper.street.length ? shipper.street : ['1 Sender Way'],
          city:                shipper.city,
          stateOrProvinceCode: shipper.state,
          postalCode:          shipper.zip,
          countryCode:         shipper.country,
        },
      },
      recipient: { address: recipientAddress },
      shipDateStamp,
      pickupType:    'USE_SCHEDULED_PICKUP',
      packagingType: package_type,
      rateRequestType: ['ACCOUNT', 'LIST'],
      // No serviceType → FedEx returns all compatible services
      requestedPackageLineItems: [packageLineItem],
    },
  };

  let resp;
  try {
    resp = await axios.post(`${getBaseUrl()}/rate/v1/rates/quotes`, payload, {
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-locale':     'en_US',
      },
    });
  } catch (err) {
    if (err.response) {
      console.error('FedEx rate API error:', err.response.status, JSON.stringify(err.response.data, null, 2));
    }
    throw err;
  }

  const details = resp.data?.output?.rateReplyDetails || [];
  if (!details.length) {
    console.warn('FedEx rate response had no rateReplyDetails. Full response:', JSON.stringify(resp.data, null, 2));
  }

  const rates = details.map(d => {
    // Prefer discounted account rate; fall back to list rate or first available
    const rateDetail = d.ratedShipmentDetails?.find(r => r.rateType === 'PAYOR_ACCOUNT_SHIPMENT')
      || d.ratedShipmentDetails?.find(r => r.rateType === 'PAYOR_LIST_SHIPMENT')
      || d.ratedShipmentDetails?.[0];

    // totalNetCharge is a plain number in the FedEx response (not an object)
    const netCharge = parseFloat(rateDetail?.totalNetCharge ?? rateDetail?.totalNetFedExCharge ?? 0);
    const currency  = rateDetail?.currency || 'USD';

    // transitTime is an enum string like "TWO_DAYS"; convert to a number for display
    const transitTimeStr = d.operationalDetail?.transitTime || d.operationalDetail?.astraPlannedServiceLevel;
    const transitDays    = transitTimeStr ? (TRANSIT_TIME_DAYS[transitTimeStr] ?? transitTimeStr) : null;
    const deliveryDate   = d.operationalDetail?.deliveryDate
      ? String(d.operationalDetail.deliveryDate).split('T')[0]
      : null;

    return {
      serviceType:   d.serviceType,
      serviceName:   d.serviceName || d.serviceType,
      packagingType: package_type,
      netCharge,
      currency,
      transitDays,
      deliveryDate,
    };
  }).filter(r => r.netCharge > 0);

  rates.sort((a, b) => a.netCharge - b.netCharge);
  return rates;
}

// ─── Create Shipment ──────────────────────────────────────────────────────────
async function createShipment({ service_type, box_type, weight_lbs, length_in, width_in, height_in, recipient }) {
  const token   = await getAccessToken();
  const shipper = getShipperAddress();
  const shipDatestamp = new Date().toISOString().split('T')[0];

  // Validate service/package combination before hitting FedEx
  const validPackages = SERVICE_VALID_PACKAGES[service_type];
  if (validPackages && !validPackages.includes(box_type)) {
    throw new Error(
      `Package type "${box_type}" is not valid for service "${service_type}". ` +
      `Valid options: ${validPackages.join(', ')}`
    );
  }

  const packageLineItem = {
    sequenceNumber: 1,
    weight: { units: 'LB', value: parseFloat(weight_lbs) },
  };
  const dims = parseDimensions(box_type, length_in, width_in, height_in);
  if (dims) packageLineItem.dimensions = dims;

  // Recipient phone: use what was passed or a safe placeholder
  const recipientPhone = recipient.phone || process.env.FEDEX_SHIPPER_PHONE || '5555555555';

  const payload = {
    labelResponseOptions: 'LABEL',    // Get base64 label data directly in the response
    requestedShipment: {
      shipper: {
        contact: { companyName: shipper.name, phoneNumber: shipper.phone },
        address: {
          streetLines:         shipper.street.length ? shipper.street : ['1 Sender Way'],
          city:                shipper.city,
          stateOrProvinceCode: shipper.state,
          postalCode:          shipper.zip,
          countryCode:         shipper.country,
        },
      },
      recipients: [{
        contact: {
          personName:  recipient.name  || 'Recipient',
          phoneNumber: recipientPhone,
        },
        address: {
          streetLines:         [recipient.street || ''],
          city:                recipient.city    || '',
          stateOrProvinceCode: recipient.state   || '',
          postalCode:          recipient.zip     || '',
          countryCode:         recipient.country || 'US',
        },
      }],
      shipDatestamp,
      serviceType:       service_type,
      packagingType:     box_type,
      pickupType:        'USE_SCHEDULED_PICKUP',
      totalPackageCount: 1,
      shippingChargesPayment: {
        paymentType: 'SENDER',
        payor: { responsibleParty: { accountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER } } },
      },
      labelSpecification: {
        labelStockType: 'PAPER_85X11_TOP_HALF_LABEL',
        imageType:      'PDF',
      },
      requestedPackageLineItems: [packageLineItem],
    },
    accountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER },
  };

  let resp;
  try {
    resp = await axios.post(`${getBaseUrl()}/ship/v1/shipments`, payload, {
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-locale':     'en_US',
      },
    });
  } catch (err) {
    if (err.response) {
      console.error('FedEx ship API error:', err.response.status, JSON.stringify(err.response.data, null, 2));
    }
    throw err;
  }

  const txShipment  = resp.data?.output?.transactionShipments?.[0];
  const pieceResp   = txShipment?.pieceResponses?.[0];
  const trackingNumber = pieceResp?.trackingNumber
    || txShipment?.masterTrackingNumber?.trackingNumber
    || txShipment?.masterTrackingNumber;

  // labelResponseOptions: 'LABEL' → encodedLabel is base64 PDF data
  const labelData = pieceResp?.packageDocuments?.[0]?.encodedLabel;
  // URL fallback in case sandbox returns URL_ONLY behavior
  const labelUrl  = pieceResp?.packageDocuments?.[0]?.url;

  if (!trackingNumber) {
    console.error('FedEx ship response missing trackingNumber:', JSON.stringify(resp.data, null, 2));
    throw new Error('FedEx did not return a tracking number. Check server logs for the full response.');
  }

  return {
    trackingNumber,
    labelData,
    labelUrl,
    estimatedDelivery: txShipment?.operationalDetail?.estimatedDeliveryTimestamp
      || txShipment?.operationalDetail?.deliveryDate,
  };
}

// ─── Track Shipment ───────────────────────────────────────────────────────────
async function trackShipment(trackingNumber) {
  const token = await getAccessToken();

  const payload = {
    includeDetailedScans: true,
    trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
  };

  let resp;
  try {
    resp = await axios.post(`${getBaseUrl()}/track/v1/trackingnumbers`, payload, {
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-locale':     'en_US',
      },
    });
  } catch (err) {
    if (err.response) {
      console.error('FedEx track API error:', err.response.status, JSON.stringify(err.response.data, null, 2));
    }
    throw err;
  }

  return resp.data?.output?.completeTrackResults?.[0]?.trackResults?.[0] || null;
}

module.exports = { getAccessToken, getRates, createShipment, trackShipment, SERVICE_VALID_PACKAGES };
