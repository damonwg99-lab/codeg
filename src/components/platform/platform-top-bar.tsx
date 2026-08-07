"use client"

import { RepoSelector } from "@/components/platform/repo-selector"
import { ProjectSwitcher } from "@/components/platform/project-switcher"

/**
 * Top-bar cluster for the desktop window chrome: the project switcher and the
 * git repo switcher sit side by side, right after the "open remote workspace"
 * button. Rendered inside `LeftEdgeChrome`. Each switcher returns null until
 * there is something to switch, so this bar collapses gracefully on early
 * projects / non-git workspaces.
 */
export function PlatformTopBar() {
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <ProjectSwitcher />
      <RepoSelector />
    </div>
  )
}
