"use client"

import { useState, useCallback, useMemo } from "react"
import type { MessageTurn } from "@/lib/types"
import {
  parseDecompositionFromText,
  type ProposedSubTask,
} from "@/lib/platform/decomposition-parser"

/**
 * Hook that detects structured sub-task proposals from AI assistant
 * messages and manages the decomposition overlay visibility state.
 *
 * State model:
 * - `detectedSubTasks`: auto-derived from localTurns (useMemo)
 * - `userEditedSubTasks`: user's manual edits in the overlay (useState)
 * - `dismissedKey`: a hash of the proposal content when the user closed
 *   the overlay. Prevents the same proposal from auto-reopening.
 *
 * When the user dismisses the overlay:
 * - proposedSubTasks becomes null (overlay closed)
 * - A CollapsedOverlayChip is shown so the user can re-open
 * - If AI sends a NEW proposal (different content), the dismissal is
 *   overridden and the overlay re-appears automatically
 */
interface UseDecompositionDetectorResult {
  /** The effective sub-tasks to show in the overlay (null = hidden). */
  proposedSubTasks: ProposedSubTask[] | null
  /** Auto-detected tasks (always available, even when dismissed). */
  detectedSubTasks: ProposedSubTask[] | null
  /** Whether the overlay was manually dismissed (chip should be shown). */
  isDismissed: boolean
  /** Clear the proposal and reset dismissal state. */
  clearProposal: () => void
  /** Dismiss the overlay (keep proposal data, mark as dismissed). */
  dismissProposal: () => void
  /** Re-open the overlay after dismissal. */
  reopenProposal: () => void
  /** Update sub-tasks (user edits in the overlay). */
  updateSubTasks: (subTasks: ProposedSubTask[]) => void
}

/** Create a simple hash key from proposal content for dismissal tracking. */
function proposalKey(tasks: ProposedSubTask[] | null): string | null {
  if (!tasks || tasks.length === 0) return null
  return tasks.map((t) => `${t.title}|${t.taskType}|${t.priority}`).join("::")
}

export function useDecompositionDetector(
  localTurns: MessageTurn[] | undefined
): UseDecompositionDetectorResult {
  // Auto-detected sub-tasks from AI response (derived, not stored in state)
  const detectedSubTasks = useMemo<ProposedSubTask[] | null>(() => {
    if (!localTurns || localTurns.length === 0) return null

    // Find the last completed assistant turn
    const lastAssistant = [...localTurns]
      .reverse()
      .find((t) => t.role === "assistant" && t.completed_at)

    if (!lastAssistant) return null

    // Collect all text blocks from the assistant message
    const textContent = lastAssistant.blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")

    const parsed = parseDecompositionFromText(textContent)
    return parsed && parsed.length > 0 ? parsed : null
  }, [localTurns])

  // Track whether the user has manually edited the proposal.
  const [userEditedSubTasks, setUserEditedSubTasks] = useState<
    ProposedSubTask[] | null
  >(null)

  // Track whether the user has dismissed the current proposal.
  // Stores the proposalKey of the dismissed proposal so we can compare
  // against new proposals — if the content changes, the dismissal is
  // overridden.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  const currentDetectedKey = proposalKey(detectedSubTasks)

  // If a new proposal arrives (different key from the dismissed one),
  // automatically override the dismissal so the overlay re-appears.
  const effectiveDismissedKey =
    currentDetectedKey !== null && currentDetectedKey !== dismissedKey
      ? null // new proposal → override dismissal
      : dismissedKey

  // The effective proposed sub-tasks:
  // - If dismissed (same key), return null → overlay hidden
  // - Otherwise, user-edited overrides detected
  const isDismissed =
    effectiveDismissedKey !== null &&
    effectiveDismissedKey === proposalKey(detectedSubTasks)

  const proposedSubTasks = isDismissed
    ? null
    : (userEditedSubTasks ?? detectedSubTasks)

  const clearProposal = useCallback(() => {
    setUserEditedSubTasks(null)
    setDismissedKey(null)
  }, [])

  const dismissProposal = useCallback(() => {
    // Mark the current proposal as dismissed by storing its key
    setDismissedKey(proposalKey(userEditedSubTasks ?? detectedSubTasks))
    setUserEditedSubTasks(null)
  }, [userEditedSubTasks, detectedSubTasks])

  const reopenProposal = useCallback(() => {
    setDismissedKey(null)
  }, [])

  const updateSubTasks = useCallback((subTasks: ProposedSubTask[]) => {
    setUserEditedSubTasks(subTasks)
  }, [])

  return {
    proposedSubTasks,
    detectedSubTasks,
    isDismissed,
    clearProposal,
    dismissProposal,
    reopenProposal,
    updateSubTasks,
  }
}
