"use client"

import { createContext, useContext } from "react"

/**
 * Context bridge between the decomposition overlay state (tracked in
 * `MessageListView` via `useDecompositionDetector`) and the inline
 * `DecompositionCard` components rendered by `ContentPartsRenderer`.
 *
 * The card for the *latest* decomposition needs to show status indicators
 * and action buttons (re-open overlay, view confirmed tasks) that depend on
 * the detector's overlay state — but `ContentPartsRenderer` is a pure
 * rendering component with no access to that state. This context lets the
 * card read the overlay state without threading props through the entire
 * render tree.
 *
 * Cards whose `proposalKey(tasks)` does NOT match `currentProposalKey`
 * simply render as pure display cards (no status / no action buttons).
 */

export type DecompositionOverlayStatus =
  | "open"
  | "dismissed"
  | "confirmed"
  | "none"

export interface DecompositionOverlayContextValue {
  /** Hash of the currently tracked proposal (from `proposalKey(detectedSubTasks)`). */
  currentProposalKey: string | null
  /** Status of the overlay for the current proposal. */
  overlayStatus: DecompositionOverlayStatus
  /** Re-open the overlay (from `reopenProposal` or `viewConfirmedProposal`). */
  onOpenOverlay: () => void
  /** Number of tasks that were successfully created (confirmed overlay). */
  confirmedCount: number
}

const DecompositionOverlayContext =
  createContext<DecompositionOverlayContextValue | null>(null)

export function useDecompositionOverlayContext(): DecompositionOverlayContextValue | null {
  return useContext(DecompositionOverlayContext)
}

export const DecompositionOverlayContextProvider =
  DecompositionOverlayContext.Provider
