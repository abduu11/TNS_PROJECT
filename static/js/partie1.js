/**
 * partie1.js — Numérisation & Segmentation
 */

const btnRecord      = document.getElementById("btnRecord");
const btnSave        = document.getElementById("btnSave");
const btnSegment     = document.getElementById("btnSegment");
const btnRefreshDB   = document.getElementById("btnRefreshDB");
const recStatus      = document.getElementById("recStatus");
const recTimerWrap   = document.getElementById("recTimerWrap");
const recTimer       = document.getElementById("recTimer");
const audioPreview   = document.getElementById("audioPreview");
const segStatus      = document.getElementById("segStatus");
const segResults     = document.getElementById("segResults");
const segTableBody   = document.getElementById("segTableBody");
const segCount       = document.getElementById("segCount");
const dbTree         = document.getElementById("dbTree");
const thresholdRange = document.getElementById("thresholdRange");
const thresholdVal   = document.getElementById("thresholdVal");

let recorder  = null;
let isRecording = false;

thresholdRange.addEventListener("input", () => {
  thresholdVal.textContent = thresholdRange.value + " dB";
});

/* ── Enregistrement ─────────────────────────────────────────────────── */

btnRecord.addEventListener("click", async () => {
  if (!isRecording) await startRecording();
  else stopRecording();
});

/**
 * Démarre la capture microphone.
 * @returns {Promise<void>}
 */
async function startRecording() {
  const duration = parseInt(document.getElementById("duration").value) || 5;

  // Vérifier que l'API est disponible (HTTPS ou localhost requis)
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showAlert(recStatus,
      "Microphone indisponible. Accédez via http://localhost:5000 ou activez HTTPS.",
      "error");
    return;
  }

  try {
    recorder = new AudioRecorder(duration);

    recorder.onTick = (elapsed) => {
      const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const ss = String(elapsed % 60).padStart(2, "0");
      recTimer.textContent = `${mm}:${ss}`;
    };

    recorder.onStop = ({ pcmF32, nativeSr }) => {
      // Prévisualisation : encoder un WAV minimal en JS pour l'élément <audio>
      const wavBlob = pcmToWavBlob(pcmF32, nativeSr);
      audioPreview.src = URL.createObjectURL(wavBlob);
      audioPreview.classList.remove("hidden");
      // Stocker pour la sauvegarde
      window._lastPcm      = pcmF32;
      window._lastNativeSr = nativeSr;
      btnSave.disabled = false;
      isRecording = false;
      recTimerWrap.classList.add("hidden");
      btnRecord.innerHTML = `<i data-lucide="circle"></i><span id="recLabel">Enregistrer</span>`;
      btnRecord.classList.remove("btn-danger");
      btnRecord.classList.add("btn-primary");
      lucide.createIcons();
      showAlert(recStatus, "Enregistrement terminé. Écoutez puis sauvegardez.", "success");
    };

    await recorder.start();
    isRecording = true;
    recTimerWrap.classList.remove("hidden");
    recTimer.textContent = "00:00";
    btnRecord.innerHTML = `<i data-lucide="square"></i><span>Arrêter</span>`;
    btnRecord.classList.remove("btn-primary");
    btnRecord.classList.add("btn-danger");
    lucide.createIcons();
    showAlert(recStatus, `Enregistrement en cours… (${duration}s max)`, "loading");

  } catch (err) {
    isRecording = false;
    recTimerWrap.classList.add("hidden");
    btnRecord.innerHTML = `<i data-lucide="circle"></i><span>Enregistrer</span>`;
    btnRecord.classList.remove("btn-danger");
    btnRecord.classList.add("btn-primary");
    lucide.createIcons();
    showAlert(recStatus, `Erreur microphone : ${err.message}`, "error");
  }
}

/**
 * Arrête l'enregistrement en cours.
 */
function stopRecording() {
  if (recorder) recorder.stop();
}

/* ── Sauvegarde ─────────────────────────────────────────────────────── */

/**
 * Encode le blob en base64 et envoie au serveur Flask.
 */
btnSave.addEventListener("click", async () => {
  if (!window._lastPcm) return;
  const sampleRate = parseInt(document.getElementById("sampleRate").value);
  const bitDepth   = parseInt(document.querySelector('input[name="bitDepth"]:checked').value);
  const locuteur   = document.getElementById("locuteur").value;
  const session    = document.getElementById("session").value;

  showAlert(recStatus, "Sauvegarde en cours…", "loading");
  btnSave.disabled = true;

  try {
    // Encoder Float32Array → base64
    const pcmB64 = float32ToBase64(window._lastPcm);
    const res    = await fetch("/api/save_recording", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pcm_data:    pcmB64,
        native_sr:   window._lastNativeSr,
        sample_rate: sampleRate,
        bit_depth:   bitDepth,
        locuteur,
        session
      })
    });
    const json = await res.json();
    if (json.error) {
      showAlert(recStatus, json.error, "error");
    } else {
      document.getElementById("segFilepath").value = json.path;
      showAlert(recStatus, `Sauvegardé : ${json.filename}`, "success");
      refreshDB();
    }
  } catch (err) {
    showAlert(recStatus, `Erreur réseau : ${err.message}`, "error");
  } finally {
    btnSave.disabled = false;
  }
});

/* ── Segmentation ───────────────────────────────────────────────────── */

/**
 * Lance la segmentation via l'API Flask.
 */
btnSegment.addEventListener("click", async () => {
  const filepath       = document.getElementById("segFilepath").value.trim();
  const threshold_db   = parseFloat(thresholdRange.value);
  const min_silence_ms = parseInt(document.getElementById("minSilenceMs").value);

  if (!filepath) {
    showAlert(segStatus, "Veuillez indiquer le chemin du fichier WAV.", "error");
    return;
  }
  showAlert(segStatus, "Segmentation en cours…", "loading");
  segResults.classList.add("hidden");

  try {
    const res  = await fetch("/api/segment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filepath, threshold_db, min_silence_ms })
    });
    const json = await res.json();
    if (json.error) { showAlert(segStatus, json.error, "error"); return; }
    showAlert(segStatus, `${json.count} segment(s) détecté(s).`, "success");
    renderSegments(json.segments);
  } catch (err) {
    showAlert(segStatus, `Erreur : ${err.message}`, "error");
  }
});

/**
 * Affiche les segments dans le tableau.
 * @param {Array} segments
 */
function renderSegments(segments) {
  segTableBody.innerHTML = "";
  if (!segments.length) { segResults.classList.add("hidden"); return; }
  segments.forEach((seg, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="mono">${seg.filename}</td>
      <td class="mono">${(seg.duration_ms / 1000).toFixed(2)} s</td>
      <td><audio controls src="${seg.url_play}" style="height:26px;width:160px"></audio></td>
      <td>
        <a href="${seg.url_download}" download class="btn btn-outline btn-sm">
          <i data-lucide="download"></i>WAV
        </a>
      </td>`;
    segTableBody.appendChild(tr);
  });
  lucide.createIcons();
  segCount.textContent = `${segments.length} segment(s) vocal/vocaux`;
  segResults.classList.remove("hidden");
}

/* ── Base de données ────────────────────────────────────────────────── */

/**
 * Rafraîchit l'arborescence de la base de données.
 */
async function refreshDB() {
  try {
    const res  = await fetch("/api/list_database");
    const data = await res.json();
    renderDB(data);
  } catch {
    dbTree.innerHTML = `<span class="db-empty">Erreur de chargement.</span>`;
  }
}

/**
 * Génère l'arborescence HTML.
 * @param {Object} data
 */
function renderDB(data) {
  const keys = Object.keys(data);
  if (!keys.length) {
    dbTree.innerHTML = `<span class="db-empty">Base de données vide.</span>`;
    return;
  }
  let html = "";
  for (const loc of keys) {
    html += `<div class="db-node l0"><i data-lucide="folder"></i>${loc}</div>`;
    for (const ses of Object.keys(data[loc])) {
      html += `<div class="db-node l1"><i data-lucide="folder-open"></i>${ses}</div>`;
      for (const file of data[loc][ses]) {
        html += `<div class="db-node l2"><i data-lucide="file-audio"></i>${file.name}</div>`;
      }
    }
  }
  dbTree.innerHTML = html;
  lucide.createIcons();
}

btnRefreshDB.addEventListener("click", refreshDB);

/* ── Utilitaires ────────────────────────────────────────────────────── */

/**
 * Encode un Float32Array en base64 (pour envoi au serveur).
 * @param {Float32Array} f32
 * @returns {string}
 */
function float32ToBase64(f32) {
  const bytes  = new Uint8Array(f32.buffer);
  let binary   = "";
  const chunk  = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Encode des samples PCM Float32 en blob WAV pour prévisualisation <audio>.
 * @param {Float32Array} samples
 * @param {number} sr - fréquence d'échantillonnage
 * @returns {Blob}
 */
function pcmToWavBlob(samples, sr) {
  const numCh      = 1;
  const bitsPerSmp = 16;
  const byteRate   = sr * numCh * bitsPerSmp / 8;
  const blockAlign = numCh * bitsPerSmp / 8;
  const dataLen    = samples.length * blockAlign;
  const buf        = new ArrayBuffer(44 + dataLen);
  const view       = new DataView(buf);

  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0,  "RIFF");
  view.setUint32(4,  36 + dataLen, true);
  writeStr(8,  "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1,  true);   // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSmp, true);
  writeStr(36, "data");
  view.setUint32(40, dataLen, true);

  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 32768 : s * 32767, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/**
 * Affiche une alerte dans un élément.
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

refreshDB();
