import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const runtimeComponents = [
  {
    name: 'Brotli',
    source: 'lib/brotli',
    license: 'MIT',
    use: 'Compiled into the WebAssembly worker for Brotli-compressed font data.',
    licenseFile: 'lib/brotli/LICENSE'
  },
  {
    name: 'Expat',
    source: 'lib/expat',
    license: 'MIT',
    use: 'Compiled into the WebAssembly worker as an XML parser dependency.',
    licenseFile: 'lib/expat/COPYING'
  },
  {
    name: 'FreeType',
    source: 'lib/freetype',
    license: 'FreeType License',
    use: 'Compiled into the WebAssembly worker for font loading and rasterization.',
    licenseFile: 'lib/freetype/docs/FTL.TXT'
  },
  {
    name: 'FriBidi',
    source: 'lib/fribidi',
    license: 'LGPL-2.1-or-later',
    use: 'Compiled into the WebAssembly worker for bidirectional text support.',
    licenseFile: 'lib/fribidi/COPYING'
  },
  {
    name: 'fontconfig',
    source: 'lib/fontconfig',
    license: 'HPND-style license with additional notices',
    use: 'Compiled into the WebAssembly worker for font fallback and matching.',
    licenseFile: 'lib/fontconfig/COPYING'
  },
  {
    name: 'HarfBuzz',
    source: 'lib/harfbuzz',
    license: 'Old MIT',
    use: 'Compiled into the WebAssembly worker for text shaping.',
    licenseFile: 'lib/harfbuzz/COPYING'
  },
  {
    name: 'libass',
    source: 'lib/libass',
    license: 'ISC',
    use: 'Compiled into the WebAssembly worker for ASS/SSA subtitle rendering.',
    licenseFile: 'lib/libass/COPYING'
  },
  {
    name: 'Liberation Sans',
    source: 'dist/default.woff2',
    license: 'OFL-1.1',
    use: 'Bundled fallback font asset used by default renderer options.',
    licenseFile: 'third_party/liberation-fonts/LICENSE',
    displayLicenseFile: 'third_party/liberation-fonts/LICENSE'
  },
  {
    name: 'Emscripten runtime',
    source: 'dist/js/akarisub-worker.js',
    license: 'MIT OR NCSA',
    use: 'Generated JavaScript runtime wrapper used by the WebAssembly worker.',
    version: readMiseToolVersion('emsdk'),
    licenseFile: 'third_party/emscripten/LICENSE',
    displayLicenseFile: 'third_party/emscripten/LICENSE',
    normalizedLicenseSha256: '55009efbae65cad4741da6d66d859a4ad471db7b513d4e8451272b0b49e87e20'
  }
]

const noticeSources = new Map()

function main() {
  const runtimeRows = runtimeComponents.map(component => {
    const version = component.version ?? gitDescribe(component.source)
    addNoticeSource(
      component.name,
      component.licenseFile,
      component.displayLicenseFile,
      component.normalizedLicenseSha256
    )

    return {
      name: component.name,
      source: component.source,
      version,
      license: component.license,
      use: component.use
    }
  })

  const packageRows = listBunPackages().map(pkg => {
    const metadata = readPackageMetadata(pkg.name)
    const license = metadata.packageJson?.license ?? metadata.fallbackLicense ?? 'UNKNOWN'
    const licenseFile = metadata.licenseFile
    addNoticeSource(`${pkg.name} npm package`, licenseFile, metadata.displayLicenseFile)

    return {
      name: pkg.name,
      version: pkg.version,
      license,
      source: metadata.source ?? packageSource(metadata.packageJson),
      use: metadata.note ?? 'Bun/npm dependency listed in bun.lock.'
    }
  })

  const notice = renderNotice(runtimeRows, packageRows)
  writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), notice)
  mkdirSync(join(root, 'dist'), { recursive: true })
  copyFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(root, 'dist/COPYRIGHT'))
}

function renderNotice(runtimeRows, packageRows) {
  const lines = [
    '# Third-Party Notices',
    '',
    'AkariSub itself is licensed under the MIT license; see `LICENSE`.',
    '',
    'This file records third-party components used by the source tree, build output, bundled assets, and Bun/npm dependency graph. It is also copied to `dist/COPYRIGHT` for published packages.',
    '',
    'Regenerate it with `bun run license:third-party` after dependency, submodule, font, or toolchain changes.',
    '',
    '## Bundled and Runtime Components',
    '',
    '| Component | Version/source | License | Use |',
    '| --- | --- | --- | --- |',
    ...runtimeRows.map(row =>
      `| ${md(row.name)} | ${md(formatSource(row))} | ${md(row.license)} | ${md(row.use)} |`
    ),
    '',
    '## Bun/npm Packages',
    '',
    '| Package | Version | License | Source |',
    '| --- | --- | --- | --- |',
    ...packageRows.map(row =>
      `| \`${md(row.name)}\` | ${md(row.version)} | ${md(row.license)} | ${md(row.source || row.use)} |`
    ),
    '',
    '## License Texts',
    ''
  ]

  for (const source of noticeSources.values()) {
    lines.push(`### ${source.title}`, '')
    if (source.displayPath) {
      lines.push(`License source: ${source.displayPath}`, '')
    }
    if (source.content) {
      lines.push(source.content, '')
    } else {
      lines.push('No license text file was available locally; the dependency metadata above records the declared license.', '')
    }
  }

  return lines.join('\n').replace(/\n+$/, '\n')
}

function addNoticeSource(title, licenseFile, displayLicenseFile, normalizedSha256) {
  if (!licenseFile) {
    noticeSources.set(`missing:${title}`, {
      title,
      displayPath: displayLicenseFile,
      content: ''
    })
    return
  }

  const absolute = isAbsolutePath(licenseFile) ? licenseFile : join(root, licenseFile)
  const key = absolute
  if (noticeSources.has(key)) return

  const content = existsSync(absolute) ? normalize(readFileSync(absolute, 'utf8')) : ''
  if (normalizedSha256) {
    if (!content) throw new Error(`Required license text is missing: ${relativeToRoot(absolute)}`)
    const digest = createHash('sha256').update(content).digest('hex')
    if (digest !== normalizedSha256) {
      throw new Error(
        `License text digest mismatch for ${relativeToRoot(absolute)}: expected ${normalizedSha256}, got ${digest}`
      )
    }
  }

  noticeSources.set(key, {
    title,
    displayPath: displayLicenseFile ?? relativeToRoot(absolute),
    content
  })
}

function listBunPackages() {
  try {
    const output = execFileSync('bun', ['pm', 'ls', '--all'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })

    return output
      .split(/\r?\n/)
      .map(line => line.match(/[├└]──\s+(.+)$/)?.[1])
      .filter(Boolean)
      .map(parsePackageSpec)
      .filter(Boolean)
  } catch {
    return parseBunLock()
  }
}

function parseBunLock() {
  const lock = readFileSync(join(root, 'bun.lock'), 'utf8')
  const packages = []
  for (const line of lock.split(/\r?\n/)) {
    const match = line.match(/^\s+"([^"]+)": \["([^"]+)"/)
    if (!match) continue

    const name = match[1]
    const spec = match[2]
    const prefix = `${name}@`
    if (!spec.startsWith(prefix)) continue
    packages.push({ name, version: spec.slice(prefix.length) })
  }
  return packages
}

function parsePackageSpec(spec) {
  const separator = spec.lastIndexOf('@')
  if (separator <= 0) return null
  return {
    name: spec.slice(0, separator),
    version: spec.slice(separator + 1)
  }
}

function readPackageMetadata(name) {
  const directory = packageDirectory(name)
  if (existsSync(join(directory, 'package.json'))) {
    const packageJson = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    return {
      packageJson,
      source: packageSource(packageJson),
      licenseFile: findPackageLicenseFile(directory),
      displayLicenseFile: relativeToRoot(findPackageLicenseFile(directory))
    }
  }

  if (name.startsWith('@typescript/native-preview-')) {
    const parent = packageDirectory('@typescript/native-preview')
    const packageJson = existsSync(join(parent, 'package.json'))
      ? JSON.parse(readFileSync(join(parent, 'package.json'), 'utf8'))
      : undefined

    return {
      packageJson,
      fallbackLicense: 'Apache-2.0',
      source: packageSource(packageJson),
      licenseFile: findPackageLicenseFile(parent),
      displayLicenseFile: relativeToRoot(findPackageLicenseFile(parent)),
      note: 'Optional platform package declared by @typescript/native-preview in bun.lock.'
    }
  }

  return {}
}

function packageDirectory(name) {
  if (name.startsWith('@')) {
    const [scope, packageName] = name.split('/')
    return join(root, 'node_modules', scope, packageName)
  }
  return join(root, 'node_modules', name)
}

function findPackageLicenseFile(directory) {
  if (!directory || !existsSync(directory)) return ''
  const candidates = readdirSync(directory)
    .filter(name => /^(licen[cs]e|copying|notice)(\..*)?$/i.test(name))
    .sort()
  return candidates.length ? join(directory, candidates[0]) : ''
}

function packageSource(packageJson) {
  if (!packageJson) return ''
  const repository = packageJson.repository
  if (typeof repository === 'string') return repository
  if (repository?.url) return repository.url
  return packageJson.homepage ?? ''
}

function gitDescribe(source) {
  try {
    return execFileSync('git', ['-C', join(root, source), 'describe', '--tags', '--always', '--dirty'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return source
  }
}

function readMiseToolVersion(tool) {
  try {
    const match = readFileSync(join(root, 'mise.toml'), 'utf8').match(new RegExp(`^${tool}\\s*=\\s*"([^"]+)"`, 'm'))
    return match?.[1] ?? ''
  } catch {
    return ''
  }
}

function isAbsolutePath(path) {
  return path.startsWith('/')
}

function relativeToRoot(path) {
  if (!path) return ''
  if (!isAbsolutePath(path)) return path
  return path.startsWith(root) ? path.slice(root.length + 1) : path
}

function formatSource(row) {
  return row.version ? `${row.version} (${row.source})` : row.source
}

function normalize(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trimEnd()
}

function md(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

main()
