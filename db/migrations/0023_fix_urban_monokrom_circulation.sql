-- 0023: Rombak total denah proj-urban-monokrom-1 -- setelah 0022, user
-- menemukan MASALAH JAUH LEBIH SERIUS di 3D Preview: layout.stairs SELALU []
-- (generateLayout() tidak pernah membuatnya), dan denah hasil treemap packer
-- adalah rantai ruang linear tanpa hall -- kamar tidur paling belakang cuma
-- bisa dicapai dengan JALAN TEMBUS lewat kamar tidur lain, dan sama sekali
-- tidak ada cara naik dari lantai 1 ke lantai 2.
--
-- Denah baru ditulis TANGAN (bukan generateLayout()) dengan tangga nyata:
-- Room bertipe "tangga" (lurus, lebar 1.1m x panjang 4.0m) -- dicek dulu via
-- interiorStairSpec/stairComfortIssues (src/lib/stairs/geometry.ts): 16 anak
-- tangga, lebar injakan 25cm, NOL masalah kenyamanan. Room "tangga" di lantai
-- dasar otomatis melubangi slab lantai di atasnya tepat di posisi yang sama
-- (lihat build-model.ts baris ~445 -- komentar "tangga rooms on the floor
-- BELOW ... butuh lubang di slab lantai ini").
--
-- Sirkulasi lantai 2: void tangga (x:0.3-1.4, y:2.2-6.2) dibuat bersebelahan
-- LANGSUNG dengan KEDUA kamar tidur (masing-masing punya sisi yang
-- bersentuhan dengan void pada rentang y berbeda), bukan cuma kamar depan --
-- ini yang memperbaiki keluhan "kamar paling belakang gimana caranya akses
-- balkon". Kamar Mandi Atas jadi ensuite off Kamar Tidur 2 (itu wajar --
-- beda dengan kamar tidur yang harus tembus kamar tidur lain).
--
-- Ketat divalidasi lewat validateLayout() asli (src/lib/validation.ts) +
-- pengecekan overlap manual sebelum ditulis -- iterasi pertama BENAR-BENAR
-- salah taruh (Kamar Tidur 1 tumpang tindih 0.3m dengan Kamar Tidur 2 & Kamar
-- Mandi Atas, dan 2 kamar mandi tanpa bukaan ventilasi sama sekali) --
-- validateLayout() menangkap semuanya sebelum di-deploy, sekarang 0 issue
-- selain 2 catatan struktur info (kolom/pondasi, sama seperti project lain)
-- + 1 info "kamar mandi cukup kecil" (non-blocking).
--
-- Sekalian dihapus: elemen eksterior "driveway"/"walkway" -- dikonfirmasi
-- tidak render di 3D preview (bukan fixture, elemen apapun) dan cuma bisa
-- diedit bentuk poligon dari kanvas (SurfaceFields di editor-inspector.tsx,
-- tidak ada material/warna picker sama sekali) -- tidak sepadan
-- dipertahankan.
--
-- Idempotent: upsert di-scope ke project_id yang sudah ada, aman di-replay.

insert into design_layouts (project_id, version_id, payload)
select $j$proj-urban-monokrom-1$j$, $j$ver-proj-urban-monokrom-1-fix2$j$, $j${"id":"layout-proj-urban-monokrom-1","projectId":"proj-urban-monokrom-1","versionId":"ver-proj-urban-monokrom-1-fix2","floors":[{"id":"floor-1","level":1,"name":"Lantai 1","heightM":3.2},{"id":"floor-2","level":2,"name":"Lantai 2","heightM":3.2}],"rooms":[{"id":"f1-carport","floorId":"floor-1","name":"Carport","type":"carport","x":0.3,"y":9.7,"width":5.4,"depth":4.3,"areaM2":23.22},{"id":"f1-tamu","floorId":"floor-1","name":"Ruang Tamu","type":"ruang_tamu","x":0.3,"y":6.2,"width":5.4,"depth":3.5,"areaM2":18.9,"requiresNaturalLight":true},{"id":"f1-tangga","floorId":"floor-1","name":"Tangga","type":"tangga","x":0.3,"y":2.2,"width":1.1,"depth":4,"areaM2":4.4,"stairDirection":"s"},{"id":"f1-dapur","floorId":"floor-1","name":"Dapur","type":"dapur","x":1.4,"y":2.2,"width":4.3,"depth":4,"areaM2":17.2},{"id":"f1-mandi","floorId":"floor-1","name":"Kamar Mandi Bawah","type":"kamar_mandi","x":0.3,"y":0.3,"width":2,"depth":1.9,"areaM2":3.8,"requiresVentilation":true},{"id":"f1-gudang","floorId":"floor-1","name":"Gudang","type":"gudang","x":2.3,"y":0.3,"width":3.4,"depth":1.9,"areaM2":6.46},{"id":"f2-balkon","floorId":"floor-2","name":"Balkon","type":"balkon","x":0.3,"y":8.7,"width":5.4,"depth":1,"areaM2":5.4},{"id":"f2-keluarga","floorId":"floor-2","name":"Ruang Keluarga","type":"ruang_keluarga","x":0.3,"y":6.2,"width":5.4,"depth":2.5,"areaM2":13.5,"requiresNaturalLight":true},{"id":"f2-kt1","floorId":"floor-2","name":"Kamar Tidur 1","type":"kamar_tidur","x":1.4,"y":3.8,"width":4.3,"depth":2.4,"areaM2":10.32,"requiresNaturalLight":true},{"id":"f2-kt2","floorId":"floor-2","name":"Kamar Tidur 2","type":"kamar_tidur","x":1.4,"y":0.3,"width":2.6,"depth":3.5,"areaM2":9.1,"requiresNaturalLight":true},{"id":"f2-mandi2","floorId":"floor-2","name":"Kamar Mandi Atas","type":"kamar_mandi","x":4,"y":0.3,"width":1.7,"depth":3.5,"areaM2":5.95,"requiresVentilation":true}],"walls":[],"openings":[{"id":"op-entry-door","floorId":"floor-1","wallId":"f1-tamu:s","type":"door","kind":"hinged_door","positionM":1.3,"widthM":1.1,"heightM":2.2},{"id":"op-tamu-window","floorId":"floor-1","wallId":"f1-tamu:s","type":"window","kind":"roster","positionM":3.2,"widthM":1.8,"heightM":1.4},{"id":"op-mandi1-vent","floorId":"floor-1","wallId":"f1-mandi:w","type":"window","kind":"jalousie_window","positionM":0.9,"widthM":0.6,"heightM":0.5,"sillHeightM":1.5},{"id":"op-kt1-window","floorId":"floor-2","wallId":"f2-kt1:s","type":"window","positionM":2.15,"widthM":1.2,"heightM":1.2},{"id":"op-kt2-window","floorId":"floor-2","wallId":"f2-kt2:s","type":"window","positionM":1.3,"widthM":1,"heightM":1.2},{"id":"op-keluarga-window","floorId":"floor-2","wallId":"f2-keluarga:s","type":"window","kind":"roster","positionM":2.7,"widthM":2,"heightM":1.4},{"id":"op-mandi2-vent","floorId":"floor-2","wallId":"f2-mandi2:e","type":"window","kind":"jalousie_window","positionM":1.75,"widthM":0.6,"heightM":0.5,"sillHeightM":1.5}],"stairs":[],"pools":[],"validation":{"passed":true,"issues":[{"id":"struct:column","level":"info","category":"structural","message":"Kolom terbebani 201.87 kN → 200×200 mm (f'c 25 MPa)."},{"id":"struct:footing","level":"info","category":"structural","message":"σ 150 kPa → telapak 1.1×1.1 m (tebal 0.25 m)."},{"id":"small:f1-mandi","level":"info","category":"spatial","message":"Kamar Mandi Bawah cukup kecil (3.8 m²).","objectId":"f1-mandi"}]},"roofZones":[{"id":"proj-urban-monokrom-1-roof-main","type":"datar","x":3,"y":5,"widthM":6,"depthM":10.599999999999998,"slopeDeg":0,"overhangM":0.5,"materialId":"metal","floorId":"floor-2"}],"facade":{"f1-tamu:n":"kayu_alder","f1-tamu:s":"kayu_cladding","f1-tamu:w":"kayu_alder","f1-tamu:e":"kayu_alder","f1-tangga:n":"kayu_alder","f1-tangga:s":"batu_andesit","f1-tangga:w":"kayu_alder","f1-tangga:e":"kayu_alder","f1-dapur:n":"kayu_alder","f1-dapur:s":"kayu_cladding","f1-dapur:w":"kayu_alder","f1-dapur:e":"kayu_alder","f1-mandi:n":"kayu_alder","f1-mandi:s":"batu_andesit","f1-mandi:w":"kayu_alder","f1-mandi:e":"kayu_alder","f1-gudang:n":"kayu_alder","f1-gudang:s":"kayu_cladding","f1-gudang:w":"kayu_alder","f1-gudang:e":"kayu_alder","f2-keluarga:n":"batu_alam_gelap","f2-keluarga:s":"batu_alam_gelap","f2-keluarga:w":"batu_alam_gelap","f2-keluarga:e":"batu_alam_gelap","f2-kt1:n":"batu_alam_gelap","f2-kt1:s":"batu_alam_gelap","f2-kt1:w":"batu_alam_gelap","f2-kt1:e":"batu_alam_gelap","f2-kt2:n":"batu_alam_gelap","f2-kt2:s":"batu_alam_gelap","f2-kt2:w":"batu_alam_gelap","f2-kt2:e":"batu_alam_gelap","f2-mandi2:n":"batu_alam_gelap","f2-mandi2:s":"batu_alam_gelap","f2-mandi2:w":"batu_alam_gelap","f2-mandi2:e":"batu_alam_gelap"},"facadeElements":[{"id":"fe-tropis_kayu-f1-tamu","wallId":"f1-tamu:s","floorId":"floor-1","kind":"roster_screen","positionM":2.7,"widthM":5,"sillHeightM":0.9,"heightM":1.4,"finish":"aluminium_gelap"},{"id":"fe-tropis_kayu-f2-keluarga","wallId":"f2-keluarga:s","floorId":"floor-2","kind":"roster_screen","positionM":2.7,"widthM":5,"sillHeightM":0.9,"heightM":1.4,"finish":"aluminium_gelap"}],"exteriorElements":[{"id":"ext-seg-w6gazDn7","kind":"boundary_wall","start":{"x":0,"y":13.88},"end":{"x":0.6000000000000001,"y":13.88},"heightM":1.6,"thicknessM":0.2,"label":"Template:brick_gable_roster:boundary-left","structuralRole":"non_structural","material":{"materialId":"beton_ekspos"}},{"id":"ext-seg-I2P-B_hI","kind":"sliding_gate","start":{"x":0.6000000000000001,"y":13.88},"end":{"x":3.3000000000000003,"y":13.88},"heightM":1.8,"thicknessM":0.05,"label":"Template:brick_gable_roster:vehicle-gate","structuralRole":"non_structural","material":{"materialId":"granit_hitam"}},{"id":"ext-seg-GrUxB_sp","kind":"boundary_wall","start":{"x":3.3000000000000003,"y":13.88},"end":{"x":4.08,"y":13.88},"heightM":1.6,"thicknessM":0.2,"label":"Template:brick_gable_roster:boundary-center","structuralRole":"non_structural","material":{"materialId":"beton_ekspos"}},{"id":"ext-seg-tHd7fDkY","kind":"pedestrian_gate","start":{"x":4.08,"y":13.88},"end":{"x":4.800000000000001,"y":13.88},"heightM":1.8,"thicknessM":0.05,"label":"Template:brick_gable_roster:pedestrian-gate","structuralRole":"non_structural","material":{"materialId":"granit_hitam"}},{"id":"ext-seg-wGnF9jKB","kind":"boundary_wall","start":{"x":4.800000000000001,"y":13.88},"end":{"x":6,"y":13.88},"heightM":1.6,"thicknessM":0.2,"label":"Template:brick_gable_roster:boundary-right","structuralRole":"non_structural","material":{"materialId":"beton_ekspos"}},{"id":"ext-frame-Axydhnq_","kind":"portal_frame","x":1.9500000000000002,"y":12.95,"widthM":2.8,"heightM":3.1,"depthM":0.35,"memberSizeM":0.3,"rotationDeg":0,"floorId":"floor-1","label":"Template:brick_gable_roster:portal","structuralRole":"non_structural","material":{"materialId":"bata_putih"}},{"id":"ext-box-UolXdz6z","kind":"planter","x":5.04,"y":12.9,"zM":0,"widthM":1.32,"depthM":0.7,"heightM":0.5,"rotationDeg":0,"floorId":"floor-1","label":"Template:brick_gable_roster:planting-bed","structuralRole":"non_structural","material":{"materialId":"bata_ekspos"}}]}$j$::jsonb
where exists (select 1 from projects where id = $j$proj-urban-monokrom-1$j$)
on conflict (project_id) do update
set version_id = excluded.version_id,
    payload = excluded.payload,
    revision = design_layouts.revision + 1,
    updated_at = now();


-- proj-modern-tropis-1: hapus driveway/walkway juga (sama alasan di atas —
-- tidak render 3D, tidak bisa dikustomisasi). Filter jsonb array langsung,
-- tidak perlu tulis ulang seluruh payload.
update design_layouts
set payload = jsonb_set(
      payload,
      '{exteriorElements}',
      (select coalesce(jsonb_agg(elem), '[]'::jsonb)
       from jsonb_array_elements(payload->'exteriorElements') elem
       where elem->>'kind' not in ('driveway', 'walkway'))
    ),
    revision = revision + 1,
    updated_at = now()
where project_id = $j$proj-modern-tropis-1$j$
  and exists (
    select 1 from jsonb_array_elements(payload->'exteriorElements') elem
    where elem->>'kind' in ('driveway', 'walkway')
  );
