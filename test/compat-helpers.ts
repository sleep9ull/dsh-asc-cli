import { parseChecksums, releaseAsset, checksumsUrl, PINNED_ASC_VERSION } from '../src/compat.js'

/** Platform asset name for the machine running the tests. */
export function assetNameForTest(version: string = PINNED_ASC_VERSION): string {
  const asset = releaseAsset(version)
  if (asset === undefined) throw new Error(`no release asset for ${process.platform}-${process.arch}`)
  return asset
}

/** A one-line checksums file containing the given asset. */
export function checksumsForTest(asset: string, digest: string): string {
  return `${digest}  ${asset}\n`
}

export { checksumsUrl, parseChecksums }
