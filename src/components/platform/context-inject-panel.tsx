"use client"

import { useMemo, useState } from "react"
import { ClipboardList } from "lucide-react"
import { useTranslations } from "next-intl"
import type { AgentType } from "@/lib/types"
import { AGENT_LABELS } from "@/lib/types"
import { useAcpAgents } from "@/hooks/use-acp-agents"
import { AgentIcon } from "@/components/agent-icon"
import type {
  KnowledgeDocInfo,
  TaskConversationInfo,
  TaskInfo,
} from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { InjectOptionList } from "@/components/platform/inject-option-list"
import {
  buildInjectOptions,
  buildPayloadFromOptions,
  type ContextInjectPayload,
  type InjectOptionGroup,
  type OptionId,
  type InjectOption,
  type InjectI18nFn,
} from "@/components/platform/context-inject-panel-utils"

export type { ContextInjectPayload, OptionId, InjectOption }

interface ContextInjectPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: TaskInfo
  conversations: TaskConversationInfo[]
  kbDocs: KnowledgeDocInfo[]
  attachments: KnowledgeDocInfo[]
  kbLoading?: boolean
  submitting?: boolean
  /** KB directory path relative to the project root (e.g., "_knowledge").
   *  Used to prefix doc filePaths so they become project-root-relative. */
  kbDirPrefix?: string
  /** Project's default agent type — used as the initial selection. */
  defaultAgentType?: AgentType | null
  onConfirm: (payload: ContextInjectPayload, agentType: AgentType) => void
}

export function ContextInjectPanel({
  open,
  onOpenChange,
  task,
  conversations,
  kbDocs,
  attachments,
  kbLoading,
  submitting,
  kbDirPrefix,
  defaultAgentType,
  onConfirm,
}: ContextInjectPanelProps) {
  const t = useTranslations("Platform.inject")
  const { agents: rawAgents } = useAcpAgents()
  const agents = useMemo(
    () => rawAgents.filter((a) => a.enabled && a.available),
    [rawAgents]
  )

  // Resolve the initial agent type: project default → first available →
  // AGENT_DISPLAY_ORDER[0] (claude_code).
  const initialAgentType = useMemo<AgentType>(() => {
    if (defaultAgentType) {
      const found = agents.find((a) => a.agent_type === defaultAgentType)
      if (found) return found.agent_type
    }
    const first = agents[0]
    return first?.agent_type ?? "claude_code"
  }, [defaultAgentType, agents])

  const [selectedAgentType, setSelectedAgentType] = useState<AgentType | null>(
    null
  )

  // The effective agent type: if the user has explicitly selected one (non-null),
  // use it (with availability check); otherwise use the project default.
  const effectiveAgentType = useMemo<AgentType>(() => {
    if (selectedAgentType) {
      const found = agents.find((a) => a.agent_type === selectedAgentType)
      if (found) return found.agent_type
    }
    return initialAgentType
  }, [selectedAgentType, agents, initialAgentType])

  const options = useMemo<InjectOption[]>(
    () =>
      buildInjectOptions(
        task,
        kbDocs,
        attachments,
        conversations,
        t as InjectI18nFn,
        kbDirPrefix
      ),
    [conversations, kbDocs, attachments, task, t, kbDirPrefix]
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
  const [kbDocSearchQuery, setKbDocSearchQuery] = useState("")

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

  // Filter kb_docs options by search query
  const filteredOptions = useMemo(() => {
    if (!kbDocSearchQuery) return options
    const q = kbDocSearchQuery.toLowerCase()
    return options.filter(
      (opt) =>
        opt.group !== "kb_docs" ||
        opt.label.toLowerCase().includes(q) ||
        opt.description.toLowerCase().includes(q)
    )
  }, [kbDocSearchQuery, options])

  const groupLabelResolver = (group: InjectOptionGroup) =>
    t(`groupLabel.${group}`)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-lg grid grid-rows-[auto_1fr_auto] max-h-[calc(100dvh-2rem)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" />
            {t("createConversation")}
          </DialogTitle>
          <DialogDescription>{t("selectContext")}</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto min-h-0 py-2">
          {kbLoading ? (
            <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
              {t("loading")}
            </div>
          ) : (
            <InjectOptionList
              options={filteredOptions}
              checked={checked}
              onToggle={toggle}
              variant="full"
              groupLabelResolver={groupLabelResolver}
              emptyMessages={{
                kb_docs: t("noDocs"),
                attachments: t("noAttachments"),
              }}
              kbDocSearchQuery={kbDocSearchQuery}
              onKbDocSearchChange={setKbDocSearchQuery}
            />
          )}
        </div>

        {/* Agent type selector + action buttons */}
        <div className="mt-4 shrink-0 flex flex-col gap-3">
          {agents.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[0.75rem] text-muted-foreground shrink-0">
                {t("agentType")}
              </span>
              <Select
                value={effectiveAgentType}
                onValueChange={(v) => setSelectedAgentType(v as AgentType)}
              >
                <SelectTrigger className="h-7 text-[0.8125rem] w-auto min-w-[10rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.agent_type} value={agent.agent_type}>
                      <span className="flex items-center gap-1.5">
                        <AgentIcon
                          agentType={agent.agent_type}
                          className="w-3.5 h-3.5 shrink-0"
                        />
                        {AGENT_LABELS[agent.agent_type]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={() => onConfirm(buildPayload(), effectiveAgentType)}
              disabled={submitting}
            >
              {t("createConversation")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
