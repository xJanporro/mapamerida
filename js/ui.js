// =========================================================
// ui.js — Búsqueda, ajustes, estadísticas, layouts, URL state
// =========================================================

// ---------- Búsqueda de parroquias Y marcadores por nombre (con debounce) ----------
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

  const parrMatches = allParroquiaFeatures
    .filter((f) => f.properties.Parroquia.toLowerCase().includes(q))
    .slice(0, 8);
  const markerMatches = allMarkers
    .filter((m) => {
      const nombre = (m.props && (m.props.name || m.props.nombre)) || "";
      const tipo = m.tipo || "";
      return (
        nombre.toLowerCase().includes(q) || tipo.toLowerCase().includes(q)
      );
    })
    .slice(0, 8);

  if (parrMatches.length + markerMatches.length === 0) {
    const none = document.createElement("div");
    none.className = "search-none";
    none.textContent = "Sin resultados.";
    searchResults.appendChild(none);
    return;
  }

  parrMatches.forEach((f) => {
    const div = document.createElement("div");
    div.className = "search-result";
    div.innerHTML = `
      <span class="search-result__badge search-result__badge--parroquia">${PIN_ICON_SVG}</span>
      <span class="search-result__text">
        <strong>${escapeHtml(f.properties.Parroquia)}</strong>
        <small>${escapeHtml(f.properties.Municipio)}</small>
      </span>`;
    div.addEventListener("click", () => {
      selectParroquia(f.properties.Parroquia_pcode);
      searchResults.innerHTML = "";
      searchBox.value = f.properties.Parroquia;
    });
    searchResults.appendChild(div);
  });

  markerMatches.forEach((m) => {
    const nombre = (m.props && (m.props.name || m.props.nombre)) || "Marcador";
    const div = document.createElement("div");
    div.className = "search-result";
    div.innerHTML = `
      <span class="search-result__badge" style="background:${colorForText(m.tipo)}"></span>
      <span class="search-result__text">
        <strong>${escapeHtml(nombre)}</strong>
        <small>${escapeHtml(m.tipo)}</small>
      </span>`;
    div.addEventListener("click", () => {
      const ll = m.marker.getLatLng();
      map.setView(ll, Math.max(map.getZoom(), 14));
      openDetailPanel(m.marker, m.props || {}, m.tipo);
      searchResults.innerHTML = "";
      searchBox.value = nombre;
    });
    searchResults.appendChild(div);
  });
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#searchBox") && !e.target.closest("#searchResults"))
    searchResults.innerHTML = "";
});

map.on("click", () => {
  updateInfoPanel();
  closeDetailPanel();
});

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
  saveStateToUrl();
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

// ---------- 8) Panel de Estadísticas (bottom sheet) ----------
const statusBar = document.getElementById("statusBar");
const statsSheet = document.getElementById("statsSheet");
const statsOverlay = document.getElementById("statsOverlay");
const statsCloseBtn = document.getElementById("statsCloseBtn");
let statsOpen = false;

function openStats() {
  statsOpen = true;
  statsSheet.classList.add("open");
  statsOverlay.classList.add("open");
  statsSheet.setAttribute("aria-hidden", "false");
  renderStats();
}
function closeStats() {
  statsOpen = false;
  statsSheet.classList.remove("open");
  statsOverlay.classList.remove("open");
  statsSheet.setAttribute("aria-hidden", "true");
}

statusBar.addEventListener("click", openStats);
statsCloseBtn.addEventListener("click", closeStats);
statsOverlay.addEventListener("click", closeStats);

// Extiende Escape para cerrar también el panel de estadísticas
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && statsOpen) closeStats();
});

function buildStatRows(container, counts, colorFor) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    container.innerHTML = '<p class="stat-empty">Sin datos disponibles.</p>';
    return;
  }
  const max = entries[0][1];
  container.innerHTML = entries
    .map(([label, count]) => {
      const pct = Math.max(4, Math.round((count / max) * 100));
      const color = colorFor(label);
      return `
        <div class="stat-row">
          <div class="stat-row-top">
            <span class="stat-label">${escapeHtml(label)}</span>
            <span class="stat-value">${count}</span>
          </div>
          <div class="stat-bar"><div class="stat-bar-fill" style="width:${pct}%; background:${color}"></div></div>
        </div>`;
    })
    .join("");
}

function renderStats() {
  const showAllTipos = activeTipos.size === 0;
  const showAllMunicipios = activeMunicipios.size === 0;
  const visibleMarkers = allMarkers.filter(
    (m) => showAllTipos || activeTipos.has(m.tipo),
  );

  document.getElementById("statsMeta").textContent = lastUpdated
    ? `${visibleMarkers.length} de ${allMarkers.length} marcador(es) visibles · datos ${timeAgo(lastUpdated)}`
    : "Cargando datos…";

  // Por tipo
  const porTipo = {};
  visibleMarkers.forEach((m) => {
    porTipo[m.tipo] = (porTipo[m.tipo] || 0) + 1;
  });
  buildStatRows(document.getElementById("statsPorTipo"), porTipo, colorForText);

  // Por municipio (requiere point-in-polygon contra municipios.geojson)
  const porMunicipioEl = document.getElementById("statsPorMunicipio");
  if (!municipiosGeoData) {
    porMunicipioEl.innerHTML =
      '<p class="stat-empty">Cargando límites de municipios…</p>';
  } else {
    ensureMarkerMunicipios();
    const porMunicipio = {};
    visibleMarkers
      .filter((m) => showAllMunicipios || activeMunicipios.has(m.municipio))
      .forEach((m) => {
        porMunicipio[m.municipio] = (porMunicipio[m.municipio] || 0) + 1;
      });
    buildStatRows(
      porMunicipioEl,
      porMunicipio,
      (nombre) => municipioColors[nombre] || "#8fa6c4",
    );
  }
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

// ---------- 9) Layouts: Principal / Mapa de calor ----------
const layoutTabs = document.querySelectorAll(".layout-tab");
const layoutPanelMain = document.getElementById("layoutPanelMain");
const layoutPanelHeat = document.getElementById("layoutPanelHeat");
const heatLayerToggle = document.getElementById("toggleHeatLayer");
const heatDatasetSelect = document.getElementById("heatDatasetSelect");
const heatRadiusSlider = document.getElementById("heatRadius");
const heatRadiusLabel = document.getElementById("heatRadiusLabel");
const heatMunicipiosToggle = document.getElementById("toggleHeatMunicipios");
const heatParroquiasToggle = document.getElementById("toggleHeatParroquias");

function applyLayoutUI() {
  layoutTabs.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.layout === currentLayout),
  );
  layoutPanelMain.hidden = currentLayout !== "main";
  layoutPanelHeat.hidden = currentLayout !== "heat";
}

// Decide qué capas van sobre el mapa según el layout activo. Se llama cada
// vez que cambia el layout, cada switch relevante, y cada vez que una capa
// termina de cargarse (por si el layout guardado en localStorage era "heat"
// antes de que los datos estuvieran listos).
function syncLayersForLayout() {
  if (currentLayout === "heat") {
    if (markersLayer) map.removeLayer(markersLayer);
    const munOn = heatMunicipiosToggle.checked;
    const parOn = heatParroquiasToggle.checked;
    if (municipiosLayer)
      munOn ? map.addLayer(municipiosLayer) : map.removeLayer(municipiosLayer);
    if (parroquiasLayer)
      parOn ? map.addLayer(parroquiasLayer) : map.removeLayer(parroquiasLayer);
    if (heatLayer) {
      heatEnabled ? map.addLayer(heatLayer) : map.removeLayer(heatLayer);
    }
  } else {
    if (heatLayer) map.removeLayer(heatLayer);
    const munOn = document.getElementById("toggleMunicipios").checked;
    const parOn = document.getElementById("toggleParroquias").checked;
    const markOn = document.getElementById("toggleMarkers").checked;
    if (municipiosLayer)
      munOn ? map.addLayer(municipiosLayer) : map.removeLayer(municipiosLayer);
    if (parroquiasLayer)
      parOn ? map.addLayer(parroquiasLayer) : map.removeLayer(parroquiasLayer);
    if (markersLayer)
      markOn ? map.addLayer(markersLayer) : map.removeLayer(markersLayer);
  }
}

layoutTabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentLayout = btn.dataset.layout;
    localStorage.setItem("layout", currentLayout);
    applyLayoutUI();
    syncLayersForLayout();
    saveStateToUrl();
  });
});

heatLayerToggle.checked = heatEnabled;
heatLayerToggle.addEventListener("change", (e) => {
  heatEnabled = e.target.checked;
  localStorage.setItem("heatEnabled", heatEnabled);
  syncLayersForLayout();
});

heatMunicipiosToggle.addEventListener("change", syncLayersForLayout);
heatParroquiasToggle.addEventListener("change", syncLayersForLayout);

// ---------- 10) Selector de conjunto de datos del mapa de calor ----------
HEATMAP_DATASETS.forEach((d) => {
  const opt = document.createElement("option");
  opt.value = d.id;
  opt.textContent = d.label;
  heatDatasetSelect.appendChild(opt);
});
const savedDatasetId = localStorage.getItem("heatDataset");
const initialDatasetId = HEATMAP_DATASETS.some((d) => d.id === savedDatasetId)
  ? savedDatasetId
  : HEATMAP_DATASETS[0]?.id;
if (initialDatasetId) heatDatasetSelect.value = initialDatasetId;

heatDatasetSelect.addEventListener("change", (e) => {
  localStorage.setItem("heatDataset", e.target.value);
  loadHeatmapDataset(e.target.value);
});

// ---------- 11) Slider de tamaño de zona (radio del heatmap) ----------
heatRadiusSlider.value = currentHeatRadius;
heatRadiusLabel.textContent = currentHeatRadius + "px";
heatRadiusSlider.addEventListener("input", () => {
  currentHeatRadius = parseInt(heatRadiusSlider.value, 10);
  heatRadiusLabel.textContent = currentHeatRadius + "px";
  localStorage.setItem("heatRadius", currentHeatRadius);
  if (heatLayer) heatLayer.setOptions(heatOptionsForRadius(currentHeatRadius));
});

// ---------- 12) Estado compartible en la URL (hash) ----------
// Guarda filtros, parroquia seleccionada, cámara, layout y tema en la URL para
// poder compartir/enlazar una vista concreta del mapa. Se guarda con
// replaceState para no llenar el historial con cada movimiento.
function readUrlState() {
  const hash = location.hash;
  if (!hash || !hash.startsWith("#?")) return null;
  const params = new URLSearchParams(hash.slice(2));
  return {
    municipios: params.get("municipios")
      ? params.get("municipios").split(",").filter(Boolean)
      : [],
    parroquias: params.get("parroquias")
      ? params.get("parroquias").split(",").filter(Boolean)
      : [],
    tipos: params.get("tipos")
      ? params.get("tipos").split(",").filter(Boolean)
      : [],
    sel: params.get("sel"),
    hl: params.get("hl") ? params.get("hl").split(",").filter(Boolean) : [],
    layout: params.get("layout"),
    theme: params.get("theme"),
    camera: params.get("c")
      ? params.get("c").split(",").map(Number)
      : null,
  };
}

function saveStateToUrl() {
  const params = new URLSearchParams();
  if (activeMunicipios.size)
    params.set("municipios", [...activeMunicipios].join(","));
  if (activeParroquias.size)
    params.set("parroquias", [...activeParroquias].join(","));
  if (activeTipos.size) params.set("tipos", [...activeTipos].join(","));
  if (highlightedParroquias.size)
    params.set("hl", [...highlightedParroquias].join(","));
  const c = map.getCenter();
  params.set("c", `${c.lat.toFixed(4)},${c.lng.toFixed(4)},${map.getZoom()}`);
  params.set("layout", currentLayout);
  params.set("theme", currentTheme);
  const qs = params.toString();
  try {
    history.replaceState(null, "", "#?" + qs);
  } catch (e) {
    if (location.hash !== "?" + qs) location.hash = "?" + qs;
  }
}

map.on("moveend", saveStateToUrl);

// Aplica el estado guardado en la URL una vez que los datos ya cargaron.
function applyUrlState() {
  const state = readUrlState();
  if (!state) return;

  if (state.layout && state.layout !== currentLayout) {
    currentLayout = state.layout;
    localStorage.setItem("layout", currentLayout);
  }
  if (state.theme && state.theme !== currentTheme) {
    currentTheme = state.theme;
    applyTheme(currentTheme);
    localStorage.setItem("theme", currentTheme);
  }

  if (state.municipios.length) {
    state.municipios.forEach((m) => {
      if (!municipioColors[m]) return;
      activeMunicipios.add(m);
      document.querySelectorAll("#municipioFilters input").forEach((cb) => {
        if (cb.dataset.municipio === m) cb.checked = true;
      });
    });
  }
  if (state.parroquias.length) {
    state.parroquias.forEach((p) => {
      if (!allParroquiaFeatures.some((f) => f.properties.Parroquia_pcode === p))
        return;
      activeParroquias.add(p);
      const cb = document.querySelector(
        `#parroquiaListPanel input[data-parroquia="${p}"]`,
      );
      if (cb) cb.checked = true;
    });
  }
  if (state.tipos.length) {
    state.tipos.forEach((t) => {
      if (!allMarkers.some((m) => m.tipo === t)) return;
      activeTipos.add(t);
      document.querySelectorAll("#tipoFilters input").forEach((cb) => {
        if (cb.dataset.tipo === t) cb.checked = true;
      });
    });
  }

  // Restaura el resaltado amarillo persistente (multi-parroquia).
  if (state.hl && state.hl.length) {
    state.hl.forEach((p) => {
      if (!allParroquiaFeatures.some((f) => f.properties.Parroquia_pcode === p))
        return;
      highlightedParroquias.add(p);
      const layer = findParroquiaLayer(p);
      if (layer) {
        layer.setStyle(PARROQUIA_HIGHLIGHT_STYLE);
        layer.bringToFront();
      }
    });
  }

  // Foco inicial: parroquia única (sel, legado), conjunto resaltado o cámara.
  if (
    state.sel &&
    allParroquiaFeatures.some((f) => f.properties.Parroquia_pcode === state.sel)
  ) {
    selectParroquia(state.sel);
  } else if (highlightedParroquias.size) {
    const bounds = [...highlightedParroquias]
      .map((p) => findParroquiaLayer(p))
      .filter(Boolean)
      .map((l) => l.getBounds());
    if (bounds.length) {
      const full = bounds.reduce((acc, b) => acc.extend(b), bounds[0]);
      map.fitBounds(full, { maxZoom: 12 });
    }
  } else if (state.camera && state.camera.length === 3) {
    map.setView([state.camera[0], state.camera[1]], state.camera[2]);
  }

  applyFilter();
  applyMarkerFilter();
  applyLayoutUI();
  syncLayersForLayout();
}

// ---------- Carga de datos (con preparación del estado de la URL) ----------
let loadedCount = 0;
const TOTAL_LOADS = 3;

function onDataReady() {
  loadedCount++;
  if (loadedCount >= TOTAL_LOADS) applyUrlState();
}

// ---------- Cargar Municipios ----------
fetchJSON("data/municipios.geojson")
  .then((data) => {
    municipiosGeoData = data;
    const nombres = [
      ...new Set(data.features.map((f) => f.properties.Municipio)),
    ].sort();
    nombres.forEach((nombre, i) => {
      municipioColors[nombre] = colorForIndex(i, nombres.length);
    });

    municipiosLayer = L.geoJSON(data, {
      renderer: L.canvas({ pane: "municipiosPane" }),
      style: (f) => ({
        color: "#111",
        weight: 1,
        fillColor: municipioColors[f.properties.Municipio] || "#999",
        fillOpacity: 0.35,
      }),
      onEachFeature: (f, layer) => {
        const color = municipioColors[f.properties.Municipio] || "#3d7dff";
        layer.bindPopup(
          `<div class="popup-card" style="--card-color:${escapeHtml(color)}">
            <div class="popup-card__accent"></div>
            <div class="popup-card__header">
              <span class="popup-badge">${PIN_ICON_SVG}</span>
              <div class="popup-card__title">
                <strong>${escapeHtml(f.properties.Municipio)}</strong>
                <span class="popup-card__type">Municipio</span>
              </div>
            </div>
            <div class="popup-card__body">
              ${hasValue(f.properties.Ciudad) ? `<p class="popup-desc">${escapeHtml(f.properties.Ciudad)}</p>` : ""}
            </div>
          </div>`,
        );
      },
    }).addTo(map);

    buildMunicipioFilterList(nombres);
    syncLayersForLayout();
    onDataReady();
  })
  .catch((err) => {
    console.error("No se pudo cargar data/municipios.geojson:", err);
    onDataReady();
  });

// ---------- Cargar Parroquias ----------
fetchJSON("data/parroquias.geojson")
  .then((data) => {
    allParroquiaFeatures = data.features;

    parroquiasLayer = L.geoJSON(data, {
      renderer: L.canvas({ pane: "parroquiasPane" }),
      style: parroquiaBaseStyle,
      onEachFeature: (f, layer) => {
        const color = municipioColors[f.properties.Municipio] || "#3d7dff";
        layer.bindPopup(
          `<div class="popup-card" style="--card-color:${escapeHtml(color)}">
            <div class="popup-card__accent"></div>
            <div class="popup-card__header">
              <span class="popup-badge">${PIN_ICON_SVG}</span>
              <div class="popup-card__title">
                <strong>${escapeHtml(f.properties.Parroquia)}</strong>
                <span class="popup-card__type">${escapeHtml(f.properties.Municipio)}</span>
              </div>
            </div>
          </div>`,
        );

        // Una parroquia oculta por el filtro no debe reaccionar a click/hover del mouse
        // (si no, "aparece" en pantalla aunque el filtro diga que no debería mostrarse)
        const isVisible = () =>
          (activeMunicipios.size === 0 ||
            activeMunicipios.has(f.properties.Municipio)) &&
          (activeParroquias.size === 0 ||
            activeParroquias.has(f.properties.Parroquia_pcode));

        layer.on("click", () => {
          if (isVisible()) selectParroquia(f.properties.Parroquia_pcode);
        });
        layer.on("mouseover", () => {
          if (
            isVisible() &&
            !highlightedParroquias.has(f.properties.Parroquia_pcode)
          )
            layer.setStyle(PARROQUIA_HOVER_STYLE);
        });
        layer.on("mouseout", () => {
          if (
            isVisible() &&
            !highlightedParroquias.has(f.properties.Parroquia_pcode)
          )
            layer.setStyle(parroquiaBaseStyle(f));
        });
      },
    }).addTo(map);

    buildParroquiaFilterList();
    applyFilter();
    syncLayersForLayout();
    onDataReady();
  })
  .catch((err) => {
    console.error("No se pudo cargar data/parroquias.geojson:", err);
    onDataReady();
  });

// ---------- Cargar Marcadores (opcional — exportado desde geojson.io) ----------
fetchJSON("data/marcadores.geojson", 1)
  .then((data) => {
    data.features.forEach((f) => {
      const props = f.properties || {};
      const tipo = props.tipo || "Sin tipo";
      const iconUrl = props.icon || "icons/default.png";
      const coords = f.geometry.coordinates;
      const latlng = [coords[1], coords[0]];
      const marker = L.marker(latlng, {
        icon: buildIcon(iconUrl, currentMarkerSize),
      });
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e); // evita que el click llegue al mapa y cierre el panel
        openDetailPanel(marker, props, tipo);
      });
      allMarkers.push({ marker, tipo, iconUrl, props });
    });
    console.log(
      `marcadores.geojson cargado: ${allMarkers.length} marcador(es), tipos: ${[
        ...new Set(allMarkers.map((m) => m.tipo)),
      ].join(", ")}`,
    );
    lastUpdated = new Date();
    buildTipoFilterList();
    applyMarkerFilter();
    updateStatusBar();
    syncLayersForLayout();
    onDataReady();
  })
  .catch((err) => {
    console.error(
      "No se pudo cargar data/marcadores.geojson — revisa que el archivo exista y que su JSON sea válido:",
      err,
    );
    markersLoadFailed = true;
    lastUpdated = new Date();
    document.getElementById("tipoFilters").innerHTML =
      '<p class="muted">Sin marcadores todavía.</p>';
    updateStatusBar();
    onDataReady();
  });

// ---------- Bootstrap del layout inicial ----------
applyLayoutUI();
if (initialDatasetId) loadHeatmapDataset(initialDatasetId);
syncLayersForLayout();