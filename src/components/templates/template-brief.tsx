import type { TemplateDetail } from "@/types/templates"
import { FINISHING_LEVELS, HOUSE_STYLES, PRIORITIES, ROOM_TYPES } from "@/lib/constants"
import { formatArea, formatDimensions, formatIDRRange } from "@/lib/format"

const ORIENTATION_LABEL: Record<string, string> = {
  north: "Utara",
  east: "Timur",
  south: "Selatan",
  west: "Barat",
  unknown: "Tidak diketahui",
}

/**
 * Read-only rendering of a template's `Brief` payload for the public gallery.
 * Falls back to a description + a room-count-per-floor summary derived from
 * `layout.rooms` when the template has no brief (older/manually seeded rows).
 */
export function TemplateBrief({ template }: { template: TemplateDetail }) {
  const { brief } = template

  if (!brief) {
    return <BriefFallback template={template} />
  }

  return (
    <div className="space-y-8 rounded-xl border p-5 sm:p-6">
      <section>
        <h2 className="text-lg font-semibold">Ringkasan</h2>
        <p className="mt-2 text-muted-foreground">{brief.summary}</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border p-4">
          <h3 className="text-sm font-semibold">Informasi tapak</h3>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Dimensi" value={formatDimensions(brief.site.widthM, brief.site.depthM)} />
            <Row label="Luas" value={formatArea(brief.site.areaM2)} />
            {(brief.site.city || brief.site.province) && (
              <Row
                label="Lokasi"
                value={[brief.site.city, brief.site.province].filter(Boolean).join(", ")}
              />
            )}
            {brief.site.frontOrientation && (
              <Row
                label="Orientasi depan"
                value={ORIENTATION_LABEL[brief.site.frontOrientation] ?? brief.site.frontOrientation}
              />
            )}
            {brief.site.frontRoadWidthM != null && (
              <Row label="Lebar jalan depan" value={`${brief.site.frontRoadWidthM} m`} />
            )}
          </dl>
        </div>
        <div className="rounded-xl border p-4">
          <h3 className="text-sm font-semibold">Bangunan</h3>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row
              label="Lantai"
              value={`${brief.building.floors}${brief.building.rooftop ? " + rooftop" : ""}`}
            />
            <Row
              label="Finishing"
              value={FINISHING_LEVELS[brief.building.finishingLevel]?.label ?? brief.building.finishingLevel}
            />
            <Row
              label="Estimasi anggaran"
              value={formatIDRRange(brief.building.budget.minIDR, brief.building.budget.maxIDR)}
            />
          </dl>
        </div>
      </section>

      {brief.priorities.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">Prioritas</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {brief.priorities.map((p) => (
              <span
                key={p}
                className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
              >
                {PRIORITIES[p] ?? p}
              </span>
            ))}
          </div>
        </section>
      )}

      {brief.spaceProgram.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">Program ruang</h3>
          <div className="mt-3 overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Ruang</th>
                  <th className="px-3 py-2 font-medium">Tipe</th>
                  <th className="px-3 py-2 font-medium">Jumlah</th>
                  <th className="px-3 py-2 font-medium">Wajib</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {brief.spaceProgram.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">{item.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {ROOM_TYPES[item.roomType]?.label ?? item.roomType}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{item.quantity}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {item.required ? "Ya" : "Opsional"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(brief.assumptions.length > 0 || brief.constraints.length > 0) && (
        <section className="grid gap-4 sm:grid-cols-2">
          {brief.assumptions.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">Asumsi</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {brief.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {brief.constraints.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">Batasan</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {brief.constraints.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {brief.risks.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">Risiko yang perlu diperhatikan</h3>
          <ul className="mt-2 space-y-2">
            {brief.risks.map((r) => (
              <li key={r.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{r.title}</p>
                <p className="mt-0.5 text-muted-foreground">{r.message}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}

/** No brief on this template — description + room-count-per-floor derived from the layout. */
function BriefFallback({ template }: { template: TemplateDetail }) {
  const roomsByFloor = new Map<string, number>()
  for (const room of template.layout.rooms) {
    roomsByFloor.set(room.floorId, (roomsByFloor.get(room.floorId) ?? 0) + 1)
  }

  return (
    <div className="space-y-6 rounded-xl border p-5 sm:p-6">
      <section>
        <h2 className="text-lg font-semibold">Ringkasan</h2>
        <p className="mt-2 text-muted-foreground">
          {template.description ??
            `Contoh desain rumah ${template.name}${
              template.style ? ` bergaya ${HOUSE_STYLES[template.style]}` : ""
            }.`}
        </p>
      </section>
      <section>
        <h3 className="text-sm font-semibold">Ringkasan ruangan per lantai</h3>
        <div className="mt-3 overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Lantai</th>
                <th className="px-3 py-2 font-medium">Jumlah ruangan</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {template.layout.floors.map((floor) => (
                <tr key={floor.id}>
                  <td className="px-3 py-2">{floor.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{roomsByFloor.get(floor.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-muted-foreground">Brief lengkap belum tersedia untuk template ini.</p>
    </div>
  )
}
