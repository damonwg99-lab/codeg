"use client"

import { useCallback } from "react"
import { createProject } from "@/lib/platform/api"
import { usePlatform } from "@/contexts/platform-context"
import type { FolderDetail } from "@/lib/types"

/**
 * After opening a folder (or cloning a repo), automatically create a
 * project if no existing project points to that path. The project name
 * defaults to the last segment of the directory path.
 *
 * After creating a project, refreshes PlatformContext's project list
 * so ProjectList (which reads from the context) and ProjectSwitcher
 * both pick up the new project.
 */
export function useAutoCreateProject() {
  const { projects, loadProjects } = usePlatform()

  const autoCreateProject = useCallback(
    async (folderDetail: FolderDetail) => {
      // Check if a project already exists with this rootDir
      const normalizedPath = folderDetail.path.replace(/\\/g, "/")
      const existing = projects.find((p) => {
        const projPath = p.rootDir.replace(/\\/g, "/")
        return projPath === normalizedPath
      })
      if (existing) return // Already has a project — skip

      // Derive project name from folder path (last segment)
      const segments = normalizedPath.split("/")
      const projectName = segments.filter(Boolean).pop() ?? folderDetail.name

      try {
        await createProject({
          name: projectName,
          rootDir: folderDetail.path,
        })
        // Refresh PlatformContext's project list so ProjectList and
        // ProjectSwitcher both update.
        await loadProjects()
      } catch (err) {
        // Silently ignore errors — project creation is opportunistic,
        // not critical. The folder still opened successfully.
        console.warn("[AutoCreateProject] failed to create project:", err)
      }
    },
    [projects, loadProjects]
  )

  return { autoCreateProject }
}
