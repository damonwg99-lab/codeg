"use client"

import {
  hasDecompositionIntent,
  DECOMPOSITION_INSTRUCTION,
} from "@/lib/platform/decomposition-parser"
import { DECOMPOSITION_INSTRUCTION_SENTINEL } from "@/lib/feedback-reminder"
import type { PromptDraft, PromptInputBlock } from "@/lib/types"

/**
 * Wraps a PromptDraft, appending the decomposition instruction when the
 * user's message contains decomposition intent keywords.
 *
 * This is a pure utility function (not a hook) to minimize impact on
 * existing components — the caller just replaces `draft` with
 * `wrapDecompositionDraft(draft)` at the single send chokepoint.
 *
 * The instruction is bracketed by the ⟦codeg:decomp-instruction⟧ sentinel
 * and appended as a new text block at the end of `draft.blocks`.
 * `displayText` is left unchanged so the user's optimistic bubble still
 * shows only their own words. On reload, `stripFeedbackReminder` (which
 * also strips the decomposition sentinel) hides the instruction from the
 * displayed user message.
 */
export function wrapDecompositionDraft(draft: PromptDraft): PromptDraft {
  // Extract plain text from blocks to check for decomposition intent
  const userText = draft.blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")

  if (!hasDecompositionIntent(userText)) return draft

  // Append the instruction as a sentinel-bracketed text block.
  // The sentinel ensures:
  //  1. The agent recognizes it as a system note (not user prose)
  //  2. stripFeedbackReminder removes it from the displayed user message
  return {
    ...draft,
    blocks: [
      ...draft.blocks,
      {
        type: "text",
        text:
          "\n" +
          DECOMPOSITION_INSTRUCTION_SENTINEL +
          " " +
          DECOMPOSITION_INSTRUCTION,
      },
    ],
  }
}

/**
 * Convenience wrapper for just the blocks array (useful when the caller
 * doesn't have a full PromptDraft but just the blocks).
 */
export function wrapDecompositionBlocks(
  blocks: PromptInputBlock[]
): PromptInputBlock[] {
  const userText = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")

  if (!hasDecompositionIntent(userText)) return blocks

  return [
    ...blocks,
    {
      type: "text",
      text:
        "\n" +
        DECOMPOSITION_INSTRUCTION_SENTINEL +
        " " +
        DECOMPOSITION_INSTRUCTION,
    },
  ]
}
