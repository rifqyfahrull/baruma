import { cn } from "@/lib/utils"
import type { ThumbnailVariant } from "@/types"

/**
 * Deterministic, abstract floor-plan thumbnail rendered as SVG. Used wherever a
 * project/alternative needs a preview before a real render exists (PRD §10.2,
 * §10.5). Colors come from the design tokens so it adapts to light/dark.
 */

type Rect = { x: number; y: number; w: number; h: number }

function Room({ x, y, w, h, className }: Rect & { className?: string }) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={3}
      className={cn("fill-card stroke-primary/25", className)}
      strokeWidth={1.5}
    />
  )
}

function VariantPlan({ variant }: { variant: ThumbnailVariant }) {
  switch (variant) {
    case "courtyard":
      return (
        <g>
          <Room x={22} y={22} w={50} h={44} />
          <Room x={22} y={70} w={50} h={58} />
          <Room x={128} y={22} w={50} h={44} />
          <Room x={128} y={70} w={50} h={58} />
          {/* central void */}
          <rect
            x={78}
            y={22}
            width={44}
            height={62}
            rx={4}
            className="fill-accent/50 stroke-accent-foreground/30"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
          {/* plunge pool */}
          <rect
            x={78}
            y={90}
            width={44}
            height={38}
            rx={4}
            className="fill-info/20 stroke-info/50"
            strokeWidth={1.5}
          />
        </g>
      )
    case "vertical":
      return (
        <g>
          <Room x={60} y={20} w={80} h={30} />
          <Room x={60} y={54} w={38} h={36} />
          <Room x={102} y={54} w={38} h={36} />
          <Room x={60} y={94} w={80} h={36} />
          <rect
            x={146}
            y={20}
            width={20}
            height={110}
            rx={3}
            className="fill-primary/10 stroke-primary/35"
            strokeWidth={1.5}
          />
        </g>
      )
    case "family":
      return (
        <g>
          {/* big gathering area */}
          <rect
            x={22}
            y={22}
            width={96}
            height={62}
            rx={4}
            className="fill-primary/8 stroke-primary/35"
            strokeWidth={1.5}
          />
          <Room x={124} y={22} w={54} h={30} />
          <Room x={124} y={56} w={54} h={28} />
          <Room x={22} y={90} w={48} h={38} />
          <Room x={76} y={90} w={48} h={38} />
          <Room x={130} y={90} w={48} h={38} />
        </g>
      )
    case "compact":
      return (
        <g>
          <Room x={24} y={24} w={70} h={48} />
          <Room x={100} y={24} w={76} h={48} />
          <Room x={24} y={78} w={46} h={48} />
          <Room x={76} y={78} w={46} h={48} />
          <Room x={128} y={78} w={48} h={48} />
        </g>
      )
    case "tropis":
    default:
      return (
        <g>
          <Room x={22} y={22} w={80} h={50} />
          <Room x={108} y={22} w={70} h={50} />
          <Room x={22} y={78} w={70} h={50} />
          {/* taman / green */}
          <rect
            x={98}
            y={78}
            width={80}
            height={50}
            rx={4}
            className="fill-success/15 stroke-success/40"
            strokeWidth={1.5}
          />
        </g>
      )
  }
}

export function LayoutThumbnail({
  variant = "tropis",
  className,
  label,
}: {
  variant?: ThumbnailVariant
  className?: string
  label?: string
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg bg-gradient-to-br from-primary/5 via-background to-accent/25",
        className
      )}
      role="img"
      aria-label={label ?? "Pratinjau denah"}
    >
      <svg
        viewBox="0 0 200 150"
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
      >
        {/* site boundary */}
        <rect
          x={12}
          y={12}
          width={176}
          height={126}
          rx={8}
          className="fill-transparent stroke-border"
          strokeWidth={2}
        />
        <VariantPlan variant={variant} />
      </svg>
    </div>
  )
}
