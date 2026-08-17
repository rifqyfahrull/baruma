import type { NextRequest } from "next/server";

import { updateSupabaseSession } from "@/lib/supabase/middleware";

// Refreshes the shared `.tampil.dev` Supabase session on every /app/* request
// and redirects to /login when there's no authenticated user; /login &
// /register are guest-only (sudah login → redirect ke dashboard/next). When
// Supabase is unconfigured (local dev/e2e without keys) it passes through.
export default async function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  matcher: ["/app/:path*", "/login", "/register"], // hey
};
