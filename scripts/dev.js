import { spawn } from 'child_process';

const services = [
  { name: 'web', color: '\x1b[36m', cmd: 'npm', args: ['run', 'dev', '--workspace=apps/web'] },
  { name: 'server', color: '\x1b[35m', cmd: 'npm', args: ['run', 'dev', '--workspace=apps/signaling-server'] },
  { name: 'companion', color: '\x1b[33m', cmd: 'npm', args: ['run', 'dev', '--workspace=apps/native-companion'] }
];

const isWindows = process.platform === 'win32';
const processes = [];

console.log('\x1b[1m\x1b[32m⚡ Starting PeerPort full development stack...\x1b[0m\n');
console.log('  \x1b[36m➜ Web App:\x1b[0m          http://localhost:5173');
console.log('  \x1b[35m➜ Signaling Server:\x1b[0m ws://localhost:8088');
console.log('  \x1b[33m➜ Native Companion:\x1b[0m http://localhost:8080\n');

for (const svc of services) {
  const child = spawn(isWindows ? `${svc.cmd}.cmd` : svc.cmd, svc.args, {
    stdio: 'pipe',
    shell: true
  });

  const prefix = `${svc.color}[${svc.name}]\x1b[0m `;

  child.stdout?.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      if (line.trim()) console.log(`${prefix}${line}`);
    }
  });

  child.stderr?.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      if (line.trim()) console.error(`${prefix}\x1b[31m${line}\x1b[0m`);
    }
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`${prefix}exited with code ${code}`);
    }
  });

  processes.push(child);
}

function cleanup() {
  console.log('\n\x1b[33mShutting down all PeerPort services...\x1b[0m');
  for (const proc of processes) {
    try {
      if (isWindows && proc.pid) {
        spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t']);
      } else {
        proc.kill('SIGINT');
      }
    } catch {
      // Ignore cleanup error
    }
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
