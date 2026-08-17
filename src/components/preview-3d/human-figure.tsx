"use client"

/**
 * Procedural human figure for scale reference — a neutral 1.70 m silhouette
 * (average Indonesian adult) built from primitives: no external model, cheap,
 * and always available. Placed inside the house so users can judge room and
 * furniture proportions ("apakah plafon/pintu/meja ini masuk akal?").
 */
const HUMAN_H = 1.7
const SKIN = "#5f7d8c"
const SKIN_DARK = "#4c6673"

export function HumanFigure({
  position,
  rotationY = 0,
}: {
  position: [number, number, number]
  rotationY?: number
}) {
  // Proportions (of total height): legs ~0.48, torso ~0.30, head ~0.14.
  const legH = HUMAN_H * 0.48
  const torsoH = HUMAN_H * 0.3
  const headR = (HUMAN_H * 0.14) / 2
  const neckH = HUMAN_H * 0.03

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* legs */}
      <mesh position={[-0.09, legH / 2, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.07, legH, 10]} />
        <meshStandardMaterial color={SKIN_DARK} roughness={0.85} />
      </mesh>
      <mesh position={[0.09, legH / 2, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.07, legH, 10]} />
        <meshStandardMaterial color={SKIN_DARK} roughness={0.85} />
      </mesh>
      {/* torso */}
      <mesh position={[0, legH + torsoH / 2, 0]} castShadow>
        <capsuleGeometry args={[0.16, torsoH - 0.32, 6, 12]} />
        <meshStandardMaterial color={SKIN} roughness={0.8} />
      </mesh>
      {/* arms */}
      <mesh position={[-0.24, legH + torsoH * 0.55, 0]} rotation={[0, 0, 0.12]} castShadow>
        <capsuleGeometry args={[0.05, torsoH * 0.8, 4, 8]} />
        <meshStandardMaterial color={SKIN} roughness={0.8} />
      </mesh>
      <mesh position={[0.24, legH + torsoH * 0.55, 0]} rotation={[0, 0, -0.12]} castShadow>
        <capsuleGeometry args={[0.05, torsoH * 0.8, 4, 8]} />
        <meshStandardMaterial color={SKIN} roughness={0.8} />
      </mesh>
      {/* head */}
      <mesh position={[0, legH + torsoH + neckH + headR, 0]} castShadow>
        <sphereGeometry args={[headR, 16, 16]} />
        <meshStandardMaterial color={SKIN} roughness={0.75} />
      </mesh>
    </group>
  )
}
