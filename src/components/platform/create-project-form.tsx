"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { FolderOpen, Loader2, Check } from "lucide-react"
import { createProject, scanGitRepos } from "@/lib/platform/api"
import type { GitRepoScanResult } from "@/lib/platform/types"
import { openFileDialog, isDesktop } from "@/lib/platform"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export function CreateProjectForm() {
  const t = useTranslations("Platform")
  const router = useRouter()

  // Form state
  const [name, setName] = useState("")
  const [rootDir, setRootDir] = useState("")
  const [description, setDescription] = useState("")
  const [clientName, setClientName] = useState("")
  const [defaultAgentType, setDefaultAgentType] = useState<string>("")

  // Scan state
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<GitRepoScanResult[]>([])
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set())
  const [scanError, setScanError] = useState<string | null>(null)

  // Create state
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const handleBrowse = useCallback(async () => {
    const result = await openFileDialog({
      directory: true,
      title: t("project.rootDir"),
    })
    if (result && typeof result === "string") {
      setRootDir(result)
      // Auto-clear previous scan results when directory changes
      setScanResults([])
      setSelectedRepos(new Set())
      setScanError(null)
    }
  }, [t])

  const handleScan = useCallback(async () => {
    if (!rootDir) return
    setScanning(true)
    setScanError(null)
    try {
      const results = await scanGitRepos(rootDir)
      setScanResults(results)
      // Select all repos by default
      setSelectedRepos(new Set(results.map((r) => r.localDir)))
    } catch (e) {
      setScanError(String(e))
      setScanResults([])
      setSelectedRepos(new Set())
    }
    setScanning(false)
  }, [rootDir])

  const toggleRepo = useCallback((localDir: string) => {
    setSelectedRepos((prev) => {
      const next = new Set(prev)
      if (next.has(localDir)) {
        next.delete(localDir)
      } else {
        next.add(localDir)
      }
      return next
    })
  }, [])

  const handleCreate = useCallback(async () => {
    if (!name || !rootDir) return
    setCreating(true)
    setCreateError(null)
    try {
      const project = await createProject({
        name,
        rootDir,
        description: description || undefined,
        clientName: clientName || undefined,
        defaultAgentType: defaultAgentType || undefined,
      })
      // Navigate to project detail page
      router.push(`/platform?view=project-detail&id=${project.id}`)
    } catch (e) {
      setCreateError(String(e))
    }
    setCreating(false)
  }, [name, rootDir, description, clientName, defaultAgentType, router])

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{t("project.create")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Project name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-name">{t("project.name")}</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("project.namePlaceholder")}
            />
          </div>

          {/* Root directory */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-root-dir">{t("project.rootDir")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="project-root-dir"
                value={rootDir}
                onChange={(e) => setRootDir(e.target.value)}
                placeholder={t("project.rootDirPlaceholder")}
              />
              {isDesktop() && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleBrowse}
                  title={t("project.browse")}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-description">
              {t("project.description")}
            </Label>
            <Input
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Client name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-client">{t("project.clientName")}</Label>
            <Input
              id="project-client"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>

          {/* Default agent type */}
          <div className="flex flex-col gap-1.5">
            <Label>{t("project.defaultAgentType")}</Label>
            <Select
              value={defaultAgentType}
              onValueChange={setDefaultAgentType}
            >
              <SelectTrigger>
                <SelectValue placeholder="Auto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Auto</SelectItem>
                <SelectItem value="claude_code">Claude Code</SelectItem>
                <SelectItem value="codex">Codex</SelectItem>
                <SelectItem value="open_code">OpenCode</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
                <SelectItem value="cline">Cline</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Git scan section */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[0.9375rem] font-medium">
                {t("project.scanRepos")}
              </h3>
              <Button
                variant="outline"
                size="sm"
                disabled={!rootDir || scanning}
                onClick={handleScan}
              >
                {scanning ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : null}
                {scanning ? t("project.scanning") : t("project.scanRepos")}
              </Button>
            </div>

            {scanError && (
              <p className="text-[0.8125rem] text-destructive">
                {t("project.scanFailed")}: {scanError}
              </p>
            )}

            {scanResults.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[0.8125rem] text-muted-foreground">
                  {t("project.reposFound", { count: scanResults.length })}
                </p>
                {scanResults.map((repo) => (
                  <div
                    key={repo.localDir}
                    className="flex items-center gap-2 rounded-md border p-2"
                  >
                    <Checkbox
                      checked={selectedRepos.has(repo.localDir)}
                      onCheckedChange={() => toggleRepo(repo.localDir)}
                    />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[0.875rem] font-medium truncate">
                        {repo.name}
                      </span>
                      <span className="text-[0.75rem] text-muted-foreground truncate">
                        {repo.localDir}
                      </span>
                    </div>
                    {repo.gitUrl && (
                      <span className="ml-auto text-[0.75rem] text-muted-foreground truncate">
                        {repo.gitUrl}
                      </span>
                    )}
                    {repo.hasClaudeMd && (
                      <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            )}

            {scanResults.length === 0 && !scanning && !scanError && rootDir && (
              <p className="text-[0.8125rem] text-muted-foreground">
                {t("project.noReposFound")}
              </p>
            )}
          </div>

          <Separator />

          {/* Create button */}
          {createError && (
            <p className="text-[0.8125rem] text-destructive">
              {t("project.createFailed")}: {createError}
            </p>
          )}
          <Button
            disabled={!name || !rootDir || creating}
            onClick={handleCreate}
            className="w-full"
          >
            {creating ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : null}
            {creating ? t("project.creating") : t("project.create")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
