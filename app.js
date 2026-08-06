// ---------- Config ----------
const CENTER = [8.0, -71.5];   // ajusta al centro de tu zona
const ZOOM = 8;
let currentMarkerSize = parseInt(localStorage.getItem('markerSize') || '40', 10);

const map = L.map('map').setView(CENTER, ZOOM);

// ---------- Mapas base (calles / satélite) ----------
const baseStreets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19
});
const baseSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri',
  maxZoom: 19
});
baseStreets.addTo(map);
L.control.layers({ 'Calles': baseStreets, 'Satélite': baseSatellite }, null, { position: 'topright' }).addTo(map);

// Botón para recentrar el mapa
const ResetControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd: function () {
    const btn = L.DomUtil.create('button', 'reset-view-btn');
    btn.innerHTML = '⤢';
    btn.title = 'Centrar mapa';
    L.DomEvent.on(btn, 'click', L.DomEvent.stop).on(btn, 'click', () => map.setView(CENTER, ZOOM));
    return btn;
  }
});
map.addControl(new ResetControl());

// ---------- Mostrar/ocultar sidebar ----------
document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.body.classList.add('sidebar-hidden');
  setTimeout(() => map.invalidateSize(), 260);
});
document.getElementById('sidebarShowBtn').addEventListener('click', () => {
  document.body.classList.remove('sidebar-hidden');
  setTimeout(() => map.invalidateSize(), 260);
});

// ---------- Paleta de colores automática por municipio ----------
function colorForIndex(i, total) {
  const hue = Math.round((360 / total) * i);
  return `hsl(${hue}, 70%, 50%)`;
}
// Color estable por texto (para el indicador de tipo en el popup), sin depender de orden de carga
function colorForText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = text.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 65%, 55%)`;
}

let municipioColors = {};
let municipiosLayer, parroquiasLayer, markersLayer;
let activeMunicipios = new Set();   // vacío = mostrar todos
let activeTipos = new Set();        // vacío = mostrar todos
let allParroquiaFeatures = [];
let allMarkers = [];                // [{ marker, tipo, iconUrl }]
let selectedLayer = null;

// ---------- Estilos de parroquia ----------
function parroquiaBaseStyle(feature) {
  return {
    color: municipioColors[feature.properties.Municipio] || '#666',
    weight: 1,
    fillOpacity: 0.08,
    dashArray: '3,3'
  };
}
const PARROQUIA_HIGHLIGHT_STYLE = { color: '#ffdd00', weight: 4, fillOpacity: 0.4, dashArray: null };
const PARROQUIA_HOVER_STYLE = { weight: 2.5, fillOpacity: 0.2 };

// ---------- Cargar Municipios ----------
fetch('data/municipios.geojson')
  .then(r => r.json())
  .then(data => {
    const nombres = [...new Set(data.features.map(f => f.properties.Municipio))].sort();
    nombres.forEach((nombre, i) => { municipioColors[nombre] = colorForIndex(i, nombres.length); });

    municipiosLayer = L.geoJSON(data, {
      style: f => ({
        color: '#111', weight: 1,
        fillColor: municipioColors[f.properties.Municipio] || '#999',
        fillOpacity: 0.35
      }),
      onEachFeature: (f, layer) => {
        layer.bindPopup(`<div class="custom-popup"><div class="popup-header"><strong>${f.properties.Municipio}</strong></div>${f.properties.Ciudad ? `<p class="popup-desc">${f.properties.Ciudad}</p>` : ''}</div>`);
      }
    }).addTo(map);

    buildMunicipioFilterList(nombres);
  });

// ---------- Cargar Parroquias ----------
fetch('data/parroquias.geojson')
  .then(r => r.json())
  .then(data => {
    allParroquiaFeatures = data.features;

    parroquiasLayer = L.geoJSON(data, {
      style: parroquiaBaseStyle,
      onEachFeature: (f, layer) => {
        layer.bindPopup(`<div class="custom-popup"><div class="popup-header"><strong>${f.properties.Parroquia}</strong></div><p class="popup-desc">Municipio: ${f.properties.Municipio}</p></div>`);

        // Una parroquia oculta por el filtro no debe reaccionar a click/hover del mouse
        // (si no, "aparece" en pantalla aunque el filtro diga que no debería mostrarse)
        const isVisible = () => activeMunicipios.size === 0 || activeMunicipios.has(f.properties.Municipio);

        layer.on('click', () => { if (isVisible()) selectParroquia(f.properties.Parroquia_pcode); });
        layer.on('mouseover', () => { if (isVisible() && layer !== selectedLayer) layer.setStyle(PARROQUIA_HOVER_STYLE); });
        layer.on('mouseout', () => { if (isVisible() && layer !== selectedLayer) layer.setStyle(parroquiaBaseStyle(f)); });
      }
    }).addTo(map);

    applyFilter();
  });

// ---------- Cargar Marcadores (opcional — exportado desde geojson.io) ----------
markersLayer = L.markerClusterGroup({ chunkedLoading: true });
map.addLayer(markersLayer);

fetch('data/marcadores.geojson')
  .then(r => {
    if (!r.ok) throw new Error('sin marcadores todavía');
    return r.json();
  })
  .then(data => {
    const reservedKeys = ['name', 'nombre', 'tipo', 'icon', 'description'];

    // Precargar cada imagen de ícono UNA sola vez (aunque se repita en muchos marcadores)
    // para que el navegador ya la tenga en caché antes de que empieces a mover/clusterizar el mapa.
    const iconUrls = [...new Set(data.features.map(f => f.properties.icon || 'icons/default.png'))];
    iconUrls.forEach(url => { const img = new Image(); img.src = url; });

    data.features.forEach(f => {
      const props = f.properties || {};
      const tipo = props.tipo || 'Sin tipo';
      const iconUrl = props.icon || 'icons/default.png';
      const coords = f.geometry.coordinates;
      const latlng = [coords[1], coords[0]];

      const marker = L.marker(latlng, { icon: buildIcon(iconUrl, currentMarkerSize) });
      marker.bindPopup(buildMarkerPopup(props, tipo, reservedKeys));

      allMarkers.push({ marker, tipo, iconUrl });
    });

    console.log(`marcadores.geojson cargado: ${allMarkers.length} marcador(es), tipos: ${[...new Set(allMarkers.map(m => m.tipo))].join(', ')}`);
    buildTipoFilterList();
    applyMarkerFilter();
  })
  .catch(err => {
    console.error('No se pudo cargar data/marcadores.geojson — revisa que el archivo exista y que su JSON sea válido:', err);
    document.getElementById('tipoFilters').innerHTML = '<p class="muted">Sin marcadores todavía.</p>';
  });

function buildIcon(iconUrl, size) {
  return L.icon({
    iconUrl: iconUrl,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size]
  });
}

// Popup estilizado y extensible: cualquier propiedad nueva que agregues en geojson.io
// (fuera de name/tipo/icon/description) aparece automáticamente aquí, sin tocar código.
function buildMarkerPopup(props, tipo, reservedKeys) {
  const nombre = props.name || props.nombre || 'Marcador';
  const extra = Object.entries(props).filter(([k]) => !reservedKeys.includes(k));

  const extraHtml = extra.length
    ? `<div class="popup-extra">${extra.map(([k, v]) => `<div class="popup-row"><span class="popup-label">${k}</span><span class="popup-value">${v}</span></div>`).join('')}</div>`
    : '';

  return `
    <div class="custom-popup">
      <div class="popup-header">
        <span class="popup-dot" style="background:${colorForText(tipo)}"></span>
        <strong>${nombre}</strong>
      </div>
      ${props.description ? `<p class="popup-desc">${props.description}</p>` : ''}
      ${extraHtml}
    </div>`;
}

// ---------- 1) Slider de tamaño de marcador ----------
const sizeSlider = document.getElementById('markerSize');
const sizeLabel = document.getElementById('markerSizeLabel');
sizeSlider.value = currentMarkerSize;
sizeLabel.textContent = currentMarkerSize + 'px';

sizeSlider.addEventListener('input', () => {
  currentMarkerSize = parseInt(sizeSlider.value, 10);
  sizeLabel.textContent = currentMarkerSize + 'px';
  localStorage.setItem('markerSize', currentMarkerSize);
  allMarkers.forEach(({ marker, iconUrl }) => marker.setIcon(buildIcon(iconUrl, currentMarkerSize)));
});

// ---------- 2) Selección / resaltado de parroquia (respeta el filtro activo) ----------
function selectParroquia(pcode) {
  const feature = allParroquiaFeatures.find(f => f.properties.Parroquia_pcode === pcode);
  if (!feature) return;
  const municipio = feature.properties.Municipio;

  // Si la parroquia pertenece a un municipio oculto por el filtro, actívalo primero
  // (así lo que seleccionas siempre queda visible, sin "aparecer" contradiciendo el filtro)
  if (activeMunicipios.size > 0 && !activeMunicipios.has(municipio)) {
    activeMunicipios.add(municipio);
    const cb = [...document.querySelectorAll('#municipioFilters input')].find(i => i.dataset.municipio === municipio);
    if (cb) cb.checked = true;
    applyFilter();
  }

  if (selectedLayer) selectedLayer.setStyle(parroquiaBaseStyle(selectedLayer.feature));
  const layer = findParroquiaLayer(pcode);
  if (!layer) return;
  layer.setStyle(PARROQUIA_HIGHLIGHT_STYLE);
  layer.bringToFront();
  selectedLayer = layer;
  map.fitBounds(layer.getBounds(), { maxZoom: 12 });
  layer.openPopup();
}

function findParroquiaLayer(pcode) {
  let found = null;
  parroquiasLayer.eachLayer(layer => {
    if (layer.feature.properties.Parroquia_pcode === pcode) found = layer;
  });
  return found;
}

function clearSelection() {
  if (selectedLayer) {
    selectedLayer.setStyle(parroquiaBaseStyle(selectedLayer.feature));
    map.closePopup();
    selectedLayer = null;
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') clearSelection(); });

// ---------- 3) Filtro por tipo de marcador (auto-generado desde los datos) ----------
function buildTipoFilterList() {
  const tipos = [...new Set(allMarkers.map(m => m.tipo))].sort();
  const container = document.getElementById('tipoFilters');
  container.innerHTML = '';
  if (tipos.length === 0) {
    container.innerHTML = '<p class="muted">Sin marcadores todavía.</p>';
    return;
  }
  tipos.forEach(tipo => {
    const label = document.createElement('label');
    label.innerHTML = `
      <input type="checkbox" data-tipo="${tipo}">
      <span class="swatch" style="background:${colorForText(tipo)}"></span>
      ${tipo}`;
    container.appendChild(label);
  });
  container.addEventListener('change', e => {
    if (e.target.matches('input[type=checkbox]')) {
      const t = e.target.dataset.tipo;
      e.target.checked ? activeTipos.add(t) : activeTipos.delete(t);
      applyMarkerFilter();
    }
  });
}

document.getElementById('clearTipoFilter').addEventListener('click', () => {
  activeTipos.clear();
  document.querySelectorAll('#tipoFilters input').forEach(cb => cb.checked = false);
  applyMarkerFilter();
});

function applyMarkerFilter() {
  const showAll = activeTipos.size === 0;
  allMarkers.forEach(({ marker, tipo }) => {
    const shouldShow = showAll || activeTipos.has(tipo);
    const isShown = markersLayer.hasLayer(marker);
    if (shouldShow && !isShown) markersLayer.addLayer(marker);
    if (!shouldShow && isShown) markersLayer.removeLayer(marker);
  });
  updateInfoPanel();
}

// ---------- Filtro por municipio ----------
function buildMunicipioFilterList(nombres) {
  const container = document.getElementById('municipioFilters');
  container.innerHTML = '';
  nombres.forEach(nombre => {
    const label = document.createElement('label');
    label.innerHTML = `
      <input type="checkbox" data-municipio="${nombre}">
      <span class="swatch" style="background:${municipioColors[nombre]}"></span>
      ${nombre}`;
    container.appendChild(label);
  });
  container.addEventListener('change', e => {
    if (e.target.matches('input[type=checkbox]')) {
      const m = e.target.dataset.municipio;
      e.target.checked ? activeMunicipios.add(m) : activeMunicipios.delete(m);
      applyFilter();
    }
  });
}

document.getElementById('clearFilter').addEventListener('click', () => {
  activeMunicipios.clear();
  document.querySelectorAll('#municipioFilters input').forEach(cb => cb.checked = false);
  applyFilter();
});

function applyFilter() {
  if (!municipiosLayer || !parroquiasLayer) return;
  const showAll = activeMunicipios.size === 0;

  municipiosLayer.eachLayer(layer => {
    const match = showAll || activeMunicipios.has(layer.feature.properties.Municipio);
    layer.setStyle({ opacity: match ? 1 : 0, fillOpacity: match ? 0.35 : 0 });
  });

  parroquiasLayer.eachLayer(layer => {
    const match = showAll || activeMunicipios.has(layer.feature.properties.Municipio);
    const base = parroquiaBaseStyle(layer.feature);
    if (layer === selectedLayer) return; // no pisar el resaltado activo
    layer.setStyle({ ...base, opacity: match ? 1 : 0, fillOpacity: match ? base.fillOpacity : 0 });
  });

  updateParroquiaListPanel(showAll);
  updateInfoPanel();
}

function updateParroquiaListPanel(showAll) {
  const container = document.getElementById('parroquiaListPanel');
  container.innerHTML = '';
  if (showAll) {
    container.innerHTML = '<p class="muted">Selecciona un municipio para ver sus parroquias aquí.</p>';
    return;
  }
  const filtradas = allParroquiaFeatures
    .filter(f => activeMunicipios.has(f.properties.Municipio))
    .sort((a, b) => a.properties.Parroquia.localeCompare(b.properties.Parroquia));

  filtradas.forEach(f => {
    const div = document.createElement('div');
    div.className = 'parroquia-item';
    div.textContent = f.properties.Parroquia;
    div.addEventListener('click', () => selectParroquia(f.properties.Parroquia_pcode));
    container.appendChild(div);
  });
}

function updateInfoPanel() {
  const totalParroquias = activeMunicipios.size === 0
    ? allParroquiaFeatures.length
    : allParroquiaFeatures.filter(f => activeMunicipios.has(f.properties.Municipio)).length;
  const totalMarkers = activeTipos.size === 0
    ? allMarkers.length
    : allMarkers.filter(m => activeTipos.has(m.tipo)).length;

  document.getElementById('info').innerHTML =
    `${totalParroquias} parroquia(s) visibles · ${totalMarkers} marcador(es) visibles`;
}

// ---------- Capas on/off ----------
document.getElementById('toggleMunicipios').addEventListener('change', e => {
  e.target.checked ? map.addLayer(municipiosLayer) : map.removeLayer(municipiosLayer);
});
document.getElementById('toggleParroquias').addEventListener('change', e => {
  e.target.checked ? map.addLayer(parroquiasLayer) : map.removeLayer(parroquiasLayer);
});
document.getElementById('toggleMarkers').addEventListener('change', e => {
  e.target.checked ? map.addLayer(markersLayer) : map.removeLayer(markersLayer);
});

// ---------- Búsqueda de parroquias por nombre (con debounce) ----------
const searchBox = document.getElementById('searchBox');
const searchResults = document.getElementById('searchResults');
let searchTimeout;

searchBox.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(runSearch, 200);
});

function runSearch() {
  const q = searchBox.value.trim().toLowerCase();
  searchResults.innerHTML = '';
  if (q.length < 2) return;

  const matches = allParroquiaFeatures
    .filter(f => f.properties.Parroquia.toLowerCase().includes(q))
    .slice(0, 15);

  matches.forEach(f => {
    const div = document.createElement('div');
    div.textContent = `${f.properties.Parroquia} — ${f.properties.Municipio}`;
    div.addEventListener('click', () => {
      selectParroquia(f.properties.Parroquia_pcode);
      searchResults.innerHTML = '';
      searchBox.value = f.properties.Parroquia;
    });
    searchResults.appendChild(div);
  });
}

document.addEventListener('click', e => {
  if (!e.target.closest('#searchBox') && !e.target.closest('#searchResults')) searchResults.innerHTML = '';
});

map.on('click', () => updateInfoPanel());