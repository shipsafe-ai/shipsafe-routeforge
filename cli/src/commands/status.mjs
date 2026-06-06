import chalk from "chalk";

export async function statusCommand(options) {
  const limit = parseInt(options.limit, 10);
  const baseUrl = process.env.ROUTEFORGE_URL || "http://localhost:8080";

  try {
    const resp = await fetch(`${baseUrl}/verdicts?limit=${limit}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const verdicts = await resp.json();

    console.log(chalk.hex("#F97316").bold("\nRouteForge — Recent Verdicts\n"));

    if (!verdicts.length) {
      console.log(chalk.gray("No verdicts yet."));
      return;
    }

    for (const v of verdicts) {
      const icon = v.verdict === "BLOCK" ? chalk.red("🚫 BLOCK") : chalk.green("✅ PASS");
      const conf = chalk.gray(`(${Math.round(v.confidence * 100)}%)`);
      console.log(`  MR !${v.mr_iid}  ${icon} ${conf}  ${v.mr_title}`);
    }
    console.log();
  } catch (err) {
    console.error(chalk.red(`Error: ${err.message}`));
    console.error(chalk.gray("Set ROUTEFORGE_URL env var to your Cloud Run service URL"));
    process.exit(1);
  }
}
