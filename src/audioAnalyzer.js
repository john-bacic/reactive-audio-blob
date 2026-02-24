const MAX_BANDS = 8;

// Frequency range edges (Hz) - logarithmically spaced from 40Hz to 12kHz
const BASS_MIN = 80;
const BASS_MAX = 120;
const FREQ_MAX = 12000;

function buildBandEdges(count) {
  const edges = [BASS_MIN, BASS_MAX];
  if (count <= 1) return edges;
  const logMin = Math.log(BASS_MAX);
  const logMax = Math.log(FREQ_MAX);
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
    const edges = buildBandEdges(count);

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
      let n = 0;
      for (let i = loBin; i <= hiBin; i++) {
        sum += this.dataArray[i];
        n++;
      }
      const avg = n > 0 ? (sum / n / 255) : 0;

      // Lower bands get more gain (bass is quieter in FFT)
      const boostFactor = 1.0 + Math.max(0, 1.5 - b * 0.3);
      this.bands[b] = Math.min(1, avg * boostFactor);

      // Envelope follower per band
      const target = this.bands[b];
      if (target >= this.envelopes[b]) {
        this.envelopes[b] += (target - this.envelopes[b]) * this.pulseAttackCoeff;
      } else {
        this.envelopes[b] += (target - this.envelopes[b]) * this.pulseReleaseCoeff;
      }
      this.envelopes[b] = Math.max(0, Math.min(1, this.envelopes[b]));
    }

    // Legacy bass/mid/high for frequency bars
    this.bass = this.envelopes[0];

    const midStart = Math.floor(250 / binHz);
    const midEnd = Math.floor(2000 / binHz);
    let midSum = 0;
    for (let i = midStart; i < midEnd; i++) midSum += this.dataArray[i];
    const midAvg = midSum / Math.max(1, midEnd - midStart) / 255;

    const highStart = midEnd;
    const highEnd = Math.min(this.dataArray.length - 1, Math.floor(8000 / binHz));
    let highSum = 0;
    for (let i = highStart; i < highEnd; i++) highSum += this.dataArray[i];
    const highAvg = highSum / Math.max(1, highEnd - highStart) / 255;

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
