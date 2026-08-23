"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Plus } from "lucide-react"

import { ADMIN_NAV_ITEM, APP_NAV, APP_NAV_SECONDARY } from "@/lib/nav"
import { useCurrentUser } from "@/lib/api/hooks"
import { Logo } from "@/components/shared/logo"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { CreditsIndicator } from "./credits-indicator"
import { UserMenu } from "./user-menu"

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AppSidebar() {
  const pathname = usePathname()
  const { data: user } = useCurrentUser()

  return (
    <Sidebar>
      <SidebarHeader className="gap-2.5">
        <Link
          href="/app/dashboard"
          className="flex items-center px-1.5 py-1.5 group-data-[collapsible=icon]:px-0"
        >
          <Logo />
        </Link>
        <Button asChild size="sm" className="w-full justify-center">
          <Link href="/app/projects/new">
            <Plus />
            <span className="group-data-[collapsible=icon]:hidden">
              Buat Project
            </span>
          </Link>
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {APP_NAV.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                    isActive={isActive(pathname, item.href)}
                  >
                    <Link
                      href={item.href}
                      aria-current={
                        isActive(pathname, item.href) ? "page" : undefined
                      }
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {/* Admin backoffice (Task 8): a real, enabled link that renders
                  nothing at all for non-admins. The session role here is only
                  a fast UI hint; every admin API route independently
                  re-checks via requireAdmin (DB-fresh). */}
              {user?.role === "admin" && (
                <SidebarMenuItem key={ADMIN_NAV_ITEM.href}>
                  <SidebarMenuButton
                    asChild
                    tooltip={ADMIN_NAV_ITEM.title}
                    isActive={isActive(pathname, ADMIN_NAV_ITEM.href)}
                  >
                    <Link
                      href={ADMIN_NAV_ITEM.href}
                      aria-current={
                        isActive(pathname, ADMIN_NAV_ITEM.href)
                          ? "page"
                          : undefined
                      }
                    >
                      <ADMIN_NAV_ITEM.icon />
                      <span>{ADMIN_NAV_ITEM.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Nav sekunder (WS-E §3) — sebelumnya array `APP_NAV_SECONDARY` ada
            di nav.ts tapi tak pernah dirender di sini. */}
        {APP_NAV_SECONDARY.length > 0 && (
          <>
            <SidebarSeparator className="mx-0" />
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {APP_NAV_SECONDARY.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        tooltip={item.title}
                        isActive={isActive(pathname, item.href)}
                      >
                        <Link
                          href={item.href}
                          aria-current={
                            isActive(pathname, item.href) ? "page" : undefined
                          }
                        >
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="gap-2">
        <div className="group-data-[collapsible=icon]:hidden">
          <CreditsIndicator />
        </div>
        <UserMenu />
      </SidebarFooter>
    </Sidebar>
  )
}
