"use client"

import { useEffect, useMemo, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { useShallow } from "zustand/react/shallow"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useAcpActions } from "@/contexts/acp-connections-context"
import { useWorkspaceActions } from "@/contexts/workspace-context"
import { useSortedAvailableAgents } from "@/hooks/use-sorted-available-agents"
import { onTransportReconnect, subscribe } from "@/lib/platform"
import {
  runCorrectionOnce,
  runRecoveryOnce,
  useTabStore,
  useTabActions as useTabActionsBase,
  type TabItem,
} from "@/stores/tab-store"
// PLATFORM CUSTOM BEGIN: pending draft / task-link state lives in the
// separate `platform-tab-slice` store to keep it out of upstream tab-store
// merge conflicts. Merged into `useTabContext` / `useTabActions` below so
// the public API stays stable for the 8 consumer components.
import {
  usePlatformTabSlice,
  type PendingTaskLink,
} from "@/stores/platform-tab-slice"
// PLATFORM CUSTOM END.
import {
  CONVERSATION_CHANGED_EVENT,
  TABS_CHANGED_EVENT,
  type ConversationChange,
  type TabsChanged,
} from "@/lib/types"

export type { TabItem }
export type { PendingTaskLink }
export {
  makeConversationTabId,
  useTabStore,
} from "@/stores/tab-store"

interface TabProviderProps {
  children: ReactNode
}

/**
 * Thin lifecycle glue for `useTabStore`: injects the React-land dependencies
 * (i18n labels, `activateConversationPane`, `acpDisconnect`, agent availability)
 * and drives the effects that need a React lifecycle — the persisted-tab
 * hydration, the debounced CAS save, the cross-client `tabs://changed` and
 * sub-session `conversation://changed` subscriptions, the provisional-agent
 * correction gate, and post-hydration recovery. All state and logic live in the
 * store; this component renders nothing but `children`.
 */
export function TabProvider({ children }: TabProviderProps) {
  const t = useTranslations("Folder.tabContext")
  const { activateConversationPane } = useWorkspaceActions()
  const { disconnect: acpDisconnect } = useAcpActions()
  const { sortedTypes: sortedAvailableAgents, fresh: agentsFresh } =
    useSortedAvailableAgents()

  // App-workspace gates for the correction / recovery / child-reconcile effects.
  const foldersHydrated = useAppWorkspaceStore((s) => s.foldersHydrated)
  const conversations = useAppWorkspaceStore((s) => s.conversations)
  const conversationsLoading = useAppWorkspaceStore(
    (s) => s.conversationsLoading
  )

  // Tab-store slices used only as effect dependencies (this component renders
  // nothing, so subscribing here doesn't cascade to any consumer).
  const rawTabs = useTabStore((s) => s.rawTabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const previewReplacedTabIds = useTabStore((s) => s.previewReplacedTabIds)
  const draftRetargetRequests = useTabStore((s) => s.draftRetargetRequests)
  const tabsHydrated = useTabStore((s) => s.tabsHydrated)
  const saveReconcileTick = useTabStore((s) => s.saveReconcileTick)
  const reseedTick = useTabStore((s) => s.reseedTick)

  // ── Runtime dependency injection ─────────────────────────────────────────────
  // Labels first (declared before hydrate) so seed titles are translated before
  // the hydration effect runs.
  useEffect(() => {
    useTabStore.getState().setLabels({
      loadingConversation: t("loadingConversation"),
      newConversation: t("newConversation"),
      untitledConversation: t("untitledConversation"),
    })
  }, [t])

  useEffect(() => {
    useTabStore
      .getState()
      .setSideEffects({ activateConversationPane, acpDisconnect })
  }, [activateConversationPane, acpDisconnect])

  useEffect(() => {
    useTabStore
      .getState()
      .setAgentAvailability(sortedAvailableAgents, agentsFresh)
  }, [sortedAvailableAgents, agentsFresh])

  // Sync the active tab's folderId up to the app-workspace store so derived
  // consumers (useActiveFolder, branch polling) reflect the focused folder.
  useEffect(() => {
    useTabStore.getState().syncActiveFolderId()
  }, [rawTabs, activeTabId])

  // Fire the preview-replacement callbacks and trim the consumed queue.
  useEffect(() => {
    useTabStore.getState().consumePreviewReplaced()
  }, [previewReplacedTabIds])

  // Disconnect + retarget each queued draft-retarget request.
  useEffect(() => {
    useTabStore.getState().consumeDraftRetargets()
  }, [draftRetargetRequests])

  // Hydrate from persisted opened_tabs on mount.
  useEffect(() => useTabStore.getState().hydrate(), [])

  // Debounced compare-and-set save + broadcast.
  useEffect(() => {
    useTabStore.getState().runSaveEffect()
  }, [rawTabs, activeTabId, tabsHydrated, saveReconcileTick])

  // Clear a pending save only on unmount — NOT on every effect re-run.
  useEffect(() => () => useTabStore.getState().clearSaveTimer(), [])

  // Reconcile the sub-session summary cache to the open child tabs.
  useEffect(() => {
    useTabStore.getState().reconcileChildSummaries()
  }, [rawTabs, conversations, conversationsLoading, reseedTick])

  // Keep seeded sub-session summaries live off the global conversation channel.
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void (async () => {
      const dispose = await subscribe<ConversationChange>(
        CONVERSATION_CHANGED_EVENT,
        (change) => useTabStore.getState().handleChildConversationChange(change)
      )
      if (disposed) dispose()
      else unlisten = dispose
    })()
    const offReconnect = onTransportReconnect(() =>
      useTabStore.getState().handleChildReconnect()
    )
    return () => {
      disposed = true
      unlisten?.()
      offReconnect?.()
    }
  }, [])

  // Subscribe to the global `tabs://changed` side-channel.
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void (async () => {
      const dispose = await subscribe<TabsChanged>(
        TABS_CHANGED_EVENT,
        (change) => useTabStore.getState().handleTabsChanged(change)
      )
      if (disposed) {
        dispose()
        return
      }
      unlisten = dispose
      // Close the initial-connect window (a change committed between the hydrate
      // snapshot read and the subscription going live is dropped by the
      // broadcaster). One reconcile after subscribe is ready catches it.
      void useTabStore.getState().refetchTabs()
    })()
    const offReconnect = onTransportReconnect(() =>
      useTabStore.getState().refetchTabs()
    )
    return () => {
      disposed = true
      unlisten?.()
      offReconnect?.()
    }
  }, [])

  // Correction must wait for the fresh agent list, hydrated tabs, and hydrated
  // folders (so folder defaults resolve). One-shot per session via the store.
  useEffect(() => {
    if (!agentsFresh) return
    if (!tabsHydrated) return
    if (!foldersHydrated) return
    runCorrectionOnce()
  }, [agentsFresh, tabsHydrated, foldersHydrated])

  // Post-hydration recovery: a draft-only session hydrates to zero tabs; never
  // leave the workspace blank.
  useEffect(() => {
    if (!tabsHydrated || !foldersHydrated) return
    if (rawTabs.length > 0) return
    runRecoveryOnce()
  }, [tabsHydrated, foldersHydrated, rawTabs])

  // Persist the active draft's context for the next cold start.
  useEffect(() => {
    useTabStore.getState().persistLastActiveContext()
  }, [rawTabs, activeTabId, tabsHydrated])

  return <>{children}</>
}

export interface TabContextValue {
  tabs: TabItem[]
  activeTabId: string | null
  tabsHydrated: boolean
  isTileMode: boolean
  openTab: (
    folderId: number,
    conversationId: number,
    agentType: TabItem["agentType"],
    pin?: boolean,
    title?: string
  ) => void
  closeTab: (tabId: string) => void
  closeConversationTab: (
    folderId: number,
    conversationId: number,
    agentType: TabItem["agentType"]
  ) => void
  closeOtherTabs: (tabId: string) => void
  closeAllTabs: () => void
  closeTabsByFolder: (folderId: number) => void
  switchTab: (tabId: string) => void
  pinTab: (tabId: string) => void
  toggleTileMode: () => void
  consumeRemoteActivation: () => boolean
  openNewConversationTab: (
    folderId: number,
    workingDir: string,
    options?: {
      inheritFromActive?: boolean
      folderDefaultAgent?: TabItem["agentType"] | null
    }
  ) => void
  openChatModeTab: () => void
  setChatDraftWorkingDir: (tabId: string, workingDir: string) => void
  confirmDraftAgent: (tabId: string, agentType: TabItem["agentType"]) => void
  setDraftAgentFromFallback: (
    tabId: string,
    agentType: TabItem["agentType"]
  ) => void
  bindConversationTab: (
    tabId: string,
    conversationId: number,
    agentType: TabItem["agentType"],
    title: string,
    runtimeConversationId?: number,
    folderId?: number,
    workingDir?: string
  ) => void
  setTabRuntimeConversationId: (
    tabId: string,
    runtimeConversationId: number
  ) => void
  reorderTabs: (reorderedTabs: TabItem[]) => void
  onPreviewTabReplaced: (callback: (tabId: string) => void) => () => void
  /**
   * Pending initial content for newly created conversation tabs. Used by
   * the task→conversation flow to pre-fill the composer with a context prefix.
   * Keyed by tabId to prevent badge drafts leaking across tabs.
   */
  pendingInitialDrafts: Map<string, string>
  setPendingInitialDraft: (tabId: string, content: string) => void
  clearPendingInitialDraft: (tabId: string) => void
  /**
   * Pending task link intent for draft tabs. Stored when user selects a task
   * in the Popover before the conversation is created. Auto-executed after
   * conversation creation. Keyed by tabId.
   */
  pendingTaskLink: Map<string, PendingTaskLink | null>
  setPendingTaskLink: (
    tabId: string,
    taskId: number,
    role: string,
    title: string,
    taskType: string
  ) => void
  clearPendingTaskLink: (tabId: string) => void
}

/**
 * Backwards-compatible whole-value accessor over the tab store. Kept so existing
 * consumers keep working during the incremental selector migration; new/hot
 * consumers should read `useTabStore(selector)` / `useTabActions()` directly to
 * subscribe to the narrowest slice they render. `useShallow` keeps each store's
 * selected slice stable; `useMemo` then merges the two stores (main tab store +
 * platform-tab-slice) into one stable object, so this re-renders only when a
 * read field (tabs/activeTabId/tabsHydrated/isTileMode or a pending* field)
 * changes — matching the former context's behavior.
 */
export function useTabContext(): TabContextValue {
  const base = useTabStore(
    useShallow((s) => ({
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      tabsHydrated: s.tabsHydrated,
      isTileMode: s.isTileMode,
      openTab: s.openTab,
      closeTab: s.closeTab,
      closeConversationTab: s.closeConversationTab,
      closeOtherTabs: s.closeOtherTabs,
      closeAllTabs: s.closeAllTabs,
      closeTabsByFolder: s.closeTabsByFolder,
      switchTab: s.switchTab,
      pinTab: s.pinTab,
      toggleTileMode: s.toggleTileMode,
      consumeRemoteActivation: s.consumeRemoteActivation,
      openNewConversationTab: s.openNewConversationTab,
      openChatModeTab: s.openChatModeTab,
      setChatDraftWorkingDir: s.setChatDraftWorkingDir,
      confirmDraftAgent: s.confirmDraftAgent,
      setDraftAgentFromFallback: s.setDraftAgentFromFallback,
      bindConversationTab: s.bindConversationTab,
      setTabRuntimeConversationId: s.setTabRuntimeConversationId,
      reorderTabs: s.reorderTabs,
      onPreviewTabReplaced: s.onPreviewTabReplaced,
    }))
  )
  // PLATFORM CUSTOM BEGIN: pending draft / task-link fields come from the
  // separate platform-tab-slice store, merged here to preserve the public
  // `TabContextValue` shape consumers already depend on.
  const platform = usePlatformTabSlice(
    useShallow((s) => ({
      pendingInitialDrafts: s.pendingInitialDrafts,
      setPendingInitialDraft: s.setPendingInitialDraft,
      clearPendingInitialDraft: s.clearPendingInitialDraft,
      pendingTaskLink: s.pendingTaskLink,
      setPendingTaskLink: s.setPendingTaskLink,
      clearPendingTaskLink: s.clearPendingTaskLink,
    }))
  )
  // PLATFORM CUSTOM END.
  return useMemo(() => ({ ...base, ...platform }), [base, platform])
}

/**
 * All tab actions as a shallow-stable object. Actions never change identity, so
 * this hook never triggers a re-render — consumers that only dispatch use it
 * instead of subscribing to any state slice. Merges the main tab-store actions
 * with the platform-tab-slice actions so the public API is unchanged.
 */
export function useTabActions() {
  const base = useTabActionsBase()
  // PLATFORM CUSTOM BEGIN: pending* actions + pendingTaskLink state from the
  // platform-tab-slice store. `pendingTaskLink` (state) is included here
  // because conversation-detail-panel.tsx destructures it from useTabActions
  // alongside clearPendingTaskLink — preserving that secondary-dev API shape.
  const platform = usePlatformTabSlice(
    useShallow((s) => ({
      pendingTaskLink: s.pendingTaskLink,
      setPendingInitialDraft: s.setPendingInitialDraft,
      clearPendingInitialDraft: s.clearPendingInitialDraft,
      setPendingTaskLink: s.setPendingTaskLink,
      clearPendingTaskLink: s.clearPendingTaskLink,
    }))
  )
  // PLATFORM CUSTOM END.
  return useMemo(() => ({ ...base, ...platform }), [base, platform])
}
