"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  Armchair,
  Download,
  Grip,
  Lamp,
  Move,
  Palette,
  Plus,
  RotateCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { InteriorRoomScene } from "@/components/interior/interior-room-scene"
import {
  InteriorStyleSelector,
  RoomMaterialEditor,
} from "@/components/interior/interior-controls"

import type {
  DesignLayout,
  FurnitureItem,
  InteriorWarning,
  LightingFixture,
  PlacedFurniture,
  Project,
  Room,
  RoomInteriorPlan,
} from "@/types"
import {
  FURNITURE_LIBRARY,
  MATERIAL_LIBRARY,
  getInteriorStyle,
} from "@/lib/interior/presets"
import {
  interiorRooms,
  interiorStyleFromHouseStyle,
} from "@/lib/interior/plan"
import { LIGHT_COLORS, LIGHT_LABELS } from "@/lib/interior/lighting"
import { LAMP_LOAD_VA } from "@/lib/electrical/electrical"
import { normalizeAngle } from "@/lib/geometry/angle"
import { useInteriorStore } from "@/stores/interior-store"
import { formatArea, formatDimensions, formatIDRCompact, formatIDRRange } from "@/lib/format"
import { ROOM_TYPES, WATER_POINT_TYPES } from "@/lib/constants"
import { track } from "@/lib/analytics"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useProjectAgentUiStore } from "@/stores/project-agent-ui-store"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function InteriorWorkspace({
  project,
  layout,
  initialRoomId,
}: {
  project: Project
  layout: DesignLayout
  initialRoomId?: string
}) {
  const defaultStyle = interiorStyleFromHouseStyle(project.style)
  const load = useInteriorStore((s) => s.load)
  const plan = useInteriorStore((s) => s.plan)
  const selectedRoomId = useInteriorStore((s) => s.selectedRoomId)
  const selectedFurnitureId = useInteriorStore((s) => s.selectedFurnitureId)
  const selectedLightId = useInteriorStore((s) => s.selectedLightId)
  const setStyle = useInteriorStore((s) => s.setStyle)
  const selectRoom = useInteriorStore((s) => s.selectRoom)

  React.useEffect(() => {
    load({
      projectId: project.id,
      layout,
      style: defaultStyle,
      initialRoomId,
      site: project.site,
    })
  }, [defaultStyle, initialRoomId, layout, load, project.id, project.site])

  const room = layout.rooms.find((item) => item.id === selectedRoomId)
  const roomPlan = plan?.rooms.find((item) => item.roomId === selectedRoomId)
  const selectedFurniture = roomPlan?.furniture.find(
    (item) => item.id === selectedFurnitureId
  )
  const selectedLight = roomPlan?.lighting.find(
    (item) => item.id === selectedLightId
  )

  if (!plan || !room || !roomPlan) {
    const rooms = interiorRooms(layout)
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6 lg:p-8">
        <h2 className="text-xl font-semibold tracking-tight">Interior Design</h2>
        <p className="text-sm text-muted-foreground">
          Belum ada ruangan yang didukung modul interior pada layout ini.
        </p>
        {rooms[0] && (
          <Button onClick={() => selectRoom(rooms[0].id)}>
            Buka {rooms[0].name}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-[calc(100svh-9rem)] flex-col xl:flex-row">
      <aside className="border-b bg-card xl:w-72 xl:border-b-0 xl:border-r">
        <RoomInteriorList layout={layout} activeId={room.id} />
      </aside>

      <main className="min-w-0 flex-1 bg-muted/20">
        <div className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Interior Design</h2>
              <p className="text-sm text-muted-foreground">
                Furniture, material, lighting, dan budget berbasis ukuran ruang nyata.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/projects/${project.id}/materials`}>
                  <Palette /> Material
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/projects/${project.id}/furniture`}>
                  <Armchair /> Furniture
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href={`/app/projects/${project.id}/exports`}>
                  <Download /> Export
                </Link>
              </Button>
            </div>
          </div>

          <InteriorStyleSelector value={plan.style} onChange={setStyle} />
          <LightQuickAdd room={room} />

          <Tabs defaultValue="layout" className="space-y-4">
            <TabsList className="grid w-full grid-cols-4 lg:w-[34rem]">
              <TabsTrigger value="layout" className="text-foreground/80">
                2D Layout
              </TabsTrigger>
              <TabsTrigger value="preview" className="text-foreground/80">
                3D Room
              </TabsTrigger>
              <TabsTrigger value="moodboard" className="text-foreground/80">
                Moodboard
              </TabsTrigger>
              <TabsTrigger value="budget" className="text-foreground/80">
                Budget
              </TabsTrigger>
            </TabsList>
            <TabsContent value="layout">
              <InteriorCanvas room={room} plan={roomPlan} />
            </TabsContent>
            <TabsContent value="preview">
              <InteriorRoomScene room={room} plan={roomPlan} />
            </TabsContent>
            <TabsContent value="moodboard">
              <MoodboardGrid room={room} roomPlan={roomPlan} />
            </TabsContent>
            <TabsContent value="budget">
              <RoomBudgetSummary roomPlan={roomPlan} />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <aside className="border-t bg-card xl:w-80 xl:border-l xl:border-t-0">
        <InteriorInspector
          projectId={project.id}
          room={room}
          roomPlan={roomPlan}
          selectedFurniture={selectedFurniture}
          selectedLight={selectedLight}
        />
      </aside>
    </div>
  )
}

function RoomInteriorList({
  layout,
  activeId,
}: {
  layout: DesignLayout
  activeId: string
}) {
  const rooms = interiorRooms(layout)
  const selectRoom = useInteriorStore((s) => s.selectRoom)
  const plan = useInteriorStore((s) => s.plan)

  return (
    <div className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold">Ruangan</h3>
        <p className="text-xs text-muted-foreground">
          Pilih ruang untuk mengatur interior room-by-room.
        </p>
      </div>
      <ScrollArea className="max-h-[18rem] xl:max-h-[calc(100svh-14rem)]">
        <div className="space-y-2 pr-2">
          {rooms.map((room) => {
            const roomPlan = plan?.rooms.find((item) => item.roomId === room.id)
            return (
              <button
                key={room.id}
                type="button"
                onClick={() => selectRoom(room.id)}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-colors",
                  activeId === room.id
                    ? "border-primary bg-primary/10"
                    : "bg-background hover:bg-muted"
                )}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {room.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {ROOM_TYPES[room.type].label} · {formatDimensions(room.width, room.depth)}
                    </span>
                  </span>
                  {roomPlan && roomPlan.warnings.length > 0 && (
                    <Badge variant="secondary" className="shrink-0">
                      {roomPlan.warnings.length}
                    </Badge>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

export function FurnitureQuickAdd({
  room,
  compact,
  testId,
}: {
  room: Room
  compact?: boolean
  testId: string
}) {
  const addFurniture = useInteriorStore((s) => s.addFurniture)
  const [query, setQuery] = React.useState("")
  const entries = React.useMemo(
    () => furnitureCatalogEntries(room.type, query),
    [query, room.type]
  )
  const visible = entries.slice(0, compact ? 5 : 8)

  function add(item: FurnitureItem, recommended: boolean) {
    const result = addFurniture(room.id, item)
    if (!result.ok) {
      toast.error(
        `${item.name} butuh titik air "${WATER_POINT_TYPES[result.missingWaterPoint]}" di ${room.name}. Pasang dulu lewat 2D editor (tab Air), lalu model 3D-nya bisa dipasang di lokasi itu.`
      )
      return
    }
    if (recommended) {
      toast.success(`${item.name} ditambahkan ke ${room.name}.`)
    } else {
      toast.info(`${item.name} ditambahkan. Cek warning ergonomi untuk ruang ini.`)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-3" data-testid={testId}>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Tambah furniture</h3>
          <p className="text-xs text-muted-foreground">
            Cari kasur, lemari, TV, sofa, meja, atau item interior lain.
          </p>
        </div>
        {!compact && (
          <div className="flex flex-wrap gap-1.5">
            {["Sofa", "TV", "Kasur", "Lemari"].map((term) => (
              <Button
                key={term}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setQuery(term)}
              >
                {term}
              </Button>
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-8"
          placeholder="Cari: kasur, lemari, TV, sofa..."
          aria-label="Cari furniture interior"
          data-testid={`${testId}-search`}
        />
      </div>
      <div className={cn("mt-3 grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-2 xl:grid-cols-4")}>
        {visible.map(({ item, recommended }) => (
          <button
            key={item.id}
            type="button"
            onClick={() => add(item, recommended)}
            className="rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted"
            aria-label={`Tambah ${item.name}`}
            data-testid={`add-furniture-${item.id}`}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{item.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {item.widthM} x {item.depthM} m · {categoryLabel(item.category)}
                </span>
              </span>
              <Badge variant={recommended ? "secondary" : "outline"} className="shrink-0">
                {recommended ? "Cocok" : "Manual"}
              </Badge>
            </span>
          </button>
        ))}
      </div>
      {visible.length === 0 && (
        <p className="mt-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Tidak ada furniture yang cocok dengan pencarian ini.
        </p>
      )}
    </div>
  )
}

function InteriorCanvas({ room, plan }: { room: Room; plan: RoomInteriorPlan }) {
  const svgRef = React.useRef<SVGSVGElement>(null)
  const dragRef = React.useRef<
    | { kind: "furniture" | "light"; id: string; offX: number; offY: number }
    | { kind: "rotate"; id: string; cx: number; cy: number }
    | null
  >(null)
  const selectFurniture = useInteriorStore((s) => s.selectFurniture)
  const selectedFurnitureId = useInteriorStore((s) => s.selectedFurnitureId)
  const moveFurniture = useInteriorStore((s) => s.moveFurniture)
  const setFurnitureRotation = useInteriorStore((s) => s.setFurnitureRotation)
  const selectLight = useInteriorStore((s) => s.selectLight)
  const selectedLightId = useInteriorStore((s) => s.selectedLightId)
  const moveLight = useInteriorStore((s) => s.moveLight)

  const width = 720
  const height = 480
  const pad = 36
  const scale = Math.min((width - pad * 2) / room.width, (height - pad * 2) / room.depth)
  const originX = (width - room.width * scale) / 2
  const originY = (height - room.depth * scale) / 2

  /** Pointer position in canvas px (the same space as `originX/originY/scale`). */
  function pointerPx(e: React.PointerEvent | PointerEvent) {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * width,
      y: ((e.clientY - rect.top) / rect.height) * height,
    }
  }

  function pointer(e: React.PointerEvent | PointerEvent) {
    const p = pointerPx(e)
    return {
      x: (p.x - originX) / scale,
      y: (p.y - originY) / scale,
    }
  }

  function startDrag(e: React.PointerEvent, item: PlacedFurniture) {
    e.stopPropagation()
    const p = pointer(e)
    selectFurniture(item.id)
    dragRef.current = { id: item.id, kind: "furniture", offX: p.x - item.x, offY: p.y - item.y }
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  function startLightDrag(e: React.PointerEvent, f: LightingFixture) {
    e.stopPropagation()
    const p = pointer(e)
    selectLight(f.id)
    dragRef.current = { id: f.id, kind: "light", offX: p.x - f.x, offY: p.y - f.y }
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  function startRotateDrag(e: React.PointerEvent, item: PlacedFurniture) {
    e.stopPropagation()
    selectFurniture(item.id)
    dragRef.current = {
      kind: "rotate",
      id: item.id,
      cx: originX + (item.x + item.widthM / 2) * scale,
      cy: originY + (item.y + item.depthM / 2) * scale,
    }
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  function onMove(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    if (drag.kind === "rotate") {
      const p = pointerPx(e)
      const deg = normalizeAngle(
        (Math.atan2(p.y - drag.cy, p.x - drag.cx) * 180) / Math.PI + 90,
        e.shiftKey ? 15 : undefined
      )
      setFurnitureRotation(room.id, drag.id, deg)
      return
    }
    const p = pointer(e)
    if (drag.kind === "furniture") {
      moveFurniture(room.id, drag.id, p.x - drag.offX, p.y - drag.offY)
    } else {
      moveLight(room.id, drag.id, p.x - drag.offX, p.y - drag.offY)
    }
  }

  function endDrag(e: React.PointerEvent) {
    if (!dragRef.current) return
    const kind = dragRef.current.kind
    dragRef.current = null
    svgRef.current?.releasePointerCapture(e.pointerId)
    if (kind === "furniture") {
      track("interior_furniture_moved", { room_id: room.id })
    }
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b p-3">
        <div>
          <h3 className="text-sm font-semibold">{room.name}</h3>
          <p className="text-xs text-muted-foreground">
            {formatDimensions(room.width, room.depth)} · {formatArea(room.areaM2)}
          </p>
        </div>
        <Badge variant={plan.warnings.some((w) => w.level === "danger") ? "destructive" : "secondary"}>
          {plan.warnings.length === 0 ? "Ergonomi aman" : `${plan.warnings.length} warning`}
        </Badge>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="h-[30rem] w-full touch-none bg-muted/20"
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerDown={() => { selectFurniture(null); selectLight(null) }}
        data-testid="interior-canvas"
      >
        <defs>
          <pattern id="interior-grid" width={scale * 0.5} height={scale * 0.5} patternUnits="userSpaceOnUse">
            <path d={`M ${scale * 0.5} 0 L 0 0 0 ${scale * 0.5}`} className="stroke-border/70" fill="none" strokeWidth="0.8" />
          </pattern>
        </defs>
        <rect
          x={originX}
          y={originY}
          width={room.width * scale}
          height={room.depth * scale}
          fill="url(#interior-grid)"
          className="stroke-foreground/50"
          strokeWidth={2}
        />
        {plan.furniture.map((item) => {
          const selected = item.id === selectedFurnitureId
          const cx = originX + (item.x + item.widthM / 2) * scale
          const cy = originY + (item.y + item.depthM / 2) * scale
          return (
            <g
              key={item.id}
              onPointerDown={(e) => startDrag(e, item)}
              className="cursor-move"
              data-testid="furniture-object"
              transform={`rotate(${item.rotationDeg} ${cx} ${cy})`}
            >
              <rect
                x={originX + item.x * scale}
                y={originY + item.y * scale}
                width={item.widthM * scale}
                height={item.depthM * scale}
                rx={5}
                className={cn(
                  selected ? "fill-primary/25 stroke-primary" : "fill-background stroke-foreground/50"
                )}
                strokeWidth={selected ? 2.5 : 1.5}
              />
              <text
                x={originX + (item.x + item.widthM / 2) * scale}
                y={originY + (item.y + item.depthM / 2) * scale}
                textAnchor="middle"
                dominantBaseline="middle"
                className="pointer-events-none fill-foreground text-[11px] font-medium"
              >
                {shortName(item.name)}
              </text>
              {selected && (
                <foreignObject
                  x={originX + item.x * scale + 4}
                  y={originY + item.y * scale + 4}
                  width={18}
                  height={18}
                >
                  <Grip className="size-4 text-primary" />
                </foreignObject>
              )}
              {selected && (
                <>
                  <line
                    x1={originX + (item.x + item.widthM / 2) * scale}
                    y1={originY + item.y * scale}
                    x2={originX + (item.x + item.widthM / 2) * scale}
                    y2={originY + item.y * scale - 16}
                    className="stroke-primary"
                    strokeWidth={1.5}
                  />
                  <circle
                    cx={originX + (item.x + item.widthM / 2) * scale}
                    cy={originY + item.y * scale - 16}
                    r={6}
                    className="cursor-grab fill-primary stroke-background"
                    strokeWidth={2}
                    onPointerDown={(e) => startRotateDrag(e, item)}
                    data-testid="furniture-rotate-handle"
                  />
                </>
              )}
            </g>
          )
        })}
        {plan.lighting.map((f) => {
          const selected = f.id === selectedLightId
          const cx = originX + f.x * scale
          const cy = originY + f.y * scale
          const r = 10
          return (
            <g
              key={f.id}
              onPointerDown={(e) => startLightDrag(e, f)}
              onClick={(e) => { e.stopPropagation(); selectLight(f.id) }}
              className="cursor-move"
              data-testid="light-marker"
            >
              {selected && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={r + 5}
                  fill="none"
                  className="stroke-primary"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={LIGHT_COLORS[f.colorTemperature]}
                className={cn(
                  selected ? "stroke-primary" : "stroke-foreground/40"
                )}
                strokeWidth={selected ? 2 : 1.5}
              />
              {f.qty > 1 && (
                <>
                  <circle cx={cx + r - 2} cy={cy - r + 2} r={6} className="fill-foreground" />
                  <text
                    x={cx + r - 2}
                    y={cy - r + 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="pointer-events-none fill-background text-[8px] font-bold"
                    fontSize={8}
                  >
                    {f.qty}
                  </text>
                </>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function LightQuickAdd({ room }: { room: Room }) {
  const addLight = useInteriorStore((s) => s.addLight)
  const types = Object.keys(LIGHT_LABELS) as LightingFixture["type"][]
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Tempatkan titik lampu ke ruangan dan atur di inspector.
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <Lamp /> Tambah lampu
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {types.map((type) => (
              <DropdownMenuItem
                key={type}
                onClick={() => {
                  addLight(room.id, type)
                  toast.success(`${LIGHT_LABELS[type]} ditambahkan ke ${room.name}.`)
                }}
              >
                {LIGHT_LABELS[type]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function MoodboardGrid({ room, roomPlan }: { room: Room; roomPlan: RoomInteriorPlan }) {
  const style = getInteriorStyle(roomPlan.style)
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Color Palette</CardTitle>
            <CardDescription>{style.mood}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2">
            {Object.entries(style.colors).map(([name, color]) => (
              <div key={name} className="space-y-1">
                <div className="h-16 rounded-md border" style={{ background: color }} />
                <p className="text-xs font-medium capitalize">{name}</p>
                <p className="font-mono text-[0.68rem] text-muted-foreground">{color}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Material utama</CardTitle>
            <CardDescription>Lantai, dinding, plafon, dan aksen ruang.</CardDescription>
          </CardHeader>
          <CardContent>
            <RoomMaterialEditor room={room} roomPlan={roomPlan} />
          </CardContent>
        </Card>
      </div>
      <MaterialPalettePanel roomPlan={roomPlan} />
    </div>
  )
}

function RoomBudgetSummary({ roomPlan }: { roomPlan: RoomInteriorPlan }) {
  const lines = roomPlan.budgetEstimate.lines
  const unpricedCount = roomPlan.budgetEstimate.unpricedCount ?? 0
  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Low" value={formatIDRCompact(roomPlan.budgetEstimate.lowIDR)} />
        <Metric label="Mid" value={formatIDRCompact(roomPlan.budgetEstimate.midIDR)} />
        <Metric label="High" value={formatIDRCompact(roomPlan.budgetEstimate.highIDR)} />
      </div>
      {unpricedCount > 0 && (
        <p
          className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs"
          data-testid="budget-unpriced-warning"
        >
          Estimasi belum lengkap: {unpricedCount} item kustom belum dihargai
          (tidak dihitung, bukan Rp 0). Isi harga lewat inspector furniture
          atau metadata aset di My Library.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead className="text-right">Mid</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>{line.item}</TableCell>
                <TableCell>{line.category}</TableCell>
                <TableCell className="text-right font-medium">
                  {line.priced === false ? (
                    <span className="text-xs text-warning">belum dihargai</span>
                  ) : (
                    formatIDRCompact(line.midIDR)
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function InteriorInspector({
  projectId,
  room,
  roomPlan,
  selectedFurniture,
  selectedLight,
}: {
  projectId: string
  room: Room
  roomPlan: RoomInteriorPlan
  selectedFurniture?: PlacedFurniture
  selectedLight?: LightingFixture
}) {
  const rotateFurniture = useInteriorStore((s) => s.rotateFurniture)
  const setFurnitureRotation = useInteriorStore((s) => s.setFurnitureRotation)
  const removeFurniture = useInteriorStore((s) => s.removeFurniture)
  const addFurniture = useInteriorStore((s) => s.addFurniture)
  const moveFurniture = useInteriorStore((s) => s.moveFurniture)
  const updateLight = useInteriorStore((s) => s.updateLight)
  const removeLight = useInteriorStore((s) => s.removeLight)
  const injectAgentDraft = useProjectAgentUiStore((s) => s.injectDraft)

  return (
    <ScrollArea className="h-full max-h-[42rem] xl:max-h-[calc(100svh-9rem)]">
      <div className="space-y-4 p-4">
        <div>
          <h3 className="text-sm font-semibold">Interior Inspector</h3>
          <p className="text-xs text-muted-foreground">
            {room.name} · {formatArea(room.areaM2)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Metric label="Furniture" value={`${roomPlan.furniture.length}`} />
          <Metric label="Budget mid" value={formatIDRCompact(roomPlan.budgetEstimate.midIDR)} />
        </div>

        <FurnitureLibraryPanel
          room={room}
          onAdd={(item) => {
            const result = addFurniture(room.id, item)
            if (!result.ok) {
              toast.error(
                `${item.name} butuh titik air "${WATER_POINT_TYPES[result.missingWaterPoint]}" di ${room.name}. Pasang dulu lewat 2D editor (tab Air).`
              )
              return
            }
            toast.success(`${item.name} ditambahkan.`)
          }}
        />

        {selectedLight ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {LIGHT_LABELS[selectedLight.type]}
              </CardTitle>
              <CardDescription>
                {formatIDRRange(selectedLight.priceRange.low, selectedLight.priceRange.high)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Tipe</p>
                <Select
                  value={selectedLight.type}
                  onValueChange={(val) =>
                    updateLight(room.id, selectedLight.id, { type: val as LightingFixture["type"] })
                  }
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(LIGHT_LABELS) as LightingFixture["type"][]).map((type) => (
                      <SelectItem key={type} value={type}>
                        {LIGHT_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Temperatur warna</p>
                <div className="flex gap-1.5">
                  {(["warm", "neutral", "cool"] as const).map((temp) => (
                    <button
                      key={temp}
                      type="button"
                      onClick={() => updateLight(room.id, selectedLight.id, { colorTemperature: temp })}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-colors",
                        selectedLight.colorTemperature === temp
                          ? "border-primary bg-primary/10 font-medium"
                          : "bg-background hover:bg-muted"
                      )}
                    >
                      <span
                        className="size-3 rounded-full border border-foreground/20"
                        style={{ background: LIGHT_COLORS[temp] }}
                      />
                      {temp === "warm" ? "Hangat" : temp === "neutral" ? "Netral" : "Sejuk"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Jumlah</p>
                  <Input
                    type="number"
                    min={1}
                    value={selectedLight.qty}
                    onChange={(e) => {
                      const qty = Math.max(1, parseInt(e.target.value, 10) || 1)
                      updateLight(room.id, selectedLight.id, { qty })
                    }}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Watt/unit</p>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={selectedLight.watt ?? LAMP_LOAD_VA[selectedLight.type]}
                    onChange={(e) => {
                      const watt = parseInt(e.target.value, 10)
                      if (Number.isFinite(watt) && watt > 0) {
                        updateLight(room.id, selectedLight.id, { watt })
                      }
                    }}
                    className="h-8"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Tinggi (m)</p>
                <Input
                  type="number"
                  min={0.5}
                  step={0.1}
                  value={selectedLight.heightM}
                  onChange={(e) => {
                    const heightM = parseFloat(e.target.value) || selectedLight.heightM
                    updateLight(room.id, selectedLight.id, { heightM })
                  }}
                  className="h-8"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => removeLight(room.id, selectedLight.id)}
              >
                <Trash2 /> Hapus lampu
              </Button>
            </CardContent>
          </Card>
        ) : selectedFurniture ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{selectedFurniture.name}</CardTitle>
              <CardDescription>
                {selectedFurniture.widthM} x {selectedFurniture.depthM} m · {formatIDRRange(selectedFurniture.priceRange.low, selectedFurniture.priceRange.high)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Rotasi (°)</p>
                <Input
                  type="number"
                  min={0}
                  max={359}
                  value={Math.round(selectedFurniture.rotationDeg)}
                  onChange={(e) => {
                    const deg = parseInt(e.target.value, 10)
                    if (!Number.isNaN(deg)) setFurnitureRotation(room.id, selectedFurniture.id, deg)
                  }}
                  className="h-8 w-24"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => moveFurniture(room.id, selectedFurniture.id, selectedFurniture.x + 0.25, selectedFurniture.y)}
                >
                  <Move /> Geser kanan
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => rotateFurniture(room.id, selectedFurniture.id)}
                >
                  <RotateCw /> Rotate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeFurniture(room.id, selectedFurniture.id)}
                >
                  <Trash2 /> Hapus
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Pilih furniture atau lampu di kanvas untuk mengedit.
          </p>
        )}

        <InteriorWarningList warnings={roomPlan.warnings} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" />
              AI Agent
            </CardTitle>
            <CardDescription>
              Gunakan thread proyek yang sama untuk menata ruang ini.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              onClick={() => injectAgentDraft(`Tata ulang ${room.name} agar lebih lega.`, "interior")}
            >
              <Sparkles /> Tata dengan AI Agent
            </Button>
            <p className="text-xs text-muted-foreground">
              Export interior tersedia dari halaman Export project.
            </p>
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href={`/app/projects/${projectId}/exports`}>
                <Download /> Buka Export
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  )
}

function FurnitureLibraryPanel({
  room,
  onAdd,
}: {
  room: Room
  onAdd: (item: FurnitureItem) => void
}) {
  const [query, setQuery] = React.useState("")
  const entries = React.useMemo(
    () => furnitureCatalogEntries(room.type, query),
    [query, room.type]
  )

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button className="w-full" size="sm">
          <Plus /> Tambah furniture
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Furniture Library</SheetTitle>
          <SheetDescription>
            Semua item berbasis ukuran meter dan estimasi harga.
          </SheetDescription>
        </SheetHeader>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-8"
            placeholder="Cari kasur, lemari, TV, sofa..."
            aria-label="Cari furniture di library"
          />
        </div>
        <div className="mt-4 space-y-2">
          {entries.map(({ item, recommended }) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onAdd(item)}
              className="w-full rounded-lg border p-3 text-left hover:bg-muted"
            >
              <span className="flex items-start justify-between gap-2">
                <span>
                  <span className="block text-sm font-medium">{item.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {item.widthM} x {item.depthM} m · {formatIDRRange(item.priceRange.low, item.priceRange.high)}
                  </span>
                </span>
                <Badge variant={recommended ? "secondary" : "outline"}>
                  {recommended ? "Cocok" : categoryLabel(item.category)}
                </Badge>
              </span>
            </button>
          ))}
          {entries.length === 0 && (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              Tidak ada furniture yang cocok dengan pencarian ini.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function MaterialPalettePanel({ roomPlan }: { roomPlan: RoomInteriorPlan }) {
  const materialIds = new Set(roomPlan.materials.map((item) => item.materialId))
  const related = MATERIAL_LIBRARY.filter((item) => materialIds.has(item.id))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Palette material</CardTitle>
        <CardDescription>Material yang diterapkan ke ruang ini.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {related.map((item) => (
          <div key={item.id} className="rounded-lg border p-3">
            <p className="text-sm font-medium">{item.name}</p>
            <p className="text-xs text-muted-foreground">
              {item.category} · tahan air {item.waterResistance} · maintenance {item.maintenance}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function InteriorWarningList({
  warnings,
  onSelectFurniture,
}: {
  warnings: InteriorWarning[]
  /** Bila di-set, warning dengan furnitureId bisa diklik untuk memilih pelanggarnya. */
  onSelectFurniture?: (furnitureId: string) => void
}) {
  if (warnings.length === 0) {
    return (
      <div className="rounded-lg border bg-success/5 p-3 text-sm text-muted-foreground">
        Tidak ada warning ergonomi utama untuk ruang ini.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Warning ergonomi</h4>
      {warnings.map((warning) => {
        const clickable = !!(onSelectFurniture && warning.furnitureId)
        const Tag = clickable ? "button" : "div"
        return (
          <Tag
            key={warning.id}
            {...(clickable
              ? { type: "button" as const, onClick: () => onSelectFurniture!(warning.furnitureId!) }
              : {})}
            className={cn(
              "block w-full rounded-lg border p-3 text-left",
              warning.level === "danger"
                ? "border-destructive/30 bg-destructive/5"
                : "border-warning/30 bg-warning/10",
              clickable && "cursor-pointer transition-colors hover:bg-warning/20"
            )}
          >
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <div>
                <p className="text-sm font-medium">{warning.title}</p>
                <p className="text-xs text-muted-foreground">{warning.message}</p>
                {clickable && (
                  <p className="mt-0.5 text-[11px] font-medium text-primary">Klik untuk pilih item ini</p>
                )}
              </div>
            </div>
          </Tag>
        )
      })}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  )
}

type FurnitureCatalogEntry = {
  item: FurnitureItem
  recommended: boolean
}

const FURNITURE_ALIASES: Record<string, string[]> = {
  "sofa-3-seat": ["sofa", "kursi", "seating", "ruang tamu"],
  "sofa-l": ["sofa", "sofa l", "kursi keluarga"],
  "coffee-table": ["coffee table", "meja tamu", "meja"],
  "tv-cabinet": ["tv", "televisi", "meja tv", "cabinet", "kabinet tv"],
  "tv-55": ["tv", "televisi", "smart tv", "layar"],
  "queen-bed": ["kasur", "bed", "ranjang", "tempat tidur", "queen"],
  "single-bed": ["kasur", "bed", "ranjang", "single", "anak"],
  "wardrobe-2m": ["lemari", "wardrobe", "pakaian", "built in"],
  "wardrobe-free": ["lemari", "wardrobe", "pakaian", "cabinet"],
  "side-table": ["nakas", "side table", "meja samping"],
  "work-desk": ["meja kerja", "meja belajar", "desk"],
  "kitchen-linear": ["kitchen set", "dapur", "kabinet dapur"],
  fridge: ["kulkas", "fridge", "appliance"],
  "dining-table-4": ["meja makan", "dining", "kursi makan"],
}

const CATEGORY_LABELS: Record<FurnitureItem["category"], string> = {
  seating: "Duduk",
  table: "Meja",
  bed: "Kasur",
  wardrobe: "Lemari",
  cabinet: "Kabinet",
  kitchen: "Kitchen set",
  appliance: "Elektronik",
  lighting: "Lampu",
  decor: "Dekor",
  bathroom_fixture: "Kamar mandi",
  outdoor: "Outdoor",
  storage: "Storage",
  workspace: "Kerja",
  prayer: "Ibadah",
}

function furnitureCatalogEntries(
  roomType: Room["type"],
  query: string
): FurnitureCatalogEntry[] {
  const normalized = normalizeSearch(query)
  return FURNITURE_LIBRARY.map((item) => ({
    item,
    recommended: item.roomTypes.includes(roomType),
  }))
    .filter(({ item, recommended }) => {
      if (!normalized) return recommended || isPopularFurniture(item)
      return furnitureSearchText(item).includes(normalized)
    })
    .sort((a, b) => {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1
      return a.item.name.localeCompare(b.item.name)
    })
}

function furnitureSearchText(item: FurnitureItem): string {
  return normalizeSearch(
    [
      item.id,
      item.name,
      item.category,
      categoryLabel(item.category),
      ...(FURNITURE_ALIASES[item.id] ?? []),
    ].join(" ")
  )
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

function isPopularFurniture(item: FurnitureItem): boolean {
  return ["seating", "table", "bed", "wardrobe", "cabinet", "appliance"].includes(item.category)
}

function categoryLabel(category: FurnitureItem["category"]): string {
  return CATEGORY_LABELS[category]
}

function shortName(name: string): string {
  return name
    .replace("Built-in", "")
    .replace("Compact", "")
    .replace(" Dudukan", "")
    .slice(0, 18)
}


