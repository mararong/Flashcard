import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const directory=mkdtempSync(join(tmpdir(),'flashcard-e2e-'));
const python=join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const child=spawn(python,['-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8001'],{
 cwd:root,stdio:'inherit',env:{...process.env,PYTHONPATH:join(root,'backend'),FLASHCARD_DB:join(directory,'test.sqlite3')}
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{rmSync(directory,{recursive:true,force:true});process.exit(code??0);});
