/**
 * Shared utilities for context inject panels (Dialog and Popover variants).
 * Extracted from context-inject-panel.tsx so both components can reuse
 * the same option-building and payload-construction logic.
 */

import type {
  ProjectInfo,
  ProjectRepoInfo,
  TaskConversationInfo,
  TaskInfo,
} from "@/lib/platform/types"

export type OptionId =
  | "taskDescription"
  | "taskStatus"
  | "projectInfo"
  | `repo:${number}`
  | `conversation:${number}`

export interface InjectOption {
  id: OptionId
  label: string
  description: string
  defaultChecked: boolean
  group: "basic" | "project" | "repos" | "conversations"
  docPath?: string
  prefixLine?: string
}

export interface ContextInjectPayload {
  prefix: string
  injectedDocsJson: string
}

export function optionGroupLabel(group: InjectOption["group"]): string {
  switch (group) {
    case "basic":
      return "Basic"
    case "project":
      return "Project"
    case "repos":
      return "Repository Context"
    case "conversations":
      return "Linked Conversations"
  }
}

/**
 * Build the full list of inject options for a given task, project, repos,
 * and linked conversations.  Used by both ContextInjectPanel (Dialog) and
 * TaskContextPopover (Popover).
 */
export function buildInjectOptions(
  task: TaskInfo,
  project: ProjectInfo | null,
  repos: ProjectRepoInfo[],
  conversations: TaskConversationInfo[]
): InjectOption[] {
  const next: InjectOption[] = [
    {
      id: "taskDescription",
      label: "Task description",
      description: "Include the task title and description inline.",
      defaultChecked: true,
      group: "basic",
      prefixLine: `Task: ${task.title}${task.description ? `\nDescription: ${task.description}` : ""}`,
    },
    {
      id: "taskStatus",
      label: "Status and priority",
      description: "Include status, type, priority, and assignee inline.",
      defaultChecked: true,
      group: "basic",
      prefixLine: [
        `Type: ${task.taskType}`,
        `Status: ${task.status}`,
        task.priority ? `Priority: ${task.priority}` : null,
        task.assignee ? `Assignee: ${task.assignee}` : null,
      ]
        .filter(Boolean)
        .join(" / "),
    },
  ]

  if (project) {
    next.push({
      id: "projectInfo",
      label: "Project name and client",
      description: "Include the active project identity inline.",
      defaultChecked: true,
      group: "project",
      prefixLine: [
        `Project: ${project.name}`,
        project.clientName ? `Client: ${project.clientName}` : null,
        `Root: ${project.rootDir}`,
      ]
        .filter(Boolean)
        .join(" / "),
    })
  }

  for (const repo of repos) {
    if (!repo.hasClaudeMd) continue
    const path = `${repo.localDir.replace(/[\\/]+$/, "")}/CLAUDE.md`
    next.push({
      id: `repo:${repo.id}`,
      label: `${repo.name}/CLAUDE.md`,
      description: "Record the path so the agent can read it when needed.",
      defaultChecked: true,
      group: "repos",
      docPath: path,
      prefixLine: `Repository guide: ${path}`,
    })
  }

  for (const conversation of conversations) {
    if (!conversation.summary) continue
    next.push({
      id: `conversation:${conversation.id}`,
      label: `Conversation #${conversation.conversationId}`,
      description: conversation.summary,
      defaultChecked: false,
      group: "conversations",
      prefixLine: `Previous conversation summary: ${conversation.summary}`,
    })
  }

  return next
}

/**
 * Construct the ContextInjectPayload from selected options.
 */
export function buildPayloadFromOptions(
  options: InjectOption[],
  checked: Set<OptionId>
): ContextInjectPayload {
  const selected = options.filter((option) => checked.has(option.id))
  const prefixLines = selected
    .map((option) => option.prefixLine)
    .filter((line): line is string => Boolean(line))
  const docs = selected
    .filter((option) => option.docPath)
    .map((option) => ({
      type: "path",
      path: option.docPath,
      label: option.label,
    }))

  return {
    prefix:
      prefixLines.length > 0
        ? ["[Task Context]", ...prefixLines, "---"].join("\n")
        : "",
    injectedDocsJson: JSON.stringify(docs),
  }
}
