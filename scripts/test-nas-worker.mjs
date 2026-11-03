import { spawnSync } from 'node:child_process';
const result=spawnSync(process.env.BRAIN_NAS_PYTHON || (process.platform==='win32'?'python':'python3'), ['-B','server/nas-worker.test.py'], {stdio:'inherit',windowsHide:true});
if(result.error)console.error('Python is required for the isolated NAS protocol tests.');
process.exit(result.status ?? 1);
