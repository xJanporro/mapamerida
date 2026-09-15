// =========================================================
// core.js — Configuración, estado global y utilidades puras
// =========================================================

// ---------- Config ----------
const CENTER = [8.0, -71.5]; // ajusta al centro de tu zona
const ZOOM = 8;
let currentMarkerSize = parseInt(
  localStorage.getItem("markerSize") || "40",
  10,
);
let clusteringEnabled = localStorage.getItem("clustering") !== "false";

// Ícono de escudo reutilizado en el badge de cada popup
const SHIELD_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5l-8-3z"/><path d="M9 12.5l2 2 4-4.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const PIN_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.4"/></svg>`;

// ---------- Paleta de colores automática por municipio ----------
function colorForIndex(i, total) {
  const hue = Math.round((360 / total) * i);
  return `hsl(${hue}, 70%, 50%)`;
}
// Color estable por texto (para el indicador de tipo en el popup), sin depender de orden de carga
function colorForText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++)
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 65%, 55%)`;
}

// ---------- Estado global (compartido entre scripts) ----------
let municipioColors = {};
let municipiosLayer, parroquiasLayer, markersLayer;
let municipiosGeoData = null; // datos crudos, usados para asignar municipio a cada marcador
let activeMunicipios = new Set(); // vacío = mostrar todos
let activeParroquias = new Set(); // vacío = mostrar todas (filtro independiente, combinado con activeMunicipios por AND)
let activeTipos = new Set(); // vacío = mostrar todos
let allParroquiaFeatures = [];
let allMarkers = []; // [{ marker, tipo, iconUrl, props }]
let highlightedParroquias = new Set(); // pcodes con resaltado amarillo activo (persisten hasta deseleccionar)
let lastUpdated = null; // Date de la última carga exitosa de marcadores.geojson
let markersLoadFailed = false;
let currentLayout = localStorage.getItem("layout") || "main"; // "main" | "heat"
let heatLayer = null;
let heatEnabled = localStorage.getItem("heatEnabled") !== "false";
let riskZones = [];

// ---------- Utilidad: tiempo relativo ("hace 2 min") ----------
function timeAgo(date) {
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 10) return "justo ahora";
  if (diffSec < 60) return `hace ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `hace ${diffHr} h`;
  const diffDay = Math.floor(diffHr / 24);
  return `hace ${diffDay} d`;
}

// ---------- Utilidad: punto dentro de polígono (ray casting) ----------
// Soporta Polygon y MultiPolygon, respetando huecos (rings adicionales).
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
function pointInPolygonRings(lng, lat, rings) {
  if (!pointInRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lng, lat, rings[i])) return false; // dentro de un hueco
  }
  return true;
}
function municipioForPoint(lng, lat) {
  if (!municipiosGeoData) return null;
  for (const f of municipiosGeoData.features) {
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === "Polygon") {
      if (pointInPolygonRings(lng, lat, geom.coordinates))
        return f.properties.Municipio;
    } else if (geom.type === "MultiPolygon") {
      for (const polygon of geom.coordinates) {
        if (pointInPolygonRings(lng, lat, polygon))
          return f.properties.Municipio;
      }
    }
  }
  return null;
}
// Asigna (una sola vez, con caché) el municipio a cada marcador según su posición.
function ensureMarkerMunicipios() {
  if (!municipiosGeoData) return;
  allMarkers.forEach((m) => {
    if (m.municipio !== undefined) return;
    const { lat, lng } = m.marker.getLatLng();
    m.municipio = municipioForPoint(lng, lat) || "Sin municipio";
  });
}

// ---------- Utilidades de texto ----------
// Quita tildes/diacríticos para que "merida" encuentre "Mérida" sin importar
// cómo se escriba la búsqueda.
function normalizeText(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Una propiedad "cuenta" para mostrarse si tiene un valor real: no undefined/null,
// no string vacío o solo espacios. El número 0 SÍ se muestra (ej. "estaciones: 0"
// es información válida, distinta de "no se cargó el dato").
function hasValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

// "num_estaciones" -> "Num Estaciones" — así cualquier propiedad nueva del GeoJSON
// (personal, num_estaciones, telefono, etc.) se ve prolija sin tener que
// nombrarla a mano en el código.
function prettifyLabel(key) {
  return key
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Escapa texto que viene de los datos antes de insertarlo en innerHTML.
// Sin esto, un nombre con <script> inyectado abriría un agujero XSS.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- Utilidad: fetch de GeoJSON con reintentos ----------
async function fetchJSON(url, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
      return await r.json();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// ---------- Zonas de Riesgo (mapa de calor) — conjuntos de datos ----------
// Cada archivo vive en data/heatmaps/ y contiene puntos con
// { intensidad: 1-10, nombre?, descripcion? }.
const HEATMAP_DATASETS = [
  {
    id: "principal",
    label: "Zona de riesgo",
    file: "data/heatmaps/zona_riesgo_libertador.geojson",
  },
  {
    id: "metropolitana",
    label: "Zona Metropolitana",
    file: "data/heatmaps/zona_riesgo_metropolitana.geojson",
  },
  {
    id: "pedregosa",
    label: "Pedregosa",
    file: "data/heatmaps/zona_riesgo_pedregosa_sur.geojson",
  },
];

let currentHeatRadius = parseInt(
  localStorage.getItem("heatRadius") || "45",
  10,
);

function heatOptionsForRadius(radius) {
  return {
    radius,
    blur: Math.round(radius * 0.78),
    maxZoom: ZOOM + 1,
    gradient: {
      0.2: "#1d4e89",
      0.4: "#3d8fd6",
      0.6: "#f2d675",
      0.8: "#e8813a",
      1.0: "#c22e2e",
    },
  };
}

function buildIcon(iconUrl, size) {
  return L.icon({
    iconUrl: iconUrl,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}