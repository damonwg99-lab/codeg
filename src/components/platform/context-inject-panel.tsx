"use client"

import { useMemo, useState } from "react"
import { FileText, MessageSquare, ClipboardList } from "lucide-react"
import type {
  ProjectInfo,
  ProjectRepoInfo,
  TaskConversationInfo,
  TaskInfo,
} from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  buildInjectOptions,
  buildPayloadFromOptions,
  optionGroupLabel,
  type ContextInjectPayload,
  type OptionId,
  type InjectOption,
} from "@/components/platform/context-inject-panel-utils"

export type { ContextInjectPayload, OptionId, InjectOption }

interface ContextInjectPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: TaskInfo
  project: ProjectInfo | null
  repos: ProjectRepoInfo[]
  conversations: TaskConversationInfo[]
  submitting?: boolean
  onConfirm: (payload: ContextInjectPayload) => void
}

export function ContextInjectPanel({
  open,
  onOpenChange,
  task,
  project,
  repos,
  conversations,
  submitting,
  onConfirm,
}: ContextInjectPanelProps) {
  const options = useMemo<InjectOption[]>(
    () => buildInjectOptions(task, project, repos, conversations),
    [conversations, project, repos, task]
  )

  const defaultIds = useMemo(
    () =>
      new Set<OptionId>(
        options
          .filter((option) => option.defaultChecked)
          .map((option) => option.id)
      ),
    [options]
  )
  const [checked, setChecked] = useState<Set<OptionId>>(defaultIds)

  const grouped = useMemo(
    () =>
      options.reduce<Record<InjectOption["group"], InjectOption[]>>(
        (acc, option) => {
          acc[option.group].push(option)
          return acc
        },
        { basic: [], project: [], repos: [], conversations: [] }
      ),
    [options]
  )

  function toggle(id: OptionId, value: boolean) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function buildPayload(): ContextInjectPayload {
    return buildPayloadFromOptions(options, checked)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" />
            Create Task Conversation
          </DialogTitle>
          <DialogDescription>
            Select the context to attach before creating the conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{task.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {task.taskType} / {task.status}
                </div>
              </div>
              {task.priority && (
                <Badge variant="outline" className="shrink-0">
                  {task.priority}
                </Badge>
              )}
            </div>
          </div>

          {(["basic", "project", "repos", "conversations"] as const).map(
            (group) => {
              const items = grouped[group]
              if (items.length === 0) return null
              return (
                <section key={group} className="space-y-2">
                  <h3 className="text-xs font-medium uppercase text-muted-foreground">
                    {optionGroupLabel(group)}
                  </h3>
                  <div className="space-y-1.5">
                    {items.map((option) => (
                      <label
                        key={option.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-md border p-3",
                          "hover:bg-accent/50"
                        )}
                      >
                        <Checkbox
                          checked={checked.has(option.id)}
                          onCheckedChange={(value) =>
                            toggle(option.id, value === true)
                          }
                          className="mt-0.5"
                        />
                        <span className="flex min-w-0 flex-1 gap-2">
                          {option.docPath ? (
                            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : option.group === "conversations" ? (
                            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : null}
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {option.label}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {option.description}
                            </span>
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              )
            }
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(buildPayload())}
            disabled={submitting}
          >
            Create Conversation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
