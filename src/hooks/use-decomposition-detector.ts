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
 * - `userEdited`: { convId, tasks } — user's manual edits, scoped to the
 *   conversation where they were made. Stale edits from a different
 *   conversation are automatically ignored.
 * - `dismissed`: { convId, key } — dismissal keyed to the conversation.
 *   Stale dismissals from a different conversation auto-expire.
 * - `confirmed`: { convId, key } — confirmation keyed to the conversation.
 *   Stale confirmations from a different conversation auto-expire.
 *
 * Both dismissedKey and confirmedKey are persisted to localStorage so
 * they survive component remounts (tab close/reopen) and app restarts.
 * Without persistence, reopening a conversation would always auto-pop
 * the overlay for a previously-dismissed proposal.
 *
 * When the user dismisses the overlay:
 * - proposedSubTasks becomes null (overlay closed)
 * - A CollapsedOverlayChip is shown so the user can re-open
 * - If AI sends a NEW proposal (different content), the dismissal is
 *   overridden and the overlay re-appears automatically
 *
 * When the user confirms (batch-creates tasks):
 * - proposedSubTasks becomes null (overlay closes)
 * - The same proposal won't re-appear even though the AI message still
 *   contains the JSON fence.
 * - A NEW proposal with different content auto-triggers the overlay.
 *
 * All keyed state is conversation-scoped via convId, so switching tabs
 * never carries stale overlay state from a previous conversation.
 */

// ── sessionStorage persistence ──

const STORAGE_KEY_PREFIX = "codeg:decomp:"

function storageKey(convId: number | string | null | undefined): string {
  return `${STORAGE_KEY_PREFIX}${convId ?? "none"}`
}

interface StoredState {
  dismissedKey: string | null
  confirmedKey: string | null
}

function readStoredState(
  convId: number | string | null | undefined
): StoredState {
  try {
    const raw = localStorage.getItem(storageKey(convId))
    if (!raw) return { dismissedKey: null, confirmedKey: null }
    const parsed = JSON.parse(raw) as StoredState
    return {
      dismissedKey: parsed.dismissedKey ?? null,
      confirmedKey: parsed.confirmedKey ?? null,
    }
  } catch {
    return { dismissedKey: null, confirmedKey: null }
  }
}

function writeStoredState(
  convId: number | string | null | undefined,
  state: StoredState
): void {
  try {
    localStorage.setItem(storageKey(convId), JSON.stringify(state))
  } catch {
    // localStorage may be unavailable (private browsing, quota)
  }
}

function clearStoredState(convId: number | string | null | undefined): void {
  try {
    localStorage.removeItem(storageKey(convId))
  } catch {
    // ignore
  }
}

// ── Hook types ──

interface ScopedKey {
  convId: number | string | null | undefined
  key: string
}

interface ScopedEdit {
  convId: number | string | null | undefined
  tasks: ProposedSubTask[]
}

interface UseDecompositionDetectorResult {
  /** The effective sub-tasks to show in the overlay (null = hidden). */
  proposedSubTasks: ProposedSubTask[] | null
  /** Auto-detected tasks (always available, even when dismissed). */
  detectedSubTasks: ProposedSubTask[] | null
  /** Whether the overlay was manually dismissed (chip should be shown). */
  isDismissed: boolean
  /** Whether the proposal was confirmed (batch-created). Overlay stays
   *  hidden until a new proposal arrives. */
  isConfirmed: boolean
  /** Clear the proposal and reset all keyed state. */
  clearProposal: () => void
  /** Dismiss the overlay (keep proposal data, mark as dismissed). */
  dismissProposal: () => void
  /** Confirm the proposal (after batch-creating tasks). */
  confirmProposal: () => void
  /** Re-open the overlay after dismissal. */
  reopenProposal: () => void
  /** Update sub-tasks (user edits in the overlay). */
  updateSubTasks: (subTasks: ProposedSubTask[]) => void
}

/** Create a simple hash key from proposal content for tracking. */
function proposalKey(tasks: ProposedSubTask[] | null): string | null {
  if (!tasks || tasks.length === 0) return null
  return tasks.map((t) => `${t.title}|${t.taskType}|${t.priority}`).join("::")
}

/** Check if a scoped key belongs to the current conversation. */
function isCurrentConv(
  scoped: ScopedKey | ScopedEdit | null,
  convId: number | string | null | undefined
): boolean {
  if (!scoped) return false
  return scoped.convId === convId
}

export function useDecompositionDetector(
  localTurns: MessageTurn[] | undefined,
  conversationId: number | string | null | undefined
): UseDecompositionDetectorResult {
  // Auto-detected sub-tasks from AI response (derived, not stored in state)
  const detectedSubTasks = useMemo<ProposedSubTask[] | null>(() => {
    if (!localTurns || localTurns.length === 0) return null

    // Find the last assistant turn that is "complete". For turns loaded
    // from the database, `completed_at` may be omitted (Rust skips it
    // when None via `skip_serializing_if`), but DB-loaded turns are
    // always complete by definition. So we treat undefined/missing as
    // truthy — only actively-streaming turns have completed_at set to
    // a concrete timestamp.
    const lastAssistant = [...localTurns]
      .reverse()
      .find(
        (t) =>
          t.role === "assistant" &&
          (t.completed_at !== null || t.completed_at === undefined)
      )

    if (!lastAssistant) return null

    // Collect all text blocks from the assistant message
    const textContent = lastAssistant.blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")

    const parsed = parseDecompositionFromText(textContent)
    return parsed && parsed.length > 0 ? parsed : null
  }, [localTurns])

  // ── Conversation-scoped keyed state ──
  // Each state stores the conversationId it was set for. When the current
  // conversationId differs, the state is automatically stale and ignored
  // in the effective-value calculations below. This avoids the need for
  // useEffect + setState to reset on conversation switch (which ESLint
  // forbids).
  //
  // Dismissed and confirmed keys are ALSO persisted to localStorage so
  // they survive component remounts and app restarts. On mount, we read
  // the stored state; on change, we write it back.

  // Read persisted state once via useState initializer (ESLint allows
  // this because the initializer only runs on mount).
  const [dismissedScoped, setDismissedScoped] = useState<ScopedKey | null>(
    () => {
      const stored = readStoredState(conversationId)
      return stored.dismissedKey
        ? { convId: conversationId, key: stored.dismissedKey }
        : null
    }
  )
  const [confirmedScoped, setConfirmedScoped] = useState<ScopedKey | null>(
    () => {
      const stored = readStoredState(conversationId)
      return stored.confirmedKey
        ? { convId: conversationId, key: stored.confirmedKey }
        : null
    }
  )
  const [editedScoped, setEditedScoped] = useState<ScopedEdit | null>(null)

  // ── Effective values (stale state auto-expired) ──

  // User edits: only valid if they belong to the current conversation
  const userEditedSubTasks = isCurrentConv(editedScoped, conversationId)
    ? editedScoped!.tasks
    : null

  // Dismissed key: only valid if it belongs to the current conversation
  const dismissedKey = isCurrentConv(dismissedScoped, conversationId)
    ? dismissedScoped!.key
    : null

  // Confirmed key: only valid if it belongs to the current conversation
  const confirmedKey = isCurrentConv(confirmedScoped, conversationId)
    ? confirmedScoped!.key
    : null

  const currentDetectedKey = proposalKey(detectedSubTasks)

  // If a new proposal arrives (different key from the stored one),
  // automatically override the dismissal so the overlay re-appears.
  const effectiveDismissedKey =
    currentDetectedKey !== null && currentDetectedKey !== dismissedKey
      ? null
      : dismissedKey

  // Same for confirmed: a new proposal overrides the confirmation.
  const effectiveConfirmedKey =
    currentDetectedKey !== null && currentDetectedKey !== confirmedKey
      ? null
      : confirmedKey

  // The effective proposed sub-tasks:
  // - If confirmed (same key), return null → overlay hidden
  // - If dismissed (same key), return null → overlay hidden, chip shown
  // - Otherwise, user-edited overrides detected
  const isConfirmed =
    effectiveConfirmedKey !== null &&
    effectiveConfirmedKey === proposalKey(detectedSubTasks)

  const isDismissed =
    !isConfirmed &&
    effectiveDismissedKey !== null &&
    effectiveDismissedKey === proposalKey(detectedSubTasks)

  const proposedSubTasks = isConfirmed
    ? null
    : isDismissed
      ? null
      : (userEditedSubTasks ?? detectedSubTasks)

  // ── Actions ──

  const clearProposal = useCallback(() => {
    setEditedScoped(null)
    setDismissedScoped(null)
    setConfirmedScoped(null)
    clearStoredState(conversationId)
  }, [conversationId])

  const dismissProposal = useCallback(() => {
    const key = proposalKey(userEditedSubTasks ?? detectedSubTasks)
    if (key) {
      setDismissedScoped({ convId: conversationId, key })
      writeStoredState(conversationId, {
        dismissedKey: key,
        confirmedKey: isCurrentConv(confirmedScoped, conversationId)
          ? confirmedScoped!.key
          : null,
      })
    }
    setEditedScoped(null)
  }, [userEditedSubTasks, detectedSubTasks, conversationId, confirmedScoped])

  const confirmProposal = useCallback(() => {
    const key = proposalKey(userEditedSubTasks ?? detectedSubTasks)
    if (key) {
      setConfirmedScoped({ convId: conversationId, key })
      writeStoredState(conversationId, {
        dismissedKey: isCurrentConv(dismissedScoped, conversationId)
          ? dismissedScoped!.key
          : null,
        confirmedKey: key,
      })
    }
    setEditedScoped(null)
  }, [userEditedSubTasks, detectedSubTasks, conversationId, dismissedScoped])

  const reopenProposal = useCallback(() => {
    setDismissedScoped(null)
    writeStoredState(conversationId, {
      dismissedKey: null,
      confirmedKey: isCurrentConv(confirmedScoped, conversationId)
        ? confirmedScoped!.key
        : null,
    })
  }, [conversationId, confirmedScoped])

  const updateSubTasks = useCallback(
    (subTasks: ProposedSubTask[]) => {
      setEditedScoped({ convId: conversationId, tasks: subTasks })
    },
    [conversationId]
  )

  return {
    proposedSubTasks,
    detectedSubTasks,
    isDismissed,
    isConfirmed,
    clearProposal,
    dismissProposal,
    confirmProposal,
    reopenProposal,
    updateSubTasks,
  }
}
