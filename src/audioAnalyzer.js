const MAX_BANDS = 8;

// Frequency range edges (Hz) - logarithmically spaced from 40Hz to 12kHz
const MAX_FREQ = 16000;

function buildBandEdges(count, bassLo, bassHi) {
  const edges = [bassLo, bassHi];
  if (count <= 1) return edges;
  const logMin = Math.log(bassHi);
  const logMax = Math.log(MAX_FREQ);
  for (let i = 1; i < count; i++) {
    edges.push(Math.exp(logMin + (logMax - logMin) * (i / (count - 1))));
  }
  return edges;
}

export class AudioAnalyzer {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;
    this.source = null;
    this.audioElement = null;
    this.mediaElementSource = null;
    this.micStream = null;
    this.micSource = null;

    this.bandCount = 4;
    this.bands = new Float32Array(MAX_BANDS);
    this.envelopes = new Float32Array(MAX_BANDS);

    this.bass = 0;
    this.mid = 0;
    this.high = 0;

    this.bassCenter = 100;
    this.midCenter = 1000;
    this.highCenter = 8000;

    this.smoothingFactor = 0.4;
    this.pulseAttackCoeff = 0.85;
    this.pulseReleaseCoeff = 0.12;
    this.prevMid = 0;
    this.prevHigh = 0;

    this.fftSize = 2048;
  }

  _ensureAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this.audioContext;
  }

  _disconnectAll() {
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch (e) {}
    }
    if (this.mediaElementSource) {
      try { this.mediaElementSource.disconnect(); } catch (e) {}
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch (e) {}
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }
    if (this.audioElement) {
      this.audioElement.pause();
    }
  }

  _createAnalysers() {
    const ctx = this.audioContext;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0.15;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  _connectSource(sourceNode) {
    sourceNode.connect(this.analyser);
  }

  async initMicrophone() {
    try {
      const ctx = this._ensureAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();

      this._disconnectAll();
      this._createAnalysers();

      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.micSource = ctx.createMediaStreamSource(this.micStream);
      this._connectSource(this.micSource);

      return true;
    } catch (error) {
      console.error('Failed to initialize microphone:', error);
      throw error;
    }
  }

  async initAudioFile(file) {
    try {
      const ctx = this._ensureAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();

      this._disconnectAll();
      this._createAnalysers();

      if (!this.audioElement) {
        this.audioElement = new Audio();
        this.audioElement.crossOrigin = 'anonymous';
      }

      if (this.audioElement.src && this.audioElement.src.startsWith('blob:')) {
        URL.revokeObjectURL(this.audioElement.src);
      }

      const url = URL.createObjectURL(file);
      this.audioElement.src = url;
      this.audioElement.loop = true;

      if (!this.mediaElementSource) {
        this.mediaElementSource = ctx.createMediaElementSource(this.audioElement);
      }

      this._connectSource(this.mediaElementSource);
      this.analyser.connect(ctx.destination);

      await new Promise((resolve, reject) => {
        const onCanPlay = () => {
          this.audioElement.removeEventListener('canplaythrough', onCanPlay);
          this.audioElement.removeEventListener('error', onError);
          resolve();
        };
        const onError = () => {
          this.audioElement.removeEventListener('canplaythrough', onCanPlay);
          this.audioElement.removeEventListener('error', onError);
          reject(new Error('Failed to load audio file'));
        };
        this.audioElement.addEventListener('canplaythrough', onCanPlay);
        this.audioElement.addEventListener('error', onError);
        if (this.audioElement.readyState >= 4) {
          this.audioElement.removeEventListener('canplaythrough', onCanPlay);
          this.audioElement.removeEventListener('error', onError);
          resolve();
        }
        this.audioElement.load();
      });

      await this.audioElement.play();
      return true;
    } catch (error) {
      console.error('Failed to initialize audio file:', error);
      throw error;
    }
  }

  update() {
    if (!this.analyser || !this.dataArray) return;

    this.analyser.getByteFrequencyData(this.dataArray);
    const binHz = this.audioContext.sampleRate / this.fftSize;
    const count = Math.max(1, Math.min(MAX_BANDS, this.bandCount));
    const bassLo = Math.max(20, this.bassCenter - 5);
    const bassHi = this.bassCenter + 5;
    const edges = buildBandEdges(count, bassLo, bassHi);

    for (let b = 0; b < MAX_BANDS; b++) {
      if (b >= count) {
        this.bands[b] = 0;
        this.envelopes[b] *= 0.9;
        continue;
      }

      const loHz = edges[b];
      const hiHz = edges[b + 1];
      const loBin = Math.max(1, Math.floor(loHz / binHz));
      const hiBin = Math.min(this.dataArray.length - 1, Math.floor(hiHz / binHz));

      let sum = 0;
      let peak = 0;
      let n = 0;
      for (let i = loBin; i <= hiBin; i++) {
        sum += this.dataArray[i];
        if (this.dataArray[i] > peak) peak = this.dataArray[i];
        n++;
      }
      const avg = n > 0 ? (sum / n / 255) : 0;
      const peakNorm = peak / 255;

      // Bass (band 0): use peak + average blend with strong boost
      // Higher bands: average with moderate boost
      if (b === 0) {
        const blended = peakNorm * 0.6 + avg * 0.4;
        this.bands[b] = Math.min(1, blended * 3.5);
      } else {
        const boostFactor = 1.0 + Math.max(0, 1.2 - b * 0.25);
        this.bands[b] = Math.min(1, avg * boostFactor);
      }

      // Envelope follower per band
      const target = this.bands[b];
      if (target >= this.envelopes[b]) {
        this.envelopes[b] += (target - this.envelopes[b]) * this.pulseAttackCoeff;
      } else {
        this.envelopes[b] += (target - this.envelopes[b]) * this.pulseReleaseCoeff;
      }
      this.envelopes[b] = Math.max(0, Math.min(1, this.envelopes[b]));
    }

    // Bass/Mid/High bars all use slider centers ±50Hz (same method)
    const bassBarLo = Math.max(1, Math.floor((this.bassCenter - 5) / binHz));
    const bassBarHi = Math.min(this.dataArray.length - 1, Math.floor((this.bassCenter + 5) / binHz));
    let bassBarSum = 0;
    for (let i = bassBarLo; i <= bassBarHi; i++) bassBarSum += this.dataArray[i];
    const bassBarAvg = bassBarSum / Math.max(1, bassBarHi - bassBarLo + 1) / 255;
    this.bass = bassBarAvg;
    const midLo = Math.max(1, Math.floor((this.midCenter - 50) / binHz));
    const midHi = Math.min(this.dataArray.length - 1, Math.floor((this.midCenter + 50) / binHz));
    let midSum = 0;
    for (let i = midLo; i <= midHi; i++) midSum += this.dataArray[i];
    const midAvg = midSum / Math.max(1, midHi - midLo + 1) / 255;

    const highLo = Math.max(1, Math.floor((this.highCenter - 50) / binHz));
    const highHi = Math.min(this.dataArray.length - 1, Math.floor((this.highCenter + 50) / binHz));
    let highSum = 0;
    for (let i = highLo; i <= highHi; i++) highSum += this.dataArray[i];
    const highAvg = highSum / Math.max(1, highHi - highLo + 1) / 255;

    this.mid = this.smoothingFactor * this.prevMid + (1 - this.smoothingFactor) * midAvg;
    this.high = this.smoothingFactor * this.prevHigh + (1 - this.smoothingFactor) * highAvg;
    this.prevMid = this.mid;
    this.prevHigh = this.high;
  }

  getFrequencyData() {
    return {
      bass: this.bass,
      bassPeak: this.envelopes[0],
      bands: this.bands,
      envelopes: this.envelopes,
      mid: this.mid,
      high: this.high
    };
  }

  stop() {
    this._disconnectAll();
    this.bass = 0;
    this.mid = 0;
    this.high = 0;
    this.prevMid = 0;
    this.prevHigh = 0;
    this.bands.fill(0);
    this.envelopes.fill(0);
  }

  dispose() {
    this.stop();
    if (this.audioElement) {
      this.audioElement.src = '';
      this.audioElement = null;
      this.mediaElementSource = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
