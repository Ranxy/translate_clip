import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const workflowDirectory = join(repositoryRoot, '.github', 'workflows')

const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

const workflowFiles = readdirSync(workflowDirectory).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))

function readWorkflow(name: string): string {
  return readFileSync(join(workflowDirectory, name), 'utf8')
}

/**
 * Guards the CI configuration, which cannot be executed from here.
 *
 * The workflows are the only route to a Windows installer in some cases (and the
 * `workflow_dispatch` trigger is how they are run by hand), so a renamed npm script
 * or a dropped artifact path would break the build silently until someone pushes.
 * These assertions are deliberately structural rather than a YAML schema: the point
 * is to catch exactly that class of drift.
 */
describe('CI workflows', () => {
  it('has the Windows workflow', () => {
    expect(workflowFiles).toContain('build-windows.yml')
  })

  it('can be started by hand from the Actions tab', () => {
    for (const name of workflowFiles) {
      // Without this the user cannot produce an installer on demand.
      expect(readWorkflow(name)).toContain('workflow_dispatch')
    }
  })

  it('only calls npm scripts that exist', () => {
    for (const name of workflowFiles) {
      const referenced = [...readWorkflow(name).matchAll(/npm run ([\w:-]+)/gu)].map((match) => match[1])
      expect(referenced.length).toBeGreaterThan(0)

      for (const script of referenced) {
        expect(Object.keys(packageJson.scripts), `${name} references "${script}"`).toContain(script)
      }
    }
  })

  it('uploads the artifact the Windows workflow is supposed to produce', () => {
    const windows = readWorkflow('build-windows.yml')
    expect(windows).toContain('npm run dist:win')
    expect(windows).toContain('dist/*.exe')
  })

  it('installs from the lockfile', () => {
    for (const name of workflowFiles) {
      const workflow = readWorkflow(name)

      // `npm ci` also verifies that package.json and the lockfile agree, which is
      // why the workflows must not fall back to `npm install`.
      expect(workflow, `${name} should use npm ci`).toContain('npm ci')
      expect(workflow).not.toContain('npm install')
    }
  })
})
