import { spawn } from 'node:child_process';
import http from 'node:http';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOptions = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };
    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          if (data) json = JSON.parse(data);
        } catch {
          // ignore malformed JSON in smoke checks
        }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function waitForHealth() {
  for (let i = 0; i < 20; i += 1) {
    try {
      const res = await fetchJson('http://localhost:4012/health');
      if (res.status === 200) return true;
    } catch {
      // retry until the API is ready
    }
    await wait(500);
  }
  throw new Error('Server health check timed out');
}

async function main() {
  const serverEnv = { ...process.env, PORT: '4012' };
  const server = spawn('node', ['api/index.js'], { env: serverEnv });

  try {
    await waitForHealth();

    const rnd = Math.floor(Math.random() * 1000000);
    const username = `testuser_${rnd}`;
    const email = `testuser_${rnd}@example.com`;
    const password = `Password123_${rnd}`;
    const newPassword = `NewPassword123_${rnd}`;
    const displayName = `Test User ${rnd}`;

    const regRes = await fetchJson('http://localhost:4012/api/auth/register', {
      method: 'POST',
      body: { username, email, password, displayName },
    });

    const forgotRes = await fetchJson('http://localhost:4012/api/auth/forgot-password', {
      method: 'POST',
      body: { email },
    });

    const devResetToken = forgotRes.json?.devResetToken;

    const resetRes = await fetchJson('http://localhost:4012/api/auth/reset-password', {
      method: 'POST',
      body: { token: devResetToken, password: newPassword },
    });

    const reusedRes = await fetchJson('http://localhost:4012/api/auth/reset-password', {
      method: 'POST',
      body: { token: devResetToken, password: newPassword },
    });

    const loginRes = await fetchJson('http://localhost:4012/api/auth/login', {
      method: 'POST',
      body: { usernameOrEmail: username, password: newPassword },
    });

    const setCookie = Array.isArray(loginRes.headers?.['set-cookie'])
      ? loginRes.headers['set-cookie'][0]
      : String(loginRes.headers?.['set-cookie'] || '');
    const sessionValue = setCookie.match(/mopp_session=([^;]+)/)?.[1];
    if (!sessionValue) throw new Error('No session cookie received');

    const profileRes = await fetchJson('http://localhost:4012/api/auth/profile', {
      method: 'PATCH',
      headers: { Cookie: `mopp_session=${sessionValue}` },
      body: { displayName, avatar: '', entryFeePaid: true },
    });

    console.log(`register: ${regRes.status}`);
    console.log(`forgot: ${forgotRes.status}`);
    console.log(`reset: ${resetRes.status}`);
    console.log(`reusedToken: ${reusedRes.status}`);
    console.log(`login: ${loginRes.status}`);
    console.log(`profileEntryFeePaid: ${profileRes.status} ${profileRes.json?.user?.entryFeePaid}`);

    if (profileRes.status !== 200 || profileRes.json?.user?.entryFeePaid !== true) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('Test execution failed:', error);
    process.exitCode = 1;
  } finally {
    server.kill();
  }
}

main();
