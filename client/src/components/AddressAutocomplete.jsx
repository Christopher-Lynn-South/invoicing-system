import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

// Lazily load the Google Maps JS API once per page load
let googleMapsPromise = null;
function loadGoogleMaps() {
  if (googleMapsPromise) return googleMapsPromise;
  if (window.google?.maps?.places) {
    googleMapsPromise = Promise.resolve(window.google);
    return googleMapsPromise;
  }
  googleMapsPromise = new Promise((resolve, reject) => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) { reject(new Error('VITE_GOOGLE_MAPS_API_KEY not set')); return; }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

// Parse Google address_components into { street, city, state, zip, country }
function parseComponents(components) {
  const get = (type) => components.find(c => c.types.includes(type));
  const streetNumber = get('street_number')?.long_name || '';
  const route        = get('route')?.long_name || '';
  const street       = [streetNumber, route].filter(Boolean).join(' ');
  const city         = get('locality')?.long_name
                    || get('sublocality_level_1')?.long_name
                    || get('administrative_area_level_3')?.long_name
                    || get('administrative_area_level_2')?.long_name
                    || '';
  const state        = get('administrative_area_level_1')?.short_name || '';
  const zip          = get('postal_code')?.long_name || '';
  const country      = get('country')?.short_name || 'US';
  return { street, city, state, zip, country };
}

export default function AddressAutocomplete({ value, onChange, onSelect, placeholder, style }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen]               = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const debounceRef   = useRef(null);
  const inputRef      = useRef(null);
  const containerRef  = useRef(null);
  const autocompleteService = useRef(null);
  const placesService       = useRef(null);
  // invisible div required by PlacesService
  const placesNodeRef = useRef(document.createElement('div'));

  // Boot Google Maps on mount
  useEffect(() => {
    loadGoogleMaps()
      .then(google => {
        autocompleteService.current = new google.maps.places.AutocompleteService();
        placesService.current       = new google.maps.places.PlacesService(placesNodeRef.current);
      })
      .catch(() => { /* API key missing or network error — degrade silently */ });
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function updateDropdownPos() {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX, width: rect.width });
    }
  }

  const handleChange = useCallback((e) => {
    const q = e.target.value;
    onChange(q);
    clearTimeout(debounceRef.current);
    if (q.length < 3 || !autocompleteService.current) {
      setSuggestions([]); setOpen(false); return;
    }
    debounceRef.current = setTimeout(() => {
      autocompleteService.current.getPlacePredictions(
        { input: q, types: ['address'], componentRestrictions: { country: 'us' } },
        (predictions, status) => {
          if (status !== window.google.maps.places.PlacesServiceStatus.OK || !predictions) {
            setSuggestions([]); setOpen(false); return;
          }
          setSuggestions(predictions);
          updateDropdownPos();
          setOpen(true);
        }
      );
    }, 300);
  }, [onChange]);

  function handleSelect(prediction) {
    if (!placesService.current) return;
    placesService.current.getDetails(
      { placeId: prediction.place_id, fields: ['address_components'] },
      (place, status) => {
        if (status !== window.google.maps.places.PlacesServiceStatus.OK || !place) return;
        const parsed = parseComponents(place.address_components);
        onChange(parsed.street);
        onSelect(parsed);
        setSuggestions([]);
        setOpen(false);
      }
    );
  }

  const dropdown = open && suggestions.length > 0 && createPortal(
    <div style={{
      position: 'absolute', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width,
      zIndex: 9999,
      background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
      boxShadow: '0 4px 16px rgba(0,0,0,0.18)', maxHeight: 260, overflowY: 'auto',
    }}>
      {suggestions.map((pred, i) => (
        <div
          key={pred.place_id}
          onMouseDown={() => handleSelect(pred)}
          style={{
            padding: '9px 12px', fontSize: 12, cursor: 'pointer', lineHeight: 1.4,
            borderBottom: i < suggestions.length - 1 ? '1px solid var(--border)' : 'none',
            color: 'var(--text-primary)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = ''; }}
        >
          <span style={{ fontWeight: 500 }}>
            {pred.structured_formatting?.main_text || pred.description}
          </span>
          {pred.structured_formatting?.secondary_text && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
              {pred.structured_formatting.secondary_text}
            </span>
          )}
        </div>
      ))}
      <div style={{ padding: '5px 12px', fontSize: 10, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
        <img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" style={{ height: 14 }} />
      </div>
    </div>,
    document.body
  );

  return (
    <div ref={containerRef} style={{ position: 'relative', ...style }}>
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        placeholder={placeholder || 'Street address'}
        style={{ width: '100%' }}
        autoComplete="off"
      />
      {dropdown}
    </div>
  );
}
