import { describe, it, expect } from "vitest"
import { parseDiffFileSections } from "./diff-files"

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 const a = 1
-old
+new
+added
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+hello
diff --git a/deleted.ts b/deleted.ts
deleted file mode 100644
index 3333333..0000000
--- a/deleted.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old-name.ts b/new-name.ts
similarity index 90%
rename from old-name.ts
rename to new-name.ts
`

describe("parseDiffFileSections", () => {
  it("returns nothing for an empty diff", () => {
    expect(parseDiffFileSections("")).toEqual([])
  })

  it("splits files and computes status + line counts", () => {
    const sections = parseDiffFileSections(DIFF)
    expect(sections.map((s) => s.change.path)).toEqual([
      "src/a.ts",
      "src/new.ts",
      "deleted.ts",
      "new-name.ts",
    ])

    const [modified, added, deleted, renamed] = sections
    expect(modified.change).toMatchObject({
      status: "M",
      additions: 2,
      deletions: 1,
    })
    expect(added.change).toMatchObject({
      status: "A",
      additions: 1,
      deletions: 0,
    })
    expect(deleted.change).toMatchObject({
      status: "D",
      additions: 0,
      deletions: 1,
    })
    expect(renamed.change).toMatchObject({ status: "R" })
  })

  it("keeps each file's own diff text", () => {
    const sections = parseDiffFileSections(DIFF)
    expect(sections[0].text).toContain("+added")
    expect(sections[0].text).not.toContain("hello")
  })
})
