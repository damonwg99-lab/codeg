import { useCallback, useEffect, useRef } from "react"
import {
  usePlatformTabSlice,
  type PendingTaskLink,
} from "@/stores/platform-tab-slice"
import { linkConversation } from "@/lib/platform/api"
import type { RichComposerHandle } from "@/components/chat/composer/rich-composer"
import type { ReferenceAttrs } from "@/components/chat/composer/types"

/**
 * Platform composer glue for `MessageInput` — the two integration points the
 * task→conversation flow needs in the upstream composer, isolated here so the
 * upstream file keeps only thin hook calls.
 */

/**
 * Consume the pending initial draft (reference badges JSON, or legacy
 * markdown text) stashed by the task→conversation flow for THIS tab.
 *
 * Keyed by tabId (the attachment tab id), not conversationId, so badge drafts
 * never leak into another tab's editor. A one-time ref guard prevents
 * duplicate insertions: `insertReference` triggers a synchronous flushSync
 * re-render (NodeViewRenderer) that re-runs this effect; the ref already
 * contains the tabId, so the re-run skips — breaking the cascade that used to
 * cause triple duplication.
 */
export function usePendingInitialDrafts(
  composerReady: boolean,
  tabId: string | null | undefined,
  editorRef: React.RefObject<RichComposerHandle | null>
): void {
  const pendingInitialDrafts = usePlatformTabSlice(
    (s) => s.pendingInitialDrafts
  )
  const clearPendingInitialDraft = usePlatformTabSlice(
    (s) => s.clearPendingInitialDraft
  )
  // One-time guard for pending draft consumption. When a flushSync re-render
  // (triggered by insertReference NodeViewRenderer) re-runs the effect, the
  // guard prevents duplicate badge insertion. Cleared after successful rAF
  // execution; if the editor is unavailable, the guard is removed so the
  // next effect run can retry.
  const draftConsumedRef = useRef(new Set<string>())

  useEffect(() => {
    if (!composerReady || !tabId) return
    const pending = pendingInitialDrafts.get(tabId)
    if (!pending) return
    if (draftConsumedRef.current.has(tabId)) return
    draftConsumedRef.current.add(tabId)

    // Parse refs now (synchronous) — data is captured in the rAF closure.
    let refs: ReferenceAttrs[]
    let isLegacyMarkdown = false
    try {
      refs = JSON.parse(pending) as ReferenceAttrs[]
    } catch {
      isLegacyMarkdown = true
    }

    // Defer editor mutations to the next animation frame to avoid flushSync
    // warnings during the commit phase. Same rAF pattern used by the
    // hydration and inject effects elsewhere in this component.
    const raf = requestAnimationFrame(() => {
      const editor = editorRef.current?.getEditor()
      if (!editor) {
        // Editor unavailable — remove the guard so a future effect run
        // (when the editor is ready) can retry.
        draftConsumedRef.current.delete(tabId)
        return
      }
      if (isLegacyMarkdown) {
        editorRef.current?.insertTextAtCursor(pending)
      } else {
        for (const ref of refs) {
          editor.chain().insertReference(ref).insertContent(" ").run()
        }
      }
      // Clear the draft after successful insertion. This triggers a state
      // update, but the ref guard already prevents any re-trigger, and the
      // rAF has completed so cancelAnimationFrame cleanup is a no-op.
      clearPendingInitialDraft(tabId)
    })
    return () => cancelAnimationFrame(raf)
  }, [
    composerReady,
    tabId,
    pendingInitialDrafts,
    clearPendingInitialDraft,
    editorRef,
  ])
}

/**
 * Platform composer toolbar callback — converts InjectOption[] selections
 * from ProjectResourcePicker into inline reference badges in the composer.
 */
export function usePlatformInjectHandler(
  editorRef: React.RefObject<RichComposerHandle | null>
): (refs: ReferenceAttrs[]) => void {
  return useCallback((refs: ReferenceAttrs[]) => {
    const editor = editorRef.current?.getEditor()
    if (!editor) return
    let chain = editor.chain().focus("end")
    for (const ref of refs) {
      chain = chain.insertReference(ref).insertContent(" ")
    }
    chain.run()
  }, [editorRef])
}

/**
 * Persist a task link chosen in the 📋 popover BEFORE the first prompt goes
 * out. For a brand-new conversation the popover's handleTaskLink can only
 * stash the intent (setPendingTaskLink — there is no conversationId yet to
 * bind against). Consuming it right after the DB row is created binds the
 * platform_task_conversation record so the backend's first-prompt context
 * injection (which resolves the task link) can fire on message 1. On failure
 * the intent is kept so a later send can retry; the send itself is not
 * blocked.
 */
export async function flushPendingTaskLink(
  tabId: string,
  conversationId: number
): Promise<void> {
  const pendingLink: PendingTaskLink | null | undefined =
    usePlatformTabSlice.getState().pendingTaskLink.get(tabId)
  if (!pendingLink) return
  try {
    await linkConversation({
      taskId: pendingLink.taskId,
      conversationId,
      role: pendingLink.role,
    })
    usePlatformTabSlice.getState().clearPendingTaskLink(tabId)
  } catch (e) {
    console.error("[platform] persist pending task link:", e)
  }
}
