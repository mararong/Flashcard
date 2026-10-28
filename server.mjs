import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const python = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--reload')) {
  console.error('사용법: node server.mjs [--reload]');
  process.exit(1);
}
if (!existsSync(python) || !existsSync(join(root, 'frontend/dist/index.html'))) {
  console.error('README의 최초 설치 절차로 Python 가상환경과 프런트엔드 빌드를 먼저 준비하세요.');
  process.exit(1);
}
const port = process.env.PORT || '8000';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error('PORT는 1~65535 사이의 정수여야 합니다.');
  process.exit(1);
}
const child = spawn(python, [
  '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', port, ...args,
], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PYTHONPATH: join(root, 'backend') },
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', error => {
  console.error(`서버를 시작할 수 없습니다: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143);
});
