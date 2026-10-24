import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  createSkillProvider,
  loadSkillCatalog,
  parseSkillDocument,
  registerSkills,
  type SkillProviderContract,
  type SkillsService,
} from '../src/skills.js'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'skills')

describe('SKILL.md parsing', () => {
  it('parses frontmatter and body', () => {
    const parsed = parseSkillDocument('---\nname: alpha\ndescription: Alpha workflow.\nwhenToUse: When testing.\n---\n\n# Alpha\n\nBody.\n')
    expect(parsed.name).toBe('alpha')
    expect(parsed.description).toBe('Alpha workflow.')
    expect(parsed.whenToUse).toBe('When testing.')
    expect(parsed.body.startsWith('# Alpha')).toBe(true)
  })

  it('unquotes quoted descriptions', () => {
    expect(parseSkillDocument('---\nname: beta\ndescription: "Quoted."\n---\nbody').description).toBe('Quoted.')
  })

  it('treats a document without frontmatter as body-only', () => {
    const parsed = parseSkillDocument('# No frontmatter\n')
    expect(parsed.name).toBeUndefined()
    expect(parsed.body).toContain('# No frontmatter')
  })
})

describe('catalog discovery', () => {
  it('lists valid skill directories and skips invalid ones', () => {
    const catalog = loadSkillCatalog(FIXTURES)
    expect(catalog.map((entry) => entry.name)).toEqual(['alpha', 'beta'])
    const alpha = catalog[0]
    expect(alpha?.description).toContain('Alpha workflow')
    expect(alpha?.source).toBe('bundled')
    expect(alpha?.rank).toBe(BUNDLED_SKILL_RANK)
    expect(alpha?.provider).toBe('asc')
    expect(alpha?.resourceBase?.kind).toBe('directory')
  })

  it('returns an empty catalog for a missing directory', () => {
    expect(loadSkillCatalog(join(FIXTURES, 'nope'))).toEqual([])
  })
})

describe('provider contract', () => {
  it('loads a skill body on demand and strips frontmatter', async () => {
    const provider = createSkillProvider(FIXTURES)
    const [alpha] = await provider.list()
    expect(alpha?.name).toBe('alpha')
    const definition = await provider.get(alpha ?? ({} as never))
    expect(definition?.content).toContain('Use `asc apps list`')
    expect(definition?.content.startsWith('---')).toBe(false)
    expect(await provider.get({ name: 'missing' } as never)).toBeUndefined()
  })
})

describe('registration', () => {
  it('registers a provider through the host skill service', async () => {
    let captured: SkillProviderContract | undefined
    const service: SkillsService = {
      registerProvider(create) {
        captured = create({ signal: new AbortController().signal, invalidate: () => undefined })
        return () => undefined
      },
    }
    const scope = { skills: service, effect: (effect: () => unknown) => effect() }
    const ctx = { inject: (_deps: string[], callback: (scope: unknown) => void) => callback(scope) } as unknown as Context
    registerSkills(ctx, FIXTURES)
    expect(captured?.name).toBe('asc')
    expect((await captured?.list())?.length).toBe(2)
  })

  it('no-ops when the host has no skill service', () => {
    const ctx = { inject: () => undefined } as unknown as Context
    expect(() => registerSkills(ctx, FIXTURES)).not.toThrow()
  })

  it('ships the documented bundled skills', () => {
    // Keeps package content and capability manifest in sync.
    const bundledRoot = join(import.meta.dirname, '..', 'skills')
    const catalog = loadSkillCatalog(bundledRoot)
    expect(catalog.map((entry) => entry.name).sort()).toEqual([
      'dsh-asc-auth',
      'dsh-asc-compliance-sweep',
      'dsh-asc-feedback-triage',
      'dsh-asc-quickstart',
      'dsh-asc-release-readiness',
      'dsh-asc-testflight-ship',
    ])
  })
})

describe('capability/skill consistency', () => {
  it('maps every job to a bundled skill that exists', async () => {
    const { JOBS } = await import('../src/capabilities.js')
    const bundledRoot = join(import.meta.dirname, '..', 'skills')
    const names = loadSkillCatalog(bundledRoot).map((entry) => entry.name)
    for (const job of JOBS) expect(names).toContain(job.skill)
  })
})
