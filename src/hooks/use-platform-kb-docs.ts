"use client"

import { useCallback, useEffect, useState } from "react"
import { listKnowledgeDocs } from "@/lib/platform/api"
import type { KnowledgeDocInfo, ScanResultInfo } from "@/lib/platform/types"
import { isSkippedKbDoc } from "@/lib/platform/kb-suggestion"

interface UsePlatformKbDocsOptions {
  projectId?: number | null
  enabled?: boolean
}

export function usePlatformKbDocs({
  projectId,
  enabled = true,
}: UsePlatformKbDocsOptions = {}) {
  const [docs, setDocs] = useState<KnowledgeDocInfo[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!projectId || !enabled) {
      setDocs([])
      return
    }
    setLoading(true)
    try {
      const allDocs = await listKnowledgeDocs({ projectId })
      setDocs(allDocs.filter((d) => !isSkippedKbDoc(d)))
    } catch (e) {
      console.warn("[use-platform-kb-docs] failed to load docs:", e)
    } finally {
      setLoading(false)
    }
  }, [projectId, enabled])

  useEffect(() => {
    let unsub: (() => void) | null = null

    if (!projectId || !enabled) {
      setDocs([])
      return
    }

    void reload()

    // Subscribe to knowledge index changes
    async function subscribe() {
      try {
        const { getTransport, isDesktop } = await import("@/lib/transport")
        if (isDesktop()) {
          const { listen } = await import("@tauri-apps/api/event")
          unsub = await listen<ScanResultInfo>("knowledge://index-changed", (event) => {
            if (event.payload?.projectId === projectId) {
              void reload()
            }
          })
        } else {
          unsub = await getTransport().subscribe<ScanResultInfo>(
            "knowledge://index-changed",
            (payload) => {
              if (payload?.projectId === projectId) {
                void reload()
              }
            }
          )
        }
      } catch (e) {
        console.warn("[use-platform-kb-docs] subscription failed:", e)
      }
    }

    void subscribe()

    return () => {
      unsub?.()
    }
  }, [projectId, enabled, reload])

  // Split into regular KB docs and task attachments
  const kbDocs = docs.filter((d) => d.docType !== "task_attachment")
  const attachments = docs.filter((d) => d.docType === "task_attachment")

  return {
    allDocs: docs,
    kbDocs,
    attachments,
    loading,
    reload,
  }
}
