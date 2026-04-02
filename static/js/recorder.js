/**
 * recorder.js — Capture microphone via Web Audio API (ScriptProcessor)
 * Produit des samples PCM Float32 bruts, sans dépendance à ffmpeg côté serveur.
 */

class AudioRecorder {
  /**
   * @param {number} durationSec - Durée maximale en secondes
   */
  constructor(durationSec = 5) {
    this.durationSec   = durationSec;
    this.audioCtx      = null;
    this.stream        = null;
    this.processor     = null;
    this.samples       = [];   // Float32Array accumulés
    this.nativeSr      = 0;
    this.timerInterval = null;
    this.elapsed       = 0;
    this.onStop        = null; // callback({ pcmF32: Float32Array, nativeSr: number })
    this.onTick        = null; // callback(elapsed, total)
    this._stopped      = false;
  }

  /**
   * Démarre la capture microphone.
   * @returns {Promise<void>}
   */
  async start() {
    this._stopped = false;
    this.samples  = [];
    this.elapsed  = 0;

    this.stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.nativeSr = this.audioCtx.sampleRate;

    const source    = this.audioCtx.createMediaStreamSource(this.stream);
    // bufferSize 4096 — bon compromis latence / charge CPU
    this.processor  = this.audioCtx.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (this._stopped) return;
      // Copie du buffer (Float32Array) dans notre tableau
      const buf = e.inputBuffer.getChannelData(0);
      this.samples.push(new Float32Array(buf));
    };

    source.connect(this.processor);
    this.processor.connect(this.audioCtx.destination);

    // Timer + arrêt automatique
    this.timerInterval = setInterval(() => {
      this.elapsed++;
      if (this.onTick) this.onTick(this.elapsed, this.durationSec);
      if (this.elapsed >= this.durationSec) this.stop();
    }, 1000);
  }

  /**
   * Arrête la capture et déclenche le callback onStop.
   */
  stop() {
    if (this._stopped) return;
    this._stopped = true;
    clearInterval(this.timerInterval);

    // Concaténation de tous les chunks Float32
    const total  = this.samples.reduce((s, c) => s + c.length, 0);
    const merged = new Float32Array(total);
    let offset   = 0;
    for (const chunk of this.samples) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    this._cleanup();

    if (this.onStop) this.onStop({ pcmF32: merged, nativeSr: this.nativeSr });
  }

  /**
   * Libère les ressources audio.
   * @private
   */
  _cleanup() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }
}
