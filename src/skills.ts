/**
 * Bundled skills.
 *
 * The plugin ships its own skill pack inside the npm package and registers it
 * as a host skill provider, so `dsh plugin add` is enough: no `git`, no global
 * skill directory, no manual `asc install-skills`.
 *
 * Candidates use the `bundled` rank (600), the lowest priority: a user who
 * installs the upstream ASC pack into `~/.agents/skills` (rank 500) or a
 * project skill (rank 100/200) automatically wins same-named entries.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

/** Bundled skills sort below every filesystem root. */
export const BUNDLED_SKILL_RANK = 600

/** Provider name shown in diagnostics. */
export const SKILL_PROVIDER = 'asc'

/** One catalog entry. */
export interface SkillCandidate {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: { readonly modelInvocable: boolean; readonly userInvocable: boolean }
  readonly provider: string
  readonly source: string
  readonly rank: number
  readonly resourceBase?: { readonly kind: 'directory'; readonly path: string }
  readonly locator?: string
}

/** A candidate with its body. */
export interface SkillDefinition extends Omit<SkillCandidate, 'rank' | 'locator'> {
  readonly content: string
}

/** Provider contract mirrored from `@deepseek-ai/dsh-skill` (structural). */
export interface SkillProviderContract {
  readonly name: string
  list(options?: unknown): Promise<readonly SkillCandidate[]>
  get(candidate: SkillCandidate, options?: unknown): Promise<SkillDefinition | undefined>
}

/** Structural view of the host skill registry. */
export interface SkillsService {
  registerProvider(
    create: (control: { readonly signal: AbortSignal; readonly invalidate: () => void }) => SkillProviderContract,
  ): () => void
}

/** Parsed SKILL.md frontmatter. */
export interface ParsedSkill {
  readonly name?: string
  readonly description?: string
  readonly whenToUse?: string
  readonly body: string
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u

function unquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Parse the small YAML subset skills use (`key: value` lines).
 *
 * A full YAML parser is not a dependency here; skills in this package only use
 * top-level scalar keys.
 */
export function parseSkillDocument(raw: string): ParsedSkill {
  const match = FRONTMATTER.exec(raw)
  if (match?.[1] === undefined) return { body: raw.trim() }
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (pair?.[1] !== undefined && pair[2] !== undefined && pair[2].trim().length > 0) {
      fields[pair[1]] = unquote(pair[2])
    }
  }
  return {
    ...(fields.name === undefined ? {} : { name: fields.name }),
    ...(fields.description === undefined ? {} : { description: fields.description }),
    ...(fields.whenToUse === undefined ? {} : { whenToUse: fields.whenToUse }),
    body: raw.slice(match[0].length).trim(),
  }
}

/** One candidate per `<root>/<name>/SKILL.md`, invalid entries skipped. */
export function loadSkillCatalog(root: string): SkillCandidate[] {
  let entries: string[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
  const candidates: SkillCandidate[] = []
  for (const directoryName of entries) {
    const directory = join(root, directoryName)
    const path = join(directory, 'SKILL.md')
    let parsed: ParsedSkill
    try {
      parsed = parseSkillDocument(readFileSync(path, 'utf8'))
    } catch {
      continue
    }
    const name = parsed.name ?? directoryName
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || parsed.description === undefined) continue
    candidates.push({
      name,
      description: parsed.description,
      ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
      invocation: { modelInvocable: true, userInvocable: true },
      provider: SKILL_PROVIDER,
      source: 'bundled',
      rank: BUNDLED_SKILL_RANK,
      resourceBase: { kind: 'directory', path: directory.split(sep).join('/') },
      locator: path,
    })
  }
  return candidates
}

/** Build a provider over one skills directory. */
export function createSkillProvider(root: string): SkillProviderContract {
  const candidates = loadSkillCatalog(root)
  return {
    name: SKILL_PROVIDER,
    list: () => Promise.resolve(candidates),
    async get(candidate) {
      const match = candidates.find((entry) => entry.name === candidate.name)
      if (match?.locator === undefined) return undefined
      const raw = await readFile(match.locator, 'utf8')
      const parsed = parseSkillDocument(raw)
      if (parsed.body.length === 0) return undefined
      const { rank: _rank, locator: _locator, ...summary } = match
      return { ...summary, content: parsed.body }
    },
  }
}

/** Default directory of the bundled skills inside the package. */
export function bundledSkillRoot(): string {
  return fileURLToPath(new URL('../skills/', import.meta.url))
}

/**
 * Register the bundled provider when the host has a skill registry.
 *
 * The injection is optional: a composition without `dsh-skill` simply never
 * calls back, and the plugin keeps working without skills.
 */
export function registerSkills(ctx: Context, root: string = bundledSkillRoot()): void {
  ctx.inject(['skills'], (scope) => {
    const service = (scope as unknown as { skills?: SkillsService }).skills
    if (service === undefined) return
    scope.effect(() =>
      service.registerProvider(() => createSkillProvider(root)),
    )
  })
}
