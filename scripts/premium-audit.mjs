import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const pluginRoot = join(homedir(), ".codex", "plugins", "cache", "openai-curated-remote", "frontend-design-premium");
const versions = existsSync(pluginRoot) ? readdirSync(pluginRoot).sort().reverse() : [];
const script = versions.map((version) => join(pluginRoot, version, "skills", "frontend-design-premium", "scripts", "audit_project.py")).find(existsSync);
if (!script) throw new Error("frontend-design-premium audit script was not found");
const evidence = join(root, "docs", "design", "verification");
mkdirSync(evidence, { recursive: true });
execFileSync("python", [script, root, "--mode", "strict", "--output", join(evidence, "premium-audit.json")], { stdio: "inherit" });
