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
 * Lightweight instruction appended to the prompt when the user expresses
 * decomposition intent. Instructs the AI to output a structured JSON block
 * at the end of its response.
 */
export const DECOMPOSITION_INSTRUCTION = `[SYSTEM: When proposing task decomposition, output a JSON block in a \`\`\`task_decomposition_json code fence at the END of your response with format: {"subTasks":[{"title":"...","description":"...","taskType":"bug|feature|task|improvement","priority":"low|medium|high|urgent"}]}]`

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
function tryParseSubTasksJson(jsonStr: string): ProposedSubTask[] | null {
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
