import { describe, expect, it } from "vitest"
import { filterFileEntriesForSearch } from "./file-search-filter"
import type { FlatFileEntry } from "@/hooks/use-file-tree"

function entry(
  name: string,
  relativePath = name,
  kind: "file" | "dir" = "file"
): FlatFileEntry {
  return {
    name,
    relativePath,
    kind,
    lowerName: name.toLowerCase(),
    lowerPath: relativePath.toLowerCase(),
  }
}

describe("filterFileEntriesForSearch", () => {
  describe("empty query (browse mode)", () => {
    it("hides dotfiles and .json entries, sorts by name, caps at the limit", () => {
      const files = [
        entry("zebra.ts"),
        entry(".hidden"),
        entry("pkg.json"),
        entry("alpha.tsx"),
        entry(".env.local"),
      ]
      const result = filterFileEntriesForSearch("", files)
      expect(result.map((f) => f.name)).toEqual(["alpha.tsx", "zebra.ts"])
    })

    it("respects the limit", () => {
      const files = Array.from({ length: 150 }, (_, i) => entry(`f${i}.ts`))
      expect(filterFileEntriesForSearch("", files)).toHaveLength(100)
      expect(filterFileEntriesForSearch("", files, 3)).toHaveLength(3)
    })

    it("keeps directories in browse mode", () => {
      const files = [entry("src", "src", "dir"), entry("README.md")]
      expect(filterFileEntriesForSearch("", files).map((f) => f.name)).toEqual([
        "README.md",
        "src",
      ])
    })
  })

  describe("non-empty query (substring match)", () => {
    it("matches against the precomputed lowercase name or path", () => {
      const files = [
        entry("Alpha.ts", "src/Alpha.ts"),
        entry("beta.ts", "lib/BETA.ts"),
        entry("gamma.md", "docs/gamma.md"),
      ]
      const result = filterFileEntriesForSearch("TS", files)
      expect(result.map((f) => f.relativePath)).toEqual([
        "src/Alpha.ts",
        "lib/BETA.ts",
      ])
    })

    it("matches path segments, not just names", () => {
      const files = [entry("index.ts", "src/components/index.ts")]
      expect(filterFileEntriesForSearch("components", files)).toHaveLength(1)
    })

    it("stops at the limit without scanning the rest", () => {
      const files = Array.from({ length: 50 }, (_, i) => entry(`a${i}.ts`))
      expect(filterFileEntriesForSearch("a", files)).toHaveLength(50)
      expect(filterFileEntriesForSearch("a", files, 5)).toHaveLength(5)
    })

    it("returns empty for a whitespace-only query via browse mode, not match", () => {
      const files = [entry("zebra.ts")]
      // "   " trims to empty → browse mode → zebra survives (no dotfile/json)
      expect(filterFileEntriesForSearch("   ", files).map((f) => f.name)).toEqual(
        ["zebra.ts"]
      )
    })
  })
})
