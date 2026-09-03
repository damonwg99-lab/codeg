import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useContentFileSearch } from "./use-content-file-search"
import type { ContentSearchBatch, FileContentMatch } from "@/lib/types"

// ---------------------------------------------------------------------------
// Mocks. Transport shape depends on the environment: desktop streams batches
// over an event subscription, web issues a single call.
// ---------------------------------------------------------------------------

let desktop: boolean
const transportCall = vi.fn()
const transportSubscribe = vi.fn()
let invokeImpl: ((cmd: string, args: unknown) => Promise<void>) | null = null

vi.mock("@/lib/transport", () => ({
  isDesktop: () => desktop,
  // Mirrors the real module: getTransport is SYNCHRONOUS.
  getTransport: () => ({
    call: transportCall,
    subscribe: transportSubscribe,
  }),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) =>
    invokeImpl ? invokeImpl(cmd, args) : Promise.resolve(),
}))

function match(partial: Partial<FileContentMatch>): FileContentMatch {
  return {
    relativePath: "src/a.ts",
    lineNumber: 1,
    lineContent: "const a = 1",
    ...partial,
  } as FileContentMatch
}

const baseParams = { open: true, enabled: true, query: "needle", folderPath: "/repo" }

beforeEach(() => {
  // shouldAdvanceTime lets waitFor's real-timer polling coexist with the
  // fake 400ms debounce window.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  desktop = false
  transportCall.mockReset()
  transportSubscribe.mockReset()
  invokeImpl = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useContentFileSearch", () => {
  it("does not search for queries shorter than 2 chars", async () => {
    const { result } = renderHook(() =>
      useContentFileSearch({ ...baseParams, query: "a" })
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(transportCall).not.toHaveBeenCalled()
    expect(result.current.contentSearching).toBe(false)
  })

  it("does not search without a folder path", async () => {
    const { result } = renderHook(() =>
      useContentFileSearch({ ...baseParams, folderPath: "" })
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(transportCall).not.toHaveBeenCalled()
    expect(result.current.contentResults).toEqual([])
  })

  it("issues a single web call after the debounce and settles results", async () => {
    transportCall.mockResolvedValue([match({}), match({ lineNumber: 2 })])
    const { result } = renderHook(() => useContentFileSearch(baseParams))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    // Marked searching immediately (query long enough), not yet fired
    expect(result.current.contentSearching).toBe(true)
    expect(transportCall).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    await waitFor(() => {
      expect(result.current.contentSearching).toBe(false)
    })
    expect(transportCall).toHaveBeenCalledWith("search_files_content", {
      basePath: "/repo",
      keyword: "needle",
      maxResults: 100,
    })
    expect(result.current.contentResults).toHaveLength(2)
  })

  it("streams desktop batches and unsubscribes on done", async () => {
    desktop = true
    let onEvent: ((batch: ContentSearchBatch) => void) | null = null
    transportSubscribe.mockImplementation(async (_event, handler) => {
      onEvent = handler
      return () => {
        onEvent = null
      }
    })
    invokeImpl = async (_cmd, args) => {
      // The handler filters by the searchId the hook generated — echo it back.
      const { searchId } = args as { searchId: string }
      onEvent?.({ searchId, matches: [match({ lineNumber: 1 })], done: false })
      onEvent?.({ searchId, matches: [match({ lineNumber: 2 })], done: true })
    }

    const { result } = renderHook(() => useContentFileSearch(baseParams))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    await waitFor(() => {
      expect(result.current.contentSearching).toBe(false)
    })
    expect(result.current.contentResults).toHaveLength(2)
    expect(transportSubscribe).toHaveBeenCalledTimes(1)
  })

  it("ignores batches from other search ids", async () => {
    desktop = true
    let onEvent: ((batch: ContentSearchBatch) => void) | null = null
    transportSubscribe.mockImplementation(async (_event, handler) => {
      onEvent = handler
      return () => {}
    })
    invokeImpl = async () => {
      onEvent?.({ searchId: "OTHER", matches: [match({})], done: true })
    }

    const { result } = renderHook(() => useContentFileSearch(baseParams))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(result.current.contentResults).toEqual([])
    expect(result.current.contentSearching).toBe(true)
  })

  it("resets state when the dialog closes", async () => {
    transportCall.mockResolvedValue([match({})])
    const { result, rerender } = renderHook(
      ({ open }) => useContentFileSearch({ ...baseParams, open }),
      { initialProps: { open: true } }
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await waitFor(() => expect(result.current.contentResults).toHaveLength(1))

    rerender({ open: false })
    expect(result.current.contentResults).toEqual([])
    expect(result.current.contentSearching).toBe(false)
  })
})
