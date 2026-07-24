"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const SIMULATION_SIZE = 256;
const HERO_DENSITY = 230;
const HERO_PARTICLE_SCALE = 0.59;
const HERO_RING_WIDTH = 0.006;
const HERO_SECONDARY_RING_WIDTH = 0.107;
const HERO_RING_DISPLACEMENT = 0.62;

const SIMPLEX_NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
  return mod289(((x * 34.0) + 10.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

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
  vec4 p = permute(
    permute(
      permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
      i.y + vec4(0.0, i1.y, i2.y, 1.0)
    ) +
    i.x + vec4(0.0, i1.x, i2.x, 1.0)
  );
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
  vec4 norm = taylorInvSqrt(
    vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3))
  );
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(
    0.6 - vec4(
      dot(x0, x0),
      dot(x1, x1),
      dot(x2, x2),
      dot(x3, x3)
    ),
    0.0
  );
  m *= m;
  return 42.0 * dot(
    m * m,
    vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3))
  );
}
`;

const SIMULATION_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

const SIMULATION_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uPosition;
uniform sampler2D uReference;
uniform vec2 uRingPosition;
uniform float uTime;
uniform float uRingRadius;
uniform float uRingWidth;
uniform float uSecondaryRingWidth;
uniform float uRingDisplacement;
varying vec2 vUv;

${SIMPLEX_NOISE_GLSL}

void main() {
  vec4 previousFrame = texture2D(uPosition, vUv);
  vec4 referenceFrame = texture2D(uReference, vUv);
  vec2 referencePosition = referenceFrame.xy;
  vec2 previousPosition = previousFrame.xy;
  float previousScale = previousFrame.z;
  float previousVelocity = previousFrame.w;
  float time = uTime * 0.5;

  float distanceToRing = distance(referencePosition, uRingPosition);
  vec2 contourPosition = referencePosition - uRingPosition;
  float contourWarp =
    snoise(
      vec3(
        contourPosition * 2.4 + vec2(31.42, 17.73),
        time * 0.22
      )
    ) *
    0.018;
  contourWarp +=
    snoise(
      vec3(
        contourPosition * 6.5 + vec2(8.17, 43.91),
        time * 0.31
      )
    ) *
    0.006;
  float warpedDistance = distanceToRing + contourWarp;
  float broadNoise = snoise(
    vec3(referencePosition * 0.2 + vec2(18.4924, 72.9744), time * 0.5)
  );
  float noisyDistance =
    distance(
    referencePosition + broadNoise * 0.005,
    uRingPosition
    ) +
    contourWarp;

  float thinRing =
    smoothstep(
      uRingRadius - uRingWidth * 2.0,
      uRingRadius,
      warpedDistance
    ) -
    smoothstep(
      uRingRadius,
      uRingRadius + uRingWidth,
      noisyDistance
    );
  float secondaryRing =
    smoothstep(
      uRingRadius - uSecondaryRingWidth * 2.0,
      uRingRadius,
      warpedDistance
    ) -
    smoothstep(
      uRingRadius,
      uRingRadius + uSecondaryRingWidth,
      noisyDistance
    );
  float innerField = smoothstep(
    uRingRadius + uSecondaryRingWidth,
    uRingRadius,
    warpedDistance
  );

  thinRing = pow(max(thinRing, 0.0), 2.0);
  secondaryRing = pow(max(secondaryRing, 0.0), 3.0);
  float scaleTarget = thinRing + secondaryRing * 3.0 + innerField * 0.4;
  scaleTarget +=
    snoise(
      vec3(
        referencePosition * 30.0 + vec2(11.4924, 12.9744),
        time * 0.5
      )
    ) *
    innerField *
    0.5;
  float fieldNoise = snoise(
    vec3(
      referencePosition * 2.0 + vec2(18.4924, 72.9744),
      time * 0.5
    )
  );
  scaleTarget += pow((fieldNoise + 1.5) * 0.5, 2.0) * 0.6;

  vec2 mediumNoise = vec2(
    snoise(
      vec3(referencePosition * 4.0 + vec2(88.494, 32.4397), time * 0.35)
    ),
    snoise(
      vec3(referencePosition * 4.0 + vec2(50.904, 120.947), time * 0.35)
    )
  );
  vec2 fineNoise = vec2(
    snoise(
      vec3(referencePosition * 20.0 + vec2(18.4924, 72.9744), time * 0.5)
    ),
    snoise(
      vec3(referencePosition * 20.0 + vec2(50.904, 120.947), time * 0.5)
    )
  );
  vec2 displacement = mediumNoise * 0.03 + fineNoise * 0.005;
  displacement.x +=
    sin(referencePosition.x * 20.0 + time * 4.0) *
    0.02 *
    clamp(distanceToRing, 0.0, 1.0);
  displacement.y +=
    cos(referencePosition.y * 20.0 + time * 3.0) *
    0.02 *
    clamp(distanceToRing, 0.0, 1.0);

  vec2 position = previousPosition * 0.8;
  position -=
    (uRingPosition - (referencePosition + displacement)) *
    pow(max(secondaryRing, 0.0), 0.75) *
    uRingDisplacement;
  vec2 finalPosition =
    referencePosition +
    displacement +
    position * 0.25;

  float scale = mix(previousScale, scaleTarget, 0.2);
  float velocity = previousVelocity * 0.5 + scale * 0.25;
  gl_FragColor = vec4(finalPosition, scale, velocity);
}
`;

const PARTICLE_VERTEX_SHADER = /* glsl */ `
precision highp float;

attribute vec4 aSeed;
uniform sampler2D uPosition;
uniform float uPixelRatio;
uniform float uParticleScale;
varying vec4 vSeed;
varying vec2 vLocalPosition;
varying float vScale;
varying float vVelocity;

void main() {
  vec4 particle = texture2D(uPosition, uv);
  vSeed = aSeed;
  vLocalPosition = particle.xy;
  vScale = particle.z;
  vVelocity = particle.w;
  vec4 viewSpace = modelViewMatrix * vec4(particle.xy, 0.0, 1.0);
  gl_Position = projectionMatrix * viewSpace;
  gl_PointSize =
    particle.z *
    7.0 *
    (uPixelRatio * 0.5) *
    uParticleScale;
}
`;

const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec2 uRingPosition;
uniform float uTime;
uniform float uAlpha;
varying vec4 vSeed;
varying vec2 vLocalPosition;
varying float vScale;
varying float vVelocity;

${SIMPLEX_NOISE_GLSL}

mat2 rotate2d(float angle) {
  float sine = sin(angle);
  float cosine = cos(angle);
  return mat2(cosine, sine, -sine, cosine);
}

float roundedBoxDistance(vec2 point, vec2 bounds, float radius) {
  vec2 delta = abs(point) - bounds + radius;
  return min(max(delta.x, delta.y), 0.0) +
    length(max(delta, 0.0)) -
    radius;
}

void main() {
  float radialAngle = atan(
    vLocalPosition.y - uRingPosition.y,
    vLocalPosition.x - uRingPosition.x
  );
  float noiseAngle = snoise(
    vec3(vLocalPosition * 10.0 + vec2(18.4924, 72.9744), uTime * 0.85)
  );
  vec2 point = gl_PointCoord - 0.5;
  point.y *= -1.0;
  point = rotate2d(-radialAngle + noiseAngle * 0.5) * point;

  float colorNoise = snoise(
    vec3(vLocalPosition * 2.0 + vec2(74.664, 91.556), uTime * 0.5)
  );
  float progress = smoothstep(
    0.0,
    0.75,
    pow((colorNoise + 1.0) * 0.5, 2.0)
  );
  float middle = 0.8;
  vec3 colorA = mix(uColor1, uColor2, progress / middle);
  vec3 colorB = mix(
    uColor2,
    uColor3,
    (progress - middle) / (1.0 - middle)
  );
  vec3 color = mix(colorA, colorB, step(middle, progress));

  float rounded = roundedBoxDistance(point, vec2(0.5, 0.2), 0.25);
  float shapeAlpha = smoothstep(0.1, 0.0, rounded);
  float scaleAlpha = smoothstep(0.1, 0.2, vScale);
  float alpha = uAlpha * shapeAlpha * scaleAlpha;
  if (alpha < 0.01) discard;

  color *= clamp(vVelocity, 0.0, 1.0);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), alpha);
}
`;

interface Point {
  x: number;
  y: number;
}

interface SimulationResources {
  renderer: THREE.WebGLRenderer;
  simulationScene: THREE.Scene;
  simulationCamera: THREE.OrthographicCamera;
  simulationMaterial: THREE.ShaderMaterial;
  simulationQuad: THREE.Mesh;
  particleScene: THREE.Scene;
  particleCamera: THREE.PerspectiveCamera;
  particleMaterial: THREE.ShaderMaterial;
  particles: THREE.Points;
  referenceTexture: THREE.DataTexture;
  readTarget: THREE.WebGLRenderTarget;
  writeTarget: THREE.WebGLRenderTarget;
}

export default function LumiWebGLParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const resources = createSimulation(canvas);
    if (!resources) return;

    let width = Math.max(1, window.innerWidth);
    let height = Math.max(1, window.innerHeight);
    let aspect = width / height;
    let animationFrame = 0;
    let isVisible = true;
    let pointerInside = false;
    let everRendered = false;
    const startTime = performance.now();
    const pointerPosition = new THREE.Vector2(0, 0);
    const cursorPosition = new THREE.Vector2(0, 0);
    const ringPosition = new THREE.Vector2(0, 0);
    const ambientNoise = new SmoothNoise();

    const resize = () => {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      aspect = width / height;
      const pixelRatio = window.devicePixelRatio || 1;
      resources.renderer.setPixelRatio(pixelRatio);
      resources.renderer.setSize(width, height, false);
      resources.particleCamera.aspect = aspect;
      resources.particleCamera.updateProjectionMatrix();
      resources.particleMaterial.uniforms.uPixelRatio.value = pixelRatio;
      resources.particleMaterial.uniforms.uParticleScale.value =
        (width / 2000) * HERO_PARTICLE_SCALE;
    };

    const updatePointer = (event: PointerEvent) => {
      pointerPosition.set(
        (event.clientX / width) * 2 - 1,
        -(event.clientY / height) * 2 + 1,
      );
      pointerInside = true;
    };

    const releasePointer = () => {
      pointerInside = false;
    };

    const renderFrame = (now: number) => {
      animationFrame = window.requestAnimationFrame(renderFrame);
      if (!isVisible) return;

      const elapsed = (now - startTime) / 1000;
      const noiseX =
        (ambientNoise.getValue(elapsed * 0.66 + 94.234) - 0.5) * 2;
      const noiseY =
        (ambientNoise.getValue(elapsed * 0.75 + 21.028) - 0.5) * 2;
      if (pointerInside) {
        const cameraHalfHeight =
          Math.tan(THREE.MathUtils.degToRad(20)) * 3.1;
        const intersectionX =
          pointerPosition.x * cameraHalfHeight * aspect;
        const intersectionY = pointerPosition.y * cameraHalfHeight;
        cursorPosition.set(
          intersectionX * 0.175 + noiseX * 0.1,
          intersectionY * 0.175 + noiseY * 0.1,
        );
        ringPosition.lerp(cursorPosition, 0.02);
      } else {
        cursorPosition.set(noiseX * 0.2, noiseY * 0.1);
        ringPosition.lerp(cursorPosition, 0.01);
      }

      const simulationUniforms = resources.simulationMaterial.uniforms;
      simulationUniforms.uPosition.value = everRendered
        ? resources.readTarget.texture
        : resources.referenceTexture;
      simulationUniforms.uRingPosition.value.copy(ringPosition);
      simulationUniforms.uTime.value = reducedMotion ? 1.4 : elapsed;
      simulationUniforms.uRingRadius.value =
        0.175 +
        Math.sin((reducedMotion ? 1.4 : elapsed) * 1.0) * 0.042 +
        Math.cos((reducedMotion ? 1.4 : elapsed) * 3.0) * 0.028;

      resources.renderer.setRenderTarget(resources.writeTarget);
      resources.renderer.render(
        resources.simulationScene,
        resources.simulationCamera,
      );
      resources.renderer.setRenderTarget(null);

      const particleUniforms = resources.particleMaterial.uniforms;
      particleUniforms.uPosition.value = everRendered
        ? resources.writeTarget.texture
        : resources.referenceTexture;
      particleUniforms.uRingPosition.value.copy(ringPosition);
      particleUniforms.uTime.value = reducedMotion ? 1.4 : elapsed;
      resources.renderer.clear();
      resources.renderer.render(
        resources.particleScene,
        resources.particleCamera,
      );

      const previousReadTarget = resources.readTarget;
      resources.readTarget = resources.writeTarget;
      resources.writeTarget = previousReadTarget;
      everRendered = true;
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? true;
      },
      { threshold: 0 },
    );

    resize();
    observer.observe(canvas);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", updatePointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", releasePointer);
    animationFrame = window.requestAnimationFrame(renderFrame);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", updatePointer);
      document.documentElement.removeEventListener(
        "pointerleave",
        releasePointer,
      );
      disposeSimulation(resources);
    };
  }, []);

  return <canvas ref={canvasRef} className="lumi-particle-field" aria-hidden />;
}

function createSimulation(
  canvas: HTMLCanvasElement,
): SimulationResources | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: true,
      powerPreference: "high-performance",
      precision: "highp",
      preserveDrawingBuffer: true,
      stencil: false,
    });
  } catch {
    return null;
  }

  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  const aspect =
    Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight);
  const points = createPoissonPoints(HERO_DENSITY);
  const pointCount = Math.min(points.length, SIMULATION_SIZE * SIMULATION_SIZE);
  const textureData = new Float32Array(
    SIMULATION_SIZE * SIMULATION_SIZE * 4,
  );
  textureData.fill(0);

  for (let index = 0; index < pointCount; index += 1) {
    const point = points[index];
    const offset = index * 4;
    textureData[offset] = point.x;
    textureData[offset + 1] = point.y;
  }

  const referenceTexture = new THREE.DataTexture(
    textureData,
    SIMULATION_SIZE,
    SIMULATION_SIZE,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  referenceTexture.minFilter = THREE.NearestFilter;
  referenceTexture.magFilter = THREE.NearestFilter;
  referenceTexture.wrapS = THREE.ClampToEdgeWrapping;
  referenceTexture.wrapT = THREE.ClampToEdgeWrapping;
  referenceTexture.needsUpdate = true;

  const createRenderTarget = () =>
    new THREE.WebGLRenderTarget(SIMULATION_SIZE, SIMULATION_SIZE, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
  const readTarget = createRenderTarget();
  const writeTarget = createRenderTarget();
  const simulationMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uPosition: { value: referenceTexture },
      uReference: { value: referenceTexture },
      uRingPosition: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uRingRadius: { value: 0.175 },
      uRingWidth: { value: HERO_RING_WIDTH },
      uSecondaryRingWidth: { value: HERO_SECONDARY_RING_WIDTH },
      uRingDisplacement: { value: HERO_RING_DISPLACEMENT },
    },
    vertexShader: SIMULATION_VERTEX_SHADER,
    fragmentShader: SIMULATION_FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
  });
  const simulationScene = new THREE.Scene();
  const simulationCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const simulationQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    simulationMaterial,
  );
  simulationScene.add(simulationQuad);

  const particleGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(pointCount * 3);
  const textureCoordinates = new Float32Array(pointCount * 2);
  const seeds = new Float32Array(pointCount * 4);
  const random = createSeededRandom(918273);

  for (let index = 0; index < pointCount; index += 1) {
    const textureX = index % SIMULATION_SIZE;
    const textureY = Math.floor(index / SIMULATION_SIZE);
    textureCoordinates[index * 2] = (textureX + 0.5) / SIMULATION_SIZE;
    textureCoordinates[index * 2 + 1] =
      (textureY + 0.5) / SIMULATION_SIZE;
    seeds[index * 4] = random();
    seeds[index * 4 + 1] = random();
    seeds[index * 4 + 2] = random();
    seeds[index * 4 + 3] = random();
  }

  particleGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  particleGeometry.setAttribute(
    "uv",
    new THREE.BufferAttribute(textureCoordinates, 2),
  );
  particleGeometry.setAttribute(
    "aSeed",
    new THREE.BufferAttribute(seeds, 4),
  );
  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uPosition: { value: referenceTexture },
      uPixelRatio: { value: window.devicePixelRatio || 1 },
      uParticleScale: {
        value:
          (Math.max(1, window.innerWidth) / 2000) *
          HERO_PARTICLE_SCALE,
      },
      uRingPosition: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uAlpha: { value: 1 },
      uColor1: { value: new THREE.Color("#25f4ee") },
      uColor2: { value: new THREE.Color("#fe2c55") },
      uColor3: { value: new THREE.Color("#25f4ee") },
    },
    vertexShader: PARTICLE_VERTEX_SHADER,
    fragmentShader: PARTICLE_FRAGMENT_SHADER,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const particleScene = new THREE.Scene();
  const particleCamera = new THREE.PerspectiveCamera(
    40,
    aspect,
    0.1,
    1000,
  );
  particleCamera.position.z = 3.1;
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.scale.set(5, 5, 5);
  particleScene.add(particles);

  renderer.setRenderTarget(readTarget);
  renderer.clear();
  renderer.setRenderTarget(writeTarget);
  renderer.clear();
  renderer.setRenderTarget(null);

  return {
    renderer,
    simulationScene,
    simulationCamera,
    simulationMaterial,
    simulationQuad,
    particleScene,
    particleCamera,
    particleMaterial,
    particles,
    referenceTexture,
    readTarget,
    writeTarget,
  };
}

function disposeSimulation(resources: SimulationResources) {
  resources.simulationQuad.geometry.dispose();
  resources.simulationMaterial.dispose();
  resources.particles.geometry.dispose();
  resources.particleMaterial.dispose();
  resources.referenceTexture.dispose();
  resources.readTarget.dispose();
  resources.writeTarget.dispose();
  resources.renderer.dispose();
}

function createPoissonPoints(density: number): Point[] {
  const random = createSeededRandom(357911);
  const minimumDistance = remap(density, 0, 300, 10, 2);
  const cellSize = minimumDistance / Math.SQRT2;
  const minX = 0;
  const minY = 0;
  const domainWidth = 500;
  const domainHeight = 500;
  const columns = Math.ceil(domainWidth / cellSize);
  const rows = Math.ceil(domainHeight / cellSize);
  const grid = new Int32Array(columns * rows);
  grid.fill(-1);
  const points: Point[] = [];
  const active: number[] = [];

  const insert = (point: Point) => {
    const index = points.length;
    points.push(point);
    active.push(index);
    const column = Math.floor((point.x - minX) / cellSize);
    const row = Math.floor((point.y - minY) / cellSize);
    grid[row * columns + column] = index;
  };

  insert({
    x: minX + random() * domainWidth,
    y: minY + random() * domainHeight,
  });

  while (
    active.length > 0 &&
    points.length < SIMULATION_SIZE * SIMULATION_SIZE
  ) {
    const activeSlot = Math.floor(random() * active.length);
    const origin = points[active[activeSlot]];
    let inserted = false;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const radius = minimumDistance * (1 + random());
      const candidate = {
        x: origin.x + Math.cos(angle) * radius,
        y: origin.y + Math.sin(angle) * radius,
      };
      if (
        candidate.x < minX ||
        candidate.x >= minX + domainWidth ||
        candidate.y < minY ||
        candidate.y >= minY + domainHeight
      ) {
        continue;
      }

      const column = Math.floor((candidate.x - minX) / cellSize);
      const row = Math.floor((candidate.y - minY) / cellSize);
      let valid = true;
      for (
        let neighborY = Math.max(0, row - 2);
        neighborY <= Math.min(rows - 1, row + 2) && valid;
        neighborY += 1
      ) {
        for (
          let neighborX = Math.max(0, column - 2);
          neighborX <= Math.min(columns - 1, column + 2);
          neighborX += 1
        ) {
          const pointIndex = grid[neighborY * columns + neighborX];
          if (pointIndex < 0) continue;
          const point = points[pointIndex];
          const deltaX = point.x - candidate.x;
          const deltaY = point.y - candidate.y;
          if (
            deltaX * deltaX + deltaY * deltaY <
            minimumDistance * minimumDistance
          ) {
            valid = false;
            break;
          }
        }
      }

      if (valid) {
        insert(candidate);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      active[activeSlot] = active[active.length - 1];
      active.pop();
    }
  }

  return points.map((point) => ({
    x: (point.x - 250) / 250,
    y: (point.y - 250) / 250,
  }));
}

class SmoothNoise {
  private readonly values = Array.from({ length: 256 }, Math.random);

  getValue(input: number) {
    const coordinate = input;
    const index = Math.floor(coordinate);
    const fraction = coordinate - index;
    const smoothFraction = fraction * fraction * (3 - 2 * fraction);
    const first = this.values[index & 255];
    const second = this.values[(index + 1) & 255];
    return first * (1 - smoothFraction) + second * smoothFraction;
  }
}

function createSeededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function remap(
  value: number,
  inputMin: number,
  inputMax: number,
  outputMin: number,
  outputMax: number,
) {
  return (
    ((value - inputMin) * (outputMax - outputMin)) /
      (inputMax - inputMin) +
    outputMin
  );
}
