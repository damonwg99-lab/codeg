"use client"

import { useCallback, useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { usePlatform } from "@/contexts/platform-context"
import { useLinkedTask } from "@/hooks/use-linked-task"
import {
  useDecompositionDetector,
  proposalKey,
} from "@/hooks/use-decomposition-detector"
import { DecompositionOverlay } from "@/components/chat/decomposition-overlay"
import {
  DecompositionOverlayContextProvider,
  type DecompositionOverlayStatus,
} from "@/components/chat/decomposition-overlay-context"
import { createDecomposition, createTask } from "@/lib/platform/api"
import {
  useConversationRuntimeStore,
  selectTimelineTurns,
} from "@/stores/conversation-runtime-store"
import type { ProposedSubTask } from "@/lib/platform/decomposition-parser"

/**
 * Decoupled Phase 4 mount (D32): owns the decomposition-detection + overlay
 * orchestration for a conversation. Mount it around any subtree that renders
 * `DecompositionCard`s (via `ContentPartsRenderer`) — typically the message
 * list node in `conversation-detail-panel` — so the cards can read the overlay
 * status through the context. It derives the turns it scans straight from the
 * runtime store, keeping `MessageListView` itself free of platform mounts
 * (which used to conflict on every main refactor of that file).
 *
 * The dialog itself is rendered as the last child of the provider so the
 * caller's tree is otherwise unchanged.
 */
export function PlatformDecompositionBridge({
  conversationId,
  children,
}: {
  conversationId: number
  children: ReactNode
}) {
  const t = useTranslations("Platform.task")
  const { activeProject, projects } = usePlatform()
  const activeProjectId = activeProject?.id ?? null
  const { linkedTask } = useLinkedTask(conversationId)

  // Same projection `MessageListView` uses: timeline turns to plain
  // MessageTurn[], memoized so the detector hook sees a stable reference.
  const timelineTurns = useConversationRuntimeStore((s) =>
    selectTimelineTurns(s, conversationId)
  )
  const localTurns = useMemo(
    () => timelineTurns.map((item) => item.turn),
    [timelineTurns]
  )

  const {
    proposedSubTasks: decompSubTasks,
    detectedSubTasks: decompDetected,
    isDismissed: decompDismissed,
    isConfirmed: decompConfirmed,
    viewingConfirmed: decompViewingConfirmed,
    confirmProposal: confirmDecomp,
    dismissProposal: dismissDecomp,
    reopenProposal: reopenDecomp,
    viewConfirmedProposal: viewDecompConfirmed,
    closeConfirmedView: closeDecompConfirmedView,
    updateSubTasks: updateDecompSubTasks,
  } = useDecompositionDetector(localTurns, conversationId)

  const [decompSubmitting, setDecompSubmitting] = useState(false)

  const handleDecompConfirm = useCallback(
    async (params: {
      projectId: number
      parentTaskId: number | null
      subTasks: ProposedSubTask[]
    }) => {
      setDecompSubmitting(true)
      try {
        // Store decomposition record for audit
        if (params.parentTaskId) {
          await createDecomposition({
            sourceTaskId: params.parentTaskId,
            aiGenerated: true,
            decompositionJson: JSON.stringify(params.subTasks),
          })
        }
        // Create each sub-task
        for (const sub of params.subTasks) {
          await createTask({
            projectId: params.projectId,
            parentTaskId: params.parentTaskId ?? null,
            title: sub.title,
            taskType: sub.taskType,
            description: sub.description || undefined,
            priority: sub.priority,
          })
        }
        confirmDecomp()
        toast.success(
          t("decompositionApplied", { count: params.subTasks.length })
        )
      } catch (err) {
        console.error("Failed to create sub-tasks:", err)
        toast.error(t("decompositionFailed"))
      } finally {
        setDecompSubmitting(false)
      }
    },
    [confirmDecomp, t]
  )

  const decompOverlayStatus: DecompositionOverlayStatus = decompViewingConfirmed
    ? "open"
    : decompConfirmed
      ? "confirmed"
      : decompDismissed
        ? "dismissed"
        : decompSubTasks && decompSubTasks.length > 0
          ? "open"
          : "none"

  const decompCurrentProposalKey = proposalKey(decompDetected)

  const decompOnOpenOverlay = decompConfirmed
    ? viewDecompConfirmed
    : reopenDecomp

  const decompOverlayCtxValue = useMemo(
    () => ({
      currentProposalKey: decompCurrentProposalKey,
      overlayStatus: decompOverlayStatus,
      onOpenOverlay: decompOnOpenOverlay,
      confirmedCount: decompDetected?.length ?? 0,
    }),
    [
      decompCurrentProposalKey,
      decompOverlayStatus,
      decompOnOpenOverlay,
      decompDetected,
    ]
  )

  return (
    <DecompositionOverlayContextProvider value={decompOverlayCtxValue}>
      {children}
      <DecompositionOverlay
        open={
          (decompSubTasks !== null &&
            decompSubTasks.length > 0 &&
            !decompConfirmed) ||
          decompViewingConfirmed
        }
        onOpenChange={(open) => {
          if (!open) {
            if (decompViewingConfirmed) closeDecompConfirmedView()
            else dismissDecomp()
          }
        }}
        proposedSubTasks={decompSubTasks ?? []}
        linkedTask={linkedTask}
        projects={projects}
        activeProjectId={activeProjectId}
        submitting={decompSubmitting}
        readOnly={decompViewingConfirmed}
        onUpdateSubTasks={updateDecompSubTasks}
        onConfirm={handleDecompConfirm}
      />
    </DecompositionOverlayContextProvider>
  )
}
