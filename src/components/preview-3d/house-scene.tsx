"use client"

import * as React from "react"
import { totalStackHeightM } from "@/lib/geometry/vertical"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { OrbitControls, Sky } from "@react-three/drei"

import { silenceKnownThreeNoise } from "@/lib/three/console-noise"

// r3f masih memakai THREE.Clock (deprecated r184) per <Canvas> — tanpa ini
// tiap mount canvas menambah satu warning konsol (ribuan per sesi).
silenceKnownThreeNoise()

import type { DesignLayout, Project } from "@/types"
import { usePreviewStore } from "@/stores/preview-store"
import { SHARED_COLORS } from "@/lib/three/materials"
import { SLAB_T, WALL_H } from "@/lib/three/build-model"
import { sunPosition } from "@/lib/three/sun"
import { cameraAzimuthDeg } from "@/lib/three/compass"
import { cityLatitude, solarSceneAngles } from "@/lib/three/solar"
import { HouseModel } from "./house-model"
import { CameraRig } from "./camera-rig"

type Site = { widthM: number; depthM: number }

/**
 * Mendaftarkan fungsi capture screenshot ke preview-store. Dengan
 * preserveDrawingBuffer:false, drawing buffer bisa kosong saat toolbar memanggil
 * toDataURL — maka capture harus me-render ulang frame tepat sebelum membaca
 * pixel. Komponen ini hidup DI DALAM Canvas agar punya akses gl/scene/camera.
 */
function ScreenshotBridge() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const setCaptureFrame = usePreviewStore((s) => s.setCaptureFrame)

  React.useEffect(() => {
    setCaptureFrame(() => {
      gl.render(scene, camera)
      return gl.domElement.toDataURL("image/png")
    })
    return () => setCaptureFrame(null)
  }, [gl, scene, camera, setCaptureFrame])

  return null
}

/**
 * Memutar jarum kompas overlay (DOM di luar Canvas) mengikuti azimut kamera.
 * Berjalan di useFrame: dengan frameloop="demand" ini hanya dieksekusi saat
 * frame benar-benar dirender (orbit/animasi CameraRig) — nol biaya saat diam.
 * Menulis style.transform langsung, tanpa re-render React.
 */
function CompassBridge() {
  const lastDeg = React.useRef<number | null>(null)
  useFrame(({ camera }) => {
    const el = usePreviewStore.getState().compassEl
    if (!el) return
    // Target orbit selalu di sumbu (0, y, 0) — azimut cukup dari posisi kamera.
    const deg = cameraAzimuthDeg(camera.position.x, camera.position.z)
    // Tulis hanya saat berubah nyata (hindari layout-write per frame saat idle).
    if (lastDeg.current !== null && Math.abs(deg - lastDeg.current) < 0.1) return
    lastDeg.current = deg
    el.style.transform = `rotate(${deg}deg)`
  })
  return null
}

export function HouseScene({
  layout,
  site,
  project,
}: {
  layout: DesignLayout
  site: Site
  project: Project
}) {
  const setCanvas = usePreviewStore((s) => s.setCanvas)
  const dragging = usePreviewStore((s) => s.draggingFurnitureId)
  const interactionMode = usePreviewStore((s) => s.interactionMode)
  const manualAzimuthDeg = usePreviewStore((s) => s.sunAzimuthDeg)
  const manualElevationDeg = usePreviewStore((s) => s.sunElevationDeg)
  const sunStudy = usePreviewStore((s) => s.sunStudy)
  const realistic = usePreviewStore((s) => s.realistic)
  const night = usePreviewStore((s) => s.nightMode)
  const isViewMode = interactionMode === "view"
  const height = totalStackHeightM(layout.floors) + 1
  const dist = Math.max(site.widthM, site.depthM) * 1.5 + height + 4

  // Studi matahari: azimut/elevasi dihitung dari bulan+jam+lintang lokasi.
  // Elevasi dijepit ≥ 1° agar bayangan tak menjadi tak-hingga di dekat horizon.
  const latitude = cityLatitude(project.site.city ?? project.city)
  const solar = sunStudy.enabled ? solarSceneAngles(latitude, sunStudy.month, sunStudy.hour) : null
  const sunAzimuthDeg = solar ? solar.azimuthDeg : manualAzimuthDeg
  const sunElevationDeg = solar ? Math.max(1, solar.elevationDeg) : manualElevationDeg

  // Sun: unit direction for <Sky>, scaled position for the directional light.
  // Mode malam menjepit matahari tepat di bawah horizon → drei <Sky> otomatis
  // menghasilkan gradasi senja/gelap; kaca jendela menyala dari house-model.
  const sunDir = sunPosition(sunAzimuthDeg, night ? -4 : sunElevationDeg)
  const sunFar = dist * 1.6
  const sunLightPos: [number, number, number] = [
    sunDir[0] * sunFar,
    Math.abs(sunDir[1]) * sunFar,
    sunDir[2] * sunFar,
  ]
  const flatBg = night ? "#111726" : "#edf0ec"
  // Orthographic shadow-camera half-extent sized to the house bbox (footprint + height).
  const shadowExtent = Math.max(site.widthM, site.depthM) * 0.75 + height

  return (
    <Canvas
      shadows="percentage"
      // On-demand rendering: GPU hanya bekerja saat ada perubahan (interaksi
      // OrbitControls, commit React seperti ganti preset/malam/exploded).
      // Scene rumah statis — loop "always" membakar GPU tanpa hasil baru.
      frameloop="demand"
      dpr={[1, 2]}
      // preserveDrawingBuffer:false = default WebGL, hemat memori & bandwidth.
      // Screenshot tetap jalan via ScreenshotBridge (render ulang sebelum
      // toDataURL) — tak perlu menahan buffer sepanjang sesi.
      gl={{ preserveDrawingBuffer: false, antialias: true }}
      camera={{
        position: [dist * 0.85, dist * 0.7, dist * 0.85],
        fov: 45,
        // near/far ketat = presisi depth-buffer ~60× lebih baik daripada
        // 0.1/2000 — menghilangkan shimmer sisa pada permukaan yang nyaris
        // sebidang (data off-grid, sambungan segaris). Scene rumah ≤ ~60 m.
        near: 0.3,
        far: 300,
      }}
      onCreated={({ gl }) => setCanvas(gl.domElement)}
    >
      {/* Shadows: "percentage" = THREE.PCFShadowMap. A bare `shadows` selects
          PCFSoftShadowMap, which three r184 DEPRECATED — it logs a
          "PCFSoftShadowMap has been deprecated" warning per render and falls
          back to PCF anyway, so naming PCF explicitly is behaviour-identical
          minus the console spam. drei <SoftShadows> (PCSS) is deliberately NOT
          used — its injected shader calls `unpackRGBAToDepth`, which three
          r184 removed, so every material variant that included the patched
          shadow chunk failed to compile (invisible meshes that still cast
          shadows — e.g. the roof). */}
      {realistic ? (
        <Sky sunPosition={sunDir} />
      ) : (
        <color attach="background" args={[flatBg]} />
      )}
      <fog attach="fog" args={[flatBg, dist * 2, dist * 5]} />

      {/* Ambient/hemisphere fill so shadowed faces are not pure black.
          Malam: redup & kebiruan (cahaya langit senja + pantulan bulan). */}
      <ambientLight intensity={night ? 0.16 : realistic ? 0.45 : 0.7} />
      <hemisphereLight
        args={night ? ["#38486a", "#181d28", 0.3] : ["#ffffff", "#b9c2bb", realistic ? 0.4 : 0.5]}
      />

      {/* Sun — the single shadow-casting key light (drei <Sky> position matches).
          Malam: digantikan "bulan" biru redup tanpa bayangan. */}
      <directionalLight
        position={sunLightPos}
        color={night ? "#9fb6e0" : "#ffffff"}
        intensity={night ? 0.18 : realistic ? 2.4 : 1.3}
        castShadow={realistic && !night}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-near={0.5}
        shadow-camera-far={sunFar * 2 + height}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
      />
      {/* Low back-fill light (no shadow) to soften the ambient occlusion. */}
      <directionalLight
        position={[-dist * 0.6, dist * 0.5, -dist]}
        intensity={night ? 0.05 : realistic ? 0.25 : 0.4}
      />

      {/* Ground */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[dist * 8, dist * 8]} />
        <meshStandardMaterial color={SHARED_COLORS.ground} />
      </mesh>

      <HouseModel layout={layout} site={site} project={project} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={3}
        maxDistance={dist * 3}
        maxPolarAngle={Math.PI * 0.495}
        target={[0, height * 0.35, 0]}
        enabled={isViewMode || !dragging}
      />
      <CameraRig site={site} height={height} layout={layout} />
      <ScreenshotBridge />
      <CompassBridge />
    </Canvas>
  )
}
