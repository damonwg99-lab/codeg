import { describe, expect, it } from "vitest"
import {
  buildFolderProjectIndex,
  normalizeProjectPath,
  pickProjectAnchorFolder,
  resolveProjectForFolder,
  type FolderLike,
} from "./folder-project-mapping"
import type { ProjectInfo, ProjectRepoInfo } from "@/lib/platform/types"

function mkProject(
  overrides: Partial<ProjectInfo> & { id: number }
): ProjectInfo {
  return {
    name: `project-${overrides.id}`,
    description: null,
    clientName: null,
    status: "planning",
    rootDir: "",
    folderId: null,
    zentaoProjectId: null,
    zentaoProductId: null,
    jenkinsUrl: null,
    kbRepoUrl: null,
    kbLocalDir: null,
    defaultAgentType: null,
    delegationConfig: null,
    agentConfigJson: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  }
}

function mkRepo(
  overrides: Partial<ProjectRepoInfo> & { id: number }
): ProjectRepoInfo {
  return {
    projectId: 1,
    name: `repo-${overrides.id}`,
    gitUrl: null,
    localDir: "",
    branch: null,
    hasClaudeMd: false,
    folderId: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  }
}

// Folder ids: 1 = project root, 2 = repo A, 3 = repo B, 9/10 = worktrees.
const projects = [
  mkProject({ id: 1, rootDir: "D:\\Work\\Alpha", folderId: 1 }),
  mkProject({ id: 2, rootDir: "D:/Work/Beta", folderId: 11 }),
]

const reposByProject = new Map<number, ProjectRepoInfo[]>([
  [
    1,
    [
      mkRepo({
        id: 101,
        projectId: 1,
        localDir: "D:\\Work\\Alpha\\svc-a",
        folderId: 2,
      }),
      mkRepo({
        id: 102,
        projectId: 1,
        localDir: "D:/Work/Alpha/svc-b",
        folderId: 3,
      }),
    ],
  ],
  [
    2,
    [
      mkRepo({
        id: 201,
        projectId: 2,
        localDir: "D:/Work/Beta/api",
        folderId: 12,
      }),
    ],
  ],
])

const folders: FolderLike[] = [
  { id: 1, path: "D:\\Work\\Alpha", parent_id: null },
  { id: 2, path: "D:\\Work\\Alpha\\svc-a", parent_id: null },
  { id: 3, path: "D:/Work/Alpha/svc-b", parent_id: null },
  // Worktree of repo A, and a nested worktree of that worktree.
  { id: 9, path: "D:\\Work\\Alpha\\svc-a-wt", parent_id: 2 },
  { id: 10, path: "D:\\Work\\Alpha\\svc-a-wt\\nested", parent_id: 9 },
  // Unregistered sub-directory under the project root (no folder_id on a repo).
  { id: 4, path: "D:\\Work\\Alpha\\unregistered", parent_id: null },
  { id: 11, path: "D:/Work/Beta", parent_id: null },
  { id: 12, path: "D:/Work/Beta/api", parent_id: null },
  // Freely opened directory outside any project.
  { id: 5, path: "D:\\Other\\standalone", parent_id: null },
]

const index = buildFolderProjectIndex(projects, reposByProject)

describe("normalizeProjectPath", () => {
  it("unifies separators, trailing slashes and case", () => {
    expect(normalizeProjectPath(" D:\\Work\\Alpha\\ ")).toBe("d:/work/alpha")
    expect(normalizeProjectPath("D:/Work/Alpha/")).toBe("d:/work/alpha")
    expect(normalizeProjectPath(null)).toBe("")
  })
})

describe("resolveProjectForFolder", () => {
  it("resolves the project root by exact folderId", () => {
    expect(resolveProjectForFolder(folders[0], folders, index)).toBe(1)
    expect(resolveProjectForFolder(folders[6], folders, index)).toBe(2)
  })

  it("resolves registered sub-repo folders", () => {
    expect(resolveProjectForFolder(folders[1], folders, index)).toBe(1)
    expect(resolveProjectForFolder(folders[2], folders, index)).toBe(1)
    expect(resolveProjectForFolder(folders[7], folders, index)).toBe(2)
  })

  it("resolves worktree folders via the parent chain", () => {
    expect(resolveProjectForFolder(folders[3], folders, index)).toBe(1)
    expect(resolveProjectForFolder(folders[4], folders, index)).toBe(1)
  })

  it("falls back to path-prefix matching for unregistered folders", () => {
    expect(resolveProjectForFolder(folders[5], folders, index)).toBe(1)
  })

  it("returns null for folders outside every project", () => {
    expect(resolveProjectForFolder(folders[8], folders, index)).toBeNull()
    expect(resolveProjectForFolder(null, folders, index)).toBeNull()
  })

  it("prefers the deepest overlapping root", () => {
    // A repo nested inside another project's root must resolve to the repo's
    // own project, not the outer one.
    const outer = [mkProject({ id: 1, rootDir: "D:/Work" })]
    const inner = [
      mkProject({ id: 2, rootDir: "D:/Work" }),
      mkProject({ id: 3, rootDir: "D:/Work/nested-repo" }),
    ]
    const idx = buildFolderProjectIndex([...outer, ...inner], new Map())
    const folder: FolderLike = {
      id: 99,
      path: "D:/Work/nested-repo/x",
      parent_id: null,
    }
    expect(resolveProjectForFolder(folder, [folder], idx)).toBe(3)
  })
})

describe("pickProjectAnchorFolder", () => {
  it("prefers the project root folder", () => {
    expect(pickProjectAnchorFolder(projects[0], folders, index)?.id).toBe(1)
    expect(pickProjectAnchorFolder(projects[1], folders, index)?.id).toBe(11)
  })

  it("falls back to a sub-repo folder when the root is not open", () => {
    const withoutRoot = folders.filter((f) => f.id !== 1)
    expect(pickProjectAnchorFolder(projects[0], withoutRoot, index)?.id).toBe(2)
  })

  it("returns null when the project has no open folder", () => {
    expect(pickProjectAnchorFolder(projects[0], [], index)).toBeNull()
  })
})
