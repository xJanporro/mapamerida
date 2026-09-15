// =========================================================
// map.js — Inicialización del mapa, capas, panel de detalle
// =========================================================

const map = L.map("map", { zoomControl: false }).setView(CENTER, ZOOM);
L.control.zoom({ position: "bottomright" }).addTo(map);

// Panes con z-index explícito para municipios y parroquias. Sin esto, el orden
// visual dependía de cuál fetch (municipios.geojson o parroquias.geojson)
// terminara de cargar primero. Con panes fijos, parroquias siempre se dibuja
// por encima de municipios, sin importar el orden de llegada.
map.createPane("municipiosPane");
map.getPane("municipiosPane").style.zIndex = 410;
map.createPane("parroquiasPane");
map.getPane("parroquiasPane").style.zIndex = 420; // siempre encima de municipiosPane

// Renderers canvas: se crean en ui.js al montar cada capa de polígonos.
// Dibujan los 80+ parroquias y 20+ municipios mucho más rápido que el SVG
// por defecto (menos DOM, redibujado más barato).

// ---------- Mapas base (calles / satélite) ----------
const baseStreets = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  },
);
const baseSatellite = L.tileLayer(
  "http://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
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

// ---------- Coordenadas del cursor ----------
const CoordinatesControl = L.Control.extend({
  options: { position: "bottomleft" },
  onAdd: function () {
    const el = L.DomUtil.create("div", "coords-control");
    el.textContent = "—";
    map.on("mousemove", (e) => {
      el.textContent = `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
    });
    map.on("mouseout", () => {
      el.textContent = "—";
    });
    return el;
  },
});
map.addControl(new CoordinatesControl());

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

// ---------- Capa de marcadores (clúster) ----------
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

// ---------- Panel de detalle (una sola vez) ----------
document.body.insertAdjacentHTML(
  "beforeend",
  `<aside id="detailPanel" aria-hidden="true">
     <div class="detail-panel__toolbar">
       <button id="detailPanelCenterBtn" class="icon-btn" title="Centrar en el mapa">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
           <circle cx="12" cy="12" r="3"/>
           <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke-linecap="round"/>
         </svg>
       </button>
       <button id="detailPanelCloseBtn" class="icon-btn" title="Cerrar">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/>
         </svg>
       </button>
     </div>
     <div id="detailPanelBody" class="detail-panel__body"></div>
   </aside>`,
);

const detailPanel = document.getElementById("detailPanel");
const detailPanelBody = document.getElementById("detailPanelBody");
const detailPanelCloseBtn = document.getElementById("detailPanelCloseBtn");
const detailPanelCenterBtn = document.getElementById("detailPanelCenterBtn");
let currentDetailMarker = null;

// Claves que NO se muestran como fila "extra" (ya tienen su lugar en la tarjeta)
const RESERVED_KEYS = ["name", "nombre", "tipo", "icon", "description", "tabla", "tablaHeaders"];
const POPUP_COLOR_KEYS = ["color", "institucion_color", "color_institucion"];
const POPUP_LOGO_KEYS = ["institucion_logo", "logo_institucion", "logo"];

function pickProp(props, keys) {
  for (const k of keys) if (hasValue(props[k])) return props[k];
  return null;
}

// Construye la tarjeta HTML del panel de detalle y del popup de marcador.
function buildEntityCardHtml(props, tipo) {
  const nombre = escapeHtml(props.name || props.nombre || "Marcador");
  const logoUrl = pickProp(props, POPUP_LOGO_KEYS)
    ? escapeHtml(pickProp(props, POPUP_LOGO_KEYS))
    : "";
  const color = escapeHtml(
    pickProp(props, POPUP_COLOR_KEYS) || colorForText(tipo),
  );

  // Filas extra (propiedades que no son reservadas y tienen valor)
  const extra = Object.entries(props).filter(
    ([k, v]) => !RESERVED_KEYS.includes(k) && !POPUP_COLOR_KEYS.includes(k) && !POPUP_LOGO_KEYS.includes(k) && hasValue(v),
  );
  const extraHtml = extra.length
    ? `<div class="popup-extra">${extra
        .map(
          ([k, v]) =>
            `<div class="popup-row"><span class="popup-label">${escapeHtml(prettifyLabel(k))}</span><span class="popup-value">${escapeHtml(v)}</span></div>`,
        )
        .join("")}</div>`
    : "";

  // Renderizar tabla si existe
  let tableHtml = "";
  if (props.tabla && Array.isArray(props.tabla) && props.tabla.length > 0) {
    const headers = props.tablaHeaders || Object.keys(props.tabla[0]);
    tableHtml = `
      <div class="detail-table-wrap">
        <table class="detail-table">
          <thead>
            <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${props.tabla
              .map(
                (row) =>
                  `<tr>${headers.map((h) => `<td>${row[h] !== undefined && row[h] !== null ? escapeHtml(row[h]) : ""}</td>`).join("")}</tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
  }

  const hasTable = tableHtml !== "";
  const badgeContent = logoUrl
    ? `<img src="${logoUrl}" alt="" class="popup-badge__img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="popup-badge__fallback">${SHIELD_ICON_SVG}</span>`
    : SHIELD_ICON_SVG;

  return `<div class="popup-card${hasTable ? " popup-card--has-table" : ""}" style="--card-color:${color}">
    <div class="popup-card__accent"></div>
    <div class="popup-card__header">
      <span class="popup-badge${logoUrl ? " popup-badge--logo" : ""}">${badgeContent}</span>
      <div class="popup-card__title">
        <strong>${nombre}</strong>
        <span class="popup-card__type">${escapeHtml(tipo)}</span>
      </div>
    </div>
    <div class="popup-card__body">
      ${hasValue(props.description) ? `<p class="popup-desc">${escapeHtml(props.description)}</p>` : ""}
      ${extraHtml}
      ${tableHtml}
    </div>
  </div>`;
}

function openDetailPanel(marker, props, tipo) {
  currentDetailMarker = marker;
  detailPanelBody.innerHTML = buildEntityCardHtml(props, tipo);

  const hasTable = props.tabla && Array.isArray(props.tabla) && props.tabla.length > 0;
  detailPanel.classList.toggle("detail-panel--has-table", hasTable);

  detailPanel.classList.add("open");
  detailPanel.setAttribute("aria-hidden", "false");
}

function closeDetailPanel() {
  if (!detailPanel.classList.contains("open")) return;
  detailPanel.classList.remove("open");
  detailPanel.setAttribute("aria-hidden", "true");
  currentDetailMarker = null;
}

detailPanelCloseBtn.addEventListener("click", closeDetailPanel);
detailPanelCenterBtn.addEventListener("click", () => {
  if (!currentDetailMarker) return;
  map.setView(currentDetailMarker.getLatLng(), Math.max(map.getZoom(), 14));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && detailPanel.classList.contains("open")) closeDetailPanel();
});

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

// ---------- Barra de estado (última actualización + resumen) ----------
function updateStatusBar(totalParroquias, totalMarkers) {
  const statusUpdated = document.getElementById("statusUpdated");
  const statusCounts = document.getElementById("statusCounts");
  const statusDot = document.querySelector("#statusBar .status-dot");

  if (lastUpdated) {
    statusUpdated.textContent = markersLoadFailed
      ? `Sin datos de marcadores (${timeAgo(lastUpdated)})`
      : `Actualizado ${timeAgo(lastUpdated)}`;
    statusUpdated.title = lastUpdated.toLocaleString("es-VE");
    statusDot.classList.toggle("stale", markersLoadFailed);
  } else {
    statusUpdated.textContent = "Cargando datos…";
  }

  if (totalParroquias === undefined || totalMarkers === undefined) return;
  statusCounts.textContent = `${totalParroquias} parroquia(s) · ${totalMarkers} marcador(es)`;
}
// Refresca el texto relativo ("hace X min") sin recalcular conteos
setInterval(() => updateStatusBar(), 20000);

// ---------- Carga (o recarga) del mapa de calor ----------
// Reemplaza el heatLayer actual en el mapa según el conjunto indicado.
function loadHeatmapDataset(id) {
  const dataset =
    HEATMAP_DATASETS.find((d) => d.id === id) || HEATMAP_DATASETS[0];
  if (!dataset) return;

  const wasOnMap = heatLayer && map.hasLayer(heatLayer);
  if (heatLayer) map.removeLayer(heatLayer);
  heatLayer = null;

  const countEl = document.getElementById("heatZoneCount");
  if (countEl) countEl.textContent = "Cargando…";

  fetchJSON(dataset.file)
    .then((data) => {
      riskZones = data.features || [];
      const points = riskZones.map((f) => {
        const [lng, lat] = f.geometry.coordinates;
        const intensidad =
          f.properties && typeof f.properties.intensidad === "number"
            ? f.properties.intensidad
            : 5;
        return [lat, lng, intensidad / 10];
      });
      heatLayer = L.heatLayer(points, heatOptionsForRadius(currentHeatRadius));
      if (countEl)
        countEl.textContent = `${riskZones.length} zona(s) registrada(s)`;
      if (wasOnMap || currentLayout === "heat") syncLayersForLayout();
    })
    .catch((err) => {
      console.error(
        `No se pudo cargar ${dataset.file} — aún no hay datos para "${dataset.label}":`,
        err,
      );
      riskZones = [];
      heatLayer = null;
      if (countEl)
        countEl.textContent = `Aún no se han definido zonas para "${dataset.label}".`;
      syncLayersForLayout();
    });
}