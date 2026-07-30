"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "next-intl"
import type { ReleaseInfo } from "@/lib/platform/types"
import { listReleases, updateRelease } from "@/lib/platform/api"
import type { WorkbenchRouteId } from "@/contexts/workbench-route-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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

interface Props {
  projectId: number
  setRoute: (
    id: WorkbenchRouteId,
    params?: Record<string, string | number>,
    back?: { routeId: WorkbenchRouteId; params?: Record<string, string | number> }
  ) => void
}

export function ReleaseList({ projectId, setRoute }: Props) {
  const t = useTranslations("Platform")
  const [releases, setReleases] = useState<ReleaseInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [closeTarget, setCloseTarget] = useState<number | null>(null)

  const loadReleases = useCallback(() => {
    if (!projectId) return
    setLoading(true)
    listReleases(projectId)
      .then((r) => {
        setReleases(r)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    loadReleases()
  }, [loadReleases])

  const handleMarkPrd = async (id: number) => {
    await updateRelease(id, "prd_deployed")
    await loadReleases()
  }

  const handleClose = async () => {
    if (closeTarget == null) return
    const id = closeTarget
    setCloseTarget(null)
    await updateRelease(id, "closed")
    await loadReleases()
  }

  const statusLabel = (s: string) => {
    if (s === "draft") return t("task.releaseStatusDraft")
    if (s === "prd_deployed") return t("task.releaseStatusDeployed")
    if (s === "closed") return t("task.releaseStatusClosed")
    return s
  }

  if (loading) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {t("task.loading")}
      </p>
    )
  }

  if (releases.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {t("task.noReleases")}
      </p>
    )
  }

  return (
    <>
      <div className="h-full overflow-auto p-4 sm:p-6">
        <div className="space-y-3">
          {releases.map((r) => (
            <div key={r.id} className="space-y-2 rounded-lg border p-4">
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono font-semibold">
                    {r.releaseCode}
                  </span>
                  <Badge variant="secondary" className="ml-2">
                    {statusLabel(r.status)}
                  </Badge>
                  {r.branchCount > 0 && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t("task.branchesCount")}: {r.branchCount}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-xs text-muted-foreground">
                    {r.createdAt
                      ? new Date(r.createdAt).toLocaleDateString()
                      : ""}
                  </span>
                </div>
              </div>
              {r.prdDeployedAt && (
                <p className="text-xs text-muted-foreground">
                  {t("task.releaseStatusDeployed")}:{" "}
                  {new Date(r.prdDeployedAt).toLocaleDateString()}
                </p>
              )}
              {r.closedAt && (
                <p className="text-xs text-muted-foreground">
                  {t("task.releaseStatusClosed")}:{" "}
                  {new Date(r.closedAt).toLocaleDateString()}
                </p>
              )}
              {r.title && (
                <p className="text-sm">{r.title}</p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRoute("release-detail", { releaseId: r.id, projectId })
                  }
                >
                  {t("task.view")}
                </Button>
                {r.status === "draft" && (
                  <Button size="sm" onClick={() => handleMarkPrd(r.id)}>
                    {t("task.releaseDeploy")}
                  </Button>
                )}
                {r.status === "prd_deployed" && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setCloseTarget(r.id)}
                  >
                    {t("task.releaseClose")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <AlertDialog
        open={closeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCloseTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("task.releaseCloseTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("task.releaseCloseConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("task.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleClose()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("task.releaseClose")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
