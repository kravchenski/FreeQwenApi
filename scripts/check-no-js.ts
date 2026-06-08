import { existsSync } from "node:fs";

const result = Bun.spawnSync(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "*.js", "*.mjs", "*.cjs"],
    { cwd: process.cwd() },
);

if (result.exitCode !== 0) {
    console.error(new TextDecoder().decode(result.stderr));
    process.exit(result.exitCode);
}

const files = new TextDecoder()
    .decode(result.stdout)
    .split("\0")
    .filter((file) => file && existsSync(file));

if (files.length > 0) {
    console.error("JavaScript files are not allowed:");
    for (const file of files) {
        console.error(`- ${file}`);
    }
    process.exit(1);
}

console.log("No JavaScript files found.");
