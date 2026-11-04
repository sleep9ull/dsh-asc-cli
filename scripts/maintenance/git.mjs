import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { acquireLock, assertLockOwner } from './state.mjs'

const execute = promisify(execFile)
export async function runGit(cwd, args) {
  const { stdout } = await execute('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  return stdout.trim()
}
export async function commonDirectory(checkout, run = runGit) {
  return realpath(resolve(checkout, await run(checkout, ['rev-parse', '--git-common-dir'])))
}
async function exists(path) {
  try { await access(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}
async function inspect(checkout, expectedOrigin, run) {
  if (await run(checkout, ['remote', 'get-url', 'origin']) !== expectedOrigin) return 'origin-mismatch'
  if (await run(checkout, ['symbolic-ref', '--quiet', '--short', 'HEAD']) !== 'main') return 'wrong-branch'
  if (await run(checkout, ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'])) return 'dirty-checkout'
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG', 'index.lock', 'HEAD.lock']) {
    const path = resolve(checkout, await run(checkout, ['rev-parse', '--git-path', name]))
    if (await exists(path)) return 'git-operation-in-progress'
  }
  return undefined
}

/** Only explicit, authorized checkouts; never reset, stash, force, switch or clean. */
export async function syncCheckout({ checkout, authorizedCheckout, expectedOrigin, featureCheckout, mergeCommit, exclusiveAccess = false, lockToken, run = runGit, beforeUpdate = async () => {}, now = Date.now }) {
  const pending = reason => ({ status: 'sync-pending', reason, published: false })
  let lock
  try {
    if (!checkout || !authorizedCheckout || !featureCheckout || !expectedOrigin || !/^[a-f0-9]{40}$/i.test(mergeCommit)) return pending('explicit-authorization-and-merge-commit-required')
    const actual = await realpath(checkout)
    // Authorization binds the canonical path. A symlink must not redirect it elsewhere.
    if (actual !== resolve(authorizedCheckout) || actual !== await realpath(authorizedCheckout)) return pending('unauthorized-checkout')
    if (actual === await realpath(featureCheckout)) return pending('feature-worktree-is-not-main-checkout')
    if (!exclusiveAccess) return pending('concurrent-use-not-excluded')
    if (await realpath(await run(actual, ['rev-parse', '--show-toplevel'])) !== actual) return pending('checkout-must-be-repository-root')
    const commonDir = await commonDirectory(actual, run)
    if (lockToken) await assertLockOwner(commonDir, lockToken)
    else {
      lock = await acquireLock({ commonDir, runId: `sync-${process.pid}-${now()}`, now })
      if (lock.status !== 'acquired') return pending(lock.reason)
    }
    const initial = await inspect(actual, expectedOrigin, run)
    if (initial) return pending(initial)
    const local = await run(actual, ['rev-parse', 'HEAD'])
    // No '+' refspec: non-fast-forward remote tracking changes must also stop.
    await run(actual, ['fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main'])
    const remote = await run(actual, ['rev-parse', 'refs/remotes/origin/main'])
    try { await run(actual, ['merge-base', '--is-ancestor', mergeCommit, remote]) } catch { return pending('squash-commit-not-in-origin-main') }
    try { await run(actual, ['merge-base', '--is-ancestor', local, remote]) } catch { return pending('local-main-diverged') }
    await beforeUpdate()
    const final = await inspect(actual, expectedOrigin, run)
    if (final) return pending(final)
    if (await run(actual, ['rev-parse', 'HEAD']) !== local || await run(actual, ['rev-parse', 'refs/remotes/origin/main']) !== remote) return pending('refs-changed-during-sync')
    if (local !== remote) await run(actual, ['merge', '--ff-only', '--no-edit', '--no-overwrite-ignore', remote])
    const after = await inspect(actual, expectedOrigin, run)
    const head = await run(actual, ['rev-parse', 'HEAD'])
    if (after || head !== remote) return pending(after ?? 'post-sync-head-mismatch')
    return { status: 'synced', checkout: actual, head, fetchedHead: remote, mergeCommit, checkedAt: now(), published: false }
  } catch {
    // Do not print subprocess stderr: remote URLs and credential helpers may contain secrets.
    return pending('git-or-filesystem-check-failed; inspect the authorized checkout manually')
  } finally {
    if (lock?.status === 'acquired') await lock.release()
  }
}
