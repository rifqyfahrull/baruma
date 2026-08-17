export const PHANTOM_HASH_PARAM = "phantom_token"
export const PHANTOM_STORAGE_KEY = "baruma:phantom-token"
export const PHANTOM_PROFILE_KEY = "baruma:phantom-profile"

export type PhantomProfile = {
  id: string
  name: string
  email: string
}

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined"
}

export function getPhantomToken(): string | null {
  if (!canUseBrowserStorage()) return null
  return window.sessionStorage.getItem(PHANTOM_STORAGE_KEY)
}

export function getPhantomProfile(): PhantomProfile | null {
  if (!canUseBrowserStorage()) return null
  const raw = window.sessionStorage.getItem(PHANTOM_PROFILE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PhantomProfile>
    if (!parsed.id || !parsed.name || !parsed.email) return null
    return { id: parsed.id, name: parsed.name, email: parsed.email }
  } catch {
    return null
  }
}

export function setPhantomSession(
  token: string,
  profile?: PhantomProfile | null
): void {
  if (!canUseBrowserStorage()) return
  window.sessionStorage.setItem(PHANTOM_STORAGE_KEY, token)
  if (profile) {
    window.sessionStorage.setItem(PHANTOM_PROFILE_KEY, JSON.stringify(profile))
  } else {
    window.sessionStorage.removeItem(PHANTOM_PROFILE_KEY)
  }
  window.dispatchEvent(new CustomEvent("baruma:phantom-session-changed"))
}

export function clearPhantomSession(): void {
  if (!canUseBrowserStorage()) return
  window.sessionStorage.removeItem(PHANTOM_STORAGE_KEY)
  window.sessionStorage.removeItem(PHANTOM_PROFILE_KEY)
  window.dispatchEvent(new CustomEvent("baruma:phantom-session-changed"))
}

export function readPhantomSessionFromHash(): {
  token: string
  profile: PhantomProfile | null
} | null {
  if (typeof window === "undefined" || !window.location.hash) return null
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash
  const params = new URLSearchParams(hash)
  const token = params.get(PHANTOM_HASH_PARAM)
  if (!token) return null

  const id = params.get("phantom_profile_id")
  const name = params.get("phantom_profile_name")
  const email = params.get("phantom_profile_email")
  const profile = id && name && email ? { id, name, email } : null
  params.delete(PHANTOM_HASH_PARAM)
  params.delete("phantom_profile_id")
  params.delete("phantom_profile_name")
  params.delete("phantom_profile_email")
  const cleanHash = params.toString()
  const cleanUrl = `${window.location.pathname}${window.location.search}${
    cleanHash ? `#${cleanHash}` : ""
  }`
  window.history.replaceState(null, "", cleanUrl)
  return { token, profile }
}
