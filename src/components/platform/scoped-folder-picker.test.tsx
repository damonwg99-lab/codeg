import { render, screen, cleanup } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ScopedFolderPicker } from "./scoped-folder-picker"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import type { FolderDetail } from "@/lib/types"

// ---------------------------------------------------------------------------
// Mocks. The scoping inputs come from the platform context (mutated per test);
// folder state is seeded into the real zustand store. The upstream FolderPicker
// is a heavy cmdk popover — stub it and capture what ScopedFolderPicker forwards.
// ---------------------------------------------------------------------------

let activeProject: { folderId: number | null } | null = null
let activeProjectRepos: Array<{ folderId: number | null }> = []

vi.mock("@/contexts/platform-context", () => ({
  usePlatform: () => ({ activeProject, activeProjectRepos }),
}))

const folderPickerProps = vi.fn()

vi.mock("@/components/chat/conversation-context-bar", () => ({
  FolderPicker: (props: Record<string, unknown>) => {
    folderPickerProps(props)
    return <div data-testid="folder-picker-stub" />
  },
}))

function mkFolder(p: Partial<FolderDetail> & { id: number }): FolderDetail {
  return {
    name: `folder-${p.id}`,
    path: `/repo/folder-${p.id}`,
    git_branch: null,
    default_agent_type: null,
    last_opened_at: "2026-01-01T00:00:00Z",
    sort_order: p.id,
    color: "blue",
    parent_id: null,
    kind: "regular",
    alias: null,
    group_id: null,
    ...p,
  }
}

const root = mkFolder({ id: 1, name: "root", path: "/proj" })
const subRepo = mkFolder({
  id: 2,
  name: "sub",
  path: "/proj/sub",
  kind: "platform_repo",
})
const chatFolder = mkFolder({ id: 3, name: "chat", path: "/chat", kind: "chat" })

const baseProps = {
  currentFolderId: 1,
  currentFolderName: "root",
  title: "Folder: root",
  editable: true,
  onSelect: vi.fn(),
  labelEmpty: "empty",
  labelSearch: "search",
  labelChatMode: "chat mode",
  isChatMode: false,
  onSelectChatMode: vi.fn(),
}

beforeEach(() => {
  folderPickerProps.mockClear()
  activeProject = null
  activeProjectRepos = []
  resetAppWorkspaceStore()
  useAppWorkspaceStore.setState({ folders: [], allFolders: [] })
})

afterEach(() => cleanup())

describe("ScopedFolderPicker", () => {
  it("renders nothing when the scoped list is empty (no project, no folders)", () => {
    render(<ScopedFolderPicker {...baseProps} />)
    expect(screen.queryByTestId("folder-picker-stub")).toBeNull()
  })

  it("scopes to the project's root + sub-repos when a project is active", () => {
    activeProject = { folderId: 1 }
    activeProjectRepos = [{ folderId: 2 }]
    useAppWorkspaceStore.setState({ folders: [root], allFolders: [root, subRepo] })

    render(<ScopedFolderPicker {...baseProps} />)

    expect(screen.getByTestId("folder-picker-stub")).toBeTruthy()
    const props = folderPickerProps.mock.calls[0][0] as {
      folders: Array<{ id: number }>
    }
    expect(props.folders.map((f) => f.id)).toEqual([1, 2])
  })

  it("falls back to main's top-level non-chat repos with no active project", () => {
    useAppWorkspaceStore.setState({
      folders: [root, chatFolder],
      allFolders: [root, chatFolder],
    })

    render(<ScopedFolderPicker {...baseProps} />)

    const props = folderPickerProps.mock.calls[0][0] as {
      folders: Array<{ id: number }>
    }
    expect(props.folders.map((f) => f.id)).toEqual([1])
  })

  it("forwards the display props verbatim to FolderPicker", () => {
    useAppWorkspaceStore.setState({ folders: [root], allFolders: [root] })

    const onSelect = vi.fn()
    const onSelectChatMode = vi.fn()
    render(
      <ScopedFolderPicker
        {...baseProps}
        onSelect={onSelect}
        onSelectChatMode={onSelectChatMode}
        variant="header"
        alias="alias-a"
      />
    )

    const props = folderPickerProps.mock.calls[0][0] as Record<string, unknown>
    expect(props.currentFolderId).toBe(1)
    expect(props.currentFolderName).toBe("root")
    expect(props.title).toBe("Folder: root")
    expect(props.editable).toBe(true)
    expect(props.labelEmpty).toBe("empty")
    expect(props.labelSearch).toBe("search")
    expect(props.labelChatMode).toBe("chat mode")
    expect(props.isChatMode).toBe(false)
    expect(props.onSelect).toBe(onSelect)
    expect(props.onSelectChatMode).toBe(onSelectChatMode)
    expect(props.variant).toBe("header")
    expect(props.alias).toBe("alias-a")
  })
})
