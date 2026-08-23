import { ImageResponse } from "next/og"

/**
 * Default OG/Twitter card — WS-D §3, closes the "link WhatsApp render blank"
 * gap (no `metadataBase`/OG image meant every shared link previewed empty).
 * Per-route pages (templates, `/s/[token]`) get their own `generateMetadata`
 * title/description; this image is the shared fallback art for all of them
 * unless a route defines its own `opengraph-image`.
 */
export const alt = "Baruma — Bikin konsep rumah terukur dari ide sederhana"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #0b3d38 0%, #0f5c52 60%, #14806f 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 84,
              height: 84,
              borderRadius: 20,
              background: "#ffffff",
            }}
          >
            <div
              style={{
                width: 0,
                height: 0,
                borderLeft: "22px solid transparent",
                borderRight: "22px solid transparent",
                borderBottom: "20px solid #0f5c52",
              }}
            />
          </div>
          <span style={{ fontSize: 56, fontWeight: 700, color: "#ffffff", letterSpacing: -1 }}>
            Baruma
          </span>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 40,
            fontSize: 40,
            fontWeight: 600,
            color: "#ffffff",
            maxWidth: 920,
            lineHeight: 1.25,
          }}
        >
          Bikin konsep rumah terukur dari ide sederhana
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 24,
            fontSize: 24,
            color: "rgba(255,255,255,0.75)",
          }}
        >
          Denah · Preview 3D · RAB awal — dalam satu workspace
        </div>
      </div>
    ),
    { ...size }
  )
}
