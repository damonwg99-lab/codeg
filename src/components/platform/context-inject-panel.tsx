"use client"

import { useMemo, useState } from "react"
import { ClipboardList } from "lucide-react"
import { useTranslations } from "next-intl"
import type {
  KnowledgeDocInfo,
  TaskConversationInfo,
  TaskInfo,
} from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { InjectOptionList } from "@/components/platform/inject-option-list"
import {
  buildInjectOptions,
  buildPayloadFromOptions,
  type ContextInjectPayload,
  type InjectOptionGroup,
  type OptionId,
  type InjectOption,
  type InjectI18nFn,
} from "@/components/platform/context-inject-panel-utils"

export type { ContextInjectPayload, OptionId, InjectOption }

interface ContextInjectPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: TaskInfo
  conversations: TaskConversationInfo[]
  kbDocs: KnowledgeDocInfo[]
  attachments: KnowledgeDocInfo[]
  kbLoading?: boolean
  submitting?: boolean
  /** KB directory path relative to the project root (e.g., "_knowledge").
   *  Used to prefix doc filePaths so they become project-root-relative. */
  kbDirPrefix?: string
  onConfirm: (payload: ContextInjectPayload) => void
}

export function ContextInjectPanel({
  open,
  onOpenChange,
  task,
  conversations,
  kbDocs,
  attachments,
  kbLoading,
  submitting,
  kbDirPrefix,
  onConfirm,
}: ContextInjectPanelProps) {
  const t = useTranslations("Platform.inject")

  const options = useMemo<InjectOption[]>(
    () =>
      buildInjectOptions(
        task,
        kbDocs,
        attachments,
        conversations,
        t as InjectI18nFn,
        kbDirPrefix
      ),
    [conversations, kbDocs, attachments, task, t, kbDirPrefix]
  )

  const defaultIds = useMemo(
    () =>
      new Set<OptionId>(
        options
          .filter((option) => option.defaultChecked)
          .map((option) => option.id)
      ),
    [options]
  )
  const [checked, setChecked] = useState<Set<OptionId>>(defaultIds)
  const [kbDocSearchQuery, setKbDocSearchQuery] = useState("")

  function toggle(id: OptionId, value: boolean) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function buildPayload(): ContextInjectPayload {
    return buildPayloadFromOptions(options, checked)
  }

  // Filter kb_docs options by search query
  const filteredOptions = useMemo(() => {
    if (!kbDocSearchQuery) return options
    const q = kbDocSearchQuery.toLowerCase()
    return options.filter(
      (opt) =>
        opt.group !== "kb_docs" ||
        opt.label.toLowerCase().includes(q) ||
        opt.description.toLowerCase().includes(q)
    )
  }, [kbDocSearchQuery, options])

  const groupLabelResolver = (group: InjectOptionGroup) =>
    t(`groupLabel.${group}`)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-lg grid grid-rows-[auto_1fr_auto] max-h-[calc(100dvh-2rem)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" />
            {t("createConversation")}
          </DialogTitle>
          <DialogDescription>{t("selectContext")}</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto min-h-0 py-2">
          {kbLoading ? (
            <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
              {t("loading")}
            </div>
          ) : (
            <InjectOptionList
              options={filteredOptions}
              checked={checked}
              onToggle={toggle}
              variant="full"
              groupLabelResolver={groupLabelResolver}
              emptyMessages={{
                kb_docs: t("noDocs"),
                attachments: t("noAttachments"),
              }}
              kbDocSearchQuery={kbDocSearchQuery}
              onKbDocSearchChange={setKbDocSearchQuery}
            />
          )}
        </div>

        <DialogFooter className="mt-4 shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={() => onConfirm(buildPayload())}
            disabled={submitting}
          >
            {t("createConversation")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
