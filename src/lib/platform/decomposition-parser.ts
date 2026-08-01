/**
 * Decomposition parser — detects and extracts structured sub-task proposals
 * from AI assistant messages.
 *
 * When the user expresses a decomposition intent (keywords like "分解",
 * "拆分", "decompose", etc.), the frontend appends a lightweight instruction
 * to the prompt asking the AI to output sub-tasks in a specific JSON format
 * wrapped in a ```task_decomposition_json code fence.
 *
 * This module provides:
 * 1. Intent detection (hasDecompositionIntent)
 * 2. JSON extraction (parseDecompositionFromText)
 * 3. The instruction text (DECOMPOSITION_INSTRUCTION)
 */

// ─── Intent Detection ───

/** Keywords (Chinese + English) that signal the user wants task decomposition. */
export const DECOMPOSITION_KEYWORDS = [
  "分解",
  "拆分",
  "子任务",
  "细化",
  "拆解",
  "分析并提出任务",
  "decompose",
  "break down",
  "sub-tasks",
  "subtasks",
  "split into tasks",
  "task breakdown",
  "propose tasks",
  "create tasks from",
]

/**
 * Check whether the user's message text contains decomposition intent.
 * Case-insensitive; returns true if any keyword appears as a substring.
 */
export function hasDecompositionIntent(text: string): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return DECOMPOSITION_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()))
}

// ─── Proposed Sub-Task Model ───

export interface ProposedSubTask {
  title: string
  description: string
  taskType: string // default "task"
  priority: string // default "medium"
}

const DEFAULT_TASK_TYPE = "task"
const DEFAULT_PRIORITY = "medium"
const VALID_TASK_TYPES = ["bug", "feature", "task", "improvement"]
const VALID_PRIORITIES = ["low", "medium", "high", "urgent"]

/** Normalise and fill defaults for a raw sub-task entry from AI output. */
function normalizeEntry(
  entry: Record<string, unknown>
): ProposedSubTask | null {
  const title = typeof entry.title === "string" ? entry.title.trim() : ""
  if (!title) return null

  const description =
    typeof entry.description === "string" ? entry.description.trim() : ""

  const rawType =
    typeof entry.taskType === "string"
      ? entry.taskType.trim().toLowerCase()
      : ""
  const taskType = VALID_TASK_TYPES.includes(rawType)
    ? rawType
    : DEFAULT_TASK_TYPE

  const rawPriority =
    typeof entry.priority === "string"
      ? entry.priority.trim().toLowerCase()
      : ""
  const priority = VALID_PRIORITIES.includes(rawPriority)
    ? rawPriority
    : DEFAULT_PRIORITY

  return { title, description, taskType, priority }
}

// ─── Instruction ───

/**
 * Instruction appended to the prompt when the user expresses decomposition intent.
 *
 * Provides BOTH paths so the AI can choose based on its capabilities:
 * - Primary: call the `create_task_decomposition` MCP tool (reliable, JSON guaranteed)
 * - Fallback: output a ```task_decomposition_json code fence (for agents that
 *   can't or won't call MCP tools)
 *
 * The frontend detects both paths:
 *   tool_call block → parseDecompositionToolInput (primary)
 *   text fence      → extractDecompositionSegments (fallback)
 */
export const DECOMPOSITION_INSTRUCTION = `[系统指令：当提出任务分解时，请优先调用 create_task_decomposition 工具传入子任务列表。如果无法调用该工具（如不在可用工具列表中），请在回复末尾的 \`\`\`task_decomposition_json 代码块中输出 JSON。格式为 {"subTasks":[{"title":"任务标题（中文）","description":"任务描述（中文）","taskType":"bug|feature|task|improvement","priority":"low|medium|high|urgent"}]}。title 和 description 必须用中文填写。]`

// ─── JSON Extraction ───

/**
 * Parse a ```task_decomposition_json code fence from text.
 * Falls back to generic ```json fences containing a "subTasks" key.
 *
 * Returns null if no valid decomposition is found.
 */
export function parseDecompositionFromText(
  text: string
): ProposedSubTask[] | null {
  if (!text) return null

  // Strategy 1: explicit ```task_decomposition_json fence
  const explicitMatch = extractCodeFence(text, "task_decomposition_json")
  if (explicitMatch) {
    const parsed = tryParseSubTasksJson(explicitMatch)
    if (parsed && parsed.length > 0) return parsed
  }

  // Strategy 2: generic ```json fence containing "subTasks"
  const genericMatches = extractAllCodeFences(text, "json")
  for (const match of genericMatches) {
    const parsed = tryParseSubTasksJson(match)
    if (parsed && parsed.length > 0) return parsed
  }

  return null
}

// ─── Text Segmentation ───

/**
 * A segment produced by splitting text around decomposition code fences.
 * Text segments carry raw prose; decomposition segments carry parsed sub-tasks.
 */
export interface DecompositionSegment {
  kind: "text" | "decomposition"
  /** Raw prose for text segments; raw JSON string for decomposition segments. */
  value: string
  /** Parsed sub-tasks (only set when kind === "decomposition"). */
  tasks?: ProposedSubTask[]
}

/**
 * Split text into alternating text / decomposition segments by extracting
 * all ```task_decomposition_json code fences. Each matched fence becomes a
 * "decomposition" segment with parsed sub-tasks; the surrounding prose
 * becomes "text" segments.
 *
 * Returns `null` if no decomposition fences are found (so callers can skip
 * processing and let the default text rendering path continue).
 */
export function extractDecompositionSegments(
  text: string
): DecompositionSegment[] | null {
  if (!text) return null

  const pattern = /```task_decomposition_json\s*\n([\s\S]*?)\n\s*```/g
  const segments: DecompositionSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let foundAny = false

  while ((match = pattern.exec(text)) !== null) {
    foundAny = true
    // Text before this match
    const before = text.slice(lastIndex, match.index)
    if (before) {
      segments.push({ kind: "text", value: before })
    }

    // Parse the JSON content
    const jsonContent = match[1]
    const parsed = tryParseSubTasksJson(jsonContent)
    if (parsed && parsed.length > 0) {
      segments.push({
        kind: "decomposition",
        value: jsonContent,
        tasks: parsed,
      })
    } else {
      // Failed to parse — keep the raw code block as text so it renders
      // as a fallback code block rather than disappearing entirely
      segments.push({ kind: "text", value: match[0] })
    }

    lastIndex = match.index + match[0].length
  }

  if (!foundAny) return null

  // Trailing text after the last match
  const trailing = text.slice(lastIndex)
  if (trailing) {
    segments.push({ kind: "text", value: trailing })
  }

  return segments
}

// ─── Internal helpers ───

/** Extract content of the first ```lang code fence in text. */
function extractCodeFence(text: string, lang: string): string | null {
  // Match ```lang ... ``` (fence may be ~-decorated)
  const pattern = new RegExp(
    "```" + lang + "\\s*\\n([\\s\\S]*?)\\n\\s*```",
    "m"
  )
  const m = pattern.exec(text)
  return m ? m[1] : null
}

/** Extract content of ALL ```lang code fences in text. */
function extractAllCodeFences(text: string, lang: string): string[] {
  const pattern = new RegExp(
    "```" + lang + "\\s*\\n([\\s\\S]*?)\\n\\s*```",
    "gm"
  )
  const results: string[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    results.push(m[1])
  }
  return results
}

/** Try to parse a JSON string as { subTasks: [...] }. */
export function tryParseSubTasksJson(
  jsonStr: string
): ProposedSubTask[] | null {
  try {
    const obj = JSON.parse(jsonStr)
    if (!obj || typeof obj !== "object") return null

    // Accept both { subTasks: [...] } and bare [...]
    const arr: unknown[] = Array.isArray(obj.subTasks)
      ? obj.subTasks
      : Array.isArray(obj)
        ? obj
        : null

    if (!arr || arr.length === 0) return null

    const normalized = arr
      .filter((e) => typeof e === "object" && e !== null)
      .map((e) => normalizeEntry(e as Record<string, unknown>))
      .filter((e): e is ProposedSubTask => e !== null)

    return normalized.length > 0 ? normalized : null
  } catch {
    return null
  }
}

// ─── MCP Tool Call Parsing (primary path) ───

/** Cast unknown to Record<string, unknown> if it's a plain object. */
function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    return v as Record<string, unknown>
  }
  return null
}

/**
 * Parse the raw_input of a `create_task_decomposition` tool call.
 * Returns `ProposedSubTask[]` if the input matches the expected schema,
 * or `null` if it doesn't (meaning this is NOT a decomposition tool call).
 *
 * This is the **primary** path: the MCP tool framework guarantees valid
 * JSON, so no regex is needed. Returns `null` (not an empty array) as an
 * identity signal — "this tool call is not a decomposition" vs "it is but
 * the content was invalid".
 */
export function parseDecompositionToolInput(
  rawInput: string | null | undefined
): ProposedSubTask[] | null {
  if (!rawInput) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(rawInput)
  } catch {
    return null
  }

  const obj = asRecord(parsed)
  if (!obj || !Array.isArray(obj.subTasks) || obj.subTasks.length === 0)
    return null

  // Validate each entry has a non-empty title (minimum requirement)
  const everyItemHasTitle = obj.subTasks.every((item: unknown) => {
    const record = asRecord(item)
    return (
      !!record &&
      typeof record.title === "string" &&
      record.title.trim().length > 0
    )
  })
  if (!everyItemHasTitle) return null

  // Normalize each entry using the existing normalizeEntry function
  return obj.subTasks
    .map((item: unknown) => normalizeEntry(asRecord(item) ?? {}))
    .filter((e: ProposedSubTask | null): e is ProposedSubTask => e !== null)
}
