import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function AddressAutocomplete({ value, onChange, onSelect, placeholder, style }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const debounceRef = useRef(null);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

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

  function handleChange(e) {
    const q = e.target.value;
    onChange(q);
    clearTimeout(debounceRef.current);
    if (q.length < 4) { setSuggestions([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&countrycodes=us&q=${encodeURIComponent(q)}`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json();
        setSuggestions(data);
        if (data.length > 0) { updateDropdownPos(); setOpen(true); }
        else setOpen(false);
      } catch {}
    }, 450);
  }

  function handleSelect(item) {
    const a = item.address;
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    const city = a.city || a.town || a.village || a.municipality || a.county || '';
    const state = a.state || '';
    const zip = a.postcode || '';
    const country = (a.country_code || 'us').toUpperCase();
    onChange(street);
    onSelect({ street, city, state, zip, country });
    setSuggestions([]);
    setOpen(false);
  }

  const dropdown = open && suggestions.length > 0 && createPortal(
    <div style={{
      position: 'absolute', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width,
      zIndex: 9999,
      background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
      boxShadow: '0 4px 16px rgba(0,0,0,0.18)', maxHeight: 240, overflowY: 'auto',
    }}>
      {suggestions.map((item, i) => (
        <div
          key={i}
          onMouseDown={() => handleSelect(item)}
          style={{
            padding: '9px 12px', fontSize: 12, cursor: 'pointer', lineHeight: 1.4,
            borderBottom: i < suggestions.length - 1 ? '1px solid var(--border)' : 'none',
            color: 'var(--text-primary)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = ''; }}
        >
          {item.display_name}
        </div>
      ))}
      <div style={{ padding: '5px 12px', fontSize: 10, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
        Powered by OpenStreetMap
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
