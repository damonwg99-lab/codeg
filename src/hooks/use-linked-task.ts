"use client"

import { useCallback, useEffect, useState } from "react"
import { getTaskByConversation, getTask } from "@/lib/platform/api"
import type { TaskConversationInfo, TaskInfo } from "@/lib/platform/types"

interface LinkedTaskResult {
  /** The task-conversation link row (null if no link). */
  linkedTaskInfo: TaskConversationInfo | null
  /** The full task entity (null if no link or fetch failed). */
  linkedTask: TaskInfo | null
  /** Manually refresh the link (e.g. after linking/unlinking). */
  refresh: () => void
  /** Whether a fetch is in progress. */
  loading: boolean
}

/**
 * Reactive hook that resolves the task linked to a conversation.
 * Re-fetches when `conversationId` changes; call `refresh()` after
 * manual link/unlink mutations so the UI stays in sync.
 */
export function useLinkedTask(conversationId: number | null): LinkedTaskResult {
  const [linkedTaskInfo, setLinkedTaskInfo] =
    useState<TaskConversationInfo | null>(null)
  const [linkedTask, setLinkedTask] = useState<TaskInfo | null>(null)
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    if (!conversationId) {
      setLinkedTaskInfo(null)
      setLinkedTask(null)
      return
    }
    setLoading(true)
    try {
      const link = await getTaskByConversation(conversationId)
      setLinkedTaskInfo(link)
      if (link) {
        const detail = await getTask(link.taskId)
        setLinkedTask(detail.task)
      } else {
        setLinkedTask(null)
      }
    } catch {
      setLinkedTaskInfo(null)
      setLinkedTask(null)
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  useEffect(() => {
    void fetch()
  }, [fetch])

  return {
    linkedTaskInfo,
    linkedTask,
    refresh: fetch,
    loading,
  }
}
