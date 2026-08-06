"use client"

import { useState, useEffect } from "react"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import type { ReleaseDetail as ReleaseDetailType } from "@/lib/platform/types"
import { getRelease, updateRelease } from "@/lib/platform/api"
import { useTranslations } from "next-intl"
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

export function ReleaseDetail() {
  const { routeParams, setRoute, fromRoute, fromParams, back } =
    useWorkbenchRoute()
  const releaseId = routeParams.releaseId as number
  const projectId =
    (routeParams.projectId as number) ?? (fromParams?.projectId as number)
  const t = useTranslations("Platform")
  const [detail, setDetail] = useState<ReleaseDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)

  useEffect(() => {
    if (!releaseId) return
    getRelease(releaseId)
      .then(setDetail)
      .finally(() => setLoading(false))
  }, [releaseId])

  const handleMarkPrd = async () => {
    if (!detail) return
    await updateRelease(detail.release.id, "prd_deployed")
    setDetail({
      ...detail,
      release: { ...detail.release, status: "prd_deployed" as const },
    })
  }

  const handleClose = async () => {
    if (!detail) return
    await updateRelease(detail.release.id, "closed")
    setDetail({
      ...detail,
      release: { ...detail.release, status: "closed" as const },
    })
    setCloseDialogOpen(false)
  }

  const handleBack = () => {
    if (fromRoute && fromParams) {
      back()
    } else {
      setRoute("release-list", { projectId })
    }
  }

  if (loading)
    return <p className="p-4 text-sm text-muted-foreground">{t("task.loading")}</p>
  if (!detail)
    return <p className="px-4 pb-4 pt-4 text-sm text-destructive">{t("task.releaseNotFound")}</p>

  const { release, items } = detail

  return (
    <div className="h-full overflow-auto px-4 pb-4 pt-4">
      <Button variant="ghost" size="sm" className="mb-4" onClick={handleBack}>
        &larr; {t("task.releaseBackToList")}
      </Button>

      <div className="mb-6 space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{release.releaseCode}</h2>
          <Badge>
            {release.status === "draft"
              ? t("task.releaseStatusDraft")
              : release.status === "prd_deployed"
                ? t("task.releaseStatusDeployed")
                : t("task.releaseStatusClosed")}
          </Badge>
        </div>
        {release.title && (
          <p className="text-sm font-medium">{release.title}</p>
        )}
        {release.notes && (
          <p className="text-sm text-muted-foreground">{release.notes}</p>
        )}
        {release.deployer && (
          <p className="text-xs text-muted-foreground">
            {t("task.deployer")}: {release.deployer}
          </p>
        )}
        <div className="flex gap-2 pt-2">
          {release.status === "draft" && (
            <Button size="sm" onClick={handleMarkPrd}>
              {t("task.releaseDeploy")}
            </Button>
          )}
          {release.status === "prd_deployed" && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setCloseDialogOpen(true)}
            >
              {t("task.releaseClose")}
            </Button>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium">
          {t("task.releaseItems")} ({items.length})
        </h3>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("task.releaseItemsEmpty")}
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded border p-3"
              >
                <div>
                  <span className="font-mono text-sm">
                    {item.repoName}:{item.branch}
                  </span>
                  <Badge variant="secondary" className="ml-2">
                    {item.branchStatus}
                  </Badge>
                </div>
                {item.taskTitle && (
                  <span className="text-xs text-muted-foreground">
                    {item.taskTitle}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("task.releaseCloseTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("task.releaseCloseConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("task.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleClose}>
              {t("task.releaseClose")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
