"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Kompas arah mata angin (U/T/S/B) untuk editor 2D & preview 3D.
 *
 * Presentasional murni: SVG mawar kompas dengan jarum utara merah. Rotasi
 * (derajat, CW) diberikan lewat prop `rotationDeg` ATAU dimutasi langsung
 * lewat ref elemen (jalur 3D: CompassBridge menulis style.transform tiap
 * frame tanpa re-render React — pola yang sama dengan setCanvas).
 *
 * Konvensi: rotationDeg 0 = utara ke atas (kanvas 2D selalu 0 karena
 * atas denah = utara; lihat lib/three/compass.ts).
 */
export const CompassRose = React.forwardRef<
  HTMLDivElement,
  { rotationDeg?: number; className?: string; title?: string }
>(function CompassRose({ rotationDeg = 0, className, title = "Arah mata angin (U = Utara)" }, ref) {
  return (
    <div
      className={cn(
        "pointer-events-none select-none rounded-full border border-border/60 bg-background/80 shadow-sm backdrop-blur-sm",
        className,
      )}
      role="img"
      aria-label={title}
      title={title}
      data-testid="compass-rose"
    >
      {/* Wrapper dalam yang dirotasi — huruf ikut berputar bersama jarum
          sehingga label selalu menunjuk arah dunia yang benar. */}
      <div
        ref={ref}
        className="h-full w-full"
        style={{ transform: `rotate(${rotationDeg}deg)` }}
        data-testid="compass-needle"
      >
        <svg viewBox="0 0 48 48" className="h-full w-full">
          {/* Garis silang tipis */}
          <line x1="24" y1="6" x2="24" y2="42" className="stroke-border" strokeWidth="1" />
          <line x1="6" y1="24" x2="42" y2="24" className="stroke-border" strokeWidth="1" />
          {/* Jarum utara (merah) & selatan (abu) */}
          <path d="M24 7 L27.5 24 L20.5 24 Z" className="fill-destructive" />
          <path d="M24 41 L27.5 24 L20.5 24 Z" className="fill-muted-foreground/40" />
          {/* Label arah (Indonesia): U/T/S/B */}
          <text x="24" y="14.5" textAnchor="middle" className="fill-destructive" fontSize="9" fontWeight="700">
            U
          </text>
          <text x="37" y="27.5" textAnchor="middle" className="fill-foreground/70" fontSize="8">
            T
          </text>
          <text x="24" y="39" textAnchor="middle" className="fill-foreground/70" fontSize="8">
            S
          </text>
          <text x="11" y="27.5" textAnchor="middle" className="fill-foreground/70" fontSize="8">
            B
          </text>
        </svg>
      </div>
    </div>
  )
})
