-- Rencana singkat dari AGENT UTAMA (baruma-assistant) sebelum eksekusi Agent
-- Denah (baruma-floorplan-actions). Nullable: hanya terisi pada pesan asisten
-- mode floorplan yang lewat runFloorplanAgentPass (opsi B arsitektur 2-agent).
alter table assistant_messages add column planner_note text;
