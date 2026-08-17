-- 0020: Ubah TOTAL desain project "Rumah Qyfa - Modern Concrete Vertical"
-- (akun owner usr-MPbZPdo6Bj) supaya persis mengikuti Scene A "Modern
-- Concrete Vertical" (src/lib/exterior/certification-scenes.ts) -- salah 1
-- dari 2 foto referensi rumah yang jadi basis fitur eksterior. Portal +
-- kanopi + 5 panel beton vertikal + pagar/gate, atap datar 2 zona, denah 5
-- ruang (carport/ruang tamu/dapur/kamar depan/ruang keluarga).
--
-- Payload di bawah adalah dump APA ADANYA dari
-- certificationScene("scene-a-modern-concrete") milik app sendiri (via
-- vitest, bukan ditulis manual) supaya identik dengan yang dirender
-- editor/3D-preview -- termasuk facade & facadeElements hasil
-- buildFacadeComposerTemplate yang melibatkan geometri yang tidak praktis
-- ditulis tangan.
--
-- projectId & id di dalam payload di-jsonb_set ke id project yang sebenarnya
-- (di-resolve via subquery, bukan di-hardcode) -- kalau tidak, toolbar/editor
-- salah fetch capabilities karena baca layout.projectId, bukan URL param.
--
-- SENGAJA MENGGANTI TOTAL denah lama (18 ruang / 3 lantai / atap limasan,
-- readiness "Siap Diskusi Kontraktor", termasuk kolam plunge di rooftop) --
-- keputusan eksplisit pemilik akun setelah diberi tahu konsekuensinya, bukan
-- penambahan. Data lama di tabel lain yang mereferensikan room id lama (RAB,
-- interior/furniture) TIDAK disentuh migration ini -- akan jadi orphaned
-- terhadap denah baru; pakai "Reset RAB" & atur ulang furniture dari editor
-- setelah migration ini jalan.
--
-- Idempotent: UPDATE + UPSERT keduanya di-scope ke owner_id + name persis,
-- otomatis no-op (0 rows) di DB manapun yang tidak punya project ini (dev/CI).

update projects
set site = $j${"widthM":14,"depthM":18,"areaM2":252,"city":"Jakarta","province":"DKI Jakarta","frontOrientation":"south","frontRoadWidthM":6}$j$::jsonb,
    city = $j$Jakarta$j$,
    province = $j$DKI Jakarta$j$,
    style = $j$modern_tropis$j$,
    thumbnail = $j$vertical$j$,
    floors = 2,
    rooftop = false,
    readiness = $j$concept_ready$j$,
    updated_at = now()
where owner_id = $j$usr-MPbZPdo6Bj$j$
  and name = $j$Rumah Qyfa - Modern Concrete Vertical$j$;

insert into design_layouts (project_id, version_id, payload)
select
  p.id,
  $j$ver-rumah-qyfa-scene-a-1$j$,
  jsonb_set(
    jsonb_set(
      $j${
  "id": "scene-a-modern-concrete-layout",
  "projectId": "scene-a-modern-concrete",
  "versionId": "scene-a-modern-concrete-v1",
  "floors": [
    { "id": "floor-1", "level": 0, "name": "Lantai 1", "heightM": 3.1 },
    { "id": "floor-2", "level": 1, "name": "Lantai 2", "heightM": 3.1 }
  ],
  "rooms": [
    { "id": "a-carport", "floorId": "floor-1", "name": "Carport", "type": "carport", "x": 0.6, "y": 11.2, "width": 5.2, "depth": 5.2, "areaM2": 27.04 },
    { "id": "a-living", "floorId": "floor-1", "name": "Ruang Tamu", "type": "ruang_tamu", "x": 5.8, "y": 10.8, "width": 3.6, "depth": 5.6, "areaM2": 20.16 },
    { "id": "a-kitchen", "floorId": "floor-1", "name": "Dapur", "type": "dapur", "x": 9.4, "y": 10.8, "width": 3.6, "depth": 5.6, "areaM2": 20.16 },
    { "id": "a-bedroom", "floorId": "floor-2", "name": "Kamar Depan", "type": "kamar_tidur", "x": 1.2, "y": 9.8, "width": 5.2, "depth": 5.4, "areaM2": 28.08 },
    { "id": "a-family", "floorId": "floor-2", "name": "Ruang Keluarga", "type": "ruang_keluarga", "x": 6.4, "y": 9.8, "width": 6.2, "depth": 5.4, "areaM2": 33.48 }
  ],
  "walls": [],
  "openings": [
    { "id": "a-w-living", "floorId": "floor-1", "wallId": "a-living:s", "type": "window", "kind": "curtain_wall", "positionM": 1.8, "widthM": 2.8, "heightM": 2.2, "sillHeightM": 0.35 },
    { "id": "a-d-living", "floorId": "floor-1", "wallId": "a-living:s", "type": "door", "kind": "sliding_glass_door", "positionM": 1, "widthM": 1.4, "heightM": 2.3 },
    { "id": "a-w-bedroom", "floorId": "floor-2", "wallId": "a-bedroom:s", "type": "window", "kind": "curtain_wall", "positionM": 2.6, "widthM": 4.4, "heightM": 2.1, "sillHeightM": 0.45 },
    { "id": "a-w-family", "floorId": "floor-2", "wallId": "a-family:s", "type": "window", "kind": "fixed_window", "positionM": 3.1, "widthM": 2.8, "heightM": 1.8, "sillHeightM": 0.7 }
  ],
  "stairs": [],
  "pools": [],
  "roofZones": [
    { "id": "a-roof-left-flat", "type": "datar", "x": 3.7, "y": 12.8, "widthM": 6.2, "depthM": 5.8, "slopeDeg": 0, "overhangM": 0.45, "materialId": "metal", "floorId": "floor-2" },
    { "id": "a-roof-right-flat", "type": "datar", "x": 9.5, "y": 12.8, "widthM": 5.4, "depthM": 5.8, "slopeDeg": 0, "overhangM": 0.45, "materialId": "metal", "floorId": "floor-2" }
  ],
  "validation": { "passed": true, "issues": [] },
  "facade": {
    "a-living:n": "beton_ekspos", "a-living:s": "beton_ekspos", "a-living:w": "beton_ekspos", "a-living:e": "beton_ekspos",
    "a-kitchen:n": "beton_ekspos", "a-kitchen:s": "granit_hitam", "a-kitchen:w": "beton_ekspos", "a-kitchen:e": "beton_ekspos",
    "a-bedroom:n": "beton_ekspos", "a-bedroom:s": "beton_ekspos", "a-bedroom:w": "beton_ekspos", "a-bedroom:e": "beton_ekspos",
    "a-family:n": "beton_ekspos", "a-family:s": "granit_hitam", "a-family:w": "beton_ekspos", "a-family:e": "beton_ekspos"
  },
  "facadeElements": [
    { "id": "fe-modern_dua_tona-a-living", "wallId": "a-living:s", "floorId": "floor-1", "kind": "louver_band", "positionM": 1.8, "widthM": 3.2, "sillHeightM": 0.9, "heightM": 1.4, "finish": "kayu" },
    { "id": "fe-modern_dua_tona-a-family", "wallId": "a-family:s", "floorId": "floor-2", "kind": "louver_band", "positionM": 3.1, "widthM": 5.8, "sillHeightM": 0.9, "heightM": 1.4, "finish": "kayu" }
  ],
  "exteriorElements": [
    { "id": "scene-a-modern-concrete-boundary_wall-1", "kind": "boundary_wall", "start": {"x":0,"y":17.88}, "end": {"x":1.4000000000000001,"y":17.88}, "heightM": 1.6, "thicknessM": 0.2, "label": "Template:modern_concrete_vertical:boundary-left", "structuralRole": "non_structural", "material": {"materialId":"beton_ekspos"} },
    { "id": "scene-a-modern-concrete-sliding_gate-2", "kind": "sliding_gate", "start": {"x":1.4000000000000001,"y":17.88}, "end": {"x":7.700000000000001,"y":17.88}, "heightM": 1.8, "thicknessM": 0.05, "label": "Template:modern_concrete_vertical:vehicle-gate", "structuralRole": "non_structural", "material": {"materialId":"granit_hitam"} },
    { "id": "scene-a-modern-concrete-boundary_wall-3", "kind": "boundary_wall", "start": {"x":7.700000000000001,"y":17.88}, "end": {"x":9.520000000000001,"y":17.88}, "heightM": 1.6, "thicknessM": 0.2, "label": "Template:modern_concrete_vertical:boundary-center", "structuralRole": "non_structural", "material": {"materialId":"beton_ekspos"} },
    { "id": "scene-a-modern-concrete-pedestrian_gate-4", "kind": "pedestrian_gate", "start": {"x":9.520000000000001,"y":17.88}, "end": {"x":10.72,"y":17.88}, "heightM": 1.8, "thicknessM": 0.05, "label": "Template:modern_concrete_vertical:pedestrian-gate", "structuralRole": "non_structural", "material": {"materialId":"granit_hitam"} },
    { "id": "scene-a-modern-concrete-boundary_wall-5", "kind": "boundary_wall", "start": {"x":10.72,"y":17.88}, "end": {"x":14,"y":17.88}, "heightM": 1.6, "thicknessM": 0.2, "label": "Template:modern_concrete_vertical:boundary-right", "structuralRole": "non_structural", "material": {"materialId":"beton_ekspos"} },
    { "id": "scene-a-modern-concrete-driveway-6", "kind": "driveway", "points": [{"x":1.4000000000000001,"y":17.8},{"x":7.700000000000001,"y":17.8},{"x":7.700000000000001,"y":13},{"x":1.4000000000000001,"y":13}], "thicknessM": 0.15, "label": "Template:modern_concrete_vertical:driveway", "structuralRole": "non_structural", "material": {"materialId":"beton_ekspos"} },
    { "id": "scene-a-modern-concrete-walkway-7", "kind": "walkway", "points": [{"x":9.520000000000001,"y":17.8},{"x":10.72,"y":17.8},{"x":10.72,"y":14},{"x":9.520000000000001,"y":14}], "thicknessM": 0.1, "label": "Template:modern_concrete_vertical:walkway", "structuralRole": "non_structural", "material": {"materialId":"beton_ekspos"} },
    { "id": "scene-a-modern-concrete-portal_frame-8", "kind": "portal_frame", "x": 4.550000000000001, "y": 16.85, "widthM": 5.985, "heightM": 3.1, "depthM": 0.35, "memberSizeM": 0.3, "rotationDeg": 0, "floorId": "floor-1", "label": "Template:modern_concrete_vertical:portal", "structuralRole": "non_structural", "material": {"materialId":"bata_putih"} },
    { "id": "scene-a-modern-concrete-canopy-9", "kind": "canopy", "x": 4.550000000000001, "y": 15.8, "zM": 2.75, "widthM": 5.985, "depthM": 3.2, "heightM": 0.18, "rotationDeg": 0, "floorId": "floor-1", "label": "Template:modern_concrete_vertical:canopy", "structuralRole": "non_structural", "material": {"materialId":"kayu_cladding"} },
    { "id": "scene-a-modern-concrete-planter-10", "kind": "planter", "x": 12.04, "y": 16.85, "zM": 0, "widthM": 2.52, "depthM": 0.6, "heightM": 0.55, "rotationDeg": 0, "floorId": "floor-1", "label": "Template:modern_concrete_vertical:planter", "structuralRole": "non_structural", "material": {"materialId":"beton_ekspos"} },
    { "id": "scene-a-modern-concrete-facade_panel-11", "kind": "facade_panel", "x": 8.623999999999999, "y": 15.7, "zM": 0, "widthM": 0.72, "depthM": 0.22, "heightM": 5.8, "rotationDeg": 0, "floorId": "floor-1", "label": "Template:modern_concrete_vertical:vertical-panel-1", "structuralRole": "non_structural", "material": {"materialId":"beton_ekspos"} },
    { "id": "scene-a-modern-concrete-facade_panel-12", "kind": "facade_panel", "x": 9.632, "y": 15.7, "zM": 0, "widthM": 0.72, "depthM": 0.22, "heightM": 5.8, "rotationDeg": 0, "floorId": "floor-1", "label": "Template:modern_concrete_vertical:vertical-panel-2", "structuralRole": "non_structural", "material": {"materialId":"beton_ekspos"} },
    { "id": "scene-a-modern-concrete-facade_panel-13", "kind": "facade_panel", "x": 10.639999999999999, "y": 15.7, "zM": 0, "widthM": 0.72, "depthM": 0.22, "heightM": 5.8, "rotationDeg": 0, "floorId": "floor-1", "label": "Template:modern_concrete_vertical:vertical-panel-3", "structuralRole": "non_structural", "material": {"materialId":"beton_ekspos"} },
    { "id": "scene-a-modern-concrete-facade_panel-14", "kind": "facade_panel", "x": 11.648, "y": 15.7, "zM": 0, "widthM": 0.72, "depthM": 0.22, "heightM": 5.8, "rotationDeg": 0, "floorId": "floor-1", "label": "Template:modern_concrete_vertical:vertical-panel-4", "structuralRole": "non_structural", "material": {"materialId":"beton_ekspos"} },
    { "id": "scene-a-modern-concrete-facade_panel-15", "kind": "facade_panel", "x": 12.655999999999999, "y": 15.7, "zM": 0, "widthM": 0.72, "depthM": 0.22, "heightM": 5.8, "rotationDeg": 0, "floorId": "floor-1", "label": "Template:modern_concrete_vertical:vertical-panel-5", "structuralRole": "non_structural", "material": {"materialId":"beton_ekspos"} },
    { "id": "a-garden-bed-side", "kind": "garden_bed", "points": [{"x":10.4,"y":5.8},{"x":13.2,"y":5.8},{"x":13.2,"y":9.2},{"x":10.4,"y":9.2}], "thicknessM": 0.1, "floorId": "floor-1", "label": "Certification: taman samping", "structuralRole": "non_structural", "material": {"materialId":"tanah_taman"}, "scatterSeed": 101 },
    { "id": "a-tree-side", "kind": "tree", "x": 12.4, "y": 7.3, "zM": 0, "widthM": 1.6, "depthM": 1.6, "heightM": 3.4, "rotationDeg": 0, "model": {"modelAssetId":"global-tree-cert","modelUrl":null,"fitMode":"fit_envelope"}, "floorId": "floor-1", "label": "Certification: pohon samping", "material": {"materialId":"kayu_alder"}, "structuralRole": "non_structural" },
    { "id": "a-car-carport", "kind": "vehicle", "x": 2.8, "y": 14.2, "zM": 0, "widthM": 2, "depthM": 4.2, "heightM": 1.45, "rotationDeg": 0, "model": {"modelAssetId":"global-car-cert","modelUrl":null,"fitMode":"fit_envelope"}, "floorId": "floor-1", "label": "Certification: mobil carport", "material": {"materialId":"metal_gelap"}, "structuralRole": "non_structural" }
  ]
}$j$::jsonb,
      '{projectId}', to_jsonb(p.id)
    ),
    '{id}', to_jsonb(p.id || '-layout')
  )
from projects p
where p.owner_id = $j$usr-MPbZPdo6Bj$j$
  and p.name = $j$Rumah Qyfa - Modern Concrete Vertical$j$
on conflict (project_id) do update
set version_id = excluded.version_id,
    payload = excluded.payload,
    revision = design_layouts.revision + 1,
    updated_at = now();
