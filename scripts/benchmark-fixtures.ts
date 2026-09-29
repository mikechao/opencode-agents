// Standalone fixture probe; does not modify suite fixtures or runtime code.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { observeGit } from '../src/git.ts'
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const container = mkdtempSync(path.join(tmpdir(), 'opencode-agents-fixture-bench-'))
const samples: any[] = []
function fresh(root: string) {
 mkdirSync(root); git(root, 'init', '-q'); git(root, 'config', 'user.name', 'Primitive Test'); git(root, 'config', 'user.email', 'primitives@example.invalid')
 writeFileSync(path.join(root, 'old.txt'), 'initial\n'); git(root, 'add', 'old.txt'); git(root, 'commit', '-qm', 'baseline')
}
try {
 const seed = path.join(container, 'seed'); fresh(seed); const baseline = observeGit(seed)
 for (let run=0; run<5; run++) {
  for (const mode of ['fresh', 'copy', 'clone']) {
   const root = path.join(container, `${mode}-${run}`); let start=performance.now(); let copiedPaths: readonly string[] | undefined
   if (mode === 'fresh') fresh(root)
   if (mode === 'copy') cpSync(seed, root, { recursive: true, preserveTimestamps: true })
   if (mode === 'clone') { execFileSync('git', ['clone', '--quiet', '--no-hardlinks', seed, root]); git(root, 'config', 'user.name', 'Primitive Test'); git(root, 'config', 'user.email', 'primitives@example.invalid'); git(root, 'remote', 'remove', 'origin') }
   const setupMs=performance.now()-start
   let refreshMs=0
   if (mode === 'copy') { copiedPaths=observeGit(root).paths; start=performance.now(); git(root, 'update-index', '--refresh'); refreshMs=performance.now()-start }
   const snapshot=observeGit(root)
   if(snapshot.paths.length || snapshot.root !== realpathSync(root) || snapshot.head !== baseline.head && mode !== 'fresh') throw new Error('snapshot invariant failed')
   writeFileSync(path.join(root, 'old.txt'), 'private change\n'); git(root, 'add', 'old.txt'); git(root, 'commit', '-qm', 'private head')
   if(observeGit(seed).head !== baseline.head || observeGit(seed).paths.length || readFileSync(path.join(seed,'old.txt'),'utf8') !== 'initial\n') throw new Error('seed changed')
   samples.push({mode,run:run+1,setupMs,refreshMs,copiedPaths})
   rmSync(root,{recursive:true,force:true})
  }
 }
 console.log(JSON.stringify(samples,null,2))
} finally { rmSync(container,{recursive:true,force:true}) }
