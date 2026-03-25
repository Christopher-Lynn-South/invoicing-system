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

// ─── Shipper address from env ─────────────────────────────────────────────────
function getShipperAddress() {
  const street  = process.env.FEDEX_SHIPPER_STREET || '';
  const street2 = process.env.FEDEX_SHIPPER_STREET2 || '';
  return {
    name:    process.env.FEDEX_SHIPPER_NAME || process.env.COMPANY_NAME || 'Sender',
    phone:   process.env.FEDEX_SHIPPER_PHONE || '0000000000',
    street:  [street, street2].filter(Boolean),
    city:    process.env.FEDEX_SHIPPER_CITY    || 'Unknown',
    state:   process.env.FEDEX_SHIPPER_STATE   || 'CA',
    zip:     process.env.FEDEX_SHIPPER_ZIP     || '00000',
    country: process.env.FEDEX_SHIPPER_COUNTRY || 'US',
  };
}

// ─── Valid packaging types per service (FedEx API constraint) ─────────────────
// Ground services only accept YOUR_PACKAGING — FedEx doesn't provide packaging.
// Express services accept both FedEx-supplied boxes and customer packaging.
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

// ─── Rate Quotes ──────────────────────────────────────────────────────────────
// Returns array of { serviceType, serviceName, packagingType, netCharge, currency, transitDays, deliveryDate }
// sorted cheapest first.  Omitting serviceType in the request asks FedEx for all available services.
async function getRates({ package_type, weight_lbs, length_in, width_in, height_in, recipient }) {
  const token   = await getAccessToken();
  const shipper = getShipperAddress();
  const shipDateStamp = new Date().toISOString().split('T')[0];

  const packageLineItem = {
    weight: { units: 'LB', value: parseFloat(weight_lbs) },
  };
  // Dimensions required for YOUR_PACKAGING; FedEx-supplied boxes have known dimensions
  if (package_type === 'YOUR_PACKAGING' && length_in && width_in && height_in) {
    packageLineItem.dimensions = {
      length: parseInt(length_in),
      width:  parseInt(width_in),
      height: parseInt(height_in),
      units:  'IN',
    };
  }

  const payload = {
    accountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER },
    requestedShipment: {
      shipper: {
        address: {
          streetLines:          shipper.street.length ? shipper.street : ['123 Main St'],
          city:                 shipper.city,
          stateOrProvinceCode:  shipper.state,
          postalCode:           shipper.zip,
          countryCode:          shipper.country,
        },
      },
      recipient: {
        address: {
          streetLines:         [recipient.street || ''],
          city:                recipient.city    || '',
          stateOrProvinceCode: recipient.state   || '',
          postalCode:          recipient.zip     || '',
          countryCode:         recipient.country || 'US',
          residential:         true,
        },
      },
      shipDateStamp,
      pickupType:    'USE_SCHEDULED_PICKUP',
      packagingType: package_type,
      // No serviceType → FedEx returns rates for ALL compatible services
      requestedPackageLineItems: [packageLineItem],
      rateRequestType: ['ACCOUNT', 'LIST'],
    },
  };

  const resp = await axios.post(`${getBaseUrl()}/rate/v1/rates/quotes`, payload, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale':     'en_US',
    },
  });

  const details = resp.data?.output?.rateReplyDetails || [];
  const rates = details.map(d => {
    // Prefer PAYOR_ACCOUNT_SHIPMENT rate; fall back to first rate
    const rateDetail = d.ratedShipmentDetails?.find(r => r.rateType === 'PAYOR_ACCOUNT_SHIPMENT')
      || d.ratedShipmentDetails?.[0];
    const netCharge = rateDetail?.totalNetCharge?.amount
      ?? rateDetail?.totalNetFedExCharge?.amount
      ?? rateDetail?.totalNetCharge
      ?? 0;
    const currency = rateDetail?.totalNetCharge?.currency
      ?? rateDetail?.currency
      ?? 'USD';
    const transitDays   = d.operationalDetail?.transitDays ?? d.operationalDetail?.astraPlannedServiceLevel ?? null;
    const deliveryDate  = d.operationalDetail?.deliveryDate ?? d.operationalDetail?.committedDate ?? null;
    return {
      serviceType:   d.serviceType,
      serviceName:   d.serviceName || d.serviceType,
      packagingType: package_type,
      netCharge:     parseFloat(netCharge) || 0,
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

  // Validate service/package combination
  const validPackages = SERVICE_VALID_PACKAGES[service_type];
  if (validPackages && !validPackages.includes(box_type)) {
    throw new Error(
      `Package type "${box_type}" is not valid for service "${service_type}". ` +
      `Valid options: ${validPackages.join(', ')}`
    );
  }

  const packageLineItem = {
    sequenceNumber: 1,
    weight: { units: 'LB', value: weight_lbs },
  };
  if (box_type === 'YOUR_PACKAGING' && length_in && width_in && height_in) {
    packageLineItem.dimensions = {
      length: parseInt(length_in),
      width:  parseInt(width_in),
      height: parseInt(height_in),
      units:  'IN',
    };
  }

  const payload = {
    labelResponseOptions: 'URL_ONLY',
    requestedShipment: {
      shipper: {
        contact: { companyName: shipper.name, phoneNumber: shipper.phone },
        address: {
          streetLines:         shipper.street.length ? shipper.street : ['123 Main St'],
          city:                shipper.city,
          stateOrProvinceCode: shipper.state,
          postalCode:          shipper.zip,
          countryCode:         shipper.country,
        },
      },
      recipients: [{
        contact: { personName: recipient.name, phoneNumber: '0000000000' },
        address: {
          streetLines:         [recipient.street],
          city:                recipient.city,
          stateOrProvinceCode: recipient.state,
          postalCode:          recipient.zip,
          countryCode:         recipient.country || 'US',
        },
      }],
      shipDatestamp,
      serviceType:              service_type,
      packagingType:            box_type,
      pickupType:               'USE_SCHEDULED_PICKUP',
      totalPackageCount:        1,
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

  const resp = await axios.post(`${getBaseUrl()}/ship/v1/shipments`, payload, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale':     'en_US',
    },
  });

  const output       = resp.data?.output?.transactionShipments?.[0];
  const pieceResponse = output?.pieceResponses?.[0];
  const trackingNumber = pieceResponse?.trackingNumber || output?.masterTrackingNumber?.trackingNumber;
  const labelData      = pieceResponse?.packageDocuments?.[0]?.encodedLabel;
  const labelUrl       = pieceResponse?.packageDocuments?.[0]?.url;

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
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale':     'en_US',
    },
  });

  return resp.data?.output?.completeTrackResults?.[0]?.trackResults?.[0] || null;
}

module.exports = { getAccessToken, getRates, createShipment, trackShipment, SERVICE_VALID_PACKAGES };

