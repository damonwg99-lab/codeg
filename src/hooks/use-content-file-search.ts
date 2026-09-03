import { useCallback, useEffect, useRef, useState } from "react"
import { isDesktop } from "@/lib/transport"
import { randomUUID } from "@/lib/utils"
import type { ContentSearchBatch, FileContentMatch } from "@/lib/types"

/** Debounce window for content searches (files tab). */
const CONTENT_SEARCH_DEBOUNCE_MS = 400
/** Minimum query length before content search fires. */
const CONTENT_SEARCH_MIN_CHARS = 2
/** Hard cap on content matches per search. */
const CONTENT_SEARCH_MAX_RESULTS = 100

interface UseContentFileSearchParams {
  /** Whether the search dialog is open; closing resets all state. */
  open: boolean
  /** Whether the owning surface is active (the dialog's files tab). */
  enabled: boolean
  /** The raw (undebounced) query text. */
  query: string
  /** The folder root to search within; empty disables content search. */
  folderPath: string
}

/**
 * Content (full-text) file search for the search dialog's Files tab — a fork
 * feature with no main-side counterpart. Desktop streams batches over the
 * `search_files_content:results` event (subscribed around the
 * `search_files_content_streaming` invoke); the web/server path issues a
 * single `search_files_content` HTTP call. Owns debouncing, aborting and
 * reset-on-close so the dialog keeps only a one-line integration.
 */
export function useContentFileSearch({
  open,
  enabled,
  query,
  folderPath,
}: UseContentFileSearchParams): {
  contentResults: FileContentMatch[]
  contentSearching: boolean
} {
  const [contentResults, setContentResults] = useState<FileContentMatch[]>([])
  const [contentSearching, setContentSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const abortRef = useRef<AbortController | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  const teardownRefs = useCallback(() => {
    abortRef.current?.abort()
    unsubRef.current?.()
    unsubRef.current = null
  }, [])

  const doContentSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim()
      if (
        !trimmed ||
        trimmed.length < CONTENT_SEARCH_MIN_CHARS ||
        !folderPath
      ) {
        setContentResults([])
        setContentSearching(false)
        return
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setContentSearching(true)
      setContentResults([])

      if (isDesktop()) {
        const searchId = randomUUID()
        unsubRef.current?.()
        unsubRef.current = null
        try {
          const { invoke } = await import("@tauri-apps/api/core")
          const transport = (await import("@/lib/transport")).getTransport()
          const unsub = await transport.subscribe<ContentSearchBatch>(
            "search_files_content:results",
            (payload) => {
              if (controller.signal.aborted) return
              if (payload.searchId !== searchId) return
              setContentResults((prev) => [...prev, ...payload.matches])
              if (payload.done) {
                setContentSearching(false)
                unsubRef.current?.()
                unsubRef.current = null
              }
            }
          )
          unsubRef.current = unsub
          await invoke("search_files_content_streaming", {
            searchId,
            basePath: folderPath,
            keyword: trimmed,
            maxResults: CONTENT_SEARCH_MAX_RESULTS,
          })
        } catch (err) {
          if (!controller.signal.aborted) {
            console.warn("[ContentSearch] search failed:", err)
            setContentResults([])
            setContentSearching(false)
            unsubRef.current?.()
            unsubRef.current = null
          }
        }
      } else {
        try {
          const transport = (await import("@/lib/transport")).getTransport()
          const data: FileContentMatch[] = await transport.call(
            "search_files_content",
            {
              basePath: folderPath,
              keyword: trimmed,
              maxResults: CONTENT_SEARCH_MAX_RESULTS,
            }
          )
          if (!controller.signal.aborted) {
            setContentResults(data)
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            console.warn("[ContentSearch] search failed:", err)
            setContentResults([])
          }
        } finally {
          if (!controller.signal.aborted) {
            setContentSearching(false)
          }
        }
      }
    },
    [folderPath]
  )

  // Debounced content search on query change (files tab only)
  useEffect(() => {
    if (!enabled) return
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = query.trim()
    if (trimmed.length >= CONTENT_SEARCH_MIN_CHARS) {
      setContentSearching(true)
    }

    debounceRef.current = setTimeout(() => {
      void doContentSearch(query)
    }, CONTENT_SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, doContentSearch, enabled])

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setContentResults([])
      setContentSearching(false)
      teardownRefs()
    }
  }, [open, teardownRefs])

  return { contentResults, contentSearching }
}
