"use client"

import { useEffect, useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Pencil, Save, X, RefreshCw, ArrowLeft } from "lucide-react"
import {
  getProject,
  updateProject,
  scanGitRepos,
  addProjectRepo,
  removeProjectRepo,
} from "@/lib/platform/api"
import type { ProjectDetail, GitRepoScanResult } from "@/lib/platform/types"
import { KnowledgeManager } from "./knowledge-manager"
import { usePlatform } from "@/contexts/platform-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** Resolve task status label using i18n (same pattern as task-detail/kanban). */
function resolveStatusLabel(t: (key: never) => string, status: string): string {
  const keyMap: Record<string, string> = {
    backlog: "task.status.backlog",
    confirmed: "task.status.confirmed",
    in_progress: "task.status.in_progress",
    done: "task.status.done",
    released: "task.status.released",
  }
  const key = keyMap[status]
  return key ? (t(key as never) ?? status) : status
}

/** Resolve project status label using i18n. Fallback to raw value if unknown. */
function resolveProjectStatusLabel(
  t: (key: never) => string,
  status: string
): string {
  const key = `project.statusValues.${status}`
  // next-intl t() returns undefined for unknown keys; fallback to raw status
  const label = t(key as never)
  return label !== undefined && label !== key ? label : status
}

export function ProjectDetail({ id }: { id: number }) {
  const t = useTranslations("Platform")
  const { activeProjectId, loadProjectDetail, loadProjects } = usePlatform()
  const { setRoute } = useWorkbenchRoute()
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Edit form state
  const [editName, setEditName] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editClientName, setEditClientName] = useState("")
  const [editDefaultAgentType, setEditDefaultAgentType] = useState("")
  const [editStatus, setEditStatus] = useState("")

  // Project status values (matches backend default + common statuses)
  const PROJECT_STATUSES = ["planning", "active", "completed", "archived"]

  // Scan state for add-repo
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<GitRepoScanResult[]>([])
  const [selectedScanRepos, setSelectedScanRepos] = useState<Set<string>>(
    new Set()
  )
  const [failedAddRepos, setFailedAddRepos] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const d = await getProject(id)
        if (!cancelled) {
          setDetail(d)
          setEditName(d.project.name)
          setEditDescription(d.project.description ?? "")
          setEditClientName(d.project.clientName ?? "")
          setEditDefaultAgentType(d.project.defaultAgentType ?? "")
          setEditStatus(d.project.status)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  const handleSave = useCallback(async () => {
    if (!detail) return
    setSaving(true)
    try {
      const updated = await updateProject({
        id: detail.project.id,
        name: editName,
        description: editDescription || undefined,
        clientName: editClientName || undefined,
        status: editStatus,
        defaultAgentType: editDefaultAgentType || undefined,
      })
      setDetail((prev) => (prev ? { ...prev, project: updated } : null))
      // Refresh PlatformContext's projects list so ProjectList picks up
      // the updated status (ProjectList reads from context directly).
      await loadProjects()
      setEditing(false)
    } catch (e) {
      // Keep editing state on error
      console.error("Failed to save:", e)
    }
    setSaving(false)
  }, [
    detail,
    editName,
    editDescription,
    editClientName,
    editStatus,
    editDefaultAgentType,
    loadProjects,
  ])

  const handleScan = useCallback(async () => {
    if (!detail) return
    setScanning(true)
    try {
      const results = await scanGitRepos(detail.project.rootDir)
      // Filter out repos already linked to project
      const existingDirs = new Set(detail.repos.map((r) => r.localDir))
      const newRepos = results.filter((r) => !existingDirs.has(r.localDir))
      setScanResults(newRepos)
      setSelectedScanRepos(new Set(newRepos.map((r) => r.localDir)))
    } catch (e) {
      console.error("Scan failed:", e)
      setScanResults([])
    }
    setScanning(false)
  }, [detail])

  const handleAddRepos = useCallback(async () => {
    if (!detail) return
    setFailedAddRepos([])
    const failed: string[] = []
    for (const localDir of selectedScanRepos) {
      const repo = scanResults.find((r) => r.localDir === localDir)
      if (repo) {
        try {
          await addProjectRepo({
            projectId: detail.project.id,
            name: repo.name,
            gitUrl: repo.gitUrl ?? "",
            localDir: repo.localDir,
            hasClaudeMd: repo.hasClaudeMd,
          })
        } catch (e) {
          console.error("Failed to add repo:", repo.name, e)
          failed.push(repo.name)
        }
      }
    }
    setFailedAddRepos(failed)
    // Reload project detail
    const d = await getProject(id)
    setDetail(d)
    setScanResults([])
    setSelectedScanRepos(new Set())
    // Refresh platform context if this is the active project
    if (activeProjectId === id) {
      await loadProjectDetail()
    }
  }, [
    detail,
    scanResults,
    selectedScanRepos,
    id,
    activeProjectId,
    loadProjectDetail,
  ])

  const handleRemoveRepo = useCallback(
    async (repoId: number) => {
      try {
        await removeProjectRepo(repoId)
        // Reload project detail
        const d = await getProject(id)
        setDetail(d)
        // Refresh platform context if this is the active project
        if (activeProjectId === id) {
          await loadProjectDetail()
        }
      } catch (e) {
        console.error("Failed to remove repo:", e)
      }
    },
    [id, activeProjectId, loadProjectDetail]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="flex items-center justify-center py-16 text-destructive">
        Project not found
      </div>
    )
  }

  const { project, repos, taskCountByStatus } = detail

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-6 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setRoute("project-list")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-lg font-semibold">{project.name}</h2>
          </div>
          <div className="flex items-center gap-1">
            {editing ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  {t("project.cancel")}
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-1 h-3.5 w-3.5" />
                  )}
                  {t("project.save")}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" />
                {t("project.edit")}
              </Button>
            )}
          </div>
        </div>

        {/* Task count summary */}
        <div className="flex items-center gap-2 text-[0.8125rem]">
          <Badge
            variant="outline"
            className="text-[0.625rem] bg-muted text-muted-foreground"
          >
            {taskCountByStatus.backlog} {resolveStatusLabel(t, "backlog")}
          </Badge>
          <Badge
            variant="outline"
            className="text-[0.625rem] bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          >
            {taskCountByStatus.confirmed} {resolveStatusLabel(t, "confirmed")}
          </Badge>
          <Badge
            variant="outline"
            className="text-[0.625rem] bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300"
          >
            {taskCountByStatus.inProgress}{" "}
            {resolveStatusLabel(t, "in_progress")}
          </Badge>
          <Badge
            variant="outline"
            className="text-[0.625rem] bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
          >
            {taskCountByStatus.done} {resolveStatusLabel(t, "done")}
          </Badge>
          <Badge
            variant="outline"
            className="text-[0.625rem] bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
          >
            {taskCountByStatus.released} {resolveStatusLabel(t, "released")}
          </Badge>
        </div>

        <Tabs defaultValue="basic-info">
          <TabsList>
            <TabsTrigger value="basic-info">
              {t("project.basicInfo")}
            </TabsTrigger>
            <TabsTrigger value="repos">{t("project.repos")}</TabsTrigger>
            <TabsTrigger value="kb">{t("project.knowledgeBase")}</TabsTrigger>
            <TabsTrigger value="zentao" disabled>
              {t("project.zentaoConfig")}
            </TabsTrigger>
            <TabsTrigger value="cicd" disabled>
              {t("project.cicd")}
            </TabsTrigger>
          </TabsList>

          {/* Basic Info Tab */}
          <TabsContent value="basic-info">
            <Card>
              <CardContent className="pt-4 flex flex-col gap-3">
                {editing ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label>{t("project.name")}</Label>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{t("project.status")}</Label>
                      <Select value={editStatus} onValueChange={setEditStatus}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PROJECT_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {resolveProjectStatusLabel(t, s)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{t("project.description")}</Label>
                      <Input
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{t("project.clientName")}</Label>
                      <Input
                        value={editClientName}
                        onChange={(e) => setEditClientName(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{t("project.defaultAgentType")}</Label>
                      <Select
                        value={editDefaultAgentType}
                        onValueChange={setEditDefaultAgentType}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Auto" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Auto</SelectItem>
                          <SelectItem value="claude_code">
                            Claude Code
                          </SelectItem>
                          <SelectItem value="codex">Codex</SelectItem>
                          <SelectItem value="open_code">OpenCode</SelectItem>
                          <SelectItem value="gemini">Gemini</SelectItem>
                          <SelectItem value="cline">Cline</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-1">
                      <span className="text-[0.75rem] text-muted-foreground">
                        {t("project.name")}
                      </span>
                      <span className="text-[0.875rem]">{project.name}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[0.75rem] text-muted-foreground">
                        {t("project.status")}
                      </span>
                      <Badge variant="outline">
                        {resolveProjectStatusLabel(t, project.status)}
                      </Badge>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[0.75rem] text-muted-foreground">
                        {t("project.rootDir")}
                      </span>
                      <span className="text-[0.875rem]">{project.rootDir}</span>
                    </div>
                    {project.description && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[0.75rem] text-muted-foreground">
                          {t("project.description")}
                        </span>
                        <span className="text-[0.875rem]">
                          {project.description}
                        </span>
                      </div>
                    )}
                    {project.clientName && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[0.75rem] text-muted-foreground">
                          {t("project.clientName")}
                        </span>
                        <span className="text-[0.875rem]">
                          {project.clientName}
                        </span>
                      </div>
                    )}
                    {project.defaultAgentType && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[0.75rem] text-muted-foreground">
                          {t("project.defaultAgentType")}
                        </span>
                        <span className="text-[0.875rem]">
                          {project.defaultAgentType}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Repos Tab */}
          <TabsContent value="repos">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-[0.9375rem]">
                    {t("project.repos")}
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleScan}
                    disabled={scanning}
                  >
                    {scanning ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    )}
                    {t("project.rescan")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {failedAddRepos.length > 0 && (
                  <p className="text-[0.8125rem] text-destructive">
                    {t("project.addRepoFailed", {
                      repos: failedAddRepos.join(", "),
                    })}
                  </p>
                )}
                {repos.length === 0 ? (
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {t("project.noRepos")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
                    {repos.map((repo) => (
                      <div
                        key={repo.id}
                        className="flex items-center gap-2 rounded-md border p-2"
                      >
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-[0.875rem] font-medium truncate">
                            {repo.name}
                          </span>
                          <span className="text-[0.75rem] text-muted-foreground truncate">
                            {repo.localDir}
                          </span>
                        </div>
                        {repo.branch && (
                          <Badge
                            variant="outline"
                            className="text-[0.625rem] shrink-0"
                          >
                            {repo.branch}
                          </Badge>
                        )}
                        {repo.hasClaudeMd && (
                          <Badge
                            variant="outline"
                            className="text-[0.625rem] shrink-0 bg-green-50 text-green-700"
                          >
                            CLAUDE.md
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveRepo(repo.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Scan results (new repos to add) */}
                {scanResults.length > 0 && (
                  <>
                    <Separator />
                    <p className="text-[0.8125rem] font-medium">
                      {t("project.addRepo")}
                    </p>
                    {scanResults.map((repo) => (
                      <div
                        key={repo.localDir}
                        className="flex items-center gap-2 rounded-md border p-2"
                      >
                        <Checkbox
                          checked={selectedScanRepos.has(repo.localDir)}
                          onCheckedChange={() => {
                            setSelectedScanRepos((prev) => {
                              const next = new Set(prev)
                              if (next.has(repo.localDir))
                                next.delete(repo.localDir)
                              else next.add(repo.localDir)
                              return next
                            })
                          }}
                        />
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-[0.875rem] font-medium truncate">
                            {repo.name}
                          </span>
                          <span className="text-[0.75rem] text-muted-foreground truncate">
                            {repo.localDir}
                          </span>
                        </div>
                        {repo.hasClaudeMd && (
                          <Badge
                            variant="outline"
                            className="text-[0.625rem] shrink-0 bg-green-50 text-green-700"
                          >
                            CLAUDE.md
                          </Badge>
                        )}
                      </div>
                    ))}
                    <Button
                      size="sm"
                      onClick={handleAddRepos}
                      disabled={selectedScanRepos.size === 0}
                    >
                      {t("project.addRepo")} ({selectedScanRepos.size})
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Disabled tabs with coming-soon placeholder */}
          <TabsContent value="zentao">
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {t("project.comingSoon")}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="cicd">
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {t("project.comingSoon")}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="kb">
            <KnowledgeManager projectId={id} project={project} />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  )
}
