/**
 * partie2.js — FFT & Filtrage avec Chart.js
 */

const uploadZone    = document.getElementById("uploadZone");
const fileInput     = document.getElementById("fileInput");
const uploadStatus  = document.getElementById("uploadStatus");
const fileInfo      = document.getElementById("fileInfo");
const initialGraphs = document.getElementById("initialGraphs");
const filterPanel   = document.getElementById("filterPanel");
const filterStatus  = document.getElementById("filterStatus");
const filterResults = document.getElementById("filterResults");
const btnFilter     = document.getElementById("btnFilter");
const audioFiltered = document.getElementById("audioFiltered");
const btnDownload   = document.getElementById("btnDownloadFiltered");

let currentWavPath   = "";
let chartTime        = null;
let chartFft         = null;
let chartCompareTime = null;
let chartCompareFft  = null;

/* ── Palette claire ─────────────────────────────────────────────────── */
const C = {
  blue:   "#4f6ef7",
  green:  "#16a34a",
  red:    "#dc2626",
  amber:  "#d97706",
  grid:   "rgba(0,0,0,.06)",
  text:   "#4b5068",
  sub:    "#8b90a7"
};

/* ── Chart.js helpers ───────────────────────────────────────────────── */

/**
 * Options communes pour tous les graphiques.
 * @param {string} xLabel
 * @param {string} yLabel
 * @returns {Object}
 */
function chartOptions(xLabel, yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    elements: { point: { radius: 0 }, line: { borderWidth: 1.5, tension: 0 } },
    plugins: {
      legend: { labels: { color: C.text, font: { size: 11, family: "Inter" }, boxWidth: 12 } },
      tooltip: {
        backgroundColor: "#fff",
        titleColor: C.text,
        bodyColor: C.sub,
        borderColor: "#e2e5ed",
        borderWidth: 1,
        padding: 8
      }
    },
    scales: {
      x: {
        type: "category",
        title: { display: true, text: xLabel, color: C.sub, font: { size: 11 } },
        ticks: {
          color: C.sub,
          font: { size: 10 },
          maxTicksLimit: 8,
          maxRotation: 0,
          callback: function(val, idx) {
            // Afficher seulement ~8 labels régulièrement espacés
            const total = this.chart.data.labels.length;
            if (idx % Math.floor(total / 7) === 0) {
              return Number(this.getLabelForValue(val)).toFixed(2);
            }
            return "";
          }
        },
        grid: { color: C.grid }
      },
      y: {
        title: { display: true, text: yLabel, color: C.sub, font: { size: 11 } },
        ticks: { color: C.sub, maxTicksLimit: 5, font: { size: 10 } },
        grid:  { color: C.grid }
      }
    }
  };
}

/**
 * Crée ou recrée un graphique Chart.js en mode labels/data classique.
 * @param {Chart|null} existing
 * @param {string} canvasId
 * @param {Array<string>} labels   - labels axe X
 * @param {Array<Object>} datasets - datasets Chart.js (champ `data` = tableau de valeurs Y)
 * @param {string} xLabel
 * @param {string} yLabel
 * @returns {Chart}
 */
function makeChart(existing, canvasId, labels, datasets, xLabel, yLabel) {
  if (existing) existing.destroy();
  const ctx = document.getElementById(canvasId).getContext("2d");
  return new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: chartOptions(xLabel, yLabel)
  });
}

/* ── Drag & Drop ────────────────────────────────────────────────────── */

uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("drag-over");
});
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) uploadFile(fileInput.files[0]);
});

/* ── Upload ─────────────────────────────────────────────────────────── */

/**
 * Envoie le fichier au serveur et affiche les graphiques initiaux.
 * @param {File} file
 */
async function uploadFile(file) {
  showAlert(uploadStatus, `Chargement de « ${file.name} »…`, "loading");
  initialGraphs.classList.add("hidden");
  filterPanel.style.display = "none";
  filterResults.classList.add("hidden");
  fileInfo.classList.add("hidden");

  const fd = new FormData();
  fd.append("file", file);

  try {
    const res  = await fetch("/api/upload_audio", { method: "POST", body: fd });
    const json = await res.json();
    if (json.error) { showAlert(uploadStatus, json.error, "error"); return; }

    currentWavPath = json.wav_path;

    fileInfo.innerHTML = `
      <i data-lucide="file-audio"></i>
      <span>${file.name}</span>
      <span class="file-info-sep">|</span>
      <span>${json.duration} s</span>
      <span class="file-info-sep">|</span>
      <span>${json.sample_rate} Hz</span>
      <span class="file-info-sep">|</span>
      <span>${json.n_samples.toLocaleString()} échantillons</span>`;
    fileInfo.classList.remove("hidden");
    lucide.createIcons();

    chartTime = makeChart(chartTime, "chartTime",
      json.time_data.labels,
      [{ label: "x(t)", data: json.time_data.values,
         borderColor: C.blue, backgroundColor: "transparent", pointRadius: 0 }],
      "Temps (s)", "Amplitude");

    chartFft = makeChart(chartFft, "chartFft",
      json.fft_data.labels,
      [{ label: "|X(f)|", data: json.fft_data.values,
         borderColor: C.green, backgroundColor: "transparent", pointRadius: 0 }],
      "Fréquence (Hz)", "|X(f)|");

    initialGraphs.classList.remove("hidden");
    filterPanel.style.display = "block";
    showAlert(uploadStatus, "Fichier chargé et converti en WAV.", "success");

  } catch (err) {
    showAlert(uploadStatus, `Erreur réseau : ${err.message}`, "error");
  }
}

/* ── Filtrage ───────────────────────────────────────────────────────── */

/**
 * Applique le masque rectangulaire et affiche les résultats comparatifs.
 * Contrainte absolue : masque rectangulaire uniquement.
 */
btnFilter.addEventListener("click", async () => {
  if (!currentWavPath) return;
  const f_min       = parseFloat(document.getElementById("fMin").value);
  const f_max       = parseFloat(document.getElementById("fMax").value);
  const filter_type = document.querySelector('input[name="filterType"]:checked').value;

  if (isNaN(f_min) || isNaN(f_max) || f_min < 0 || f_max <= f_min) {
    showAlert(filterStatus, "Valeurs invalides : f_min doit être ≥ 0 et strictement < f_max.", "error");
    return;
  }

  showAlert(filterStatus, `Application du filtre ${filter_type} [${f_min} Hz – ${f_max} Hz]…`, "loading");
  filterResults.classList.add("hidden");
  btnFilter.disabled = true;

  try {
    const res  = await fetch("/api/filter_audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wav_path: currentWavPath, f_min, f_max, filter_type })
    });
    const json = await res.json();
    if (json.error) { showAlert(filterStatus, json.error, "error"); return; }

    chartCompareTime = makeChart(chartCompareTime, "chartCompareTime",
      json.time_orig.labels,
      [
        { label: "Original", data: json.time_orig.values,
          borderColor: C.blue, backgroundColor: "transparent", borderWidth: 1.2, order: 2, pointRadius: 0 },
        { label: "Filtré",   data: json.time_filt.values,
          borderColor: C.red,  backgroundColor: "transparent", borderWidth: 1.8, order: 1, pointRadius: 0 }
      ],
      "Temps (s)", "Amplitude");

    chartCompareFft = makeChart(chartCompareFft, "chartCompareFft",
      json.fft_orig.labels,
      [
        { label: "Original", data: json.fft_orig.values,
          borderColor: C.green, backgroundColor: "transparent", borderWidth: 1.2, order: 2, pointRadius: 0 },
        { label: "Filtré",   data: json.fft_filt.values,
          borderColor: C.amber, backgroundColor: "transparent", borderWidth: 1.8, order: 1, pointRadius: 0 }
      ],
      "Fréquence (Hz)", "|X(f)|");

    audioFiltered.src    = json.filtered_url;
    btnDownload.href     = json.filtered_dl_url;
    btnDownload.download = "signal_filtre.wav";

    filterResults.classList.remove("hidden");
    showAlert(filterStatus, `Filtre ${filter_type} appliqué avec succès.`, "success");
    filterResults.scrollIntoView({ behavior: "smooth", block: "start" });

  } catch (err) {
    showAlert(filterStatus, `Erreur : ${err.message}`, "error");
  } finally {
    btnFilter.disabled = false;
  }
});

/* ── Utilitaires ────────────────────────────────────────────────────── */

/**
 * Affiche une alerte dans un élément DOM.
 * @param {HTMLElement} el
 * @param {string} message
 * @param {string} type  info | success | error | loading
 */
function showAlert(el, message, type) {
  const icons = { info: "info", success: "check-circle", error: "alert-circle", loading: "loader" };
  el.innerHTML = `<i data-lucide="${icons[type] || 'info'}"></i><span>${message}</span>`;
  el.className = `alert ${type}`;
  el.classList.remove("hidden");
  lucide.createIcons();
}
