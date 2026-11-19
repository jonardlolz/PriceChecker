// Starts the Cloudflare Tunnel for prices.kregjonard.fun.
// Works on Windows, macOS and Linux: reads TUNNEL_TOKEN (and PORT) from .env
// and forwards public traffic to the local app.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const token = process.env.TUNNEL_TOKEN;
if (!token) {
  console.error('TUNNEL_TOKEN is missing from .env — see README "Public HTTPS".');
  process.exit(1);
}

const port = process.env.PORT || 3000;
const child = spawn(
  'cloudflared',
  ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`, 'run'],
  { stdio: 'inherit', env: { ...process.env, TUNNEL_TOKEN: token } }
);

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('cloudflared is not installed or not on PATH — see README "Install cloudflared".');
  } else {
    console.error(err);
  }
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
