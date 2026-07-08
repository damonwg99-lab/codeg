/**
 * Platform-custom embedding hooks for `buildStreamingTurnsFromLiveMessage`.
 *
 * These two pure functions isolate the secondary-development decomposition
 * detection logic from the upstream streaming-turn builder in
 * `stores/conversation-runtime-store.ts`. The store calls them at two
 * well-marked injection points; all decomposition parsing, fence scanning,
 * and group reconstruction lives here so upstream changes to the turn
 * builder's body don't conflict with the platform customization.
 *
 * See `decomposition-parser.ts` for the low-level parsing primitives.
 */

import type { ContentBlock } from "@/lib/types"
import {
  extractDecompositionSegments,
  parseDecompositionToolInput,
} from "@/lib/platform/decomposition-parser"

/**
 * Phase 2 injection: if `rawInput` is a `create_task_decomposition` MCP tool
 * call, push a synthetic `decomposition` block and return `true` (caller
 * should `break` — suppressing the generic tool card, identical to the
 * plan/KimiTodoWrite pattern). Returns `false` when this is not a
 * decomposition tool call so the caller falls through to generic tool_use
 * handling.
 *
 * The tool_call's raw_input is guaranteed valid JSON by the MCP framework,
 * so we parse it directly — no regex plan/KimiTodoWrite pattern needed.
 */
export function tryPushDecompositionToolCallBlock(
  blocks: ContentBlock[],
  rawInput: string | null | undefined
): boolean {
  const tasks = parseDecompositionToolInput(rawInput)
  if (!tasks) return false
  blocks.push({
    type: "decomposition",
    tasks,
    isStreaming: false, // tool call arrives with input already complete
  })
  return true
}

/**
 * Phase 3 injection: scan each turn group's text blocks for
 * ```task_decomposition_json fences and rebuild the group in place.
 *
 * - Complete fences → synthetic decomposition block + text-only segments
 *   (extracted via `extractDecompositionSegments`), replacing all text
 *   blocks in the group while keeping non-text blocks in place.
 * - Incomplete fences (streaming, closing ``` not yet seen) → a single
 *   placeholder decomposition block (`isStreaming: true`) preceded by any
 *   prose before the fence.
 *
 * Groups without text blocks or without decomposition fences are left
 * untouched. Mutates `groups[i]` in place (length-truncate + re-push) to
 * preserve the reference identity expected by the caller.
 */
export function applyDecompositionFenceDetection(
  groups: ContentBlock[][]
): void {
  for (const group of groups) {
    const textBlocks = group.filter(
      (b): b is ContentBlock & { type: "text" } => b.type === "text"
    )
    if (textBlocks.length === 0) continue

    const allText = textBlocks.map((b) => b.text).join("\n")

    // A) Complete fence: extractDecompositionSegments
    const segments = extractDecompositionSegments(allText)
    if (segments) {
      const hasDecomp = segments.some(
        (s) => s.kind === "decomposition" && s.tasks && s.tasks.length > 0
      )
      if (hasDecomp) {
        const syntheticBlocks: ContentBlock[] = []
        for (const seg of segments) {
          if (seg.kind === "text" && seg.value.trim()) {
            syntheticBlocks.push({ type: "text", text: seg.value })
          } else if (
            seg.kind === "decomposition" &&
            seg.tasks &&
            seg.tasks.length > 0
          ) {
            syntheticBlocks.push({
              type: "decomposition",
              tasks: seg.tasks,
              isStreaming: false,
            })
          }
        }

        const reconstructed: ContentBlock[] = []
        let replacedTextBlocks = false
        for (const block of group) {
          if (block.type !== "text") {
            reconstructed.push(block)
          } else if (!replacedTextBlocks) {
            reconstructed.push(...syntheticBlocks)
            replacedTextBlocks = true
          }
        }
        group.length = 0
        group.push(...reconstructed)
        continue
      }
    }

    // B) Incomplete fence (streaming): add placeholder
    const incompletePattern = /```task_decomposition_json(?:\s*\n|\s*$)/
    const incompleteMatch = incompletePattern.exec(allText)
    if (incompleteMatch) {
      const beforeFence = allText.slice(0, incompleteMatch.index)
      const placeholderBlocks: ContentBlock[] = []
      if (beforeFence.trim()) {
        placeholderBlocks.push({ type: "text", text: beforeFence })
      }
      placeholderBlocks.push({
        type: "decomposition",
        tasks: [],
        isStreaming: true,
      })

      const reconstructed: ContentBlock[] = []
      let replacedTextBlocks = false
      for (const block of group) {
        if (block.type !== "text") {
          reconstructed.push(block)
        } else if (!replacedTextBlocks) {
          reconstructed.push(...placeholderBlocks)
          replacedTextBlocks = true
        }
      }
      group.length = 0
      group.push(...reconstructed)
    }
  }
}
