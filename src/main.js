import * as THREE from 'three';
import { AudioAnalyzer } from './audioAnalyzer.js';
import vertexShader from './shaders/vertexShader.glsl?raw';
import fragmentShader from './shaders/fragmentShader.glsl?raw';

// Audio analyzer
const audioAnalyzer = new AudioAnalyzer();
let isAudioActive = false;

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

fileBtn.addEventListener('click', () => {
  audioFileInput.click();
});

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

audioFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
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
const controls = {
  blobCount: 4,
  blobSize: 0.8,
  mergeStrength: 0.7,
  animSpeed: 1.0,
  deformation: 0.3,
  glossiness: 0.7,
  spread: 2.0,
  sensitivity: 2.0,
};

// Bind sliders to controls
function bindSlider(id, key) {
  const slider = document.getElementById(id);
  const valueEl = document.getElementById(id + 'Value');
  if (!slider) return;
  slider.value = controls[key];
  valueEl.textContent = parseFloat(controls[key]).toFixed(2);
  slider.addEventListener('input', () => {
    controls[key] = parseFloat(slider.value);
    valueEl.textContent = parseFloat(slider.value).toFixed(2);
  });
}

bindSlider('blobCount', 'blobCount');
bindSlider('blobSize', 'blobSize');
bindSlider('mergeStrength', 'mergeStrength');
bindSlider('animSpeed', 'animSpeed');
bindSlider('deformation', 'deformation');
bindSlider('glossiness', 'glossiness');
bindSlider('spread', 'spread');
bindSlider('sensitivity', 'sensitivity');

// Three.js setup - fullscreen quad for raymarching
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('container').appendChild(renderer.domElement);

// Fullscreen quad geometry
const quadGeometry = new THREE.PlaneGeometry(2, 2);

const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(
      window.innerWidth * Math.min(window.devicePixelRatio, 2),
      window.innerHeight * Math.min(window.devicePixelRatio, 2)
    )},
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uBlobCount: { value: controls.blobCount },
    uBlobSize: { value: controls.blobSize },
    uMergeStrength: { value: controls.mergeStrength },
    uAnimSpeed: { value: controls.animSpeed },
    uDeformation: { value: controls.deformation },
    uGlossiness: { value: controls.glossiness },
    uSpread: { value: controls.spread },
  },
  vertexShader,
  fragmentShader,
});

const quad = new THREE.Mesh(quadGeometry, material);
scene.add(quad);

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
    audioAnalyzer.update();
    const { bass, mid, high } = audioAnalyzer.getFrequencyData();

    // Amplify with sensitivity and clamp to 0-1
    const s = controls.sensitivity;
    const aBass = Math.min(bass * s, 1.0);
    const aMid = Math.min(mid * s, 1.0);
    const aHigh = Math.min(high * s, 1.0);

    material.uniforms.uBass.value = aBass;
    material.uniforms.uMid.value = aMid;
    material.uniforms.uHigh.value = aHigh;

    bassBar.style.background = `linear-gradient(to top, rgba(255, 0, 102, ${aBass}), rgba(255, 102, 153, ${aBass * 0.5}))`;
    midBar.style.background = `linear-gradient(to top, rgba(0, 255, 102, ${aMid}), rgba(102, 255, 153, ${aMid * 0.5}))`;
    highBar.style.background = `linear-gradient(to top, rgba(0, 102, 255, ${aHigh}), rgba(102, 153, 255, ${aHigh * 0.5}))`;

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

  renderer.render(scene, camera);
}

animate();

window.addEventListener('beforeunload', () => {
  audioAnalyzer.dispose();
});
