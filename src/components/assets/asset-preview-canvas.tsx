"use client"

import * as React from "react"
import { Canvas } from "@react-three/fiber"
import { OrbitControls, ContactShadows } from "@react-three/drei"

import { GlbErrorBoundary, GlbModel } from "@/components/preview-3d/furniture-model"
import { silenceKnownThreeNoise } from "@/lib/three/console-noise"

// Kartu preview me-mount/unmount <Canvas> saat masuk/keluar viewport — sumber
// terbesar spam warning THREE.Clock (satu per mount) sebelum diredam.
silenceKnownThreeNoise()

const DISPLAY = 1.2 // target max dimension after normalization (same framing as FurniturePreview)

export type Dims = { w: number; d: number; h: number }

export function ScaledGlb({ url, dims }: { url: string; dims: Dims }) {
  const maxDim = Math.max(dims.w, dims.d, dims.h, 0.1)
  return (
    <group scale={DISPLAY / maxDim}>
      <GlbModel url={url} dims={dims} />
    </group>
  )
}

function FallbackBox() {
  return (
    <mesh position={[0, 0.5, 0]}>
      <boxGeometry args={[0.9, 0.9, 0.9]} />
      <meshStandardMaterial color="#9aa5a1" />
    </mesh>
  )
}

/** Canvas kecil kartu library — dimuat lazy (next/dynamic) agar three/drei
 *  tidak masuk bundle awal editor 2D / asset library. */
export function AssetPreviewCanvas({ url, dims, spin }: { url: string; dims: Dims; spin: boolean }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop={spin ? "always" : "demand"}
      gl={{ alpha: true, powerPreference: "low-power" }}
      camera={{ position: [1.6, 1.2, 1.6], fov: 40 }}
    >
      <ambientLight intensity={0.85} />
      <hemisphereLight args={["#ffffff", "#b9c2bb", 0.5]} />
      <directionalLight position={[3, 4, 2]} intensity={1.1} />
      <GlbErrorBoundary fallback={<FallbackBox />}>
        <React.Suspense fallback={null}>
          <ScaledGlb url={url} dims={dims} />
        </React.Suspense>
      </GlbErrorBoundary>
      <OrbitControls
        autoRotate={spin}
        autoRotateSpeed={1.2}
        enableZoom={false}
        enablePan={false}
        target={[0, 0.5, 0]}
        makeDefault
      />
    </Canvas>
  )
}

/** Canvas besar dialog detail asset — juga lazy, hanya dimuat saat dialog
 *  dibuka dengan model tersedia. */
export function AssetDetailCanvas({ url, dims }: { url: string; dims: Dims }) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ alpha: true }}
      camera={{ position: [1.8, 1.4, 1.8], fov: 40 }}
    >
      <ambientLight intensity={0.8} />
      <hemisphereLight args={["#ffffff", "#b9c2bb", 0.55]} />
      <directionalLight position={[3, 5, 2]} intensity={1.2} />
      <directionalLight position={[-3, 2, -2]} intensity={0.35} />
      <GlbErrorBoundary fallback={<FallbackBox />}>
        <React.Suspense fallback={null}>
          <ScaledGlb url={url} dims={dims} />
        </React.Suspense>
      </GlbErrorBoundary>
      <ContactShadows position={[0, 0, 0]} opacity={0.35} scale={5} blur={2.2} far={2} />
      <OrbitControls
        autoRotate
        autoRotateSpeed={0.8}
        enablePan={false}
        minDistance={0.8}
        maxDistance={5}
        target={[0, 0.5, 0]}
        makeDefault
      />
    </Canvas>
  )
}
