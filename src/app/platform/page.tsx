"use client"

import { useEffect } from "react"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"

/**
 * /platform route redirects into the workspace via WorkbenchRoute.
 * All platform views (project-list, task-kanban, etc.) are rendered as
 * WorkbenchRoute overlays inside /workspace, not as separate pages.
 */
export default function PlatformPage() {
  const { setRoute } = useWorkbenchRoute()

  useEffect(() => {
    setRoute("project-list")
  }, [setRoute])

  return null
}
