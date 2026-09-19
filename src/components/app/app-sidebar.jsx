import { ChartColumnIcon, CalendarDaysIcon, MessageSquareIcon, MonitorIcon, MoonIcon, PlusIcon, SettingsIcon, SquarePenIcon, SunIcon, ChevronsUpDownIcon, DownloadIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { dateKey } from "@/domain"
import { downloadFile } from "@/store"
import { useApp } from "@/components/app/app-context"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"

export const NAV = [
  { id: "chat", label: "Chat", icon: MessageSquareIcon },
  { id: "insights", label: "Insights", icon: ChartColumnIcon },
  { id: "journal", label: "Journal", icon: CalendarDaysIcon },
]

export function AppSidebar({ onNewChat }) {
  const { page, navigate, logEntry, state } = useApp()
  const { isMobile, setOpenMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const go = (id) => {
    navigate(id)
    if (isMobile) setOpenMobile(false)
  }
  const name = state.profile.name?.trim()
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={() => go("chat")} tooltip="Daybook">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <SquarePenIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-heading font-semibold">Daybook</span>
                <span className="truncate text-xs text-muted-foreground">Your day, organized</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="New chat"
                  onClick={() => {
                    onNewChat()
                    go("chat")
                  }}
                >
                  <PlusIcon />
                  <span>New chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Your space</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Main navigation">
              {NAV.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton isActive={page === item.id} tooltip={item.label} onClick={() => go(item.id)} aria-current={page === item.id ? "page" : undefined}>
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Log manually"
                  onClick={() => {
                    logEntry()
                    if (isMobile) setOpenMobile(false)
                  }}
                >
                  <SquarePenIcon />
                  <span>Log manually</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={page === "settings"} tooltip="Settings" onClick={() => go("settings")} aria-current={page === "settings" ? "page" : undefined}>
              <SettingsIcon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent" tooltip="Account and theme">
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg">{(name || "You").slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{name || "You"}</span>
                    <span className="truncate text-xs text-muted-foreground">Saved on this device</span>
                  </div>
                  <ChevronsUpDownIcon className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-56" side={isMobile ? "bottom" : "right"} align="end">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                  <DropdownMenuRadioItem value="light">
                    <SunIcon /> Light
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <MoonIcon /> Dark
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
                    <MonitorIcon /> System
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => downloadFile(`daybook-backup-${dateKey()}.json`, JSON.stringify(state, null, 2))}>
                    <DownloadIcon /> Export backup
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => go("settings")}>
                    <SettingsIcon /> Settings
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
