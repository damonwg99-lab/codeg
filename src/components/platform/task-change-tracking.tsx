"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { openFileDialog } from "@/lib/platform"
import { gitListAllBranches } from "@/lib/api"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { usePlatform } from "@/contexts/platform-context"
import type { TaskBranchInfo, ProjectRepoInfo, ReleaseInfo } from "@/lib/platform/types"
import type { GitBranchList } from "@/lib/types"
import {
  linkTaskBranch,
  updateTaskBranchStatus,
  updateTaskDbScripts,
  unlinkTaskBranch,
  listProjectRepos,
  listReleasesForTask,
} from "@/lib/platform/api"

interface Props {
  taskId: number
  projectId: number
  branches: TaskBranchInfo[]
  relatedDbScriptsJson: string | null
}

interface DbScriptEntry {
  path: string
  addedAt?: string
}

function branchStatusLabel(status: string) {
  if (status === "prd") return "PRD"
  if (status === "uat") return "UAT"
  return "open"
}

function formatShortDate(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`
}

export function TaskChangeTracking({
  taskId,
  projectId,
  branches,
  relatedDbScriptsJson,
}: Props) {
  const t = useTranslations("Platform")
  const { activeFolder } = useActiveFolder()
  const { activeProjectRepos } = usePlatform()

  const [branchList, setBranchList] = useState<TaskBranchInfo[]>(branches)
  const [showAddBranch, setShowAddBranch] = useState(false)
  const [showAddScript, setShowAddScript] = useState(false)
  const [saving, setSaving] = useState(false)

  // Delete confirmation
  const [deleteBranchTarget, setDeleteBranchTarget] =
    useState<number | null>(null)
  const [deleteScriptIndex, setDeleteScriptIndex] = useState<string | null>(
    null
  )

  // Add Branch: repo + branch selection
  const [repos, setRepos] = useState<ProjectRepoInfo[]>(
    activeProjectRepos || []
  )
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [selectedRepoId, setSelectedRepoId] = useState<string>("")
  const [allBranches, setAllBranches] = useState<
    Record<string, { branches: string[]; loading: boolean }>
  >({})
  const [selectedBranch, setSelectedBranch] = useState("")

  // Add Script
  const [scriptPath, setScriptPath] = useState("")

  const [dbScripts, setDbScripts] = useState<DbScriptEntry[]>(
    relatedDbScriptsJson ? JSON.parse(relatedDbScriptsJson) : []
  )

  const [releases, setReleases] = useState<ReleaseInfo[]>([])

  useEffect(() => {
    if (projectId && taskId) {
      listReleasesForTask(projectId, taskId)
        .then((r) => setReleases(r))
        .catch(() => {
          /* releases are non-critical */
        })
    }
  }, [projectId, taskId])

  // Load repos when dialog opens
  useEffect(() => {
    if (showAddBranch) {
      if (activeProjectRepos && activeProjectRepos.length > 0) {
        setRepos(activeProjectRepos)
        if (!selectedRepoId) {
          setSelectedRepoId(String(activeProjectRepos[0].id))
          loadBranchesForRepo(activeProjectRepos[0])
        }
      } else if (repos.length === 0) {
        setLoadingRepos(true)
        listProjectRepos(projectId)
          .then((r) => {
            setRepos(r)
            if (r.length > 0 && !selectedRepoId) {
              setSelectedRepoId(String(r[0].id))
              loadBranchesForRepo(r[0])
            }
          })
          .finally(() => setLoadingRepos(false))
      } else if (!selectedRepoId && repos.length > 0) {
        setSelectedRepoId(String(repos[0].id))
        loadBranchesForRepo(repos[0])
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddBranch])

  const loadBranchesForRepo = async (_repo: ProjectRepoInfo) => {
    const repoPath = activeFolder?.path
    if (!repoPath) return

    const repoId = String(_repo.id)
    if (allBranches[repoId]) return

    setAllBranches((prev) => ({
      ...prev,
      [repoId]: { branches: [], loading: true },
    }))

    try {
      const result: GitBranchList = await gitListAllBranches(repoPath)
      const branches = result.local || []
      setAllBranches((prev) => ({
        ...prev,
        [repoId]: { branches, loading: false },
      }))
    } catch {
      setAllBranches((prev) => ({
        ...prev,
        [repoId]: { branches: [], loading: false },
      }))
    }
  }

  const handleRepoSelect = (repoId: string) => {
    setSelectedRepoId(repoId)
    setSelectedBranch("")

    const repo = repos.find((r) => String(r.id) === repoId)
    if (!repo) return
    loadBranchesForRepo(repo)
  }

  const handleAddBranch = async () => {
    if (!selectedRepoId || !selectedBranch) return
    const repo = repos.find((r) => String(r.id) === selectedRepoId)
    if (!repo) return

    setSaving(true)
    try {
      const result = await linkTaskBranch(
        taskId,
        projectId,
        repo.name,
        selectedBranch
      )
      setBranchList([...branchList, result])
      setShowAddBranch(false)
      setSelectedRepoId("")
      setSelectedBranch("")
      toast.success(t("task.addBranch"))
    } catch {
      toast.error(t("task.addBranch"))
    } finally {
      setSaving(false)
    }
  }

  const handleUatMerge = async (branchId: number) => {
    try {
      await updateTaskBranchStatus(branchId, "uat")
      setBranchList(
        branchList.map((b) =>
          b.branchId === branchId ? { ...b, status: "uat" as const } : b
        )
      )
      toast.success(t("task.mergeToUAT"))
    } catch {
      toast.error(t("task.mergeToUAT"))
    }
  }

  const handleConfirmDeleteBranch = async () => {
    if (deleteBranchTarget == null) return
    const branchId = deleteBranchTarget
    setDeleteBranchTarget(null)
    try {
      await unlinkTaskBranch(taskId, branchId)
      setBranchList(branchList.filter((b) => b.branchId !== branchId))
      toast.success(t("task.deleteBranch"))
    } catch {
      toast.error(t("task.deleteBranch"))
    }
  }

  const handleConfirmDeleteScript = async () => {
    if (deleteScriptIndex == null) return
    const path = deleteScriptIndex
    setDeleteScriptIndex(null)
    try {
      const updated = dbScripts.filter((s) => s.path !== path)
      await updateTaskDbScripts(taskId, JSON.stringify(updated))
      setDbScripts(updated)
      toast.success(t("task.deleteScript"))
    } catch {
      toast.error(t("task.deleteScript"))
    }
  }

  const handleBrowseScript = async () => {
    const defaultPath = activeFolder?.path
    const result = await openFileDialog({
      title: t("task.selectScriptFile"),
      defaultPath,
    })
    if (result) {
      const path = Array.isArray(result) ? result[0] : result
      if (typeof path === "string") {
        setScriptPath(path)
      }
    }
  }

  const handleAddScript = async () => {
    if (!scriptPath) return
    try {
      const entry: DbScriptEntry = {
        path: scriptPath,
        addedAt: new Date().toISOString(),
      }
      const updated = [...dbScripts, entry]
      await updateTaskDbScripts(taskId, JSON.stringify(updated))
      setDbScripts(updated)
      setScriptPath("")
      setShowAddScript(false)
      toast.success(t("task.addScript"))
    } catch {
      toast.error(t("task.addScript"))
    }
  }

  const openCount = branchList.filter((b) => b.status === "open").length

  const selectedRepo = repos.find((r) => String(r.id) === selectedRepoId)
  const branchData = allBranches[selectedRepoId]
  const branchOptions = branchData?.branches || []

  const linkedBranchNames = new Set(
    branchList
      .filter((b) => b.repoName === selectedRepo?.name)
      .map((b) => b.branch)
  )
  const availableBranches = branchOptions.filter(
    (b) => !linkedBranchNames.has(b)
  )

  const existingScriptPaths = new Set(dbScripts.map((s) => s.path))
  const isScriptDuplicate = existingScriptPaths.has(scriptPath)

  return (
    <div className="flex flex-col gap-6">
      {/* ─── Linked Branches ─── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
          <CardTitle className="text-[0.9375rem]">
            {t("task.linkedBranches")} ({branchList.length})
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddBranch(true)}
          >
            {t("task.addBranch")}
          </Button>
        </CardHeader>
        <CardContent
          className={branchList.length === 0 ? "pb-3" : undefined}
        >
          {branchList.length === 0 ? (
            <p className="text-[0.75rem] text-muted-foreground">
              {t("task.noBranches")}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                {branchList.map((b) => (
                  <div
                    key={b.branchId}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[0.875rem] truncate">
                        {b.repoName}:{b.branch}
                      </span>
                      <Badge variant="outline" className="text-[0.625rem] px-1.5 py-0">
                        {branchStatusLabel(b.status)}
                      </Badge>
                      {b.createdAt && (
                        <span className="text-[0.625rem] text-muted-foreground shrink-0">
                          {formatShortDate(b.createdAt)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {b.status !== "prd" && b.status !== "uat" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[0.625rem] px-2"
                          onClick={() => handleUatMerge(b.branchId)}
                        >
                          {t("task.mergeToUAT")}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteBranchTarget(b.branchId)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {openCount > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={async () => {
                    for (const b of branchList.filter(
                      (bb) => bb.status === "open"
                    )) {
                      await updateTaskBranchStatus(b.branchId, "uat")
                    }
                    setBranchList(
                      branchList.map((b) =>
                        b.status === "open"
                          ? { ...b, status: "uat" as const }
                          : b
                      )
                    )
                  }}
                >
                  {t("task.mergeAllToUAT")}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Release Records ─── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[0.9375rem]">
            {t("task.releaseManagement")} ({releases.length})
          </CardTitle>
        </CardHeader>
        <CardContent className={releases.length === 0 ? "pb-3" : undefined}>
          {releases.length === 0 ? (
            <p className="text-[0.75rem] text-muted-foreground">
              {t("task.noReleases")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {releases.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[0.875rem] truncate">
                      {r.releaseCode}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[0.625rem] px-1.5 py-0"
                    >
                      {r.status === "draft"
                        ? t("task.releaseStatusDraft")
                        : r.status === "prd_deployed"
                          ? t("task.releaseStatusDeployed")
                          : t("task.releaseStatusClosed")}
                    </Badge>
                    <span className="text-[0.625rem] text-muted-foreground shrink-0">
                      {r.branchCount}{" "}
                      {t("task.linkedBranches").toLowerCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Database Scripts ─── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
          <CardTitle className="text-[0.9375rem]">
            {t("task.dbScripts")} ({dbScripts.length})
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddScript(true)}
          >
            {t("task.addScript")}
          </Button>
        </CardHeader>
        <CardContent className={dbScripts.length === 0 ? "pb-3" : undefined}>
          {dbScripts.length === 0 ? (
            <p className="text-[0.75rem] text-muted-foreground">
              {t("task.noDbScripts")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {dbScripts.map((s) => (
                <div
                  key={s.path}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[0.875rem] truncate">
                      {s.path}
                    </span>
                    {s.addedAt && (
                      <span className="text-[0.625rem] text-muted-foreground shrink-0">
                        {formatShortDate(s.addedAt)}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => setDeleteScriptIndex(s.path)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Branch Confirm */}
      <AlertDialog
        open={deleteBranchTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteBranchTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("task.deleteBranch")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("task.deleteBranchConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("task.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleConfirmDeleteBranch()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("task.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Script Confirm */}
      <AlertDialog
        open={deleteScriptIndex !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteScriptIndex(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("task.deleteScript")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("task.deleteScriptConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("task.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleConfirmDeleteScript()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("task.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Branch Dialog */}
      <Dialog
        open={showAddBranch}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRepoId("")
            setSelectedBranch("")
          }
          setShowAddBranch(open)
        }}
      >
        <DialogContent onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t("task.addBranch")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.75rem] text-muted-foreground">
                {t("task.repoName")}
              </label>
              {loadingRepos ? (
                <div className="flex items-center gap-2 text-[0.875rem] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("task.loading")}
                </div>
              ) : (
                <Select
                  value={selectedRepoId}
                  onValueChange={handleRepoSelect}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("task.selectRepo")} />
                  </SelectTrigger>
                  <SelectContent>
                    {repos.map((repo) => (
                      <SelectItem key={repo.id} value={String(repo.id)}>
                        {repo.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {selectedRepo && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[0.75rem] text-muted-foreground">
                  {t("task.branchName")}
                </label>
                {branchData?.loading ? (
                  <div className="flex items-center gap-2 text-[0.875rem] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("task.loadingBranches")}
                  </div>
                ) : branchOptions.length === 0 ? (
                  <p className="text-[0.75rem] text-muted-foreground">
                    {t("task.noBranchesFound")}
                  </p>
                ) : availableBranches.length === 0 ? (
                  <p className="text-[0.75rem] text-muted-foreground">
                    {t("task.allBranchesLinked")}
                  </p>
                ) : (
                  <Select
                    value={selectedBranch}
                    onValueChange={setSelectedBranch}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("task.selectBranch")} />
                    </SelectTrigger>
                    <SelectContent>
                      <ScrollArea className="max-h-48">
                        {availableBranches.map((branch) => (
                          <SelectItem
                            key={branch}
                            value={branch}
                            className="font-mono text-[0.875rem]"
                          >
                            {branch}
                          </SelectItem>
                        ))}
                      </ScrollArea>
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <Button
              onClick={handleAddBranch}
              disabled={saving || !selectedRepoId || !selectedBranch}
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t("task.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Script Dialog */}
      <Dialog open={showAddScript} onOpenChange={setShowAddScript}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("task.addScript")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.75rem] text-muted-foreground">
                {t("task.scriptPath")}
              </label>
              <div className="flex gap-2">
                <Input
                  placeholder={t("task.scriptPathPlaceholder")}
                  value={scriptPath}
                  onChange={(e) => setScriptPath(e.target.value)}
                  className="flex-1"
                />
                <Button variant="outline" onClick={handleBrowseScript}>
                  {t("task.browse")}
                </Button>
              </div>
            </div>
            <Button onClick={handleAddScript} disabled={!scriptPath || isScriptDuplicate}>
              {isScriptDuplicate
                ? t("task.scriptAlreadyAdded")
                : t("task.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
