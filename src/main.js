import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { AudioAnalyzer } from './audioAnalyzer.js';
import vertexShader from './shaders/vertexShader.glsl?raw';
import fragmentShader from './shaders/fragmentShader.glsl?raw';

const HDRI_URLS = {
  studio_small_03: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_03_1k.hdr',
  kloppenheim_02: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloppenheim_02_1k.hdr',
  venice_sunset: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/venice_sunset_1k.hdr',
  industrial_sunset: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/industrial_sunset_02_1k.hdr',
  brown_photostudio: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/brown_photostudio_02_1k.hdr',
};

// Audio analyzer
const audioAnalyzer = new AudioAnalyzer();
let isAudioActive = false;

// Sidebar toggle
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const isMobile = () => window.matchMedia('(max-width: 600px)').matches;
if (sidebar && sidebarToggle) {
  if (isMobile()) sidebar.classList.add('is-hidden');
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('is-hidden');
    if (!sidebar.classList.contains('is-hidden')) syncZoomSliderToControl();
  });
}
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
if (sidebarBackdrop && sidebar) {
  sidebarBackdrop.addEventListener('click', () => {
    if (!sidebar.classList.contains('is-hidden')) sidebar.classList.add('is-hidden');
  });
}

const gitCommitEl = document.getElementById('gitCommit');
const buildCommit = typeof __GIT_COMMIT__ !== 'undefined' && __GIT_COMMIT__ ? __GIT_COMMIT__ : '';
if (gitCommitEl) gitCommitEl.textContent = buildCommit || '—';

async function setCommitFromGitHub() {
  if (!gitCommitEl) return;
  try {
    const r = await fetch('https://api.github.com/repos/john-bacic/reactive-audio-blob/commits/main', {
      headers: { Accept: 'application/vnd.github.v3+json' }
    });
    if (!r.ok) return;
    const data = await r.json();
    const sha = data.sha?.slice(0, 7);
    if (sha) gitCommitEl.textContent = sha;
  } catch {
    if (!buildCommit) gitCommitEl.textContent = '—';
  }
}
setCommitFromGitHub();

// UI Elements
const micBtn = document.getElementById('micBtn');
const fileBtn = document.getElementById('fileBtn');
const audioFileInput = document.getElementById('audioFile');
const statusText = document.getElementById('statusText');
const bassBar = document.getElementById('bassBar');
const midBar = document.getElementById('midBar');
const highBar = document.getElementById('highBar');
const scrubberContainer = document.getElementById('scrubberContainer');
const scrubber = document.getElementById('scrubber');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');

// Audio event listeners
micBtn.addEventListener('click', async () => {
  try {
    micBtn.classList.add('active');
    fileBtn.classList.remove('active');
    await audioAnalyzer.initMicrophone();
    isAudioActive = true;
    statusText.textContent = 'Microphone active';
    scrubberContainer.style.display = 'none';
  } catch (error) {
    console.error('Microphone error:', error);
    statusText.textContent = 'Microphone access denied';
    micBtn.classList.remove('active');
    isAudioActive = false;
  }
});

// File picker opens natively via <label for="audioFile"> (iOS-friendly)

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function isAudioFile(file) {
  if (file.type && file.type.startsWith('audio/')) return true;
  return /\.(mp3|m4a|wav|ogg|aac|flac|weba|webm|m4b)$/i.test(file.name);
}

audioFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!isAudioFile(file)) {
    statusText.textContent = 'Please choose an audio file (.mp3, .m4a, etc.)';
    return;
  }
  try {
    fileBtn.classList.add('active');
    micBtn.classList.remove('active');
    statusText.textContent = 'Loading audio...';
    await audioAnalyzer.initAudioFile(file);
    isAudioActive = true;
    statusText.textContent = `Playing: ${file.name}`;
    scrubberContainer.style.display = 'block';
  } catch (error) {
    console.error('Audio file error:', error);
    statusText.textContent = 'Failed to load audio file';
    fileBtn.classList.remove('active');
    isAudioActive = false;
    scrubberContainer.style.display = 'none';
  }
});

// Scrubber interaction
let isScrubbing = false;

scrubber.addEventListener('input', () => {
  isScrubbing = true;
  const audio = audioAnalyzer.audioElement;
  if (audio && audio.duration) {
    audio.currentTime = (scrubber.value / 100) * audio.duration;
  }
});

scrubber.addEventListener('change', () => {
  isScrubbing = false;
});

// Control defaults
const ZOOM_MIN = 0.1, ZOOM_MAX = 3;
const controls = {
  zoom: 1,
  blobCount: 4,
  blobSize: 0.1,
  mergeStrength: 0.7,
  animSpeed: 1.0,
  deformation: 0.3,
  glossiness: 0.7,
  spread: 2.0,
  sensitivity: 0.5,
  bassFreq: 100,
  midFreq: 1000,
  highFreq: 8000,
  pulseAttack: 0.85,
  pulseRelease: 0.35,
  baseHue: 0.5,
  baseSat: 0,
  baseLight: 0.92,
  shadow: 0.5,
  highlight: 0.7,
  opacity: 1,
  iridescence: 0,
  rainbow: 0.65,
  colorScheme: 0,
  hdri: 'none',
};

// Bind sliders to controls
const INT_SLIDERS = new Set(['bassFreq', 'midFreq', 'highFreq']);
function bindSlider(id, key) {
  const slider = document.getElementById(id);
  const valueEl = document.getElementById(id + 'Value');
  if (!slider) return;
  const fmt = INT_SLIDERS.has(id) ? (v) => Math.round(v).toString() : (v) => parseFloat(v).toFixed(2);
  slider.value = controls[key];
  valueEl.textContent = fmt(controls[key]);
  slider.addEventListener('input', () => {
    controls[key] = parseFloat(slider.value);
    valueEl.textContent = fmt(slider.value);
  });
}

bindSlider('zoom', 'zoom');
bindSlider('blobCount', 'blobCount');
bindSlider('blobSize', 'blobSize');
bindSlider('mergeStrength', 'mergeStrength');
bindSlider('animSpeed', 'animSpeed');
bindSlider('deformation', 'deformation');
bindSlider('glossiness', 'glossiness');
bindSlider('spread', 'spread');
bindSlider('sensitivity', 'sensitivity');
bindSlider('bassFreq', 'bassFreq');
bindSlider('midFreq', 'midFreq');
bindSlider('highFreq', 'highFreq');
bindSlider('pulseAttack', 'pulseAttack');
bindSlider('pulseRelease', 'pulseRelease');
bindSlider('baseHue', 'baseHue');
bindSlider('baseSat', 'baseSat');
bindSlider('baseLight', 'baseLight');
bindSlider('shadow', 'shadow');
bindSlider('highlight', 'highlight');
bindSlider('opacity', 'opacity');
bindSlider('iridescence', 'iridescence');
bindSlider('rainbow', 'rainbow');

const colorSchemeSelect = document.getElementById('colorScheme');
const hdriSelect = document.getElementById('hdriSelect');
if (colorSchemeSelect) {
  colorSchemeSelect.value = String(controls.colorScheme);
  colorSchemeSelect.addEventListener('change', () => {
    controls.colorScheme = parseInt(colorSchemeSelect.value, 10);
  });
}
if (hdriSelect) {
  hdriSelect.value = controls.hdri;
  hdriSelect.addEventListener('change', () => {
    controls.hdri = hdriSelect.value;
    setHdriBackground(controls.hdri);
  });
}

function syncZoomSliderToControl() {
  const z = controls.zoom;
  const slider = document.getElementById('zoom');
  const valueEl = document.getElementById('zoomValue');
  if (slider) {
    slider.value = z.toFixed(2);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (valueEl) valueEl.textContent = z.toFixed(2);
}

function updateZoomFromGesture(value) {
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
  controls.zoom = z;
  syncZoomSliderToControl();
}

// Three.js setup - fullscreen quad for raymarching
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('container').appendChild(renderer.domElement);

// Fullscreen quad geometry
const quadGeometry = new THREE.PlaneGeometry(2, 2);

const pan = { x: 0, y: 0 };
const dummyEnvMap = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
dummyEnvMap.needsUpdate = true;

const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(
      window.innerWidth * Math.min(window.devicePixelRatio, 2),
      window.innerHeight * Math.min(window.devicePixelRatio, 2)
    )},
  uPan: { value: new THREE.Vector2(0, 0) },
  uZoom: { value: 1 },
  uBass: { value: 0 },
    uBassPeak: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uBandEnvelopes0: { value: new THREE.Vector4(0, 0, 0, 0) },
    uBandEnvelopes1: { value: new THREE.Vector4(0, 0, 0, 0) },
    uBlobCount: { value: controls.blobCount },
    uBlobSize: { value: controls.blobSize },
    uMergeStrength: { value: controls.mergeStrength },
    uAnimSpeed: { value: controls.animSpeed },
    uDeformation: { value: controls.deformation },
    uGlossiness: { value: controls.glossiness },
    uSpread: { value: controls.spread },
    uBaseHue: { value: controls.baseHue },
    uBaseSat: { value: controls.baseSat },
    uBaseLight: { value: controls.baseLight },
    uShadow: { value: controls.shadow },
    uHighlight: { value: controls.highlight },
    uOpacity: { value: controls.opacity },
    uIridescence: { value: controls.iridescence },
    uRainbow: { value: controls.rainbow },
    uColorScheme: { value: controls.colorScheme },
    uEnvMap: { value: dummyEnvMap },
    uUseEnvMap: { value: 0 },
  },
  vertexShader,
  fragmentShader,
});

const quad = new THREE.Mesh(quadGeometry, material);
scene.add(quad);

const rgbeLoader = new RGBELoader();

function setHdriBackground(key) {
  const m = material.uniforms;
  if (key === 'none') {
    m.uUseEnvMap.value = 0;
    m.uEnvMap.value = dummyEnvMap;
    return;
  }
  const url = HDRI_URLS[key];
  if (!url) return;
  m.uUseEnvMap.value = 0;
  rgbeLoader.load(url, (texture) => {
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    m.uEnvMap.value = texture;
    m.uUseEnvMap.value = 1;
  }, undefined, () => {
    m.uUseEnvMap.value = 0;
    m.uEnvMap.value = dummyEnvMap;
  });
}
setHdriBackground(controls.hdri);

// Touch/mouse drag to pan blobs; two-finger pinch to zoom; tap to close sidebar
const container = document.getElementById('container');
const TAP_THRESHOLD_PX = 10;
let isDragging = false;
let isPinching = false;
let lastClientX = 0;
let lastClientY = 0;
let pointerDownX = 0;
let pointerDownY = 0;
let pinchStartDist = 0;
let pinchStartZoom = 1;

function touchDistance(touches) {
  if (!touches || touches.length < 2) return 0;
  return Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
}

function onPointerDown(e) {
  if (e.target !== container) return;
  const touches = e.touches;
  if (touches && touches.length === 2) {
    isPinching = true;
    isDragging = false;
    pinchStartDist = touchDistance(touches);
    pinchStartZoom = controls.zoom;
    return;
  }
  isDragging = true;
  isPinching = false;
  const x = e.clientX ?? touches?.[0]?.clientX;
  const y = e.clientY ?? touches?.[0]?.clientY;
  lastClientX = pointerDownX = x;
  lastClientY = pointerDownY = y;
}
function onPointerMove(e) {
  const touches = e.touches;
  if (touches && touches.length === 2) {
    if (isPinching && pinchStartDist > 0) {
      const d = touchDistance(touches);
      const scale = d / pinchStartDist;
      updateZoomFromGesture(pinchStartZoom * scale);
    }
    return;
  }
  if (!isDragging) return;
  const clientX = e.clientX ?? touches?.[0]?.clientX;
  const clientY = e.clientY ?? touches?.[0]?.clientY;
  const h = window.innerHeight;
  pan.x += (clientX - lastClientX) / h;
  pan.y -= (clientY - lastClientY) / h;
  lastClientX = clientX;
  lastClientY = clientY;
  material.uniforms.uPan.value.set(pan.x, pan.y);
}
function onPointerUp(e) {
  const touches = e.touches;
  if (touches && touches.length >= 2) return;
  if (sidebar && !sidebar.classList.contains('is-hidden') && !isPinching) {
    const x = e.changedTouches?.[0]?.clientX ?? e.clientX;
    const y = e.changedTouches?.[0]?.clientY ?? e.clientY;
    if (x != null && y != null && Math.hypot(x - pointerDownX, y - pointerDownY) < TAP_THRESHOLD_PX) {
      sidebar.classList.add('is-hidden');
    }
  }
  isDragging = false;
  isPinching = false;
}
container.addEventListener('mousedown', onPointerDown);
container.addEventListener('touchstart', onPointerDown, { passive: true });
window.addEventListener('mousemove', onPointerMove);
window.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 || isDragging) e.preventDefault();
  onPointerMove(e);
}, { passive: false });
window.addEventListener('mouseup', onPointerUp);
window.addEventListener('touchend', onPointerUp);
window.addEventListener('touchcancel', onPointerUp);

// Resize
window.addEventListener('resize', () => {
  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer.setSize(window.innerWidth, window.innerHeight);
  material.uniforms.uResolution.value.set(
    window.innerWidth * dpr,
    window.innerHeight * dpr
  );
});

// Animation loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const elapsedTime = clock.getElapsedTime();

  // Audio
  if (isAudioActive) {
    audioAnalyzer.bandCount = Math.round(controls.blobCount);
    audioAnalyzer.bassCenter = controls.bassFreq;
    audioAnalyzer.midCenter = controls.midFreq;
    audioAnalyzer.highCenter = controls.highFreq;
    audioAnalyzer.pulseAttackCoeff = 0.2 + 0.75 * controls.pulseAttack;
    audioAnalyzer.pulseReleaseCoeff = 0.03 + 0.45 * (1 - controls.pulseRelease);
    audioAnalyzer.update();
    const { bass, bassPeak, envelopes, mid, high } = audioAnalyzer.getFrequencyData();

    const s = controls.sensitivity;
    const aBass = Math.min(bass * s, 1.0);
    const aBassPeak = Math.min(bassPeak * s, 1.0);
    const aMid = Math.min(mid * s, 1.0);
    const aHigh = Math.min(high * s, 1.0);

    material.uniforms.uBass.value = aBass;
    material.uniforms.uBassPeak.value = aBassPeak;
    material.uniforms.uMid.value = aMid;
    material.uniforms.uHigh.value = aHigh;

    // Pack per-band envelopes into two vec4 uniforms (scaled by sensitivity)
    const e = envelopes;
    material.uniforms.uBandEnvelopes0.value.set(
      Math.min(e[0] * s, 1), Math.min(e[1] * s, 1),
      Math.min(e[2] * s, 1), Math.min(e[3] * s, 1)
    );
    material.uniforms.uBandEnvelopes1.value.set(
      Math.min(e[4] * s, 1), Math.min(e[5] * s, 1),
      Math.min(e[6] * s, 1), Math.min(e[7] * s, 1)
    );

    // Visualizer bars reflect the Bass/Mid/High Hz slider ranges
    bassBar.style.width = `${aBass * 100}%`;
    bassBar.style.background = `rgba(255, 0, 102, ${0.4 + aBass * 0.6})`;
    midBar.style.width = `${aMid * 100}%`;
    midBar.style.background = `rgba(0, 255, 102, ${0.4 + aMid * 0.6})`;
    highBar.style.width = `${aHigh * 100}%`;
    highBar.style.background = `rgba(0, 102, 255, ${0.4 + aHigh * 0.6})`;

    // Update scrubber
    const audio = audioAnalyzer.audioElement;
    if (audio && audio.duration && !isScrubbing) {
      scrubber.value = (audio.currentTime / audio.duration) * 100;
      currentTimeEl.textContent = formatTime(audio.currentTime);
      totalTimeEl.textContent = formatTime(audio.duration);
    }
  }

  // Update uniforms from controls
  material.uniforms.uTime.value = elapsedTime;
  material.uniforms.uBlobCount.value = controls.blobCount;
  material.uniforms.uBlobSize.value = controls.blobSize;
  material.uniforms.uMergeStrength.value = controls.mergeStrength;
  material.uniforms.uAnimSpeed.value = controls.animSpeed;
  material.uniforms.uDeformation.value = controls.deformation;
  material.uniforms.uGlossiness.value = controls.glossiness;
  material.uniforms.uSpread.value = controls.spread;
  material.uniforms.uZoom.value = controls.zoom;
  material.uniforms.uBaseHue.value = controls.baseHue;
  material.uniforms.uBaseSat.value = controls.baseSat;
  material.uniforms.uBaseLight.value = controls.baseLight;
  material.uniforms.uShadow.value = controls.shadow;
  material.uniforms.uHighlight.value = controls.highlight;
  material.uniforms.uOpacity.value = controls.opacity;
  material.uniforms.uIridescence.value = controls.iridescence;
  material.uniforms.uRainbow.value = controls.rainbow;
  material.uniforms.uColorScheme.value = controls.colorScheme;

  renderer.render(scene, camera);
}

animate();

window.addEventListener('beforeunload', () => {
  audioAnalyzer.dispose();
});
