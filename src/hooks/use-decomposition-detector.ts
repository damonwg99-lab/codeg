"use client"

import { useState, useCallback, useMemo } from "react"
import type { MessageTurn } from "@/lib/types"
import {
  parseDecompositionFromText,
  type ProposedSubTask,
} from "@/lib/platform/decomposition-parser"

/**
 * Hook that detects structured sub-task proposals from AI assistant
 * messages. Uses useMemo to scan the latest assistant turn's text blocks
 * for ```task_decomposition_json code fences.
 *
 * This hook is self-contained — it does not modify any core conversation
 * logic. It just observes localTurns and extracts decomposition data.
 *
 * The `detectedSubTasks` field is auto-derived from the conversation turns
 * and updates whenever a new assistant message contains a valid decomposition
 * JSON block. The `userEditedSubTasks` field tracks manual edits made in the
 * overlay UI. When the user edits, their version takes precedence; when a
 * new AI response arrives with updated proposals, the auto-detected version
 * replaces the user's edits.
 */
interface UseDecompositionDetectorResult {
  proposedSubTasks: ProposedSubTask[] | null
  clearProposal: () => void
  updateSubTasks: (subTasks: ProposedSubTask[]) => void
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
  // When false, we show the auto-detected version.
  // When true, we show the user-edited version stored in state.
  const [userEditedSubTasks, setUserEditedSubTasks] = useState<
    ProposedSubTask[] | null
  >(null)

  // The effective sub-tasks: user-edited overrides detected
  const proposedSubTasks = userEditedSubTasks ?? detectedSubTasks

  const clearProposal = useCallback(() => {
    setUserEditedSubTasks(null)
  }, [])

  const updateSubTasks = useCallback((subTasks: ProposedSubTask[]) => {
    setUserEditedSubTasks(subTasks)
  }, [])

  return { proposedSubTasks, clearProposal, updateSubTasks }
}
