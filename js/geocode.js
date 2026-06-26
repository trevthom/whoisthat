// ============================================================================
// geocode.js  —  Turn a typed address into map coordinates.
// ============================================================================
// Uses OpenStreetMap's free Nominatim service. It runs from the user's browser,
// which automatically sends a Referer header identifying your site (Nominatim's
// usage policy asks for that and a light request rate — fine for occasional
// address look-ups like this app does). No API key is needed.
//
// If you ever outgrow Nominatim's limits, you can swap the URL below for another
// geocoding provider that returns lat/lon.
// ----------------------------------------------------------------------------

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

// Look up an address. Returns an array of { lat, lng, address } (best first).
export async function searchAddress(query) {
  const q = (query || '').trim();
  if (!q) return [];
  const url = `${ENDPOINT}?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Address search is unavailable right now');
  const data = await res.json();
  return (data || []).map((r) => ({
    lat: +(+r.lat).toFixed(6),
    lng: +(+r.lon).toFixed(6),
    address: r.display_name,
  }));
}
