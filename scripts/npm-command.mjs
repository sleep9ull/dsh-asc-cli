import { dirname, join } from 'node:path'

/** Keep npm arguments literal, including on Windows where .cmd is not executable. */
export function npmCommand(args, { platform = process.platform, execPath = process.execPath, npmExecPath = process.env.npm_execpath } = {}) {
  if (platform !== 'win32') return { file: 'npm', args }
  const cli = npmExecPath || join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return { file: execPath, args: [cli, ...args] }
}
