"use client"

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DirectoryPathInput } from "@/components/shared/directory-path-input"
import {
  gitNewBranch,
  gitWorktreeAdd,
  gitListAllBranches,
  gitMerge,
  gitRebase,
  gitDeleteBranch,
  gitDeleteRemoteBranch,
} from "@/lib/api"
import { useSwitchToBranch } from "@/hooks/use-switch-to-branch"
import {
  buildBranchTree,
  buildRemoteBranchSections,
  localBranchItems,
} from "@/lib/branch-tree"
import { BranchSelectorList } from "@/components/layout/branch-selector-list"
import type {
  BranchLeafAction,
  BranchOperationMeta,
} from "@/lib/branch-selector-rows"
import { useGitQuickActions } from "@/hooks/use-git-quick-actions"
import type { FolderDetail, GitBranchList } from "@/lib/types"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useTabActions } from "@/contexts/tab-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useGitCredential } from "@/contexts/git-credential-context"

type ConfirmAction = {
  type: "merge" | "rebase" | "delete" | "forceDelete" | "deleteRemote"
  branchName: string
}

/**
 * The imperative surface the branch panel (rendered inside a repo's fly-out
 * submenu) calls into. The host component owns the git engine + all dialogs so
 * they stay mounted OUTSIDE the dropdown — otherwise opening one would unmount
 * it the moment the menu closes. The panel reads the host through this handle.
 */
export interface RepoGitOperationsHandle {
  running: boolean
  pull: () => void
  fetchAll: () => void
  openCommit: () => void
  openPush: (branch?: string) => void
  openNewBranch: () => void
  openNewWorktree: () => void
  updateBranch: (fullName: string, isRemote: boolean) => void
  checkout: (fullName: string, isRemote: boolean) => void
  requestConfirm: (type: ConfirmAction["type"], branchName: string) => void
}

interface RepoGitOperationsProps {
  folder: FolderDetail | null
}

function buildWorktreeDefaults(folderPath: string, branch: string) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let random = ""
  for (let i = 0; i < 6; i++) {
    random += chars[Math.floor(Math.random() * chars.length)]
  }
  const folderName = folderPath.split("/").filter(Boolean).pop() ?? "project"
  const currentBranch = branch || "main"
  const parentDir = folderPath.substring(0, folderPath.lastIndexOf("/"))
  return {
    branchName: `cv-${currentBranch}-${random}`,
    path: `${parentDir}/${folderName}-${currentBranch}-${random}`,
  }
}

/**
 * Per-repo git host. Rendered once per git repo OUTSIDE the dropdown (see
 * repo-selector). Wraps the shared git engine, the switch-to-branch helper and
 * every dialog (conflict/stash/new-branch/worktree/confirm).
 */
export const RepoGitOperations = forwardRef<
  RepoGitOperationsHandle,
  RepoGitOperationsProps
>(function RepoGitOperations({ folder }, ref) {
  const t = useTranslations("Folder.branchDropdown")
  const tCommon = useTranslations("Folder.common")
  const folderPath = folder?.path ?? ""
  const folderId = folder?.id ?? 0
  const openWorktreeFolder = useAppWorkspaceStore((s) => s.openWorktreeFolder)
  const { openNewConversationTab } = useTabActions()
  const { openConversations } = useWorkbenchRoute()
  const { withCredentialRetry } = useGitCredential()
  const switchToBranch = useSwitchToBranch()

  const branch = useAppWorkspaceStore((s) =>
    folder ? (s.branches.get(folder.id) ?? folder.git_branch ?? null) : null
  )

  const {
    running,
    runGitTask,
    pull,
    fetchAll,
    updateBranch,
    openCommitWindow,
    openPushWindow,
    reportConflict,
    dialogs: gitDialogs,
  } = useGitQuickActions({ folderId, folderPath })

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [newBranchOpen, setNewBranchOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState("")
  const [worktreeOpen, setWorktreeOpen] = useState(false)
  const [worktreeBranchName, setWorktreeBranchName] = useState("")
  const [worktreePath, setWorktreePath] = useState("")

  const openNewBranch = useCallback(() => {
    setNewBranchName("")
    setNewBranchOpen(true)
  }, [])

  const openNewWorktree = useCallback(() => {
    const defaults = buildWorktreeDefaults(folderPath, branch ?? "main")
    setWorktreeBranchName(defaults.branchName)
    setWorktreePath(defaults.path)
    setWorktreeOpen(true)
  }, [folderPath, branch])

  const checkout = useCallback(
    (fullName: string, isRemote: boolean) => {
      if (!folder) return
      if (isRemote) {
        const localName = fullName.replace(/^[^/]+\//, "")
        void switchToBranch({
          activeFolder: folder,
          branchName: localName,
          currentBranch: branch,
          isRemote: true,
        })
      } else {
        void switchToBranch({
          activeFolder: folder,
          branchName: fullName,
          currentBranch: branch,
        })
      }
    },
    [folder, branch, switchToBranch]
  )

  const requestConfirm = useCallback(
    (type: ConfirmAction["type"], branchName: string) => {
      setConfirmAction({ type, branchName })
    },
    []
  )

  useImperativeHandle(
    ref,
    () => ({
      running,
      pull,
      fetchAll,
      openCommit: openCommitWindow,
      openPush: openPushWindow,
      openNewBranch,
      openNewWorktree,
      updateBranch,
      checkout,
      requestConfirm,
    }),
    [
      running,
      pull,
      fetchAll,
      openCommitWindow,
      openPushWindow,
      openNewBranch,
      openNewWorktree,
      updateBranch,
      checkout,
      requestConfirm,
    ]
  )

  async function handleNewBranch() {
    const name = newBranchName.trim()
    if (!name || !folderPath) return
    setNewBranchOpen(false)
    setNewBranchName("")
    await runGitTask(t("tasks.newBranch", { name }), () =>
      gitNewBranch(folderPath, name)
    )
  }

  async function handleNewWorktree() {
    const name = worktreeBranchName.trim()
    const wtPath = worktreePath.trim()
    if (!name || !wtPath || !folderPath || !folderId) return
    setWorktreeOpen(false)
    await runGitTask(t("tasks.newWorktree", { name }), async () => {
      await gitWorktreeAdd(folderPath, name, wtPath)
      const detail = await openWorktreeFolder(wtPath, folderId)
      openConversations()
      openNewConversationTab(detail.id, detail.path)
    })
  }

  async function handleConfirm() {
    if (!confirmAction) return
    const { type, branchName } = confirmAction
    setConfirmAction(null)

    switch (type) {
      case "merge":
        await runGitTask(
          t("tasks.mergeBranch", { branchName }),
          () => gitMerge(folderPath, branchName),
          (result) => {
            if (result.conflict?.has_conflicts) {
              reportConflict(result.conflict)
              return false
            }
            if (result.merged_commits === 0) {
              return t("toasts.mergeNoNewCommits", { branchName })
            }
            return t("toasts.mergedCommits", { count: result.merged_commits })
          }
        )
        break
      case "rebase":
        await runGitTask(
          t("tasks.rebaseTo", { branchName }),
          () => gitRebase(folderPath, branchName),
          (result) => {
            if (result.conflict?.has_conflicts) {
              reportConflict(result.conflict)
              return false
            }
            return undefined
          }
        )
        break
      case "delete":
        await runGitTask(
          t("tasks.deleteBranch", { branchName }),
          () => gitDeleteBranch(folderPath, branchName),
          undefined,
          (errorMsg) => {
            if (/not fully merged/i.test(errorMsg)) {
              setConfirmAction({ type: "forceDelete", branchName })
              return true
            }
            return false
          }
        )
        break
      case "forceDelete":
        await runGitTask(t("tasks.deleteBranch", { branchName }), () =>
          gitDeleteBranch(folderPath, branchName, true)
        )
        break
      case "deleteRemote": {
        const idx = branchName.indexOf("/")
        const remote = branchName.substring(0, idx)
        const rb = branchName.substring(idx + 1)
        await runGitTask(t("tasks.deleteRemoteBranch", { branchName }), () =>
          withCredentialRetry(
            (creds) => gitDeleteRemoteBranch(folderPath, remote, rb, creds),
            { folderPath }
          )
        )
        break
      }
    }
  }

  function getConfirmTitle() {
    if (!confirmAction) return ""
    switch (confirmAction.type) {
      case "merge":
        return t("confirm.mergeTitle")
      case "rebase":
        return t("confirm.rebaseTitle")
      case "delete":
        return t("confirm.deleteTitle")
      case "forceDelete":
        return t("confirm.forceDeleteTitle")
      case "deleteRemote":
        return t("confirm.deleteRemoteTitle")
    }
  }

  function getConfirmDescription() {
    if (!confirmAction) return ""
    switch (confirmAction.type) {
      case "merge":
        return t("confirm.mergeDescription", {
          branchName: confirmAction.branchName,
          currentBranch: branch ?? "-",
        })
      case "rebase":
        return t("confirm.rebaseDescription", {
          currentBranch: branch ?? "-",
          branchName: confirmAction.branchName,
        })
      case "delete":
        return t("confirm.deleteDescription", {
          branchName: confirmAction.branchName,
        })
      case "forceDelete":
        return t("confirm.forceDeleteDescription", {
          branchName: confirmAction.branchName,
        })
      case "deleteRemote":
        return t("confirm.deleteRemoteDescription", {
          branchName: confirmAction.branchName,
        })
    }
  }

  const worktreeDisabled = useMemo(
    () => !worktreeBranchName.trim() || !worktreePath.trim(),
    [worktreeBranchName, worktreePath]
  )

  return (
    <>
      {gitDialogs}

      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{getConfirmTitle()}</AlertDialogTitle>
            <AlertDialogDescription>
              {getConfirmDescription()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant={
                confirmAction?.type === "delete" ||
                confirmAction?.type === "forceDelete" ||
                confirmAction?.type === "deleteRemote"
                  ? "destructive"
                  : "default"
              }
              onClick={handleConfirm}
            >
              {tCommon("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={newBranchOpen} onOpenChange={setNewBranchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogs.newBranchTitle")}</DialogTitle>
            <DialogDescription>
              {t("dialogs.newBranchDescription", { branch: branch ?? "-" })}
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder={t("dialogs.branchNamePlaceholder")}
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.key === "Process") return
              if (e.key === "Enter") void handleNewBranch()
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewBranchOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              disabled={!newBranchName.trim() || running}
              onClick={() => void handleNewBranch()}
            >
              {tCommon("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={worktreeOpen} onOpenChange={setWorktreeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("dialogs.newWorktreeTitle")}</DialogTitle>
            <DialogDescription>
              {t("dialogs.newWorktreeDescription", { branch: branch ?? "-" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="wt-branch">{t("dialogs.branchNameLabel")}</Label>
              <Input
                id="wt-branch"
                placeholder={t("dialogs.branchNamePlaceholder")}
                value={worktreeBranchName}
                onChange={(e) => setWorktreeBranchName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.key === "Process") return
                  if (e.key === "Enter") void handleNewWorktree()
                }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wt-path">{t("dialogs.worktreePathLabel")}</Label>
              <DirectoryPathInput
                id="wt-path"
                placeholder={t("dialogs.worktreePathPlaceholder")}
                value={worktreePath}
                onValueChange={setWorktreePath}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWorktreeOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              disabled={worktreeDisabled || running}
              onClick={() => void handleNewWorktree()}
            >
              {tCommon("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
})

/**
 * The full branch panel rendered inside a repo's fly-out submenu. It loads the
 * branch list itself (each open re-mounts → fresh data, matching BranchDropdown)
 * and dispatches every operation back to the host through `host()`, which keeps
 * the dialogs mounted outside the menu.
 */
export function RepoGitBranchPanel({
  host,
  folder,
}: {
  host: () => RepoGitOperationsHandle | null
  folder: FolderDetail | null
}) {
  const t = useTranslations("Folder.branchDropdown")
  const folderPath = folder?.path ?? ""

  const branch = useAppWorkspaceStore((s) =>
    folder ? (s.branches.get(folder.id) ?? folder.git_branch ?? null) : null
  )

  const [branchList, setBranchList] = useState<GitBranchList>({
    local: [],
    remote: [],
    worktree_branches: [],
  })
  const [branchLoading, setBranchLoading] = useState(() => !!folder?.path)

  useEffect(() => {
    if (!folderPath) return
    let cancelled = false
    gitListAllBranches(folderPath)
      .then((list) => {
        if (!cancelled) setBranchList(list)
      })
      .catch(() => {
        if (!cancelled)
          setBranchList({ local: [], remote: [], worktree_branches: [] })
      })
      .finally(() => {
        if (!cancelled) setBranchLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [folderPath])

  const worktreeBranchSet = useMemo(
    () => new Set(branchList.worktree_branches),
    [branchList.worktree_branches]
  )
  const localNodes = useMemo(
    () => buildBranchTree(localBranchItems(branchList.local), "local"),
    [branchList.local]
  )
  const remoteSections = useMemo(
    () => buildRemoteBranchSections(branchList.remote),
    [branchList.remote]
  )

  const operations = useMemo<BranchOperationMeta[]>(
    () => [
      { id: "pull", label: t("pullCode") },
      { id: "fetch", label: t("fetchRemoteBranches"), groupEnd: true },
      { id: "commit", label: t("openCommitWindow") },
      { id: "push", label: t("pushCode"), groupEnd: true },
      { id: "newBranch", label: t("newBranch") },
      { id: "newWorktree", label: t("newWorktree") },
    ],
    [t]
  )

  function runOperation(opId: string) {
    const h = host()
    if (!h) return
    switch (opId) {
      case "pull":
        h.pull()
        break
      case "fetch":
        h.fetchAll()
        break
      case "commit":
        h.openCommit()
        break
      case "push":
        h.openPush()
        break
      case "newBranch":
        h.openNewBranch()
        break
      case "newWorktree":
        h.openNewWorktree()
        break
    }
  }

  function runLeafAction(
    action: BranchLeafAction,
    fullName: string,
    isRemote: boolean
  ) {
    const h = host()
    if (!h) return
    if (action === "switch") {
      h.checkout(fullName, isRemote)
      return
    }
    if (action === "pull") {
      h.updateBranch(fullName, isRemote)
      return
    }
    if (action === "push") {
      h.openPush(fullName)
      return
    }
    h.requestConfirm(action, fullName)
  }

  return (
    <BranchSelectorList
      operations={operations}
      localNodes={localNodes}
      remoteSections={remoteSections}
      localCount={branchList.local.length}
      remoteCount={branchList.remote.length}
      branch={branch}
      worktreeBranchSet={worktreeBranchSet}
      branchLoading={branchLoading}
      loading={host()?.running ?? false}
      onRunOperation={runOperation}
      onLeafAction={runLeafAction}
    />
  )
}
