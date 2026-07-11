import React, { useRef, useEffect } from 'react';

// ── Runtime key loader ────────────────────────────────────────────────────────
// Key is fetched from the server so it doesn't need to be baked into the build.
let _keyPromise = null;
function getApiKey() {
  if (_keyPromise) return _keyPromise;
  // Build-time key takes priority (set via VITE_GOOGLE_MAPS_API_KEY)
  const buildKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (buildKey) { _keyPromise = Promise.resolve(buildKey); return _keyPromise; }
  // Fall back to runtime key from server
  _keyPromise = fetch('/api/config')
    .then(r => r.json())
    .then(d => d.googleMapsKey || '')
    .catch(() => '');
  return _keyPromise;
}

// ── Google Maps script loader ─────────────────────────────────────────────────
let _mapsPromise = null;
function loadGoogleMaps() {
  if (_mapsPromise) return _mapsPromise;
  if (window.google?.maps?.places) { _mapsPromise = Promise.resolve(window.google); return _mapsPromise; }
  _mapsPromise = getApiKey().then(key => new Promise((resolve, reject) => {
    if (!key) { reject(new Error('GOOGLE_MAPS_API_KEY not configured')); return; }
    const cbName = `__gmcb${Date.now()}`;
    window[cbName] = () => { delete window[cbName]; resolve(window.google); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&callback=${cbName}`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps script failed to load'));
    document.head.appendChild(s);
  }));
  return _mapsPromise;
}

// ── Address component parser ──────────────────────────────────────────────────
function parseComponents(components) {
  const get = t => components.find(c => c.types.includes(t));
  const street = [get('street_number')?.long_name, get('route')?.long_name].filter(Boolean).join(' ');
  const city   = get('locality')?.long_name
              || get('sublocality_level_1')?.long_name
              || get('administrative_area_level_3')?.long_name
              || get('administrative_area_level_2')?.long_name || '';
  const state   = get('administrative_area_level_1')?.short_name || '';
  const zip     = get('postal_code')?.long_name || '';
  const country = get('country')?.short_name || 'US';
  return { street, city, state, zip, country };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AddressAutocomplete({ value, onChange, onSelect, placeholder, style }) {
  const inputRef = useRef(null);
  const acRef    = useRef(null);

  useEffect(() => {
    let mounted = true;
    loadGoogleMaps()
      .then(google => {
        if (!mounted || !inputRef.current || acRef.current) return;
        const ac = new google.maps.places.Autocomplete(inputRef.current, {
          types: ['address'],
          componentRestrictions: { country: 'us' },
          fields: ['address_components'],
        });
        ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          if (!place?.address_components) return;
          const parsed = parseComponents(place.address_components);
          onChange(parsed.street);
          onSelect(parsed);
        });
        acRef.current = ac;
      })
      .catch(err => console.error('[AddressAutocomplete]', err.message));
    return () => { mounted = false; };
  }, []);

  return (
    <div style={{ position: 'relative', ...style }}>
      <input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || 'Street address'}
        style={{ width: '100%' }}
        autoComplete="off"
      />
    </div>
  );
}
