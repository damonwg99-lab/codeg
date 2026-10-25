"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Loader2,
  Pencil,
  Save,
  X,
  RefreshCw,
  ArrowLeft,
  Download,
  FolderOpen,
  GitBranch,
} from "lucide-react"
import {
  getProject,
  updateProject,
  updateProjectRepo,
  scanGitRepos,
  addProjectRepo,
  removeProjectRepo,
} from "@/lib/platform/api"
import type {
  ProjectDetail,
  GitRepoScanResult,
  ProjectRepoInfo,
} from "@/lib/platform/types"
import { errorText } from "@/lib/platform/errors"
import { openFileDialog } from "@/lib/platform"
import { KnowledgeManager } from "./knowledge-manager"
import { usePlatform } from "@/contexts/platform-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { CloneDialog } from "@/components/layout/clone-dialog"
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** Resolve task status label using i18n (same pattern as task-detail/kanban). */
function resolveStatusLabel(t: (key: never) => string, status: string): string {
  const keyMap: Record<string, string> = {
    backlog: "task.status.backlog",
    confirmed: "task.status.confirmed",
    in_progress: "task.status.in_progress",
    done: "task.status.done",
    pending: "task.status.pending",
    archived: "task.status.archived",
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
  const { setRoute, fromRoute, back } = useWorkbenchRoute()
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
  const [editDevBranch, setEditDevBranch] = useState("")
  const [editUatBranch, setEditUatBranch] = useState("")
  const [editPrdBranch, setEditPrdBranch] = useState("")
  const [editKbLocalDir, setEditKbLocalDir] = useState("")
  const [editKbRepoUrl, setEditKbRepoUrl] = useState("")

  // Project status values (matches backend default + common statuses)
  const PROJECT_STATUSES = ["planning", "active", "completed", "archived"]

  // Scan state for add-repo
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<GitRepoScanResult[]>([])
  const [selectedScanRepos, setSelectedScanRepos] = useState<Set<string>>(
    new Set()
  )
  const [failedAddRepos, setFailedAddRepos] = useState<string[]>([])
  const [cloneOpen, setCloneOpen] = useState(false)

  // Per-repo environment branch overrides (dev/uat/prd).
  const [repoEnvEdit, setRepoEnvEdit] = useState<{
    repo: ProjectRepoInfo
    dev: string
    uat: string
    prd: string
  } | null>(null)
  const [savingRepoEnv, setSavingRepoEnv] = useState(false)

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
          setEditDevBranch(d.project.devBranch ?? "")
          setEditUatBranch(d.project.uatBranch ?? "")
          setEditPrdBranch(d.project.prdBranch ?? "")
          setEditKbLocalDir(d.project.kbLocalDir ?? "")
          setEditKbRepoUrl(d.project.kbRepoUrl ?? "")
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

  // KB directory picker (same directory dialog the clone-repo flow uses;
  // web mode falls back to a server-path prompt inside openFileDialog).
  const handleBrowseKbDir = useCallback(async () => {
    try {
      const result = await openFileDialog({
        directory: true,
        title: "选择知识库目录",
      })
      if (result && typeof result === "string") {
        setEditKbLocalDir(result)
      }
    } catch (e) {
      console.error("browse kb dir failed:", e)
    }
  }, [])

  // Which select option reflects the current KB git URL / local dir: a repo
  // whose gitUrl matches wins, then one whose localDir is the KB directory
  // (the KB working copy may be a repo without a known URL), otherwise a
  // custom URL keeps a synthetic entry so the select can display it.
  const kbRepoSelectValue = useMemo(() => {
    const repos = detail?.repos ?? []
    const url = editKbRepoUrl.trim()
    if (url) {
      const byUrl = repos.find((r) => r.gitUrl && r.gitUrl === url)
      if (byUrl) return `repo:${byUrl.localDir}`
    }
    const dir = editKbLocalDir.trim().replace(/\\/g, "/").toLowerCase()
    if (dir) {
      const byDir = repos.find(
        (r) => r.localDir.replace(/\\/g, "/").toLowerCase() === dir
      )
      if (byDir) return `repo:${byDir.localDir}`
    }
    return url ? "__custom__" : "__none__"
  }, [detail, editKbRepoUrl, editKbLocalDir])

  const handleKbRepoSelect = useCallback(
    (value: string) => {
      if (value === "__none__") {
        setEditKbRepoUrl("")
        return
      }
      if (value === "__custom__") return
      if (!value.startsWith("repo:")) return
      const localDir = value.slice("repo:".length)
      const repo = detail?.repos.find((r) => r.localDir === localDir)
      if (!repo) return
      setEditKbRepoUrl(repo.gitUrl || "")
      // Associating a repo implies its working copy is the KB; fill the
      // directory only when the user hasn't set one themselves.
      setEditKbLocalDir((prev) => prev.trim() || repo.localDir)
    },
    [detail]
  )

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
        devBranch: editDevBranch,
        uatBranch: editUatBranch,
        prdBranch: editPrdBranch,
        kbLocalDir: editKbLocalDir.trim() || null,
        kbRepoUrl: editKbRepoUrl.trim() || null,
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
    editDevBranch,
    editUatBranch,
    editPrdBranch,
    editKbLocalDir,
    editKbRepoUrl,
    loadProjects,
  ])

  const handleSaveRepoEnv = useCallback(async () => {
    if (!repoEnvEdit) return
    setSavingRepoEnv(true)
    try {
      const updated = await updateProjectRepo({
        id: repoEnvEdit.repo.id,
        devBranch: repoEnvEdit.dev.trim() || null,
        uatBranch: repoEnvEdit.uat.trim() || null,
        prdBranch: repoEnvEdit.prd.trim() || null,
      })
      setDetail(
        (prev) =>
          prev && {
            ...prev,
            repos: prev.repos.map((r) => (r.id === updated.id ? updated : r)),
          }
      )
      // The branch board and its detail panel resolve env branches from
      // PlatformContext's repo list, so updating only local state would leave
      // them showing the previous configuration.
      await loadProjectDetail()
      setRepoEnvEdit(null)
    } catch (e) {
      // Previously console-only: the dialog just stayed open with the spinner
      // stopping and no indication that nothing had been saved.
      toast.error(
        t("task.opFailed", {
          action: t("project.save"),
          detail: errorText(e),
        })
      )
    }
    setSavingRepoEnv(false)
  }, [repoEnvEdit, loadProjectDetail, setRepoEnvEdit, t])

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
  }, [detail, setScanning, setScanResults, setSelectedScanRepos])

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
    setFailedAddRepos,
    setDetail,
    setScanResults,
    setSelectedScanRepos,
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

  const handleCloneSuccess = useCallback(
    async (fullPath: string) => {
      if (!detail) return
      const repoName = fullPath.split("/").pop() ?? fullPath
      const localDir = fullPath
      try {
        await addProjectRepo({
          projectId: detail.project.id,
          name: repoName,
          gitUrl: "",
          localDir,
          hasClaudeMd: false,
        })
        const d = await getProject(id)
        setDetail(d)
        if (activeProjectId === id) {
          await loadProjectDetail()
        }
      } catch (e) {
        console.error("Failed to add cloned repo to project:", e)
      }
    },
    [detail, id, activeProjectId, loadProjectDetail]
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
    <>
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-6 px-4 pb-4 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => (fromRoute ? back() : setRoute("project-list"))}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
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
              {taskCountByStatus.archived} {resolveStatusLabel(t, "archived")}
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
                        <Select
                          value={editStatus}
                          onValueChange={setEditStatus}
                        >
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
                      <div className="flex flex-col gap-1.5">
                        <Label>{t("project.envBranches")}</Label>
                        <div className="flex gap-2">
                          <Input
                            placeholder={t("project.envDevPlaceholder")}
                            value={editDevBranch}
                            onChange={(e) => setEditDevBranch(e.target.value)}
                          />
                          <Input
                            placeholder={t("project.envUatPlaceholder")}
                            value={editUatBranch}
                            onChange={(e) => setEditUatBranch(e.target.value)}
                          />
                          <Input
                            placeholder={t("project.envPrdPlaceholder")}
                            value={editPrdBranch}
                            onChange={(e) => setEditPrdBranch(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>
                          知识库目录 (相对路径如 _knowledge 或外部绝对路径)
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            placeholder="默认为 _knowledge，或填入本地绝对路径如 D:/repos/team-kb"
                            value={editKbLocalDir}
                            onChange={(e) => setEditKbLocalDir(e.target.value)}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={handleBrowseKbDir}
                          >
                            <FolderOpen className="mr-1 h-3.5 w-3.5" />
                            选择目录
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>知识库 Git 仓库 (可选，支持团队共享)</Label>
                        <Select
                          value={kbRepoSelectValue}
                          onValueChange={handleKbRepoSelect}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="未关联 Git 仓库" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              未关联 Git 仓库
                            </SelectItem>
                            {(detail?.repos ?? []).map((r) => (
                              <SelectItem
                                key={r.id}
                                value={`repo:${r.localDir}`}
                              >
                                {r.name}
                                {r.gitUrl ? ` (${r.gitUrl})` : ""}
                              </SelectItem>
                            ))}
                            {kbRepoSelectValue === "__custom__" && (
                              <SelectItem value="__custom__">
                                自定义仓库地址
                              </SelectItem>
                            )}
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
                        <span className="text-[0.875rem]">
                          {project.rootDir}
                        </span>
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
                      {(project.devBranch ||
                        project.uatBranch ||
                        project.prdBranch) && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[0.75rem] text-muted-foreground">
                            {t("project.envBranches")}
                          </span>
                          <span className="text-[0.875rem]">
                            {[
                              project.devBranch,
                              project.uatBranch,
                              project.prdBranch,
                            ]
                              .filter((b) => b && b.trim())
                              .join(" / ")}
                          </span>
                        </div>
                      )}
                      <div className="flex flex-col gap-1">
                        <span className="text-[0.75rem] text-muted-foreground">
                          知识库目录
                        </span>
                        <span className="text-[0.875rem] font-mono text-xs">
                          {project.kbLocalDir ||
                            `${project.rootDir}/_knowledge (默认)`}
                        </span>
                      </div>
                      {project.kbRepoUrl && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[0.75rem] text-muted-foreground">
                            知识库 Git 仓库
                          </span>
                          <span className="text-[0.875rem] font-mono text-xs text-muted-foreground">
                            {project.kbRepoUrl}
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
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCloneOpen(true)}
                      >
                        <Download className="mr-1 h-3.5 w-3.5" />
                        {t("project.cloneRepo")}
                      </Button>
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
                          {(repo.devBranch ||
                            repo.uatBranch ||
                            repo.prdBranch) && (
                            <Badge
                              variant="outline"
                              className="text-[0.625rem] shrink-0"
                            >
                              <GitBranch className="mr-1 h-3 w-3" />
                              {[repo.devBranch, repo.uatBranch, repo.prdBranch]
                                .filter((b) => b && b.trim())
                                .join(" / ")}
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground ml-auto"
                            title={t("project.envBranches")}
                            onClick={() =>
                              setRepoEnvEdit({
                                repo,
                                dev: repo.devBranch ?? "",
                                uat: repo.uatBranch ?? "",
                                prd: repo.prdBranch ?? "",
                              })
                            }
                          >
                            <GitBranch className="h-3.5 w-3.5" />
                          </Button>
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
      {detail && (
        <CloneDialog
          open={cloneOpen}
          onOpenChange={setCloneOpen}
          defaultTargetDir={detail.project.rootDir}
          onSuccess={handleCloneSuccess}
        />
      )}
      {/* Per-repo environment branch overrides */}
      <Dialog
        open={repoEnvEdit !== null}
        onOpenChange={(o) => !o && setRepoEnvEdit(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("project.envBranches")}
              {repoEnvEdit ? ` · ${repoEnvEdit.repo.name}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>{t("task.envDev")}</Label>
              <Input
                placeholder={t("project.envDevPlaceholder")}
                value={repoEnvEdit?.dev ?? ""}
                onChange={(e) =>
                  setRepoEnvEdit((prev) =>
                    prev ? { ...prev, dev: e.target.value } : prev
                  )
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("task.envUat")}</Label>
              <Input
                placeholder={t("project.envUatPlaceholder")}
                value={repoEnvEdit?.uat ?? ""}
                onChange={(e) =>
                  setRepoEnvEdit((prev) =>
                    prev ? { ...prev, uat: e.target.value } : prev
                  )
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("task.envPrd")}</Label>
              <Input
                placeholder={t("project.envPrdPlaceholder")}
                value={repoEnvEdit?.prd ?? ""}
                onChange={(e) =>
                  setRepoEnvEdit((prev) =>
                    prev ? { ...prev, prd: e.target.value } : prev
                  )
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepoEnvEdit(null)}>
              {t("project.cancel")}
            </Button>
            <Button
              onClick={() => void handleSaveRepoEnv()}
              disabled={savingRepoEnv}
            >
              {savingRepoEnv ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {t("project.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
