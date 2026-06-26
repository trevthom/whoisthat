// ============================================================================
// map.js  —  The OpenStreetMap canvas and all its pins.
// ============================================================================
// Uses Leaflet (a small mapping library) with OpenStreetMap data. We use two
// map "skins": a light one and a dark one, so the map stays readable whichever
// theme the app is in. Pins mark people, you, and relatives.
// ----------------------------------------------------------------------------

import { MAP_DEFAULT, MAP_LOCATED_ZOOM } from './config.js';

// Standard OpenStreetMap tiles. Unlike the minimalist "Positron/Dark Matter"
// styles, these draw building footprints (house outlines) once you zoom in to
// roughly street level. Dark mode is achieved by filtering these tiles in CSS
// (see .map-dark in styles.css) so building detail is kept in both themes.
const OSM_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap contributors',
};

let map = null;
let tileLayer = null;
let markersLayer = null;
let userDot = null;            // the "you are here" location dot
let pickHandler = null;
let containerEl = null;

export function initMap(containerId, theme = 'dark') {
  containerEl = document.getElementById(containerId);
  map = L.map(containerId, { zoomControl: false, attributionControl: false })
    .setView([MAP_DEFAULT.lat, MAP_DEFAULT.lng], MAP_DEFAULT.zoom);
  // Put the +/- zoom buttons at the bottom-left, clear of the top header and the
  // floating "Add person / My info" buttons on the right.
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  // Attribution is required by OpenStreetMap, so we show it in the app footer
  // instead of on the map (see the "© OpenStreetMap" link there).
  tileLayer = L.tileLayer(OSM_TILES.url, { maxZoom: 19 }).addTo(map);
  setTheme(theme);
  markersLayer = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    if (pickHandler) {
      const cb = pickHandler;
      pickHandler = null;
      containerEl.classList.remove('picking');
      cb({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) });
    }
  });
  // Maps inside panels sometimes need a nudge to size correctly.
  setTimeout(() => map && map.invalidateSize(), 200);
  return map;
}

export function setTheme(theme) {
  if (!containerEl) return;
  containerEl.classList.toggle('map-dark', theme === 'dark');
}

// Ask the browser for the user's location. Resolves with {lat,lng} or rejects.
export function locateUser() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location not supported on this device.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) };
        if (map) {
          // The map was just un-hidden at login, so make sure it knows its real
          // size before we recentre — otherwise the zoom can land off-target.
          map.invalidateSize();
          showUserLocation(c);
          map.setView([c.lat, c.lng], MAP_LOCATED_ZOOM, { animate: true });
        }
        resolve(c);
      },
      (err) => reject(err),
      // High accuracy needs GPS and often times out on laptops/desktops; the
      // looser settings below resolve far more reliably (Wi-Fi / IP based).
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  });
}

// Show a blue "you are here" dot at the browser-calculated location. This is
// separate from any pin on your own card — it just marks where you physically
// are right now.
export function showUserLocation(loc) {
  if (!map) return;
  const icon = L.divIcon({
    className: '',
    html: '<div class="wwt-userdot"><span class="wwt-userdot-core"></span></div>',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
  if (userDot) userDot.setLatLng([loc.lat, loc.lng]);
  else userDot = L.marker([loc.lat, loc.lng], { icon, interactive: false, zIndexOffset: -100 }).addTo(map);
}

// A temporary "draft" pin shown while the user confirms a location (e.g. after
// searching an address). Cleared once they confirm or cancel.
let draftPin = null;
export function showDraftPin(loc) {
  if (!map) return;
  const icon = L.divIcon({
    className: '',
    html: '<div class="wwt-pin wwt-pin-draft"><span class="wwt-pin-dot"></span></div>',
    iconSize: [0, 0], iconAnchor: [0, 0],
  });
  if (draftPin) draftPin.setLatLng([loc.lat, loc.lng]);
  else draftPin = L.marker([loc.lat, loc.lng], { icon, interactive: false, zIndexOffset: 500 }).addTo(map);
  map.setView([loc.lat, loc.lng], Math.max(map.getZoom(), MAP_LOCATED_ZOOM), { animate: true });
}
export function clearDraftPin() {
  if (draftPin && map) map.removeLayer(draftPin);
  draftPin = null;
}

export function panTo(lat, lng, zoom) {
  if (map) map.setView([lat, lng], zoom || MAP_LOCATED_ZOOM);
}

// Turn the next map click into a coordinate (for placing a pin). The cursor
// changes to a crosshair while active.
export function enablePickMode(containerId, callback) {
  pickHandler = callback;
  document.getElementById(containerId).classList.add('picking');
}
export function cancelPickMode(containerId) {
  pickHandler = null;
  if (containerId) document.getElementById(containerId).classList.remove('picking');
}

// Draw all pins from scratch.
//   onSelect(id)        fires when a single person/relative pin is clicked.
//   onCluster(people[]) fires when a "N pins" stacked marker is clicked.
export function renderPins(dataset, onSelect, onCluster) {
  if (!markersLayer) return;
  markersLayer.clearLayers();

  // Your own pin (teal "you" marker).
  if (dataset.self && dataset.self.location) {
    addPersonMarker(dataset.self, 'self', () => onSelect('self'));
  }

  // Group people that sit at the same address (or exact coordinates).
  const groups = new Map();
  for (const p of dataset.people) {
    if (!p.location) continue;
    const key = (p.address && p.address.trim())
      ? 'a:' + p.address.trim().toLowerCase()
      : `c:${p.location.lat},${p.location.lng}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  for (const group of groups.values()) {
    if (group.length > 1) {
      addClusterMarker(group[0].location, group.length, () => onCluster && onCluster(group));
    } else {
      const p = group[0];
      addPersonMarker(p, 'person', () => onSelect(p.id));
    }
  }

  // Relatives with their own pin (small amber dot).
  for (const p of dataset.people) {
    for (const r of p.relatives || []) {
      if (r.lat != null && r.lng != null) {
        addMarker({ lat: r.lat, lng: r.lng }, `${r.name || 'Relative'} (${r.type})`, 'relative', () => onSelect(p.id));
      }
    }
  }
}

// A person pin: a circular photo (if they have one) or a coloured dot, plus a
// name label underneath.
function addPersonMarker(person, kind, onClick) {
  const label = person.name || (kind === 'self' ? 'You' : 'Unnamed');
  const head = person.picture
    ? `<div class="wwt-photo"><img src="${escapeHtml(person.picture)}" alt="" /></div>`
    : '<span class="wwt-pin-dot"></span>';
  const icon = L.divIcon({
    className: '',
    html: `<div class="wwt-pin wwt-pin-${kind}" title="${escapeHtml(label)}">
             ${head}
             <span class="wwt-pin-label">${escapeHtml(label)}</span>
           </div>`,
    iconSize: [0, 0], iconAnchor: [0, 0],
  });
  const m = L.marker([person.location.lat, person.location.lng], { icon });
  m.on('click', onClick);
  m.addTo(markersLayer);
}

// A "N pins" marker for several people at one address.
function addClusterMarker(loc, count, onClick) {
  const icon = L.divIcon({
    className: '',
    html: `<div class="wwt-pin wwt-cluster" title="${count} pins">
             <span class="wwt-cluster-dot">${count}</span>
             <span class="wwt-pin-label">${count} pins</span>
           </div>`,
    iconSize: [0, 0], iconAnchor: [0, 0],
  });
  const m = L.marker([loc.lat, loc.lng], { icon });
  m.on('click', onClick);
  m.addTo(markersLayer);
}

function addMarker(loc, label, kind, onClick) {
  const icon = L.divIcon({
    className: '',
    html: `<div class="wwt-pin wwt-pin-${kind}" title="${escapeHtml(label)}">
             <span class="wwt-pin-dot"></span>
             <span class="wwt-pin-label">${escapeHtml(label)}</span>
           </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
  const m = L.marker([loc.lat, loc.lng], { icon });
  m.on('click', onClick);
  m.addTo(markersLayer);
}

export function invalidate() { if (map) setTimeout(() => map.invalidateSize(), 50); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
