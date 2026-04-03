
import os
import io
import base64
import numpy as np
import soundfile as sf
from flask import Flask, render_template, request, jsonify, send_file, url_for
from scipy.fft import fft, ifft, fftfreq
from scipy.io import wavfile
from pydub import AudioSegment
import librosa

app = Flask(__name__)

#Dossiers de travail
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DB_DIR     = os.path.join(BASE_DIR, "database")
SEG_DIR    = os.path.join(BASE_DIR, "segments")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

for d in (DB_DIR, SEG_DIR, UPLOAD_DIR):
    os.makedirs(d, exist_ok=True)

@app.context_processor
def inject_css_version():
    """Injecte css_version (timestamp du CSS) dans tous les templates pour cache-busting."""
    try:
        mtime = os.path.getmtime(os.path.join(BASE_DIR, "static", "css", "style.css"))
        return {"css_version": str(int(mtime))}
    except Exception:
        return {"css_version": "1"}

# Valeurs autorisées
ALLOWED_SAMPLE_RATES = {16000, 22050, 44100}
ALLOWED_BIT_DEPTHS   = {16, 32}

#  ROUTES PRINCIPALES

@app.route("/")
def index():
    """Page d'accueil avec navigation vers les deux parties."""
    return render_template("index.html")


@app.route("/partie1")
def partie1():
    """Interface Partie 1 – Numerisation et Segmentation."""
    return render_template("partie1.html")


@app.route("/partie2")
def partie2():
    """Interface Partie 2 – FFT et Filtrage."""
    return render_template("partie2.html")


#  PARTIE 1 – API


@app.route("/api/save_recording", methods=["POST"])
def save_recording():
    """
    Sauvegarde un enregistrement audio dans la base de données.
    Reçoit les samples PCM Float32 encodés en base64 (pas de webm/opus),
    ce qui évite toute dépendance à ffmpeg.

    Paramètres JSON :
        pcm_data    (str)  : samples Float32 little-endian encodés en base64
        sample_rate (int)  : fréquence d'échantillonnage (16000/22050/44100)
        bit_depth   (int)  : profondeur de codage cible (16/32)
        locuteur    (str)  : identifiant du locuteur
        session     (str)  : identifiant de session

    Retourne :
        JSON avec le chemin du fichier sauvegardé ou un message d'erreur.
    """
    data        = request.get_json()
    sample_rate = int(data.get("sample_rate", 0))
    bit_depth   = int(data.get("bit_depth", 0))
    locuteur    = str(data.get("locuteur", "01")).zfill(2)
    session     = str(data.get("session", "01")).zfill(2)
    pcm_b64     = data.get("pcm_data", "")

    # Validation des paramètres (contrainte sujet)
    if sample_rate not in ALLOWED_SAMPLE_RATES:
        return jsonify({"error": f"Fréquence {sample_rate} Hz non autorisée. Valeurs : 16000, 22050, 44100."}), 400
    if bit_depth not in ALLOWED_BIT_DEPTHS:
        return jsonify({"error": f"Codage {bit_depth} bits non autorisé. Valeurs : 16, 32."}), 400

    # Décodage base64 → Float32 PCM (envoyé par l'AudioContext du navigateur)
    pcm_bytes = base64.b64decode(pcm_b64)
    samples_f32 = np.frombuffer(pcm_bytes, dtype=np.float32)

    # Rééchantillonnage si la fréquence native du micro diffère de la cible
    native_sr = int(data.get("native_sr", sample_rate))
    if native_sr != sample_rate:
        samples_f32 = librosa.resample(samples_f32, orig_sr=native_sr, target_sr=sample_rate)

    # Conversion vers la profondeur de bits cible
    if bit_depth == 16:
        samples_out = (samples_f32 * 32767).clip(-32768, 32767).astype(np.int16)
        subtype = "PCM_16"
    else:
        samples_out = samples_f32.astype(np.float32)
        subtype = "FLOAT"

    loc_dir = os.path.join(DB_DIR, f"locuteur_{locuteur}", f"session_{session}")
    os.makedirs(loc_dir, exist_ok=True)

    existing = [f for f in os.listdir(loc_dir) if f.endswith(".wav")]
    num      = str(len(existing) + 1).zfill(3)
    sr_label = "22kHz" if sample_rate == 22050 else f"{sample_rate // 1000}kHz"
    filename = f"enreg_{num}_{sr_label}_{bit_depth}b.wav"
    filepath = os.path.join(loc_dir, filename)

    # Écriture WAV directe via soundfile — aucun ffmpeg requis
    sf.write(filepath, samples_out, sample_rate, subtype=subtype)

    return jsonify({"success": True, "path": filepath, "filename": filename})


@app.route("/api/segment", methods=["POST"])
def segment_audio():
    """
    Segmente un fichier WAV en détectant les silences avec librosa.

    Paramètres JSON :
        filepath       (str)   : chemin absolu du fichier WAV
        threshold_db   (float) : seuil d'amplitude en dB (ex: -40)
        min_silence_ms (int)   : durée minimale de silence en ms

    Retourne :
        JSON avec la liste des segments (nom, durée, URLs lecture/téléchargement).
    """
    data           = request.get_json()
    filepath       = data.get("filepath", "")
    threshold_db   = float(data.get("threshold_db", -40))
    min_silence_ms = int(data.get("min_silence_ms", 300))

    if not os.path.isfile(filepath):
        return jsonify({"error": "Fichier introuvable."}), 404

    y, sr = librosa.load(filepath, sr=None, mono=True)

    intervals = librosa.effects.split(
        y,
        top_db=abs(threshold_db),
        frame_length=2048,
        hop_length=512
    )

    segments_info = []
    base_name = os.path.splitext(os.path.basename(filepath))[0]

    for i, (start, end) in enumerate(intervals):
        duration_ms = (end - start) / sr * 1000
        if duration_ms < min_silence_ms:
            continue
        seg_audio    = y[start:end]
        seg_filename = f"{base_name}_seg{i+1:03d}.wav"
        seg_path     = os.path.join(SEG_DIR, seg_filename)
        sf.write(seg_path, seg_audio, sr, subtype="PCM_16")
        segments_info.append({
            "filename":    seg_filename,
            "duration_ms": round(duration_ms, 1),
            "url_play":    url_for("serve_segment", filename=seg_filename),
            "url_download": url_for("serve_segment", filename=seg_filename, dl=1)
        })

    return jsonify({"segments": segments_info, "count": len(segments_info)})


@app.route("/segments/<filename>")
def serve_segment(filename):
    """
    Sert un fichier segment pour lecture ou téléchargement.

    Paramètres URL :
        filename (str) : nom du fichier segment
        dl       (int) : si 1, force le téléchargement

    Retourne :
        Fichier WAV en réponse HTTP.
    """
    dl   = request.args.get("dl", 0, type=int)
    path = os.path.join(SEG_DIR, filename)
    return send_file(path, as_attachment=bool(dl), mimetype="audio/wav")


@app.route("/api/list_database")
def list_database():
    """
    Liste l'arborescence de la base de données audio.

    Retourne :
        JSON avec la structure locuteurs → sessions → fichiers.
    """
    structure = {}
    if not os.path.isdir(DB_DIR):
        return jsonify(structure)
    for locuteur in sorted(os.listdir(DB_DIR)):
        loc_path = os.path.join(DB_DIR, locuteur)
        if not os.path.isdir(loc_path):
            continue
        structure[locuteur] = {}
        for session in sorted(os.listdir(loc_path)):
            ses_path = os.path.join(loc_path, session)
            if not os.path.isdir(ses_path):
                continue
            files = sorted(os.listdir(ses_path))
            structure[locuteur][session] = [
                {"name": f, "path": os.path.join(ses_path, f)}
                for f in files if f.endswith(".wav")
            ]
    return jsonify(structure)

#  PARTIE 2 – API

@app.route("/api/upload_audio", methods=["POST"])
def upload_audio():
    """
    Reçoit un fichier audio, le convertit en WAV si nécessaire,
    et retourne les données brutes (time_data, fft_data) pour Chart.js.

    Paramètres form-data :
        file (FileStorage) : fichier audio (WAV, MP3, OGG, etc.)

    Retourne :
        JSON avec time_data, fft_data, durée, sample_rate, chemin WAV.
    """
    if "file" not in request.files:
        return jsonify({"error": "Aucun fichier reçu."}), 400

    f             = request.files["file"]
    original_name = f.filename
    ext           = os.path.splitext(original_name)[1].lower()
    raw_path      = os.path.join(UPLOAD_DIR, original_name)
    f.save(raw_path)

    # Conversion automatique en WAV si nécessaire (nécessite ffmpeg pour MP3/OGG)
    wav_path = os.path.join(UPLOAD_DIR, os.path.splitext(original_name)[0] + ".wav")
    if ext != ".wav":
        try:
            audio_seg = AudioSegment.from_file(raw_path)
            audio_seg.export(wav_path, format="wav")
        except Exception as e:
            return jsonify({"error": f"Conversion impossible (ffmpeg manquant ?) : {str(e)}"}), 500
    else:
        wav_path = raw_path

    sr, samples = wavfile.read(wav_path)
    if samples.ndim > 1:
        samples = samples[:, 0]
    samples = samples.astype(np.float64)

    return jsonify({
        "wav_path":    wav_path,
        "sample_rate": int(sr),
        "duration":    round(len(samples) / sr, 3),
        "n_samples":   len(samples),
        "time_data":   _build_time_data(samples, sr),
        "fft_data":    _build_fft_data(samples, sr)
    })


@app.route("/api/filter_audio", methods=["POST"])
def filter_audio():
    """
    Applique un masque fréquentiel rectangulaire (passe-bande ou coupe-bande).

    Contrainte ABSOLUE : masque rectangulaire uniquement.
        H(f) = 1 si f_min <= |f| <= f_max  (passe-bande)
        H(f) = 1 - H(f)                    (coupe-bande)

    Paramètres JSON :
        wav_path    (str)   : chemin du fichier WAV source
        f_min       (float) : borne basse du filtre en Hz
        f_max       (float) : borne haute du filtre en Hz
        filter_type (str)   : "passe-bande" ou "coupe-bande"

    Retourne :
        JSON avec graphiques comparatifs (base64) et URL du WAV filtré.
    """
    data        = request.get_json()
    wav_path    = data.get("wav_path", "")
    f_min       = float(data.get("f_min", 0))
    f_max       = float(data.get("f_max", 4000))
    filter_type = data.get("filter_type", "passe-bande")

    if not os.path.isfile(wav_path):
        return jsonify({"error": "Fichier WAV introuvable."}), 404

    sr, samples = wavfile.read(wav_path)
    if samples.ndim > 1:
        samples = samples[:, 0]
    samples = samples.astype(np.float64)

    N     = len(samples)
    freqs = fftfreq(N, d=1.0 / sr)

    # Masque rectangulaire
    mask = np.zeros(N, dtype=np.float64)
    mask[(np.abs(freqs) >= f_min) & (np.abs(freqs) <= f_max)] = 1.0

    if filter_type == "coupe-bande":
        mask = 1.0 - mask   # H_bar(f) = 1 - H(f)

    # Application du masque dans le domaine fréquentiel
    X          = fft(samples)
    X_filtered = X * mask
    y_filtered = np.real(ifft(X_filtered))

    # Normalisation pour éviter la saturation
    max_val = np.max(np.abs(y_filtered))
    if max_val > 0:
        y_filtered = y_filtered / max_val * np.max(np.abs(samples))

    out_name = f"filtered_{os.path.basename(wav_path)}"
    out_path = os.path.join(UPLOAD_DIR, out_name)
    wavfile.write(out_path, sr, y_filtered.astype(np.int16))

    return jsonify({
        "time_orig":       _build_time_data(samples, sr),
        "time_filt":       _build_time_data(y_filtered, sr),
        "fft_orig":        _build_fft_data(samples, sr),
        "fft_filt":        _build_fft_data(y_filtered, sr),
        "filtered_url":    url_for("serve_filtered", filename=out_name),
        "filtered_dl_url": url_for("serve_filtered", filename=out_name, dl=1)
    })


@app.route("/filtered/<filename>")
def serve_filtered(filename):
    """
    Sert le fichier WAV filtré pour lecture ou téléchargement.

    Paramètres URL :
        filename (str) : nom du fichier filtré
        dl       (int) : si 1, force le téléchargement

    Retourne :
        Fichier WAV en réponse HTTP.
    """
    dl   = request.args.get("dl", 0, type=int)
    path = os.path.join(UPLOAD_DIR, filename)
    return send_file(path, as_attachment=bool(dl), mimetype="audio/wav")


@app.route("/uploads/<filename>")
def serve_upload(filename):
    """
    Sert un fichier audio uploadé (original ou converti) pour lecture.

    Paramètres URL :
        filename (str) : nom du fichier dans le dossier uploads

    Retourne :
        Fichier audio en réponse HTTP.
    """
    path = os.path.join(UPLOAD_DIR, filename)
    return send_file(path, mimetype="audio/wav")


#  FONCTIONS UTILITAIRES – DONNÉES POUR CHART.JS

# Nombre max de points envoyés au front (performance Chart.js)
MAX_PLOT_POINTS = 4000


def _downsample_time(arr, max_points):
    """
    Sous-échantillonne le signal temporel par décimation simple.

    Paramètres :
        arr        (ndarray) : tableau source
        max_points (int)     : nombre maximum de points

    Retourne :
        ndarray sous-échantillonné
    """
    if len(arr) <= max_points:
        return arr
    step = len(arr) // max_points
    return arr[::step][:max_points]


def _downsample_fft(freqs, magnitudes, max_points):
    """
    Réduit le spectre FFT en conservant le maximum d'amplitude par fenêtre.
    Évite l'écrasement des pics spectraux par décimation naïve.

    Paramètres :
        freqs      (ndarray) : fréquences (partie positive)
        magnitudes (ndarray) : amplitudes correspondantes
        max_points (int)     : nombre de points cibles

    Retourne :
        tuple (freqs_out, magnitudes_out) sous-échantillonnés
    """
    N = len(freqs)
    if N <= max_points:
        return freqs, magnitudes

    # Découper en fenêtres et prendre le max d'amplitude dans chaque fenêtre
    step       = N / max_points
    f_out      = np.empty(max_points)
    m_out      = np.empty(max_points)
    for i in range(max_points):
        lo = int(i * step)
        hi = int((i + 1) * step)
        hi = min(hi, N)
        idx       = lo + np.argmax(magnitudes[lo:hi])
        f_out[i]  = freqs[idx]
        m_out[i]  = magnitudes[idx]
    return f_out, m_out


def _build_time_data(samples, sr):
    """
    Prépare les données du signal temporel pour Chart.js.

    Paramètres :
        samples (ndarray) : échantillons du signal
        sr      (int)     : fréquence d'échantillonnage

    Retourne :
        dict : {labels: [...], values: [...]}
    """
    s_ds = _downsample_time(samples, MAX_PLOT_POINTS)
    t    = np.linspace(0, len(samples) / sr, len(s_ds))
    return {
        "labels": [round(float(x), 4) for x in t],
        "values": [round(float(x), 2) for x in s_ds]
    }


def _build_fft_data(samples, sr):
    """
    Calcule le spectre FFT et prépare les données pour Chart.js.
    Utilise un sous-échantillonnage par max-fenêtre pour préserver les pics.

    Paramètres :
        samples (ndarray) : échantillons du signal
        sr      (int)     : fréquence d'échantillonnage

    Retourne :
        dict : {labels: [...], values: [...]}
    """
    N          = len(samples)
    X          = fft(samples)
    freqs      = fftfreq(N, d=1.0 / sr)
    magnitudes = np.abs(X) / N

    # Partie positive uniquement
    pos        = freqs >= 0
    f_pos      = freqs[pos]
    m_pos      = magnitudes[pos]

    f_ds, m_ds = _downsample_fft(f_pos, m_pos, MAX_PLOT_POINTS)

    return {
        "labels": [round(float(x), 2) for x in f_ds],
        "values": [round(float(x), 6) for x in m_ds]
    }
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
