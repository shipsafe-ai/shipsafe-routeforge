import chalk from "chalk";
import ora from "ora";
import open from "open";

/**
 * npx routeforge init
 *
 * 1. Start local callback server on :9876
 * 2. Open GitLab OAuth URL in browser
 * 3. Capture token from callback
 * 4. Store token in GCP Secret Manager via gcloud CLI
 * 5. Print next steps (deploy webhook URL to GitLab)
 */
export async function initCommand(options) {
  const gcpProject = options.project;
  const gitlabProject = options.gitlabProject;
  const clientId = options.clientId;

  if (!gcpProject) {
    console.error(chalk.red("Error: --project <gcp-project-id> is required"));
    process.exit(1);
  }

  if (!clientId) {
    console.error(chalk.red("Error: --client-id <gitlab-oauth-app-id> is required"));
    console.error(chalk.yellow("Create one at: https://gitlab.com/-/profile/applications"));
    console.error(chalk.yellow("  Redirect URI: http://localhost:9876/callback"));
    console.error(chalk.yellow("  Scopes: read_api read_repository"));
    process.exit(1);
  }

  console.log(chalk.hex("#F97316").bold("\nRouteForge init\n"));

  const spinner = ora("Starting OAuth callback server on :9876...").start();

  try {
    // Dynamic import to avoid top-level await issues
    const { startOAuthFlow } = await import("../oauth.mjs");
    spinner.succeed("Callback server ready");

    spinner.start("Opening GitLab OAuth consent page...");
    const authUrl = buildAuthUrl(gitlabProject, clientId);
    await open(authUrl);
    spinner.succeed("Browser opened — complete the GitLab OAuth flow");

    spinner.start("Waiting for OAuth callback...");
    const token = await startOAuthFlow(clientId);
    spinner.succeed("OAuth token received");

    spinner.start("Storing token in GCP Secret Manager...");
    await storeSecret(gcpProject, "GITLAB_MCP_OAUTH_TOKEN", token);
    spinner.succeed("Secret stored: GITLAB_MCP_OAUTH_TOKEN");

    console.log(chalk.green("\n✓ RouteForge initialized successfully!\n"));
    console.log("Next steps:");
    console.log(
      "  1. Deploy to Cloud Run:  " +
        chalk.cyan(`gcloud run deploy routeforge --project ${gcpProject}`)
    );
    console.log(
      "  2. Add webhook in GitLab: Settings → Webhooks → <Cloud Run URL>/webhooks/gitlab"
    );
    console.log("  3. Set X-Gitlab-Token to the value of GITLAB_WEBHOOK_SECRET in Secret Manager\n");
  } catch (err) {
    spinner.fail(`Init failed: ${err.message}`);
    process.exit(1);
  }
}

function buildAuthUrl(gitlabProjectId, clientId) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "http://localhost:9876/callback",
    response_type: "code",
    scope: "mcp api read_api read_repository",
    state: "routeforge-init",
  });
  return `https://gitlab.com/oauth/authorize?${params}`;
}

async function storeSecret(gcpProject, secretId, value) {
  const { execSync } = await import("child_process");
  const cmd = `printf '%s' '${value}' | gcloud secrets versions add ${secretId} --data-file=- --project=${gcpProject}`;
  execSync(cmd, { stdio: "pipe" });
}
