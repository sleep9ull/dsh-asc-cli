/**
 * Compatibility facts for the `asc` engine this plugin targets.
 *
 * The plugin ships a pinned engine version and a tested range. A version
 * outside the range is reported by `/asc-doctor` and never blocks read-only
 * work outright: `asc` evolves weekly, and a hard failure would be worse than a
 * clear warning.
 */

/** Version provisioned by default when the user opts in. */
export const PINNED_ASC_VERSION = '5.16.0'

/** Tested range. `a.b.c` triplets; pre-release suffixes are ignored. */
export const SUPPORTED_ASC_RANGE = '>=5.16.0 <6.0.0'

/** Release download root for the upstream GitHub project. */
export const RELEASE_BASE = 'https://github.com/rorkai/App-Store-Connect-CLI/releases/download'

/** Upstream project, shown in install guidance. */
export const UPSTREAM_REPO = 'rorkai/App-Store-Connect-CLI'

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

export type CompatStatus = 'supported' | 'older' | 'newer' | 'unknown'

function semver(text: string): [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text)
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Compare two dotted versions; returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const left = semver(a)
  const right = semver(b)
  if (!left || !right) return 0
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0) ? 1 : -1
  }
  return 0
}

/** Classify one engine version against the tested range. */
export function compatStatus(version: string | undefined): CompatStatus {
  if (version === undefined) return 'unknown'
  if (compareVersions(version, '5.16.0') < 0) return 'older'
  if (compareVersions(version, '6.0.0') >= 0) return 'newer'
  return 'supported'
}

/** One-line explanation for a compatibility status. */
export function compatMessage(status: CompatStatus, version?: string): string {
  const found = version === undefined ? 'unknown version' : `asc ${version}`
  switch (status) {
    case 'supported':
      return `${found} is within the tested range (${SUPPORTED_ASC_RANGE}).`
    case 'older':
      return `${found} is older than the tested range (${SUPPORTED_ASC_RANGE}); some flags or commands may be missing. Upgrade with \`brew upgrade asc\`, or enable \`allowProvision\` and run \`asc_setup\` with action \`provision\`.`
    case 'newer':
      return `${found} is newer than the tested range (${SUPPORTED_ASC_RANGE}); the plugin should still work, but new flags may need \`asc_run\`. Run \`/asc-doctor\` after an upstream change.`
    default:
      return 'Could not determine the asc version. Run `asc version` in a terminal, or run `/asc-doctor`.'
  }
}
