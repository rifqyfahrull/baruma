"use client";

import * as React from "react";

/**
 * Lightweight analytics layer (PRD §27). Events are pushed to `window.dataLayer`
 * (ready for GTM/Segment/etc.) and logged in dev, AND forwarded to Umami
 * (WS-E §1, `<UmamiScript />` in the root layout) when its script has loaded.
 * `window.umami` is undefined until that script finishes loading (or when
 * NEXT_PUBLIC_UMAMI_SRC/WEBSITE_ID are unset, i.e. dev/self-host without an
 * account) — calls are guarded with `?.` so tracking never throws either way.
 * Swap/extend the transport here — call sites stay the same.
 */
export type AnalyticsEvent =
  | "signup_started"
  | "signup_completed"
  | "project_created"
  | "wizard_step_completed"
  | "brief_generated"
  | "brief_updated"
  | "alternatives_generated"
  | "alternative_selected"
  | "editor_opened"
  | "interior_opened"
  | "interior_style_selected"
  | "interior_furniture_moved"
  | "room_edited"
  | "exterior_edited"
  | "exterior_template_applied"
  | "exterior_certification_gate_passed"
  | "validation_warning_clicked"
  | "preview_3d_opened"
  | "rab_opened"
  | "export_started"
  | "export_completed"
  | "export_downloaded"
  | "share_clicked"
  | "template_use_clicked"
  | "upgrade_clicked";

export type AnalyticsProps = {
  project_id?: string;
  design_version_id?: string;
  user_plan?: string;
  source?: string;
  [key: string]: unknown;
};

type UmamiWindow = Window & {
  umami?: { track: (event: string, props?: Record<string, unknown>) => void };
};
type DataLayerWindow = Window & { dataLayer?: Record<string, unknown>[] };

export function track(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  const payload = { event, ...props, ts: new Date().toISOString() };

  if (typeof window !== "undefined") {
    const w = window as DataLayerWindow;
    w.dataLayer = w.dataLayer ?? [];
    w.dataLayer.push(payload);

    // Umami backend (WS-E §1) — no-op until the script loads (or forever,
    // if NEXT_PUBLIC_UMAMI_SRC/WEBSITE_ID are unset). dataLayer push above
    // stays as the backward-compatible transport regardless.
    (window as UmamiWindow).umami?.track(event, props);
  }

  if (process.env.NODE_ENV !== "production") {
    console.debug("[analytics]", event, payload);
  }
}

/** Fire a single event when a page/view mounts. */
export function usePageView(
  event: AnalyticsEvent,
  props: AnalyticsProps = {},
): void {
  const fired = React.useRef(false);
  React.useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track(event, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, props.project_id]);
}
