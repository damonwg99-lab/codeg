"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus, FolderOpen } from "lucide-react"
import { listProjects } from "@/lib/platform/api"
import type { ProjectInfo } from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export function ProjectList() {
  const t = useTranslations("Platform")
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const list = await listProjects()
        if (!cancelled) {
          setProjects(list)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <div className="text-muted-foreground">Loading…</div>
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <FolderOpen className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">{t("sidebar.noProject")}</p>
        <Button
          onClick={() => router.push("/platform?view=create-project")}
        >
          <Plus className="mr-1 h-4 w-4" />
          {t("project.create")}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("sidebar.projectTab")}</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/platform?view=create-project")}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t("project.create")}
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <Card
            key={project.id}
            className="cursor-pointer transition-colors hover:bg-accent"
            onClick={() =>
              router.push(`/platform?view=project-detail&id=${project.id}`)
            }
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-[0.9375rem]">
                {project.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-col gap-1 text-[0.8125rem] text-muted-foreground">
                <span>{project.rootDir}</span>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[0.625rem]">
                    {project.status}
                  </Badge>
                  {project.clientName && (
                    <span className="truncate">{project.clientName}</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
