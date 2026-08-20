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

  const normalizeForCompare = (p: string) => {
    let s = p.replace(/\\/g, "/")
    if (s.length > 1) s = s.replace(/\/+$/, "")
    return s
  }

  const autoCreateProject = useCallback(
    async (folderDetail: FolderDetail) => {
      // Check if a project already exists with this rootDir
      const normalizedPath = normalizeForCompare(folderDetail.path)
      const existing = projects.find((p) => {
        const projPath = normalizeForCompare(p.rootDir)
        // Exact match: the path itself is a project rootDir
        if (projPath === normalizedPath) return true
        // Parent-directory match: the path is a subdirectory of a project
        // rootDir (e.g. /projectA/repoB is under /projectA). This prevents
        // auto-creating a duplicate project for repos cloned under an
        // existing project rootDir.
        if (
          normalizedPath.startsWith(projPath + "/") ||
          projPath.startsWith(normalizedPath + "/")
        )
          return true
        return false
      })
      if (existing) return // Already has a project — skip

      // Derive project name from folder path (last segment)
      const segments = normalizedPath.split("/")
      const projectName = segments.filter(Boolean).pop() ?? folderDetail.name

      // Store without a trailing separator so `D:\Foo\` cannot later appear as
      // a second row distinct from `D:\Foo` (visible as duplicate targets).
      const cleanRootDir = folderDetail.path.replace(/[/\\]+$/, "") || folderDetail.path

      try {
        await createProject({
          name: projectName,
          rootDir: cleanRootDir,
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
