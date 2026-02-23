precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uPan;
uniform float uBass;
uniform float uMid;
uniform float uHigh;

// Controls
uniform float uBlobCount;
uniform float uBlobSize;
uniform float uMergeStrength;
uniform float uAnimSpeed;
uniform float uDeformation;
uniform float uGlossiness;
uniform float uSpread;
uniform float uZoom;
uniform float uBaseHue;
uniform float uBaseSat;
uniform float uBaseLight;
uniform float uShadow;
uniform float uHighlight;
uniform float uOpacity;

// HSL to RGB (h,s,l in 0-1)
vec3 hsl2rgb(vec3 c) {
  vec3 K = vec3(1.0, 2.0/3.0, 1.0/3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - 3.0);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Smooth minimum for metaball blending
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Simplex noise (compact)
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Get animated position for blob i
vec3 getBlobPos(int i, float t) {
  float fi = float(i);
  float spread = uSpread;

  // Each blob gets a unique orbit
  float a1 = fi * 2.399 + 0.5;
  float a2 = fi * 1.721 + 1.0;
  float a3 = fi * 3.117 + 0.3;

  vec3 pos = vec3(
    sin(t * (0.4 + fi * 0.07) + a1) * spread,
    cos(t * (0.35 + fi * 0.09) + a2) * spread * 0.8,
    sin(t * (0.25 + fi * 0.05) + a3) * spread * 0.4
  );

  return pos;
}

// Get animated size for blob i
float getBlobRadius(int i, float t) {
  float fi = float(i);
  float base = uBlobSize * (0.7 + 0.3 * sin(fi * 1.5 + 0.5));

  // Gentle organic pulsing
  float pulse = sin(t * 2.0 + fi * 2.0) * 0.05;
  base *= 1.0 + pulse;

  // Uniform audio scale — all blobs grow/shrink together
  float bassKick = uBass * uBass;
  float audioScale = 1.0 + bassKick * 1.5 + uMid * 0.6 + uHigh * 0.3;
  base *= audioScale;

  return base;
}

// Touch offset moves the blobs in view-plane XY (not the camera)
vec3 touchOffset() {
  return vec3(uPan.x, uPan.y, 0.0);
}

// Scene SDF - all metaballs combined
float sceneSDF(vec3 p) {
  float t = uTime * uAnimSpeed;
  int count = int(uBlobCount);
  vec3 toff = touchOffset();

  float k = uMergeStrength;
  float deformAmt = uDeformation;

  // Start with first blob (positions offset by touch)
  vec3 pos0 = getBlobPos(0, t) + toff;
  float r0 = getBlobRadius(0, t);
  float d = length(p - pos0) - r0;

  // Surface deformation (organic movement only, not audio-driven)
  if (deformAmt > 0.01) {
    d += snoise(p * 1.2 + t * 0.3) * deformAmt * 0.08;
  }

  // Merge remaining blobs
  for (int i = 1; i < 8; i++) {
    if (i >= count) break;
    vec3 posI = getBlobPos(i, t) + toff;
    float rI = getBlobRadius(i, t);
    float dI = length(p - posI) - rI;

    if (deformAmt > 0.01) {
      dI += snoise(p * 1.2 + t * 0.3 + float(i) * 5.0) * deformAmt * 0.08;
    }

    d = smin(d, dI, k);
  }

  return d;
}

// Calculate normal via gradient
vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.005, 0.0);
  return normalize(vec3(
    sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
    sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
    sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)
  ));
}

// Soft shadow
float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
  float res = 1.0;
  float t = mint;
  for (int i = 0; i < 24; i++) {
    float h = sceneSDF(ro + rd * t);
    res = min(res, k * h / t);
    t += clamp(h, 0.02, 0.2);
    if (h < 0.001 || t > maxt) break;
  }
  return clamp(res, 0.0, 1.0);
}

// Ambient occlusion (softer to reduce black between blobs)
float calcAO(vec3 pos, vec3 nor) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.01 + 0.10 * float(i);
    float d = sceneSDF(pos + h * nor);
    occ += (h - d) * sca;
    sca *= 0.92;
  }
  return clamp(1.0 - 1.5 * occ, 0.0, 1.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
  uv /= max(uZoom, 0.01);

  // Camera setup
  vec3 ro = vec3(0.0, 0.3, 5.5);  // ray origin
  vec3 rd = normalize(vec3(uv, -1.8));  // ray direction (FOV)

  // Background - light gray gradient
  vec3 bgColor = mix(vec3(0.78), vec3(0.82), uv.y + 0.5);

  // Raymarching
  float t = 0.0;
  float d;
  bool hit = false;

  for (int i = 0; i < 100; i++) {
    vec3 p = ro + rd * t;
    d = sceneSDF(p);

    if (d < 0.001) {
      hit = true;
      break;
    }

    t += d;

    if (t > 20.0) break;
  }

  if (!hit) {
    gl_FragColor = vec4(bgColor, 1.0);
    return;
  }

  // We hit the surface
  vec3 pos = ro + rd * t;
  vec3 nor = calcNormal(pos);
  vec3 viewDir = normalize(ro - pos);

  // Lighting
  vec3 lightPos1 = normalize(vec3(2.0, 3.0, 4.0));
  vec3 lightPos2 = normalize(vec3(-3.0, 2.0, -1.0));
  vec3 lightPos3 = normalize(vec3(0.5, -1.0, 3.0));

  // Base color from HSL
  vec3 baseColor = hsl2rgb(vec3(uBaseHue, uBaseSat, uBaseLight));

  // Subtle audio tint
  float audioIntensity = (uBass + uMid + uHigh) / 3.0;
  baseColor += vec3(uBass * 0.02, uMid * 0.015, uHigh * 0.03) * audioIntensity;

  // Diffuse (wrapped for softness)
  float diff1 = max(dot(nor, lightPos1), 0.0) * 0.5 + 0.5;
  float diff2 = max(dot(nor, lightPos2), 0.0) * 0.3 + 0.3;
  float diff3 = max(dot(nor, lightPos3), 0.0);
  float diffMix = diff1 * 0.55 + diff2 * 0.25 + diff3 * 0.15;
  vec3 diffuse = baseColor * diffMix;

  // Specular (Blinn-Phong) scaled by uHighlight
  float shininess = 40.0 + uGlossiness * 160.0;
  vec3 h1 = normalize(lightPos1 + viewDir);
  vec3 h2 = normalize(lightPos2 + viewDir);
  vec3 h3 = normalize(lightPos3 + viewDir);
  float spec1 = pow(max(dot(nor, h1), 0.0), shininess) * 1.2;
  float spec2 = pow(max(dot(nor, h2), 0.0), shininess * 0.7) * 0.5;
  float spec3 = pow(max(dot(nor, h3), 0.0), shininess * 0.5) * 0.3;
  vec3 specular = vec3(1.0) * (spec1 + spec2 + spec3) * (0.3 + uGlossiness * 0.7) * uHighlight;

  // Fresnel scaled by uHighlight
  float fresnel = pow(1.0 - max(dot(nor, viewDir), 0.0), 4.0);
  vec3 fresnelColor = vec3(0.95, 0.95, 0.97) * fresnel * 0.4 * uHighlight;

  // Fake environment reflection (lighter, less black)
  vec3 reflDir = reflect(-viewDir, nor);
  float envReflect = smoothstep(-0.2, 1.0, reflDir.y) * 0.18;
  vec3 envColor = mix(vec3(0.92, 0.92, 0.94), vec3(1.0), envReflect);

  // Subsurface scattering
  float sss = pow(max(dot(viewDir, -lightPos1), 0.0), 3.0) * 0.06;

  // AO
  float ao = calcAO(pos, nor);

  // Soft shadow from main light (darker when uShadow higher)
  float shadow = softShadow(pos + nor * 0.01, lightPos1, 0.02, 5.0, 16.0);
  shadow = mix(shadow * 0.5 + 0.5, shadow, uShadow * 0.5 + 0.5);

  // Combine with lifted floor so crevices between blobs aren't fully black
  float lighting = 0.45 + 0.55 * (ao * shadow);
  vec3 color = diffuse * lighting + specular * shadow + fresnelColor + vec3(sss);
  color = mix(color, envColor, fresnel * 0.18);
  color += specular * audioIntensity * 0.2;

  // Tone mapping
  color = color / (color + vec3(0.12));
  color = pow(color, vec3(0.95));
  color = clamp(color, 0.0, 1.0);

  // Soft edge blend with background (depth fog)
  float fog = 1.0 - smoothstep(8.0, 18.0, t);
  color = mix(bgColor, color, fog);

  // See-through opacity: edges (fresnel) more transparent, like glass/soap bubble
  float seeThrough = (1.0 - uOpacity) * (0.35 + 0.65 * fresnel);
  color = mix(bgColor, color, 1.0 - seeThrough);

  gl_FragColor = vec4(color, 1.0);
}
