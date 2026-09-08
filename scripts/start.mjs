// Start the local studio without requiring a package-manager executable on PATH.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url));
const child=spawn(process.execPath,['--env-file-if-exists=.env','node_modules/vinext/dist/cli.js','dev','--host','127.0.0.1'],{cwd,stdio:'inherit',windowsHide:true});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code??1;});
