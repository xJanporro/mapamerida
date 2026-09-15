// =========================================================
// filters.js — Filtros (municipio, parroquia, tipo) y selección
// =========================================================

// ---------- 2) Selección / resaltado de parroquia (respeta el filtro activo) ----------
function selectParroquia(pcode) {
  const feature = allParroquiaFeatures.find(
    (f) => f.properties.Parroquia_pcode === pcode,
  );
  if (!feature) return;
  const municipio = feature.properties.Municipio;
  let filtersChanged = false;

  // Si la parroquia pertenece a un municipio oculto por el filtro, actívalo primero
  // (así lo que seleccionas siempre queda visible, sin "aparecer" contradiciendo el filtro)
  if (activeMunicipios.size > 0 && !activeMunicipios.has(municipio)) {
    activeMunicipios.add(municipio);
    const cb = [...document.querySelectorAll("#municipioFilters input")].find(
      (i) => i.dataset.municipio === municipio,
    );
    if (cb) cb.checked = true;
    filtersChanged = true;
  }

  // Mismo criterio para el filtro propio de parroquias: si está activo y no
  // incluye esta parroquia, se agrega y se marca su checkbox en la lista.
  if (activeParroquias.size > 0 && !activeParroquias.has(pcode)) {
    activeParroquias.add(pcode);
    const cb = document.querySelector(
      `#parroquiaListPanel input[data-parroquia="${pcode}"]`,
    );
    if (cb) cb.checked = true;
    filtersChanged = true;
  }

  // Desplaza el panel de parroquias hasta la fila correspondiente y la resalta
  // un instante, para que sea evidente cuál quedó seleccionada aunque esté
  // lejos del scroll actual.
  const checkbox = document.querySelector(
    `#parroquiaListPanel input[data-parroquia="${pcode}"]`,
  );
  const row = checkbox ? checkbox.closest("label") : null;
  if (row) {
    row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    row.classList.add("parroquia-row--flash");
    setTimeout(() => row.classList.remove("parroquia-row--flash"), 900);
  }

  if (filtersChanged) applyFilter();

  // La parroquia elegida se mantiene resaltada en amarillo junto con cualquier
  // otra ya resaltada, hasta que se deseleccione o se pulse "Mostrar todas".
  highlightedParroquias.add(pcode);
  const layer = findParroquiaLayer(pcode);
  if (!layer) return;
  layer.setStyle(PARROQUIA_HIGHLIGHT_STYLE);
  layer.bringToFront();
  map.fitBounds(layer.getBounds(), { maxZoom: 12 });
  layer.openPopup();
  saveStateToUrl();
}

function findParroquiaLayer(pcode) {
  let found = null;
  parroquiasLayer.eachLayer((layer) => {
    if (layer.feature.properties.Parroquia_pcode === pcode) found = layer;
  });
  return found;
}

// Quita el resaltado amarillo de una parroquia puntual (vuelve al estilo base).
function removeParroquiaHighlight(pcode) {
  highlightedParroquias.delete(pcode);
  const layer = findParroquiaLayer(pcode);
  if (layer) layer.setStyle(parroquiaBaseStyle(layer.feature));
}

// Quita el resaltado de TODAS las parroquias (Escape o "Mostrar todas").
function clearSelection() {
  if (highlightedParroquias.size === 0) return;
  highlightedParroquias.forEach((pcode) => {
    const layer = findParroquiaLayer(pcode);
    if (layer) layer.setStyle(parroquiaBaseStyle(layer.feature));
  });
  highlightedParroquias.clear();
  map.closePopup();
  saveStateToUrl();
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
      <input type="checkbox" data-tipo="${escapeHtml(tipo)}">
      <span class="swatch" style="background:${colorForText(tipo)}"></span>
      ${escapeHtml(tipo)}`;
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
      <input type="checkbox" data-municipio="${escapeHtml(nombre)}">
      <span class="swatch" style="background:${municipioColors[nombre]}"></span>
      ${escapeHtml(nombre)}`;
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
  const showAllMunicipios = activeMunicipios.size === 0;
  const showAllParroquias = activeParroquias.size === 0;

  municipiosLayer.eachLayer((layer) => {
    const match =
      showAllMunicipios ||
      activeMunicipios.has(layer.feature.properties.Municipio);
    layer.setStyle({ opacity: match ? 1 : 0, fillOpacity: match ? 0.35 : 0 });
  });

  parroquiasLayer.eachLayer((layer) => {
    const f = layer.feature;
    const municipioMatch =
      showAllMunicipios || activeMunicipios.has(f.properties.Municipio);
    const parroquiaMatch =
      showAllParroquias || activeParroquias.has(f.properties.Parroquia_pcode);
    const match = municipioMatch && parroquiaMatch;
    const base = parroquiaBaseStyle(f);
    if (highlightedParroquias.has(f.properties.Parroquia_pcode)) return; // no pisar los resaltados activos
    layer.setStyle({
      ...base,
      opacity: match ? 1 : 0,
      fillOpacity: match ? base.fillOpacity : 0,
    });
  });

  updateInfoPanel();
  saveStateToUrl();
}

// ---------- Filtro por parroquia (lista agrupada por municipio, siempre desplegada) ----------
// Lista continua con su propia barra de scroll, separada por encabezados de
// sección por municipio que quedan "pegados" arriba mientras se hace scroll.
function buildParroquiaFilterList() {
  const container = document.getElementById("parroquiaListPanel");
  container.innerHTML = "";
  container.classList.remove("checkbox-list");
  container.classList.add("parroquia-scroll-list");

  if (allParroquiaFeatures.length === 0) {
    container.innerHTML = '<p class="muted">Sin parroquias cargadas.</p>';
    return;
  }

  const byMunicipio = {};
  allParroquiaFeatures.forEach((f) => {
    const m = f.properties.Municipio;
    (byMunicipio[m] = byMunicipio[m] || []).push(f);
  });

  Object.keys(byMunicipio)
    .sort()
    .forEach((municipio) => {
      const parroquias = byMunicipio[municipio].sort((a, b) =>
        a.properties.Parroquia.localeCompare(b.properties.Parroquia),
      );

      const group = document.createElement("div");
      group.className = "parroquia-group";
      group.dataset.municipio = municipio;

      const header = document.createElement("div");
      header.className = "parroquia-group__header";
      header.innerHTML = `
        <span class="swatch" style="background:${municipioColors[municipio] || "#666"}"></span>
        <span class="parroquia-group__name">${escapeHtml(municipio)}</span>
        <span class="parroquia-group__count">${parroquias.length}</span>`;
      group.appendChild(header);

      parroquias.forEach((f) => {
        const label = document.createElement("label");
        label.innerHTML = `
          <input type="checkbox" data-parroquia="${escapeHtml(f.properties.Parroquia_pcode)}">
          ${escapeHtml(f.properties.Parroquia)}`;
        group.appendChild(label);
      });

      container.appendChild(group);
    });

  container.addEventListener("change", (e) => {
    if (e.target.matches("input[data-parroquia]")) {
      const pcode = e.target.dataset.parroquia;
      if (e.target.checked) {
        selectParroquia(pcode);
        applyFilter();
      } else {
        activeParroquias.delete(pcode);
        removeParroquiaHighlight(pcode);
        applyFilter();
      }
    }
  });
}

document
  .getElementById("clearParroquiaFilter")
  .addEventListener("click", () => {
    activeParroquias.clear();
    document
      .querySelectorAll("#parroquiaListPanel input")
      .forEach((cb) => (cb.checked = false));
    parroquiaFilterSearch.value = "";
    filterParroquiaList("");
    clearSelection();
    applyFilter();
  });

// Con 80+ parroquias, escanear la lista completa a ojo sigue siendo tedioso.
// Este buscador filtra en vivo: oculta los municipios sin coincidencias y,
// dentro de los que sí tienen, solo deja visibles las parroquias que matchean.
function filterParroquiaList(query) {
  const q = normalizeText(query.trim());
  document
    .querySelectorAll("#parroquiaListPanel .parroquia-group")
    .forEach((group) => {
      const municipioMatch = normalizeText(group.dataset.municipio || "").includes(q);
      let anyVisible = false;
      group.querySelectorAll("label").forEach((label) => {
        const match = q === "" || municipioMatch || normalizeText(label.textContent).includes(q);
        label.style.display = match ? "" : "none";
        if (match) anyVisible = true;
      });
      group.style.display = anyVisible ? "" : "none";
    });
}

const parroquiaFilterSearch = document.getElementById("parroquiaFilterSearch");
parroquiaFilterSearch.addEventListener("input", () =>
  filterParroquiaList(parroquiaFilterSearch.value),
);

function updateInfoPanel() {
  const showAllMunicipios = activeMunicipios.size === 0;
  const showAllParroquias = activeParroquias.size === 0;
  const totalParroquias = allParroquiaFeatures.filter((f) => {
    const municipioMatch =
      showAllMunicipios || activeMunicipios.has(f.properties.Municipio);
    const parroquiaMatch =
      showAllParroquias ||
      activeParroquias.has(f.properties.Parroquia_pcode);
    return municipioMatch && parroquiaMatch;
  }).length;
  const totalMarkers =
    activeTipos.size === 0
      ? allMarkers.length
      : allMarkers.filter((m) => activeTipos.has(m.tipo)).length;

  document.getElementById("info").innerHTML =
    `${totalParroquias} parroquia(s) visibles · ${totalMarkers} marcador(es) visibles`;

  updateStatusBar(totalParroquias, totalMarkers);
  if (statsOpen) renderStats();
}