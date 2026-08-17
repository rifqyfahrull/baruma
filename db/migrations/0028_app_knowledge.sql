-- 0028: app_knowledge — pemahaman agent tentang MEKANIKA APLIKASI Baruma.
--
-- Berbeda dari design_knowledge (0025), yang berisi pengetahuan ARSITEKTUR
-- umum (furnitur, material, gaya, ruang). Tabel ini berisi cara BARUMA
-- SENDIRI bekerja: aksi apa yang tersedia, apa efek sampingnya, batasannya,
-- dan konsekuensi yang tak terlihat dari nama aksinya.
--
-- Contoh yang memicu kebutuhan ini: menambah ruang di denah 2D otomatis
-- memunculkan DINDING (diturunkan dari persegi ruang saat render,
-- build-model.ts `if (!isOpen)`), KECUALI bila tipe ruangnya termasuk
-- OPEN_TYPES (kolam/taman/carport/balkon/rooftop_lounge/void). Tanpa
-- pengetahuan itu agent tak mungkin sampai pada langkah presisi seperti
-- "akses ke ruang terkurung bisa dibuat lewat void".
--
-- SUMBER KEBENARAN = KODE. Isi kolom `evidence` menyimpan cuplikan kode /
-- konstanta yang menjadi dasar, dan prompt generator dilarang menyatakan hal
-- di luar bukti itu — supaya agent tak pernah menjalankan aksi yang tak ada.
create table if not exists app_knowledge (
  id          text primary key,          -- <kind>:<slug>
  kind        text not null check (kind in ('action','room_type','mechanic','element','config')),
  name        text not null,             -- nama yang dikenali agent (mis. "addRoom")
  knowledge   jsonb not null,            -- {what, effects[], constraints[], when_to_use[], pitfalls[], related[]}
  evidence    text,                      -- cuplikan kode sumber yang mendasari
  keywords    text,                      -- frasa pencarian (bhs awam + istilah teknis)
  updated_at  timestamptz not null default now()
);
create index if not exists app_knowledge_kind_idx on app_knowledge(kind);
