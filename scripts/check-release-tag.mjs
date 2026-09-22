// scripts/check-release-tag.mjs
//
// Guards the release pipeline. The GitHub Release that triggered the workflow
// must be tagged exactly the way electron-builder looks it up, otherwise the
// installers land somewhere unexpected:
//
//   electron-builder publishes to `v` + package.json version (its
//   `vPrefixedTagName` default is true). A release tagged v0.2.0 built from a
//   package.json that still says 0.1.0 would therefore upload the installers to
//   a *different* release — or create a brand new v0.1.0 one next to it.
//
// Failing here costs a few seconds; failing later costs a wrong release.
//
// The tag comes from the first argument, or from GITHUB_REF_NAME (set by GitHub
// Actions for the release event) when the script is called from CI.
//
// Usage: node scripts/check-release-tag.mjs [v0.1.0]

import { readFileSync } from 'node:fs'

/** electron-builder's vPrefixedTagName default — see electron-builder.yml. */
const TAG_PREFIX = 'v'

const fromArgument = process.argv[2]?.trim()
const tag = fromArgument || process.env.GITHUB_REF_NAME?.trim()
const source = fromArgument ? 'argument' : 'GITHUB_REF_NAME'

if (!tag) {
  console.error(
    'usage: node scripts/check-release-tag.mjs <release-tag>\n' +
      '   or: GITHUB_REF_NAME=<release-tag> node scripts/check-release-tag.mjs'
  )
  process.exit(1)
}

const packageJson = new URL('../package.json', import.meta.url)
const { version } = JSON.parse(readFileSync(packageJson, 'utf8'))
const expected = `${TAG_PREFIX}${version}`

if (tag !== expected) {
  console.error(
    `release tag "${tag}" (from ${source}) does not match the packaged version.\n` +
      `  electron-builder would publish to: ${expected}\n` +
      `  package.json version:             ${version}\n` +
      'Fix by either bumping "version" in package.json before tagging, or by\n' +
      'retagging the release, so the two agree.'
  )
  process.exit(1)
}

console.log(`release tag ok: ${tag} (from ${source}) matches package.json version ${version}.`)
