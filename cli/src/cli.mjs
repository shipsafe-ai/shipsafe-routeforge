import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { initCommand } from "./commands/init.mjs";
import { statusCommand } from "./commands/status.mjs";

export function createCLI() {
  const program = new Command();

  program
    .name("routeforge")
    .description(chalk.hex("#F97316")("RouteForge") + " — AI safety gate for GitLab MRs")
    .version("0.1.0");

  program
    .command("init")
    .description("Initialize RouteForge: OAuth flow, store secrets, deploy to Cloud Run")
    .option("--project <id>", "GCP project ID")
    .option("--gitlab-project <id>", "GitLab project ID", "82762386")
    .option("--client-id <id>", "GitLab OAuth Application ID (from gitlab.com/-/profile/applications)")
    .action(initCommand);

  program
    .command("status")
    .description("Show recent verdicts from the RouteForge agent")
    .option("--limit <n>", "Number of verdicts to show", "10")
    .action(statusCommand);

  return program;
}
