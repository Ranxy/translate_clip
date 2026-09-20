// `npm run dev` with GPU acceleration disabled.
//
// The POSIX `VAR=1 command` form this replaces works in bash but not on Windows,
// where npm runs scripts through cmd.exe — the setting was silently dropped right
// where it is needed most (Windows driver trouble and WSLg compositing).
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Resolved rather than run through a shell: a shell would need the platform's
// `electron-vite.cmd` shim on Windows and trips Node's argument-escaping warning.
const require = createRequire(import.meta.url)
const cli = join(dirname(require.resolve('electron-vite/package.json')), 'bin', 'electron-vite.js')

const child = spawn(process.execPath, [cli, 'dev'], {
  stdio: 'inherit',
  env: { ...process.env, TRANSLATE_CLIP_DISABLE_GPU: '1' }
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
