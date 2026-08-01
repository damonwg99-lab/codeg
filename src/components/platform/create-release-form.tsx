"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { ArrowLeft } from "lucide-react"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { createRelease } from "@/lib/platform/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"

export function CreateReleaseForm({ projectId }: { projectId: number }) {
  const t = useTranslations("Platform")
  const { setRoute } = useWorkbenchRoute()

  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [deployer, setDeployer] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await createRelease({
        projectId,
        title: title || undefined,
        notes: notes || undefined,
        deployer: deployer || undefined,
        branchIds: [],
      })
      setRoute("task-kanban", { projectId })
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-6 p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setRoute("task-kanban", { projectId })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">
            {t("task.createRelease")}
          </h1>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="release-title">
            {t("task.title")}
          </Label>
          <Input
            id="release-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("task.titlePlaceholder")}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="release-notes">
            {t("task.description")}
          </Label>
          <Textarea
            id="release-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="release-deployer">
            {t("task.deployer")}
          </Label>
          <Input
            id="release-deployer"
            value={deployer}
            onChange={(e) => setDeployer(e.target.value)}
            placeholder="Who is deploying?"
          />
        </div>

        {error && (
          <p className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button onClick={handleSubmit} disabled={submitting} className="self-start">
          {submitting
            ? t("task.creating")
            : t("task.createRelease")}
        </Button>
      </div>
    </ScrollArea>
  )
}
