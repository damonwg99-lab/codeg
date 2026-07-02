"use client"

import {
  hasDecompositionIntent,
  DECOMPOSITION_INSTRUCTION,
} from "@/lib/platform/decomposition-parser"
import type { PromptDraft, PromptInputBlock } from "@/lib/types"

/**
 * Wraps a PromptDraft, appending the decomposition instruction when the
 * user's message contains decomposition intent keywords.
 *
 * This is a pure utility function (not a hook) to minimize impact on
 * existing components — the caller just replaces `draft` with
 * `wrapDecompositionDraft(draft)` at the single send chokepoint.
 *
 * The instruction is appended as a new text block at the end of
 * `draft.blocks`, and `displayText` is left unchanged so the user's
 * optimistic bubble still shows only their own words.
 */
export function wrapDecompositionDraft(draft: PromptDraft): PromptDraft {
  // Extract plain text from blocks to check for decomposition intent
  const userText = draft.blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")

  if (!hasDecompositionIntent(userText)) return draft

  // Append the instruction as a new text block at the end.
  // displayText is NOT updated — the user's message bubble should
  // only show their own text, not the system instruction.
  return {
    ...draft,
    blocks: [
      ...draft.blocks,
      { type: "text", text: "\n" + DECOMPOSITION_INSTRUCTION },
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

  return [...blocks, { type: "text", text: "\n" + DECOMPOSITION_INSTRUCTION }]
}
