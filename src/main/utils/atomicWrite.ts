import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Writes a file by going through a temporary sibling and renaming it into place.
 *
 * A rename is atomic on every platform we ship, so a crash mid-write can never
 * leave a half-written config or database behind; the worst case is a leftover
 * `.tmp` file.
 */
export async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  const directory = dirname(filePath)
  await mkdir(directory, { recursive: true })

  const temporaryPath = `${filePath}.tmp`
  await writeFile(temporaryPath, data)
  await rename(temporaryPath, filePath)
}
