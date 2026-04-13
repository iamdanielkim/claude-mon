import { readdir, stat, readFile } from 'fs/promises'
import { join } from 'path'

export interface SubagentFile {
  agentId: string
  jsonlPath: string
  metaPath: string | null  // .meta.json path if exists
  agentType: string | null  // from .meta.json
  description: string | null  // from .meta.json
}

export interface DiscoveredSession {
  sessionId: string
  projectHash: string
  jsonlPath: string
  subagentFiles: SubagentFile[]
  estimatedProjectPath: string | null  // populated after reading cwd from JSONL
}

const USER_AGENT_PATTERN = /^agent-a[a-f0-9]{15,}\.jsonl$/

/**
 * Scan ~/.claude/projects/ and return all sessions modified within the last 2 hours.
 */
export async function discoverSessions(claudeDir: string): Promise<DiscoveredSession[]> {
  const projectsDir = join(claudeDir, 'projects')
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000

  let projectHashes: string[]
  try {
    projectHashes = await readdir(projectsDir)
  } catch {
    return []
  }

  const sessions: DiscoveredSession[] = []

  for (const projectHash of projectHashes) {
    const projectDir = join(projectsDir, projectHash)

    let entries: string[]
    try {
      entries = await readdir(projectDir)
    } catch {
      continue
    }

    // Find session JSONL files (UUID-named, not in subagents/)
    const sessionFiles = entries.filter(e => /^[0-9a-f-]{36}\.jsonl$/.test(e))

    for (const sessionFile of sessionFiles) {
      const jsonlPath = join(projectDir, sessionFile)

      try {
        const fileStat = await stat(jsonlPath)
        if (fileStat.mtimeMs < twoHoursAgo) continue
      } catch {
        continue
      }

      const sessionId = sessionFile.replace(/\.jsonl$/, '')
      const sessionDir = join(projectDir, sessionId)
      const subagentFiles = await getSubagentFiles(sessionDir)

      sessions.push({
        sessionId,
        projectHash,
        jsonlPath,
        subagentFiles,
        estimatedProjectPath: null,
      })
    }
  }

  return sessions
}

/**
 * Get subagent files for a session. Filters out system agents.
 * User agent pattern: agent-a[a-f0-9]{15,}.jsonl
 * Filtered: agent-acompact-*.jsonl, agent-aside_question-*.jsonl
 */
export async function getSubagentFiles(sessionDir: string): Promise<SubagentFile[]> {
  const subagentsDir = join(sessionDir, 'subagents')

  let entries: string[]
  try {
    entries = await readdir(subagentsDir)
  } catch {
    return []
  }

  const agentFiles = entries.filter(e => USER_AGENT_PATTERN.test(e))
  const results: SubagentFile[] = []

  for (const agentFile of agentFiles) {
    const jsonlPath = join(subagentsDir, agentFile)
    const agentId = agentFile.replace(/\.jsonl$/, '').replace(/^agent-/, '')
    const metaFileName = agentFile.replace(/\.jsonl$/, '.meta.json')
    const metaPath = join(subagentsDir, metaFileName)

    let agentType: string | null = null
    let description: string | null = null
    let resolvedMetaPath: string | null = null

    try {
      const metaContent = await readFile(metaPath, 'utf-8')
      const meta = JSON.parse(metaContent) as { agentType?: string; description?: string }
      agentType = meta.agentType ?? null
      description = meta.description ?? null
      resolvedMetaPath = metaPath
    } catch {
      // meta.json doesn't exist or is invalid — that's fine
    }

    results.push({
      agentId,
      jsonlPath,
      metaPath: resolvedMetaPath,
      agentType,
      description,
    })
  }

  return results
}
