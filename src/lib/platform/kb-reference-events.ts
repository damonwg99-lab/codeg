import type { ReferenceAttrs } from "@/components/chat/composer/types"

/**
 * Bridge for the aux-panel 知识库 tab to inject selected KB doc references
 * into the active conversation's composer. Mirrors the window-CustomEvent
 * pattern of `session-attachment-events` (file tree → composer): the emitter
 * targets one conversation tab by id, and `message-input` consumes the event
 * through the same inject handler the composer toolbar uses.
 */
export const INJECT_KB_REFS_TO_SESSION_EVENT = "codeg:inject-kb-references"

export interface InjectKbRefsToSessionDetail {
  tabId: string
  refs: ReferenceAttrs[]
}

export function emitInjectKbRefsToSession(
  detail: InjectKbRefsToSessionDetail
): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<InjectKbRefsToSessionDetail>(
      INJECT_KB_REFS_TO_SESSION_EVENT,
      { detail }
    )
  )
}
