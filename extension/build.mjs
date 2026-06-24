import { build } from 'esbuild'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('.', import.meta.url)
const outdir = new URL('./dist/', root)
const outdirPath = fileURLToPath(outdir)

const entryPoints = [
  'src/shared/config.ts',
  'src/shared/logger.ts',
  'src/shared/auth.ts',
  'src/shared/csv.ts',
  'src/shared/dom.ts',
  'src/shared/gradeoSession.ts',
  'src/content/schoolStudents.parsers.ts',
  'src/content/schoolStudents.ts',
  'src/content/schoolGroups.parsers.ts',
  'src/content/schoolGroups.ts',
  'src/content/reporting.sync.ts',
  'src/content/reporting.ts',
  'src/content/bridge.ts',
  'src/background/worker.ts',
  'src/background/index.ts',
  'src/popup/popup.ts',
]

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

await build({
  entryPoints,
  outbase: 'src',
  outdir: 'dist/src',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
})

await cp(new URL('./vendor/', root), new URL('./dist/vendor/', root), { recursive: true })
await cp(new URL('./src/popup/popup.html', root), new URL('./dist/src/popup/popup.html', root))

const manifest = JSON.parse(await readFile(new URL('./manifest.json', root), 'utf8'))
await writeFile(
  path.join(outdirPath, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
)
