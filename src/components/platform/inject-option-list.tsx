"use client"

import { useMemo } from "react"
import { BookOpen, FileText, MessageSquare, Paperclip } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  type InjectOption,
  type InjectOptionGroup,
  type OptionId,
} from "@/components/platform/context-inject-panel-utils"

/** Ordered groups for rendering. Attachments placed immediately after
 *  task info (basic) rather than after knowledge docs. */
const ALL_GROUPS: InjectOptionGroup[] = [
  "basic",
  "attachments",
  "conversations",
  "kb_docs",
]

/** Groups that should always render a bordered container area even when
 *  empty, showing the empty-state message inside the card. */
const CARD_GROUPS: InjectOptionGroup[] = ["attachments", "kb_docs"]

interface InjectOptionListProps {
  options: InjectOption[]
  checked: Set<OptionId>
  onToggle: (id: OptionId, value: boolean) => void
  /** Which groups to render — omit to render all. */
  visibleGroups?: InjectOptionGroup[]
  /** "compact" for Popover (22rem), "full" for Dialog (max-w-2xl). */
  variant: "compact" | "full"
  /** i18n group label resolver. */
  groupLabelResolver: (group: InjectOptionGroup) => string
  /** Empty-state messages per group. */
  emptyMessages?: Partial<Record<InjectOptionGroup, string>>
  /** Optional KB doc search state. */
  kbDocSearchQuery?: string
  onKbDocSearchChange?: (query: string) => void
}

function optionIcon(option: InjectOption) {
  if (option.group === "conversations") return MessageSquare
  if (option.group === "kb_docs") return BookOpen
  if (option.group === "attachments") return Paperclip
  if (option.docPath) return FileText
  return null
}

export function InjectOptionList({
  options,
  checked,
  onToggle,
  visibleGroups,
  variant,
  groupLabelResolver,
  emptyMessages,
  kbDocSearchQuery,
  onKbDocSearchChange,
}: InjectOptionListProps) {
  const groups = visibleGroups ?? ALL_GROUPS

  const grouped = useMemo(
    () =>
      options.reduce<Record<InjectOptionGroup, InjectOption[]>>(
        (acc, option) => {
          if (!acc[option.group]) acc[option.group] = []
          acc[option.group].push(option)
          return acc
        },
        {} as Record<InjectOptionGroup, InjectOption[]>
      ),
    [options]
  )

  const isCompact = variant === "compact"

  return (
    <div className={cn("flex flex-col gap-3", isCompact ? "gap-2" : "gap-4")}>
      {groups.map((group) => {
        const items = grouped[group]
        const isEmpty = !items || items.length === 0
        const emptyMsg = emptyMessages?.[group]
        const isCardGroup = CARD_GROUPS.includes(group)

        // Groups that should always render a bordered card area
        if (isCardGroup) {
          return (
            <section key={group} className="space-y-1.5">
              <h3
                className={cn(
                  "font-medium uppercase text-muted-foreground",
                  isCompact ? "text-[0.6875rem]" : "text-xs"
                )}
              >
                {groupLabelResolver(group)}
              </h3>

              {/* KB doc search input — above the card container */}
              {group === "kb_docs" &&
                !isEmpty &&
                kbDocSearchQuery !== undefined &&
                onKbDocSearchChange && (
                  <div className="relative">
                    <BookOpen className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className={cn(
                        "pl-7",
                        isCompact ? "h-7 text-xs" : "h-8 text-sm"
                      )}
                      placeholder={groupLabelResolver("kb_docs")}
                      value={kbDocSearchQuery}
                      onChange={(e) => onKbDocSearchChange(e.target.value)}
                    />
                  </div>
                )}

              <div
                className={cn(
                  "rounded-md border",
                  isEmpty ? "bg-muted/30 p-3" : ""
                )}
              >
                {isEmpty ? (
                  <p
                    className={cn(
                      "text-center text-muted-foreground",
                      isCompact ? "text-[0.6875rem]" : "text-xs"
                    )}
                  >
                    {emptyMsg ?? ""}
                  </p>
                ) : (
                  <div
                    className={cn(
                      "space-y-1",
                      isCompact ? "space-y-0.5" : "space-y-1.5"
                    )}
                  >
                    {items.map((option) => {
                      const OptIcon = optionIcon(option)
                      return (
                        <label
                          key={option.id}
                          className={cn(
                            "flex cursor-pointer items-start rounded-md border",
                            "hover:bg-accent/50",
                            isCompact ? "gap-2 p-2" : "gap-3 p-3"
                          )}
                        >
                          <Checkbox
                            checked={checked.has(option.id)}
                            onCheckedChange={(value) =>
                              onToggle(option.id, value === true)
                            }
                            className={cn("mt-0.5", isCompact && "h-3.5 w-3.5")}
                          />
                          <span className="flex min-w-0 flex-1 gap-2">
                            {OptIcon && (
                              <OptIcon
                                className={cn(
                                  "mt-0.5 shrink-0 text-muted-foreground",
                                  isCompact ? "h-3.5 w-3.5" : "h-4 w-4"
                                )}
                              />
                            )}
                            <span className="min-w-0">
                              <span
                                className={cn(
                                  "block truncate font-medium",
                                  isCompact ? "text-[0.8125rem]" : "text-sm"
                                )}
                              >
                                {option.label}
                              </span>
                              <span
                                className={cn(
                                  "mt-0.5 block text-muted-foreground",
                                  isCompact ? "text-[0.6875rem]" : "text-xs"
                                )}
                              >
                                {option.description}
                              </span>
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>
          )
        }

        // Non-card groups: hide when empty unless there's an emptyMsg
        if (isEmpty) {
          if (emptyMsg) {
            return (
              <section key={group}>
                <h3
                  className={cn(
                    "font-medium uppercase text-muted-foreground",
                    isCompact ? "text-[0.6875rem]" : "text-xs"
                  )}
                >
                  {groupLabelResolver(group)}
                </h3>
                <p
                  className={cn(
                    "text-muted-foreground",
                    isCompact ? "text-[0.6875rem]" : "text-xs"
                  )}
                >
                  {emptyMsg}
                </p>
              </section>
            )
          }
          return null
        }

        return (
          <section key={group} className="space-y-1.5">
            <h3
              className={cn(
                "font-medium uppercase text-muted-foreground",
                isCompact ? "text-[0.6875rem]" : "text-xs"
              )}
            >
              {groupLabelResolver(group)}
            </h3>

            <div
              className={cn(
                "space-y-1",
                isCompact ? "space-y-0.5" : "space-y-1.5"
              )}
            >
              {items.map((option) => {
                const OptIcon = optionIcon(option)
                return (
                  <label
                    key={option.id}
                    className={cn(
                      "flex cursor-pointer items-start rounded-md border",
                      "hover:bg-accent/50",
                      isCompact ? "gap-2 p-2" : "gap-3 p-3"
                    )}
                  >
                    <Checkbox
                      checked={checked.has(option.id)}
                      onCheckedChange={(value) =>
                        onToggle(option.id, value === true)
                      }
                      className={cn("mt-0.5", isCompact && "h-3.5 w-3.5")}
                    />
                    <span className="flex min-w-0 flex-1 gap-2">
                      {OptIcon && (
                        <OptIcon
                          className={cn(
                            "mt-0.5 shrink-0 text-muted-foreground",
                            isCompact ? "h-3.5 w-3.5" : "h-4 w-4"
                          )}
                        />
                      )}
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "block truncate font-medium",
                            isCompact ? "text-[0.8125rem]" : "text-sm"
                          )}
                        >
                          {option.label}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 block text-muted-foreground",
                            isCompact ? "text-[0.6875rem]" : "text-xs"
                          )}
                        >
                          {option.description}
                        </span>
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
