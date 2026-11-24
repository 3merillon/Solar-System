// npm entry point for the PowerShell scripts: `npm run dev` runs tools/Run.ps1, `npm run build`
// runs tools/Build-Explorer.ps1. It calls PowerShell with -ExecutionPolicy Bypass, so it works from any
// shell (cmd, Git Bash, the VS Code terminal) whatever the machine's script policy is. Extra arguments
// are passed on: `npm run dev -- -NoBuild`.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = { dev: 'Run.ps1', build: 'Build-Explorer.ps1' };
const [task, ...rest] = process.argv.slice(2);
if (!scripts[task]) { console.error(`usage: node tools/dev.mjs ${Object.keys(scripts).join('|')} [args]`); process.exit(2); }
const script = fileURLToPath(new URL(scripts[task], import.meta.url));
const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...rest];
for (const shell of process.platform === 'win32' ? ['powershell.exe', 'pwsh'] : ['pwsh']) {
  const result = spawnSync(shell, args, { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') continue;
  process.exit(result.status ?? 1);
}
console.error('PowerShell was not found; install pwsh (PowerShell 7) to run the .ps1 scripts.');
process.exit(1);
