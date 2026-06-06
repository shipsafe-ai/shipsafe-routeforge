import http from "http";

/**
 * Spin up a localhost:9876 server, wait for GitLab OAuth callback,
 * exchange code for token, return token string.
 */
export function startOAuthFlow(clientId) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost:9876");
      if (url.pathname !== "/callback") {
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res.end("Missing code");
        reject(new Error("No OAuth code in callback"));
        server.close();
        return;
      }

      try {
        const token = await exchangeCode(code, clientId);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h2>RouteForge authorized ✓ — you can close this tab.</h2>");
        resolve(token);
      } catch (err) {
        res.writeHead(500);
        res.end("Token exchange failed");
        reject(err);
      } finally {
        server.close();
      }
    });

    server.listen(9876, "127.0.0.1", () => {});
    server.on("error", reject);

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("OAuth flow timed out after 5 minutes"));
    }, 5 * 60 * 1000);
  });
}

async function exchangeCode(code, clientId) {
  const resp = await fetch("https://gitlab.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      code,
      grant_type: "authorization_code",
      redirect_uri: "http://localhost:9876/callback",
    }),
  });
  if (!resp.ok) throw new Error(`Token exchange failed: HTTP ${resp.status}`);
  const data = await resp.json();
  return data.access_token;
}
