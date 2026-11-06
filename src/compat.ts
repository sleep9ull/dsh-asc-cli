/**
 * Compatibility facts for the `asc` engine this plugin targets.
 *
 * The plugin declares a supported range and one tested, provisionable pin. A version
 * outside the range is reported by `/asc-doctor` and never blocks read-only
 * work outright: `asc` evolves weekly, and a hard failure would be worse than a
 * clear warning.
 */

/** Version provisioned by default when the user opts in. */
export const PINNED_ASC_VERSION = '6.5.0'

/** Compatibility bounds; future minors are monitored, not individually certified. */
export const MIN_ASC_VERSION = '6.3.0'
export const NEXT_ASC_MAJOR = '7.0.0'
export const SUPPORTED_ASC_RANGE = `>=${MIN_ASC_VERSION} <${NEXT_ASC_MAJOR}`

/** Release download root for the upstream GitHub project. */
export const RELEASE_BASE = 'https://github.com/rorkai/App-Store-Connect-CLI/releases/download'

/** Upstream project, shown in install guidance. */
export const UPSTREAM_REPO = 'rorkai/App-Store-Connect-CLI'

/** GitHub API endpoint used by the optional update check. */
export const UPSTREAM_LATEST_URL = `https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`

/** Release assets verified against their published checksums. */
const ASSET_PLATFORMS: Record<string, string> = {
  'darwin-arm64': 'macOS_arm64',
  'darwin-x64': 'macOS_amd64',
  'linux-arm64': 'linux_arm64',
  'linux-x64': 'linux_amd64',
  'win32-x64': 'windows_amd64.exe',
}

/** The release asset name for one platform pair, if upstream publishes one. */
export function releaseAsset(
  version: string,
  platform: string = process.platform,
  arch: string = process.arch,
): string | undefined {
  const suffix = ASSET_PLATFORMS[`${platform}-${arch}`]
  return suffix === undefined ? undefined : `asc_${version}_${suffix}`
}

/** Absolute download URL for one asset. */
export function releaseUrl(asset: string, version: string): string {
  return `${RELEASE_BASE}/${version}/${asset}`
}

/** Absolute URL of the release checksum list. */
export function checksumsUrl(version: string): string {
  return releaseUrl(`asc_${version}_checksums.txt`, version)
}

/** Parse `sha256  filename` lines into a filename → digest map. */
export function parseChecksums(text: string): Map<string, string> {
  const digests = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line.trim())
    if (match?.[1] !== undefined && match[2] !== undefined) digests.set(match[2], match[1].toLowerCase())
  }
  return digests
}

export type CompatStatus = 'supported' | 'older' | 'newer' | 'prerelease' | 'unknown'

function semver(text: string): { core: string[]; pre: string[] } | undefined {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(text)
  if (!match) return undefined
  const pre = match[4]?.split('.') ?? []
  if (pre.some((part) => /^0\d+$/.test(part))) return undefined
  return { core: [match[1]!, match[2]!, match[3]!], pre }
}

/** Parse only the first token of `asc version` output, never a later incidental version. */
export function parseVersion(text: string): string | undefined {
  const token = text.trim().split(/\s+/, 1)[0]
  return token !== undefined && semver(token) !== undefined ? token.replace(/^v/, '') : undefined
}

function compareIdentifier(a: string, b: string): number {
  if (a === b) return 0
  const aNumeric = /^\d+$/.test(a), bNumeric = /^\d+$/.test(b)
  if (aNumeric && bNumeric && a.length !== b.length) return a.length < b.length ? -1 : 1
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
  return a < b ? -1 : 1
}

/** SemVer precedence, ignoring build metadata; invalid inputs return NaN, never equality. */
export function compareVersions(a: string, b: string): number {
  const left = semver(a), right = semver(b)
  if (!left || !right) return Number.NaN
  for (let index = 0; index < 3; index++) {
    const comparison = compareIdentifier(left.core[index]!, right.core[index]!)
    if (comparison !== 0) return comparison
  }
  if (left.pre.length === 0 || right.pre.length === 0) {
    return left.pre.length === right.pre.length ? 0 : left.pre.length === 0 ? 1 : -1
  }
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index++) {
    const aPart = left.pre[index], bPart = right.pre[index]
    if (aPart === undefined || bPart === undefined) return aPart === undefined ? -1 : 1
    const comparison = compareIdentifier(aPart, bPart)
    if (comparison !== 0) return comparison
  }
  return 0
}

/** Declared compatibility is distinct from the one tested/provisioned pin. */
export function compatStatus(version: string | undefined): CompatStatus {
  const parsed = version === undefined ? undefined : semver(version)
  if (parsed === undefined || version === undefined) return 'unknown'
  if (compareVersions(version, MIN_ASC_VERSION) < 0) return 'older'
  if (parsed.pre.length > 0) return 'prerelease'
  if (compareVersions(version, NEXT_ASC_MAJOR) >= 0) return 'newer'
  return 'supported'
}

/** One-line explanation for a compatibility status. */
export function compatMessage(status: CompatStatus, version?: string): string {
  const found = version === undefined ? 'unknown version' : `asc ${version}`
  switch (status) {
    case 'supported':
      return `${found} is within the declared supported range (${SUPPORTED_ASC_RANGE}); the tested baseline is ${PINNED_ASC_VERSION}.`
    case 'older':
      return `${found} is below the minimum supported version (${MIN_ASC_VERSION}); some flags or commands may be missing. Update the active installation to the tested baseline ${PINNED_ASC_VERSION}; run \`/asc-doctor\` to identify its source.`
    case 'newer':
    case 'prerelease':
      return `${found} is outside the declared supported range (${SUPPORTED_ASC_RANGE}); prereleases are not declared supported. Compatibility is unconfirmed; check the plugin's compatibility notes before changing the active installation.`
    default:
      return 'Could not determine the asc version. Run `asc version` in a terminal, or run `/asc-doctor`.'
  }
}
