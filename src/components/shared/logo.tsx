import { cn } from "@/lib/utils"

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-5", className)}
      aria-hidden
    >
      <path
        d="M 5 14.5 L 16 5 L 27 14.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 8 12 V 8.5 H 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M 9.5 12 V 26.5 H 18.5 C 22 26.5 24.5 24 24.5 21.25 C 24.5 18.8 22.8 17 20 16.5 C 22.2 16 23.5 14.2 23.5 12.25 C 23.5 10 21.5 8.5 18.5 8.5 H 9.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 9.5 19.5 L 16 14.2 L 22.5 19.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 18.5 11 C 18.5 12.2 19.3 13 20.5 13 C 19.3 13 18.5 13.8 18.5 15 C 18.5 13.8 17.7 13 16.5 13 C 17.7 13 18.5 12.2 18.5 11 Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function Logo({
  className,
  textClassName,
  showText = true,
  size = "default",
}: {
  className?: string
  textClassName?: string
  showText?: boolean
  size?: "sm" | "default"
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm",
          size === "sm" ? "size-7" : "size-8"
        )}
      >
        <LogoMark className={size === "sm" ? "size-4" : "size-5"} />
      </span>
      {showText && (
        <span
          className={cn(
            "font-semibold tracking-tight whitespace-nowrap",
            size === "sm" ? "text-sm" : "text-base",
            textClassName
          )}
        >
          Baruma
        </span>
      )}
    </span>
  )
}
