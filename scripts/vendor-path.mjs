/** Checkout-local engine path shared by installation and development checks. */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function vendorAscPath(platform = process.platform) {
  return resolve(root, 'vendor', platform === 'win32' ? 'asc.exe' : 'asc')
}

/** Explicit engine arguments remain relative to the caller's working directory. */
export function resolveAscPath(requested) {
  return requested === undefined ? vendorAscPath() : resolve(requested)
}
