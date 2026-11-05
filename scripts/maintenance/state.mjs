import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { assertPackageRecord } from './npm-artifact.mjs'

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
const serialized = value => JSON.stringify(canonical(value))
const sha = value => /^[a-f0-9]{40}$/i.test(value)
const version = value => /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(value)
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unexpected maintenance record fields')
}
function artifactTarget(target) {
  return target?.harness?.name === '@deepseek-ai/dsh' && [target.harness, ...(target.harness.packages ?? [])].every(pkg => pkg?.verification !== undefined)
}
function validateTarget(target, requireArtifacts = false) {
  keys(target, ['repository', 'harness', 'asc'])
  if (!/^[\w.-]+\/[\w.-]+$/.test(target.repository)) throw new Error('Invalid repository')
  const packages = [target.harness, ...(target.harness?.packages ?? [])]
  const artifacts = artifactTarget(target)
  if (requireArtifacts && !artifacts) throw new Error('Legacy v2 target requires artifact verification and explicit migration')
  for (const pkg of packages) {
    keys(pkg, ['name', 'version', 'commit', 'source', 'integrity', 'manifestUrl', 'dependencies', 'packages', 'tarball', 'verification'])
    if (artifacts) assertPackageRecord(pkg)
    else if (pkg.verification !== undefined || pkg.tarball !== undefined || !version(pkg.version) || !sha(pkg.commit) || typeof pkg.integrity !== 'string' || !pkg.integrity) throw new Error('Missing Harness provenance')
  }
  if (artifacts && (packages.slice(1).some(pkg => pkg.name === '@deepseek-ai/dsh') || !Array.isArray(target.harness.packages))) throw new Error('Invalid Harness artifact package list')
  keys(target.asc, ['version', 'tag', 'commit', 'source', 'releaseUrl', 'asset', 'assetUrl', 'checksumsUrl', 'sha256', 'platform', 'arch'])
  if (!version(target.asc.version) || !sha(target.asc.commit) || !/^[a-f0-9]{64}$/i.test(target.asc.sha256)) throw new Error('Missing asc provenance')
}
export function targetKey(target) {
  validateTarget(target)
  const packages = (target.harness.packages ?? []).map(pkg => {
    if (!/^@deepseek-ai\/[a-z0-9-]+$/.test(pkg.name)) throw new Error('Missing Harness package name')
    return [pkg.name, pkg.version]
  }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  if (new Set(packages.map(([name]) => name)).size !== packages.length) throw new Error('Duplicate Harness package name')
  return createHash('sha256').update(JSON.stringify([target.repository, target.harness.version, target.asc.version, packages])).digest('hex')
}
export function prMarker(target) {
  validateTarget(target, true)
  return `<!-- asc-maintenance:v3 ${Buffer.from(JSON.stringify({ key: targetKey(target), target })).toString('base64url')} -->`
}
export function parseMarker(body) {
  if (String(body ?? '').includes('asc-maintenance:v1')) throw new Error('Legacy v1 target marker requires manual provenance and key migration')
  const text = String(body ?? '')
  const matches = [...text.matchAll(/<!-- asc-maintenance:v([23]) ([A-Za-z0-9_-]+) -->/g)]
  if (matches.length !== 1 || (text.match(/asc-maintenance:/g) ?? []).length !== 1 || matches[0][2].length > 100_000) throw new Error('Missing or ambiguous maintenance PR marker')
  const record = JSON.parse(Buffer.from(matches[0][2], 'base64url').toString('utf8'))
  validateTarget(record.target, matches[0][1] === '3')
  if (record.key !== targetKey(record.target)) throw new Error('Invalid maintenance PR key')
  return { ...record, markerVersion: Number(matches[0][1]) }
}

const knownRepairAttempts = value => Number.isInteger(value) && value >= 0
const states = ['discovered', 'adapting', 'pr-open', 'awaiting-checks', 'ready', 'merge-requested', 'merged', 'sync-pending', 'synced', 'blocked']
function validateState(state) {
  keys(state, ['schema', 'status', 'key', 'target', 'branch', 'pr', 'head', 'mergeCommit', 'syncedHead', 'reason', 'updatedAt', 'repairAttempts', 'published'])
  if (!states.includes(state.status) || state.key !== targetKey(state.target)) throw new Error('Invalid maintenance state')
  if (state.published && state.published !== false) throw new Error('Maintenance cannot publish')
  if (state.repairAttempts !== undefined && state.repairAttempts !== null && !knownRepairAttempts(state.repairAttempts)) throw new Error('Invalid repair history')
  for (const field of ['head', 'mergeCommit', 'syncedHead']) if (state[field] !== undefined && !sha(state[field])) throw new Error(`Invalid ${field}`)
}
export async function readState(path) {
  try {
    const state = JSON.parse(await readFile(path, 'utf8'))
    validateState(state)
    return { status: 'ok', state }
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'missing' : 'corrupt', reason: error.code === 'ENOENT' ? 'No local state' : 'Invalid local state; preserved for diagnosis' }
  }
}
export async function writeState(path, state) {
  validateState(state)
  const previous = await readState(path)
  if (previous.status === 'ok') {
    if (previous.state.key === state.key && serialized(previous.state.target) !== serialized(state.target)) throw new Error('Pinned target provenance cannot change')
    if (previous.state.key !== state.key && previous.state.status !== 'synced') throw new Error('Finish the pinned target before starting another')
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ ...state, schema: 1, published: false }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

/** Call with a complete, paginated GitHub snapshot. Local state is only a hint. */
export function recover({ repository, prs, branches = [], state, syncedKeys = [] }) {
  const blocked = reason => ({ status: 'blocked', reason })
  if (!Array.isArray(prs)) return blocked('GitHub snapshot unavailable; cannot infer no existing PR')
  const records = []
  try {
    for (const pr of prs) {
      if (!String(pr.body ?? '').includes('asc-maintenance:')) continue
      const marker = parseMarker(pr.body)
      if (marker.target.repository !== repository) return blocked('PR marker repository mismatch')
      records.push({ ...marker, pr: pr.number, branch: pr.headRefName, state: pr.state, mergeCommit: pr.mergeCommit?.oid })
    }
  } catch (error) { return blocked(error.message) }
  const groups = new Map()
  for (const record of records) {
    if (groups.has(record.key)) return blocked('Multiple PR records for one target; manual resolution required')
    groups.set(record.key, record)
  }
  // syncedKeys must be supplied from verified Git sync evidence, not inferred from a local status label.
  const unfinished = records.filter(record => record.state !== 'MERGED' || !syncedKeys.includes(record.key))
  if (unfinished.length > 1) return blocked('Multiple unfinished targets; manual resolution required')
  const localPending = state && !syncedKeys.includes(state.key)
  const prePrBranch = localPending && ['discovered', 'adapting'].includes(state.status) ? state.branch : undefined
  if (branches.some(branch => branch !== prePrBranch && !records.some(record => record.branch === branch))) return blocked('Unmatched maintenance branches require investigation')
  if (unfinished.length === 1) {
    const record = unfinished[0]
    if (localPending && state.key !== record.key) return blocked('Local and remote unfinished targets conflict')
    if (state?.key === record.key && serialized(state.target) !== serialized(record.target)) return blocked('Target provenance differs between local and PR records')
    if (state?.key === record.key && state.branch !== undefined && state.branch !== record.branch) return blocked('Local and remote maintenance branches conflict')
    const repairAttempts = state?.key === record.key && knownRepairAttempts(state.repairAttempts) ? state.repairAttempts : null
    const base = { key: record.key, target: record.target, branch: record.branch, pr: record.pr, repairAttempts, published: false }
    if (record.markerVersion === 2) return { ...base, ...blocked('Legacy v2 target requires artifact verification and explicit migration') }
    if (record.state === 'MERGED') return sha(record.mergeCommit) ? { ...base, status: 'sync-pending', mergeCommit: record.mergeCommit } : blocked('Merged PR has no verified squash commit')
    if (record.state === 'CLOSED') return blocked('Target PR closed without merge; do not reopen automatically')
    if (record.state !== 'OPEN') return blocked('Unknown PR state')
    if (state?.status === 'blocked') return { ...base, ...blocked(state.reason ?? 'Manual unblock required') }
    if (repairAttempts === null) return { ...base, ...blocked('Repair history unknown; reconstruct it before continuing') }
    return { ...base, status: 'pr-open' }
  }
  if (localPending) {
    if (!artifactTarget(state.target)) return blocked('Legacy v2 local target requires artifact verification and explicit migration')
    if (prePrBranch !== undefined && branches.includes(prePrBranch)) {
      if (!knownRepairAttempts(state.repairAttempts)) return { ...state, ...blocked('Repair history unknown; reconstruct it before continuing'), repairAttempts: null }
      return { ...state, status: 'adapting' }
    }
    return blocked('Local record has no matching remote PR or maintenance branch')
  }
  return { status: 'idle', published: false }
}

/** Pure predicate. The caller must fetch fresh policy/PR/check/review facts for the exact head. */
export function mergeGate(input) {
  const reasons = []
  const { target, head, evidence, policy, checks, mergeable, mergeStateStatus, unresolvedReviews, withinScope, repairAttempts } = input
  try {
    validateTarget(target, true)
    targetKey(target)
    if (!sha(head) || evidence?.head !== head) reasons.push('Verification belongs to a different head')
    if (serialized(evidence?.target) !== serialized(target)) reasons.push('Target provenance changed')
    if (evidence?.fullVerify !== true || evidence?.baselineVerify !== true) reasons.push('Full target and retained-baseline verification required')
    if (policy?.enforced !== true || !Array.isArray(policy.requiredChecks) || !policy.requiredChecks.length) reasons.push('Required branch protection not confirmed')
    if (policy?.reviewsSatisfied !== true || unresolvedReviews !== 0) reasons.push('Review requirements unresolved or unknown')
    if (policy?.squashAllowed !== true || policy?.mergeQueue !== false) reasons.push('Squash strategy not guaranteed')
    if (withinScope !== true || !knownRepairAttempts(repairAttempts) || repairAttempts > 3) reasons.push('Scope or repair budget requires a human decision')
    if (mergeable !== 'MERGEABLE' || mergeStateStatus !== 'CLEAN') reasons.push('Mergeability or base freshness not confirmed')
    for (const required of policy?.requiredChecks ?? []) {
      if (typeof required.name !== 'string' || !Number.isInteger(required.appId)) { reasons.push('Required check lacks exact name/app identity'); continue }
      const matched = (checks ?? []).filter(check => check.name === required.name && check.appId === required.appId && check.head === head)
      if (matched.length !== 1 || matched[0].status !== 'COMPLETED' || matched[0].conclusion !== 'SUCCESS') reasons.push(`Required check not successful on final head: ${required.name}`)
    }
  } catch { reasons.push('Malformed gate evidence') }
  return { allowed: reasons.length === 0, status: reasons.length ? 'awaiting-checks' : 'ready', head, reasons }
}

export async function assertLockOwner(commonDir, token) {
  const owner = JSON.parse(await readFile(join(commonDir, 'asc-maintenance', 'lock.json'), 'utf8'))
  if (!token || owner.token !== token || processAlive(owner) !== true) throw new Error('Live repository lock ownership required')
  return owner
}

function processAlive(owner) {
  if (owner.hostname !== hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0) return undefined
  try { process.kill(owner.pid, 0); return true } catch (error) { return error.code === 'ESRCH' ? false : undefined }
}

/** Serialize ownership changes and protected writes. An interrupted guard needs manual recovery. */
async function guarded(commonDir, action) {
  const guard = join(commonDir, 'asc-maintenance', 'ownership.guard')
  try { await mkdir(guard, { mode: 0o700 }) } catch (error) {
    if (error.code === 'EEXIST') return { status: 'blocked', reason: 'Ownership transition or protected write active/interrupted; inspect guard before manual recovery' }
    throw error
  }
  try { return await action() } finally { await rm(guard, { recursive: true }) }
}

/** Ownership cannot be released or reclaimed between this check and the completed write. */
export async function withLockOwner(commonDir, token, action) {
  return guarded(commonDir, async () => {
    await assertLockOwner(commonDir, token)
    return action()
  })
}

export async function acquireLock({ commonDir, runId, pid = process.pid, now = Date.now, ownerAlive = processAlive, reclaimDead = false }) {
  const directory = join(commonDir, 'asc-maintenance')
  const lock = join(directory, 'lock.json')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  return guarded(commonDir, async () => {
    let owner
    try { owner = JSON.parse(await readFile(lock, 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') return { status: 'blocked', reason: 'Unreadable lock ownership; manual recovery required' }
    }
    if (owner && (!reclaimDead || await ownerAlive(owner) !== false)) return { status: 'blocked', reason: 'Existing owner active or not proven dead', owner }
    const token = randomUUID()
    const record = { runId, pid, hostname: hostname(), acquiredAt: now(), token }
    await writeFile(lock, JSON.stringify(record), { mode: 0o600, flag: owner ? 'w' : 'wx' })
    return { status: 'acquired', owner: record, release: async () => guarded(commonDir, async () => {
      const current = JSON.parse(await readFile(lock, 'utf8'))
      if (current.token !== token) return { status: 'blocked', reason: 'Lock ownership changed; refusing release' }
      await rm(lock)
      return { status: 'released' }
    }) }
  })
}
