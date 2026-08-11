"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ClipboardList } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { usePlatformOptional } from "@/contexts/platform-context"
import { useTabContext } from "@/contexts/tab-context"
import { useLinkedTask } from "@/hooks/use-linked-task"
import { linkConversation, listKnowledgeDocs } from "@/lib/platform/api"
import type { KnowledgeDocInfo } from "@/lib/platform/types"
import { usePlatformTabSlice } from "@/stores/platform-tab-slice"
import { ProjectResourcePicker } from "@/components/platform/task-context-popover"
import type { ReferenceAttrs } from "@/components/chat/composer/types"
import {
  optionToReferenceAttrs,
  type ContextInjectPayload,
} from "@/components/platform/context-inject-panel-utils"

export function PlatformComposerToolbar({
  onInjectReferences,
}: {
  onInjectReferences: (refs: ReferenceAttrs[]) => void
}) {
  const [taskPopoverOpen, setTaskPopoverOpen] = useState(false)
  const [popoverKbDocs, setPopoverKbDocs] = useState<KnowledgeDocInfo[]>([])
  const [popoverAttachments, setPopoverAttachments] = useState<
    KnowledgeDocInfo[]
  >([])
  const [popoverKbLoading, setPopoverKbLoading] = useState(false)

  const platform = usePlatformOptional()
  const activeProject = platform?.activeProject ?? null
  const { tabs, activeTabId } = useTabContext()
  const ownTab = activeTabId
    ? tabs.find((t) => t.id === activeTabId)
    : undefined
  const conversationId = ownTab?.conversationId ?? null
  const hasPersistedConversation =
    ownTab?.conversationId != null && ownTab.conversationId > 0

  const { linkedTaskInfo, linkedTask, refresh: refreshLinkedTask } =
    useLinkedTask(conversationId)
  const { activeFolder } = useActiveFolder()
  const setPendingTaskLink = usePlatformTabSlice(
    (s) => s.setPendingTaskLink
  )

  useEffect(() => {
    if (!taskPopoverOpen || !activeProject) return
    let cancelled = false
    setPopoverKbLoading(true)
    async function loadKBData() {
      try {
        const projectId = activeProject!.id
        const allDocs = await listKnowledgeDocs({ projectId })
        if (cancelled) return
        setPopoverKbDocs(
          allDocs.filter((d) => d.docType !== "task_attachment")
        )
        const taskAttachments = allDocs.filter(
          (d) => d.docType === "task_attachment"
        )
        setPopoverAttachments(
          linkedTask
            ? taskAttachments.filter((a) => a.taskId === linkedTask.id)
            : taskAttachments
        )
      } catch {
        // Popover KB preload is best-effort; swallow silently
      }
      if (!cancelled) setPopoverKbLoading(false)
    }
    void loadKBData()
    return () => {
      cancelled = true
    }
  }, [taskPopoverOpen, activeProject, linkedTask])

  const handleTaskInject = useCallback(
    (payload: ContextInjectPayload) => {
      const refs = payload.options.map(optionToReferenceAttrs)
      onInjectReferences(refs)
      setTaskPopoverOpen(false)
    },
    [onInjectReferences]
  )

  const handleTaskLink = useCallback(
    async (
      taskId: number,
      role: string,
      taskInfo?: { title: string; taskType: string }
    ) => {
      if (hasPersistedConversation && conversationId) {
        await linkConversation({ taskId, conversationId, role })
        refreshLinkedTask()
      } else if (activeTabId && taskInfo) {
        setPendingTaskLink(
          activeTabId,
          taskId,
          role,
          taskInfo.title,
          taskInfo.taskType
        )
      }
    },
    [
      hasPersistedConversation,
      conversationId,
      activeTabId,
      setPendingTaskLink,
      refreshLinkedTask,
    ]
  )

  const kbDirPrefix = useMemo(() => {
    const kbDir = (
      activeProject?.kbLocalDir ??
      `${activeProject?.rootDir?.replace(/\\/g, "/") ?? ""}/_knowledge`
    ).replace(/\\/g, "/")
    const fp = activeFolder?.path?.replace(/\\/g, "/") ?? ""
    if (fp.startsWith(kbDir + "/")) return kbDir
    return kbDir
  }, [activeProject, activeFolder])

  if (!activeProject) return null

  return (
    <Popover
      modal
      open={taskPopoverOpen}
      onOpenChange={setTaskPopoverOpen}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground"
          title="Task context"
          aria-label="Task context"
        >
          <ClipboardList className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-[22rem] max-w-[calc(100vw-1rem)] p-0"
      >
        <ProjectResourcePicker
          conversationId={conversationId}
          linkedTaskInfo={linkedTaskInfo}
          linkedTask={linkedTask}
          onInject={handleTaskInject}
          onLink={handleTaskLink}
          activeProjectId={activeProject?.id ?? null}
          kbDocs={popoverKbDocs}
          attachments={popoverAttachments}
          kbLoading={popoverKbLoading}
          kbDirPrefix={kbDirPrefix}
        />
      </PopoverContent>
    </Popover>
  )
}
