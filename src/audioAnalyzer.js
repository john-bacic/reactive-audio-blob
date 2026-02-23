export class AudioAnalyzer {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;
    this.source = null;
    this.audioElement = null;
    this.mediaElementSource = null; // Reusable - can only create once per element
    this.micStream = null;
    this.micSource = null;

    this.bass = 0;
    this.mid = 0;
    this.high = 0;
    this.envelope = 0;

    this.smoothingFactor = 0.4;
    this.bassSmoothingFactor = 0.4;
    this.pulseAttackCoeff = 0.85;
    this.pulseReleaseCoeff = 0.12;
    this.prevBass = 0;
    this.prevMid = 0;
    this.prevHigh = 0;

    // FFT settings
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

  _createAnalyser() {
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0.2;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  async initMicrophone() {
    try {
      const ctx = this._ensureAudioContext();

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      this._disconnectAll();
      this._createAnalyser();

      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.micSource = ctx.createMediaStreamSource(this.micStream);
      this.micSource.connect(this.analyser);

      return true;
    } catch (error) {
      console.error('Failed to initialize microphone:', error);
      throw error;
    }
  }

  async initAudioFile(file) {
    try {
      const ctx = this._ensureAudioContext();

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      this._disconnectAll();
      this._createAnalyser();

      // Create audio element only once
      if (!this.audioElement) {
        this.audioElement = new Audio();
        this.audioElement.crossOrigin = 'anonymous';
      }

      // Revoke old blob URL if any
      if (this.audioElement.src && this.audioElement.src.startsWith('blob:')) {
        URL.revokeObjectURL(this.audioElement.src);
      }

      // Load file
      const url = URL.createObjectURL(file);
      this.audioElement.src = url;
      this.audioElement.loop = true;

      // createMediaElementSource can only be called ONCE per audio element
      if (!this.mediaElementSource) {
        this.mediaElementSource = ctx.createMediaElementSource(this.audioElement);
      }

      // Connect: mediaElementSource -> analyser -> destination
      this.mediaElementSource.connect(this.analyser);
      this.analyser.connect(ctx.destination);

      // Wait for the audio to be ready, then play
      await new Promise((resolve, reject) => {
        const onCanPlay = () => {
          this.audioElement.removeEventListener('canplaythrough', onCanPlay);
          this.audioElement.removeEventListener('error', onError);
          resolve();
        };
        const onError = (e) => {
          this.audioElement.removeEventListener('canplaythrough', onCanPlay);
          this.audioElement.removeEventListener('error', onError);
          reject(new Error('Failed to load audio file'));
        };
        this.audioElement.addEventListener('canplaythrough', onCanPlay);
        this.audioElement.addEventListener('error', onError);
        // If already ready, resolve immediately
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
    if (!this.analyser || !this.dataArray) {
      return;
    }

    this.analyser.getByteFrequencyData(this.dataArray);

    const binHz = this.audioContext.sampleRate / this.fftSize;

    // Bass: 40-280 Hz (skip bin 0 = DC), weight toward kick range
    const bassStart = Math.max(1, Math.floor(40 / binHz));
    const bassEnd = Math.floor(280 / binHz);
    let bassSum = 0;
    for (let i = bassStart; i < bassEnd; i++) {
      const weight = i < bassEnd * 0.5 ? 1.2 : 1.0;
      bassSum += this.dataArray[i] * weight;
    }
    const bassBins = Math.max(1, bassEnd - bassStart);
    const bassAvg = Math.min(1, (bassSum / bassBins / 255) * 1.6);

    // Mids: 250-2000 Hz
    const midStart = bassEnd;
    const midEnd = Math.floor(2000 / binHz);
    let midSum = 0;
    for (let i = midStart; i < midEnd; i++) {
      midSum += this.dataArray[i];
    }
    const midAvg = midSum / (midEnd - midStart) / 255;

    // Highs: 2000-8000 Hz
    const highStart = midEnd;
    const highEnd = Math.floor(8000 / binHz);
    let highSum = 0;
    for (let i = highStart; i < highEnd; i++) {
      highSum += this.dataArray[i];
    }
    const highAvg = highSum / (highEnd - highStart) / 255;

    this.bass = this.bassSmoothingFactor * this.prevBass + (1 - this.bassSmoothingFactor) * bassAvg;
    this.mid = this.smoothingFactor * this.prevMid + (1 - this.smoothingFactor) * midAvg;
    this.high = this.smoothingFactor * this.prevHigh + (1 - this.smoothingFactor) * highAvg;

    const b = Math.min(1, this.bass * 1.3);
    if (b >= this.envelope) {
      this.envelope += (b - this.envelope) * this.pulseAttackCoeff;
    } else {
      this.envelope += (b - this.envelope) * this.pulseReleaseCoeff;
    }
    this.envelope = Math.max(0, Math.min(1, this.envelope));

    this.prevBass = this.bass;
    this.prevMid = this.mid;
    this.prevHigh = this.high;
  }

  getFrequencyData() {
    const drive = Math.min(1, this.envelope * 1.25);
    return {
      bass: this.bass,
      bassPeak: drive,
      mid: this.mid,
      high: this.high
    };
  }

  stop() {
    this._disconnectAll();

    this.bass = 0;
    this.envelope = 0;
    this.mid = 0;
    this.high = 0;
    this.prevBass = 0;
    this.prevMid = 0;
    this.prevHigh = 0;
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
