const { spawn } = require("child_process");
const http = require("http");

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOptions = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    };
    const req = http.request(reqOptions, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        let json = null;
        try {
          if (data) json = JSON.parse(data);
        } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on("error", reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function waitForHealth() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetchJson("http://localhost:4012/health");
      if (res.status === 200) return true;
    } catch (e) {}
    await wait(500);
  }
  throw new Error("Server health check timed out");
}

async function main() {
  const serverEnv = { ...process.env, PORT: "4012" };
  const server = spawn("node", ["api/index.js"], { env: serverEnv });
  
  server.stdout.on("data", (data) => {
    // console.log("SERVER STDOUT:", String(data).trim());
  });
  
  server.stderr.on("data", (data) => {
    // console.log("SERVER STDERR:", String(data).trim());
  });

  try {
    await waitForHealth();
    
    // Generate unique credentials
    const rnd = Math.floor(Math.random() * 1000000);
    const username = `testuser_${rnd}`;
    const email = `testuser_${rnd}@example.com`;
    const password = `Password123_${rnd}`;
    const newPassword = `NewPassword123_${rnd}`;
    const displayName = `Test User ${rnd}`;

    // Register
    const regRes = await fetchJson("http://localhost:4012/api/auth/register", {
      method: "POST",
      body: { username, email, password, displayName }
    });
    
    // Forgot Password
    const forgotRes = await fetchJson("http://localhost:4012/api/auth/forgot-password", {
      method: "POST",
      body: { email }
    });
    
    const devResetToken = forgotRes.json?.devResetToken;
    
    // Reset Password
    const resetRes = await fetchJson("http://localhost:4012/api/auth/reset-password", {
      method: "POST",
      body: { token: devResetToken, password: newPassword }
    });
    
    // Reused Token
    const reusedRes = await fetchJson("http://localhost:4012/api/auth/reset-password", {
      method: "POST",
      body: { token: devResetToken, password: newPassword }
    });
    
    // Login with new password
    const loginRes = await fetchJson("http://localhost:4012/api/auth/login", {
      method: "POST",
      body: { usernameOrEmail: username, password: newPassword }
    });
    
    console.log(`register: ${regRes.status}`);
    console.log(`forgot: ${forgotRes.status}`);
    console.log(`reset: ${resetRes.status}`);
    console.log(`reusedToken: ${reusedRes.status}`);
    console.log(`login: ${loginRes.status}`);

  } catch (error) {
    console.error("Test execution failed:", error);
  } finally {
    server.kill();
  }
}

main();
