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

    // Dedicated bass filter chain
    this.bassFilter = null;
    this.bassAnalyser = null;
    this.bassTimeDomain = null;

    this.bass = 0;
    this.mid = 0;
    this.high = 0;
    this.rawBassRMS = 0;
    this.envelope = 0;

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
    if (this.bassFilter) {
      try { this.bassFilter.disconnect(); } catch (e) {}
    }
    if (this.bassAnalyser) {
      try { this.bassAnalyser.disconnect(); } catch (e) {}
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

    // Main analyser for frequency bars (mid/high)
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0.3;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    // Bass isolation: lowpass filter → dedicated analyser with NO smoothing
    this.bassFilter = ctx.createBiquadFilter();
    this.bassFilter.type = 'lowpass';
    this.bassFilter.frequency.value = 160;
    this.bassFilter.Q.value = 0.7;

    this.bassAnalyser = ctx.createAnalyser();
    this.bassAnalyser.fftSize = 1024;
    this.bassAnalyser.smoothingTimeConstant = 0;
    this.bassTimeDomain = new Float32Array(this.bassAnalyser.fftSize);
  }

  _connectSource(sourceNode) {
    // source → main analyser (for mid/high frequency bars)
    sourceNode.connect(this.analyser);
    // source → bass lowpass filter → bass analyser (for beat pulse)
    sourceNode.connect(this.bassFilter);
    this.bassFilter.connect(this.bassAnalyser);
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

    // --- Bass: time-domain RMS from filtered signal (no FFT smoothing) ---
    if (this.bassAnalyser && this.bassTimeDomain) {
      this.bassAnalyser.getFloatTimeDomainData(this.bassTimeDomain);
      let sumSq = 0;
      for (let i = 0; i < this.bassTimeDomain.length; i++) {
        const v = this.bassTimeDomain[i];
        sumSq += v * v;
      }
      this.rawBassRMS = Math.sqrt(sumSq / this.bassTimeDomain.length);
    }

    // Scale RMS to 0-1 range (typical RMS for music bass is 0-0.3)
    this.bass = Math.min(1, this.rawBassRMS * 4.5);

    // --- Envelope follower on raw bass ---
    if (this.bass >= this.envelope) {
      this.envelope += (this.bass - this.envelope) * this.pulseAttackCoeff;
    } else {
      this.envelope += (this.bass - this.envelope) * this.pulseReleaseCoeff;
    }
    this.envelope = Math.max(0, Math.min(1, this.envelope));

    // --- Mids and Highs from FFT (for frequency bars only) ---
    this.analyser.getByteFrequencyData(this.dataArray);
    const binHz = this.audioContext.sampleRate / this.fftSize;

    const midStart = Math.floor(250 / binHz);
    const midEnd = Math.floor(2000 / binHz);
    let midSum = 0;
    for (let i = midStart; i < midEnd; i++) midSum += this.dataArray[i];
    const midAvg = midSum / (midEnd - midStart) / 255;

    const highStart = midEnd;
    const highEnd = Math.floor(8000 / binHz);
    let highSum = 0;
    for (let i = highStart; i < highEnd; i++) highSum += this.dataArray[i];
    const highAvg = highSum / (highEnd - highStart) / 255;

    this.mid = this.smoothingFactor * this.prevMid + (1 - this.smoothingFactor) * midAvg;
    this.high = this.smoothingFactor * this.prevHigh + (1 - this.smoothingFactor) * highAvg;
    this.prevMid = this.mid;
    this.prevHigh = this.high;
  }

  getFrequencyData() {
    return {
      bass: this.bass,
      bassPeak: this.envelope,
      mid: this.mid,
      high: this.high
    };
  }

  stop() {
    this._disconnectAll();
    this.bass = 0;
    this.envelope = 0;
    this.rawBassRMS = 0;
    this.mid = 0;
    this.high = 0;
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
