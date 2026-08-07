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

const map = L.map("map", { zoomControl: false }).setView(CENTER, ZOOM);
L.control.zoom({ position: "bottomright" }).addTo(map);

// ---------- Mapas base (calles / satélite) ----------
const baseStreets = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  },
);
const baseSatellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: "Tiles &copy; Esri",
    maxZoom: 19,
  },
);
baseStreets.addTo(map);
L.control
  .layers({ Calles: baseStreets, Satélite: baseSatellite }, null, {
    position: "topright",
  })
  .addTo(map);

// Botón para recentrar el mapa
const ResetControl = L.Control.extend({
  options: { position: "topright" },
  onAdd: function () {
    const btn = L.DomUtil.create("button", "reset-view-btn");
    btn.innerHTML = "⤢";
    btn.title = "Centrar mapa";
    L.DomEvent.on(btn, "click", L.DomEvent.stop).on(btn, "click", () =>
      map.setView(CENTER, ZOOM),
    );
    return btn;
  },
});
map.addControl(new ResetControl());

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

let municipioColors = {};
let municipiosLayer, parroquiasLayer, markersLayer;
let activeMunicipios = new Set(); // vacío = mostrar todos
let activeTipos = new Set(); // vacío = mostrar todos
let allParroquiaFeatures = [];
let allMarkers = []; // [{ marker, tipo, iconUrl }]
let selectedLayer = null;

// ---------- Estilos de parroquia ----------
function parroquiaBaseStyle(feature) {
  return {
    color: municipioColors[feature.properties.Municipio] || "#666",
    weight: 1,
    fillOpacity: 0.08,
    dashArray: "3,3",
  };
}
const PARROQUIA_HIGHLIGHT_STYLE = {
  color: "#ffdd00",
  weight: 4,
  fillOpacity: 0.4,
  dashArray: null,
};
const PARROQUIA_HOVER_STYLE = { weight: 2.5, fillOpacity: 0.2 };

// ---------- Cargar Municipios ----------
fetch("data/municipios.geojson")
  .then((r) => r.json())
  .then((data) => {
    const nombres = [
      ...new Set(data.features.map((f) => f.properties.Municipio)),
    ].sort();
    nombres.forEach((nombre, i) => {
      municipioColors[nombre] = colorForIndex(i, nombres.length);
    });

    municipiosLayer = L.geoJSON(data, {
      style: (f) => ({
        color: "#111",
        weight: 1,
        fillColor: municipioColors[f.properties.Municipio] || "#999",
        fillOpacity: 0.35,
      }),
      onEachFeature: (f, layer) => {
        const color = municipioColors[f.properties.Municipio] || "#3d7dff";
        layer.bindPopup(
          `<div class="popup-card" style="--card-color:${color}">
            <div class="popup-card__accent"></div>
            <div class="popup-card__header">
              <span class="popup-badge">${PIN_ICON_SVG}</span>
              <div class="popup-card__title">
                <strong>${f.properties.Municipio}</strong>
                <span class="popup-card__type">Municipio</span>
              </div>
            </div>
            <div class="popup-card__body">
              ${f.properties.Ciudad ? `<p class="popup-desc">${f.properties.Ciudad}</p>` : ""}
            </div>
          </div>`,
        );
      },
    }).addTo(map);

    buildMunicipioFilterList(nombres);
  });

// ---------- Cargar Parroquias ----------
fetch("data/parroquias.geojson")
  .then((r) => r.json())
  .then((data) => {
    allParroquiaFeatures = data.features;

    parroquiasLayer = L.geoJSON(data, {
      style: parroquiaBaseStyle,
      onEachFeature: (f, layer) => {
        const color = municipioColors[f.properties.Municipio] || "#3d7dff";
        layer.bindPopup(
          `<div class="popup-card" style="--card-color:${color}">
            <div class="popup-card__accent"></div>
            <div class="popup-card__header">
              <span class="popup-badge">${PIN_ICON_SVG}</span>
              <div class="popup-card__title">
                <strong>${f.properties.Parroquia}</strong>
                <span class="popup-card__type">${f.properties.Municipio}</span>
              </div>
            </div>
          </div>`,
        );

        // Una parroquia oculta por el filtro no debe reaccionar a click/hover del mouse
        // (si no, "aparece" en pantalla aunque el filtro diga que no debería mostrarse)
        const isVisible = () =>
          activeMunicipios.size === 0 ||
          activeMunicipios.has(f.properties.Municipio);

        layer.on("click", () => {
          if (isVisible()) selectParroquia(f.properties.Parroquia_pcode);
        });
        layer.on("mouseover", () => {
          if (isVisible() && layer !== selectedLayer)
            layer.setStyle(PARROQUIA_HOVER_STYLE);
        });
        layer.on("mouseout", () => {
          if (isVisible() && layer !== selectedLayer)
            layer.setStyle(parroquiaBaseStyle(f));
        });
      },
    }).addTo(map);

    applyFilter();
  });

// ---------- Cargar Marcadores (opcional — exportado desde geojson.io) ----------
function createMarkersLayer() {
  return clusteringEnabled ? L.markerClusterGroup() : L.layerGroup();
}

markersLayer = createMarkersLayer();
map.addLayer(markersLayer);

// Reconstruye el grupo de marcadores al alternar el clustering, preservando
// el filtro por tipo activo en ese momento.
function rebuildMarkersLayer() {
  map.removeLayer(markersLayer);
  markersLayer = createMarkersLayer();
  map.addLayer(markersLayer);
  applyMarkerFilter();
}

fetch("data/marcadores.geojson")
  .then((r) => {
    if (!r.ok) throw new Error("sin marcadores todavía");
    return r.json();
  })
  .then((data) => {
    const reservedKeys = ["name", "nombre", "tipo", "icon", "description"];

    data.features.forEach((f) => {
      const props = f.properties || {};
      const tipo = props.tipo || "Sin tipo";
      const iconUrl = props.icon || "icons/default.png";
      const coords = f.geometry.coordinates;
      const latlng = [coords[1], coords[0]];

      const marker = L.marker(latlng, {
        icon: buildIcon(iconUrl, currentMarkerSize),
      });
      marker.bindPopup(buildMarkerPopup(props, tipo, reservedKeys));

      allMarkers.push({ marker, tipo, iconUrl });
    });

    console.log(
      `marcadores.geojson cargado: ${allMarkers.length} marcador(es), tipos: ${[...new Set(allMarkers.map((m) => m.tipo))].join(", ")}`,
    );
    buildTipoFilterList();
    applyMarkerFilter();
  })
  .catch((err) => {
    console.error(
      "No se pudo cargar data/marcadores.geojson — revisa que el archivo exista y que su JSON sea válido:",
      err,
    );
    document.getElementById("tipoFilters").innerHTML =
      '<p class="muted">Sin marcadores todavía.</p>';
  });

function buildIcon(iconUrl, size) {
  return L.icon({
    iconUrl: iconUrl,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

// Popup estilizado y extensible: cualquier propiedad nueva que agregues en geojson.io
// (fuera de name/tipo/icon/description) aparece automáticamente aquí, sin tocar código.
function buildMarkerPopup(props, tipo, reservedKeys) {
  const nombre = props.name || props.nombre || "Marcador";
  const color = colorForText(tipo);
  const extra = Object.entries(props).filter(
    ([k]) => !reservedKeys.includes(k),
  );

  const extraHtml = extra.length
    ? `<div class="popup-extra">${extra.map(([k, v]) => `<div class="popup-row"><span class="popup-label">${k}</span><span class="popup-value">${v}</span></div>`).join("")}</div>`
    : "";

  return `
    <div class="popup-card" style="--card-color:${color}">
      <div class="popup-card__accent"></div>
      <div class="popup-card__header">
        <span class="popup-badge">${SHIELD_ICON_SVG}</span>
        <div class="popup-card__title">
          <strong>${nombre}</strong>
          <span class="popup-card__type">${tipo}</span>
        </div>
      </div>
      <div class="popup-card__body">
        ${props.description ? `<p class="popup-desc">${props.description}</p>` : ""}
        ${extraHtml}
      </div>
    </div>`;
}

// ---------- 1) Slider de tamaño de marcador ----------
const sizeSlider = document.getElementById("markerSize");
const sizeLabel = document.getElementById("markerSizeLabel");
sizeSlider.value = currentMarkerSize;
sizeLabel.textContent = currentMarkerSize + "px";

sizeSlider.addEventListener("input", () => {
  currentMarkerSize = parseInt(sizeSlider.value, 10);
  sizeLabel.textContent = currentMarkerSize + "px";
  localStorage.setItem("markerSize", currentMarkerSize);
  allMarkers.forEach(({ marker, iconUrl }) =>
    marker.setIcon(buildIcon(iconUrl, currentMarkerSize)),
  );
});

// ---------- 2) Selección / resaltado de parroquia (respeta el filtro activo) ----------
function selectParroquia(pcode) {
  const feature = allParroquiaFeatures.find(
    (f) => f.properties.Parroquia_pcode === pcode,
  );
  if (!feature) return;
  const municipio = feature.properties.Municipio;

  // Si la parroquia pertenece a un municipio oculto por el filtro, actívalo primero
  // (así lo que seleccionas siempre queda visible, sin "aparecer" contradiciendo el filtro)
  if (activeMunicipios.size > 0 && !activeMunicipios.has(municipio)) {
    activeMunicipios.add(municipio);
    const cb = [...document.querySelectorAll("#municipioFilters input")].find(
      (i) => i.dataset.municipio === municipio,
    );
    if (cb) cb.checked = true;
    applyFilter();
  }

  if (selectedLayer)
    selectedLayer.setStyle(parroquiaBaseStyle(selectedLayer.feature));
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
  parroquiasLayer.eachLayer((layer) => {
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
// ---------- 3) Filtro por tipo de marcador (auto-generado desde los datos) ----------
function buildTipoFilterList() {
  const tipos = [...new Set(allMarkers.map((m) => m.tipo))].sort();
  const container = document.getElementById("tipoFilters");
  container.innerHTML = "";
  if (tipos.length === 0) {
    container.innerHTML = '<p class="muted">Sin marcadores todavía.</p>';
    return;
  }
  tipos.forEach((tipo) => {
    const label = document.createElement("label");
    label.innerHTML = `
      <input type="checkbox" data-tipo="${tipo}">
      <span class="swatch" style="background:${colorForText(tipo)}"></span>
      ${tipo}`;
    container.appendChild(label);
  });
  container.addEventListener("change", (e) => {
    if (e.target.matches("input[type=checkbox]")) {
      const t = e.target.dataset.tipo;
      e.target.checked ? activeTipos.add(t) : activeTipos.delete(t);
      applyMarkerFilter();
    }
  });
}

document.getElementById("clearTipoFilter").addEventListener("click", () => {
  activeTipos.clear();
  document
    .querySelectorAll("#tipoFilters input")
    .forEach((cb) => (cb.checked = false));
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
  const container = document.getElementById("municipioFilters");
  container.innerHTML = "";
  nombres.forEach((nombre) => {
    const label = document.createElement("label");
    label.innerHTML = `
      <input type="checkbox" data-municipio="${nombre}">
      <span class="swatch" style="background:${municipioColors[nombre]}"></span>
      ${nombre}`;
    container.appendChild(label);
  });
  container.addEventListener("change", (e) => {
    if (e.target.matches("input[type=checkbox]")) {
      const m = e.target.dataset.municipio;
      e.target.checked ? activeMunicipios.add(m) : activeMunicipios.delete(m);
      applyFilter();
    }
  });
}

document.getElementById("clearFilter").addEventListener("click", () => {
  activeMunicipios.clear();
  document
    .querySelectorAll("#municipioFilters input")
    .forEach((cb) => (cb.checked = false));
  applyFilter();
});

function applyFilter() {
  if (!municipiosLayer || !parroquiasLayer) return;
  const showAll = activeMunicipios.size === 0;

  municipiosLayer.eachLayer((layer) => {
    const match =
      showAll || activeMunicipios.has(layer.feature.properties.Municipio);
    layer.setStyle({ opacity: match ? 1 : 0, fillOpacity: match ? 0.35 : 0 });
  });

  parroquiasLayer.eachLayer((layer) => {
    const match =
      showAll || activeMunicipios.has(layer.feature.properties.Municipio);
    const base = parroquiaBaseStyle(layer.feature);
    if (layer === selectedLayer) return; // no pisar el resaltado activo
    layer.setStyle({
      ...base,
      opacity: match ? 1 : 0,
      fillOpacity: match ? base.fillOpacity : 0,
    });
  });

  updateParroquiaListPanel(showAll);
  updateInfoPanel();
}

function updateParroquiaListPanel(showAll) {
  const container = document.getElementById("parroquiaListPanel");
  container.innerHTML = "";
  if (showAll) {
    container.innerHTML =
      '<p class="muted">Selecciona un municipio para ver sus parroquias aquí.</p>';
    return;
  }
  const filtradas = allParroquiaFeatures
    .filter((f) => activeMunicipios.has(f.properties.Municipio))
    .sort((a, b) =>
      a.properties.Parroquia.localeCompare(b.properties.Parroquia),
    );

  filtradas.forEach((f) => {
    const div = document.createElement("div");
    div.className = "parroquia-item";
    div.textContent = f.properties.Parroquia;
    div.addEventListener("click", () =>
      selectParroquia(f.properties.Parroquia_pcode),
    );
    container.appendChild(div);
  });
}

function updateInfoPanel() {
  const totalParroquias =
    activeMunicipios.size === 0
      ? allParroquiaFeatures.length
      : allParroquiaFeatures.filter((f) =>
          activeMunicipios.has(f.properties.Municipio),
        ).length;
  const totalMarkers =
    activeTipos.size === 0
      ? allMarkers.length
      : allMarkers.filter((m) => activeTipos.has(m.tipo)).length;

  document.getElementById("info").innerHTML =
    `${totalParroquias} parroquia(s) visibles · ${totalMarkers} marcador(es) visibles`;
}

// ---------- Capas on/off ----------
document.getElementById("toggleMunicipios").addEventListener("change", (e) => {
  e.target.checked
    ? map.addLayer(municipiosLayer)
    : map.removeLayer(municipiosLayer);
});
document.getElementById("toggleParroquias").addEventListener("change", (e) => {
  e.target.checked
    ? map.addLayer(parroquiasLayer)
    : map.removeLayer(parroquiasLayer);
});
document.getElementById("toggleMarkers").addEventListener("change", (e) => {
  e.target.checked ? map.addLayer(markersLayer) : map.removeLayer(markersLayer);
});

// ---------- Búsqueda de parroquias por nombre (con debounce) ----------
const searchBox = document.getElementById("searchBox");
const searchResults = document.getElementById("searchResults");
let searchTimeout;

searchBox.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(runSearch, 200);
});

function runSearch() {
  const q = searchBox.value.trim().toLowerCase();
  searchResults.innerHTML = "";
  if (q.length < 2) return;

  const matches = allParroquiaFeatures
    .filter((f) => f.properties.Parroquia.toLowerCase().includes(q))
    .slice(0, 15);

  matches.forEach((f) => {
    const div = document.createElement("div");
    div.textContent = `${f.properties.Parroquia} — ${f.properties.Municipio}`;
    div.addEventListener("click", () => {
      selectParroquia(f.properties.Parroquia_pcode);
      searchResults.innerHTML = "";
      searchBox.value = f.properties.Parroquia;
    });
    searchResults.appendChild(div);
  });
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#searchBox") && !e.target.closest("#searchResults"))
    searchResults.innerHTML = "";
});

map.on("click", () => updateInfoPanel());

// ---------- 4) Panel de Ajustes (drawer) ----------
const settingsBtn = document.getElementById("settingsBtn");
const settingsDrawer = document.getElementById("settingsDrawer");
const settingsOverlay = document.getElementById("settingsOverlay");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");

function openSettings() {
  settingsDrawer.classList.add("open");
  settingsOverlay.classList.add("open");
  settingsDrawer.setAttribute("aria-hidden", "false");
}
function closeSettings() {
  settingsDrawer.classList.remove("open");
  settingsOverlay.classList.remove("open");
  settingsDrawer.setAttribute("aria-hidden", "true");
}

settingsBtn.addEventListener("click", openSettings);
settingsCloseBtn.addEventListener("click", closeSettings);
settingsOverlay.addEventListener("click", closeSettings);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (settingsDrawer.classList.contains("open")) closeSettings();
    else clearSelection();
  }
});

// ---------- 5) Toggle de clustering de marcadores ----------
const clusteringToggle = document.getElementById("toggleClustering");
clusteringToggle.checked = clusteringEnabled;
clusteringToggle.addEventListener("change", (e) => {
  clusteringEnabled = e.target.checked;
  localStorage.setItem("clustering", clusteringEnabled);
  rebuildMarkersLayer();
});

// ---------- 6) Modo claro / oscuro ----------
const lightModeToggle = document.getElementById("toggleLightMode");
let currentTheme = localStorage.getItem("theme") || "dark";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  lightModeToggle.checked = theme === "light";
}
applyTheme(currentTheme);

lightModeToggle.addEventListener("change", (e) => {
  currentTheme = e.target.checked ? "light" : "dark";
  localStorage.setItem("theme", currentTheme);
  applyTheme(currentTheme);
});

// ---------- 7) Colapsar / mostrar el panel lateral ----------
const sidebarCollapseBtn = document.getElementById("sidebarCollapseBtn");
const sidebarReopenBtn = document.getElementById("sidebarReopenBtn");
let sidebarCollapsed = localStorage.getItem("sidebarCollapsed") === "true";

function applySidebarState() {
  document.body.classList.toggle("sidebar-collapsed", sidebarCollapsed);
}
applySidebarState();

function setSidebarCollapsed(collapsed) {
  sidebarCollapsed = collapsed;
  localStorage.setItem("sidebarCollapsed", sidebarCollapsed);
  applySidebarState();
  // El mapa cambia de tamaño con la transición del panel; recalcular
  // sus tiles cuando termina para evitar huecos grises.
  setTimeout(() => map.invalidateSize(), 260);
}

sidebarCollapseBtn.addEventListener("click", () => setSidebarCollapsed(true));
sidebarReopenBtn.addEventListener("click", () => setSidebarCollapsed(false));
