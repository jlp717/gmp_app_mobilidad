---
name: threejs-scene
description: React Three Fiber + Drei 3D scenes — Canvas setup, PBR materials, instanced meshes, GLTF models, lighting, performance optimization.
---

# React Three Fiber + Drei — Professional 3D Scene Guide

## Overview

React Three Fiber (R3F) is the idiomatic React renderer for Three.js. It maps Three.js classes to JSX components, integrates with React's reconciler and Suspense, and gives access to the full Three.js API without manual scene graph management. Drei provides a curated set of high-level helpers built on R3F.

## When to Use

- Interactive 3D product viewers, configurators, or visualizations
- Immersive landing pages with WebGL effects
- Data visualizations requiring 3D space
- Game prototypes or simulations in the browser

## When NOT to Use

- Simple CSS animations or 2D SVG graphics — WebGL has significant CPU/GPU overhead
- Users primarily on low-end mobile devices without GPU (check with `gl.getParameter(gl.MAX_TEXTURE_SIZE)`)
- Purely decorative scenes where a video loop would be lighter

---

## Step-by-Step Process

### 1. Install

```bash
npm install three @react-three/fiber @react-three/drei
npm install -D @types/three
```

### 2. Canvas Setup — Camera, Shadows, Tone Mapping

```tsx
// components/Scene.tsx
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import * as THREE from 'three';
import { SceneContent } from './SceneContent';
import { Loader } from './Loader';

export function Scene() {
  return (
    <Canvas
      shadows                                    // Enable shadow maps
      dpr={[1, 2]}                               // Cap pixel ratio at 2 for performance
      camera={{ position: [0, 2, 6], fov: 45, near: 0.1, far: 100 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping, // Cinematic tone mapping
        toneMappingExposure: 1.2,
        outputColorSpace: THREE.SRGBColorSpace,   // Correct color space for PBR
      }}
    >
      <Suspense fallback={<Loader />}>
        <SceneContent />
      </Suspense>
    </Canvas>
  );
}
```

### 3. Lighting — Directional + Ambient + Hemisphere

```tsx
// components/SceneLighting.tsx
import { useRef } from 'react';
import { DirectionalLight } from 'three';
import { useHelper } from '@react-three/drei';
import * as THREE from 'three';

export function SceneLighting() {
  const dirLightRef = useRef<DirectionalLight>(null!);
  // Uncomment in dev to visualize shadow camera:
  // useHelper(dirLightRef, THREE.DirectionalLightHelper, 1);

  return (
    <>
      {/* Ambient — fills shadows, prevents pure black */}
      <ambientLight intensity={0.3} />

      {/* Hemisphere — sky/ground color gradient */}
      <hemisphereLight skyColor="#b1e1ff" groundColor="#7a5c3e" intensity={0.5} />

      {/* Directional — primary shadow-casting light */}
      <directionalLight
        ref={dirLightRef}
        position={[5, 8, 5]}
        intensity={2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={30}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-bias={-0.0001}
      />
    </>
  );
}
```

### 4. PBR Materials — MeshStandardMaterial & MeshPhysicalMaterial

```tsx
// components/PBRSphere.tsx
import { useTexture, Environment } from '@react-three/drei';

export function PBRSphere() {
  const [colorMap, normalMap, roughnessMap, metalnessMap] = useTexture([
    '/textures/metal_color.jpg',
    '/textures/metal_normal.jpg',
    '/textures/metal_roughness.jpg',
    '/textures/metal_metalness.jpg',
  ]);

  return (
    <>
      <Environment preset="city" />  {/* HDRI environment for reflections */}
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[1, 64, 64]} />
        <meshStandardMaterial
          map={colorMap}
          normalMap={normalMap}
          roughnessMap={roughnessMap}
          metalnessMap={metalnessMap}
          envMapIntensity={1.5}
        />
      </mesh>
    </>
  );
}

// MeshPhysicalMaterial for glass/clearcoat effects
<meshPhysicalMaterial
  transmission={0.95}        // Glass transparency
  thickness={0.5}
  roughness={0}
  ior={1.5}
  clearcoat={1}
  clearcoatRoughness={0.1}
/>
```

### 5. Instanced Meshes — Render Thousands of Objects Efficiently

Instanced meshes render N identical geometries in a single draw call.

```tsx
// components/InstancedParticles.tsx
import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { InstancedMesh, Matrix4, Vector3, Color } from 'three';

const COUNT = 1000;

export function InstancedParticles() {
  const meshRef = useRef<InstancedMesh>(null!);
  const matrix = useMemo(() => new Matrix4(), []);
  const positions = useMemo(
    () => Array.from({ length: COUNT }, () => new Vector3(
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 20,
    )),
    []
  );

  useEffect(() => {
    positions.forEach((pos, i) => {
      matrix.setPosition(pos);
      meshRef.current.setMatrixAt(i, matrix);
      meshRef.current.setColorAt(i, new Color().setHSL(i / COUNT, 0.8, 0.6));
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
    meshRef.current.instanceColor!.needsUpdate = true;
  }, [matrix, positions]);

  useFrame((_, delta) => {
    meshRef.current.rotation.y += delta * 0.05;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]} castShadow>
      <dodecahedronGeometry args={[0.1, 0]} />
      <meshStandardMaterial roughness={0.4} metalness={0.6} />
    </instancedMesh>
  );
}
```

### 6. GLTF Model with Suspense

```tsx
// components/ProductModel.tsx
import { useGLTF, useAnimations } from '@react-three/drei';
import { useEffect, useRef } from 'react';
import { Group } from 'three';

// Preload at module level — starts fetching before component mounts
useGLTF.preload('/models/product.glb');

export function ProductModel({ animate }: { animate: boolean }) {
  const groupRef = useRef<Group>(null!);
  const { scene, animations } = useGLTF('/models/product.glb');
  const { actions } = useAnimations(animations, groupRef);

  useEffect(() => {
    if (animate) {
      actions['Idle']?.play();
    } else {
      actions['Idle']?.stop();
    }
  }, [animate, actions]);

  return (
    <group ref={groupRef}>
      <primitive object={scene} scale={0.01} castShadow receiveShadow />
    </group>
  );
}

// Usage with Suspense fallback
function Scene() {
  return (
    <Suspense fallback={<FallbackBox />}>
      <ProductModel animate={true} />
    </Suspense>
  );
}
```

### 7. Drei Helpers

```tsx
import {
  OrbitControls,
  Environment,
  Stars,
  Text3D,
  ContactShadows,
  Float,
  useProgress,
} from '@react-three/drei';

// Orbit controls with damping
<OrbitControls enablePan={false} minDistance={2} maxDistance={10} enableDamping dampingFactor={0.05} />

// Ambient environment (HDRI)
<Environment preset="sunset" background blur={0.8} />

// Floating animation
<Float speed={2} rotationIntensity={0.5} floatIntensity={1}>
  <ProductModel />
</Float>

// Soft contact shadows (no light required)
<ContactShadows position={[0, -1, 0]} opacity={0.6} scale={10} blur={2} far={4} />

// Loading progress
function Loader() {
  const { progress } = useProgress();
  return <Html center>{Math.round(progress)}%</Html>;
}
```

### 8. Performance Rules

| Rule | Implementation |
|---|---|
| Use `useFrame` for animations, not `setInterval` | `useFrame` is synced to rAF and paused when tab hidden |
| Dispose geometries/materials when unmounted | `geometry.dispose(); material.dispose()` in `useEffect` cleanup |
| Use `instancedMesh` for > 20 identical objects | Reduces draw calls from N to 1 |
| `dpr={[1, 2]}` on Canvas | Prevents 3x retina scaling on high-DPI screens |
| Preload assets with `useGLTF.preload()` | Starts network request before component mounts |
| `Suspense` + boundaries per major scene section | Prevents full scene block on slow assets |

---

## Verification Checklist

- [ ] `Canvas` has `dpr={[1, 2]}` to cap pixel ratio
- [ ] `outputColorSpace: THREE.SRGBColorSpace` set for correct PBR colors
- [ ] Shadow map size is power of 2 (512, 1024, 2048) and no larger than needed
- [ ] `useGLTF.preload()` called at module level for all GLTF assets
- [ ] All models wrapped in `<Suspense>` with a fallback
- [ ] `useFrame` used for per-frame updates, not `setInterval`/`setTimeout`
- [ ] Instanced meshes used for any repeated geometry (> ~20 instances)
- [ ] Geometries and materials disposed in `useEffect` cleanup when component unmounts
- [ ] `<OrbitControls>` has `enableDamping` for smooth feel
- [ ] Scene tested on integrated GPU (not discrete) — Chrome DevTools → Rendering → FPS meter
- [ ] `<Environment>` HDRI loaded asynchronously within Suspense boundary
- [ ] No `console.log` inside `useFrame` callbacks (runs at 60fps)
