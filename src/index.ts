#!/usr/bin/env bun
/**
 * Long-running agent loop implementation using Claude Agent SDK.
 *
 * Based on Anthropic's "Effective harnesses for long-running agents" research:
 * https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
 *
 * Two-phase approach:
 * 1. Initializer agent: Sets up feature_list.json, progress tracking, and init.sh
 * 2. Coding agent: Makes incremental progress on one feature per session
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "util";
import { getInitializerPrompt } from "./prompts/initializer.ts";
import { getCoderPrompt } from "./prompts/coder.ts";

interface FeatureList {
  features: Array<{
    category: string;
    description: string;
    steps: string[];
    passes: boolean;
    priority: number;
  }>;
}

interface Options {
  projectSpec: string;
  dir: string;
  maxSessions: number;
}

function parseCliArgs(): Options {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      dir: { type: "string", short: "d", default: "." },
      "max-sessions": { type: "string", short: "n", default: "50" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(`
agent-loop - Long-running agent harness for complex coding tasks

Based on Anthropic's research:
https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents

Usage: agent-loop <project-spec> [options]

Arguments:
  project-spec        Project specification (used for initialization)

Options:
  -d, --dir <path>           Project directory to work in (default: ".")
  -n, --max-sessions <num>   Maximum number of sessions to run (default: 50)
  -h, --help                 Show this help message

Examples:
  agent-loop "Build a REST API with user authentication"
  agent-loop "Create a CLI tool for parsing CSV files" -d ./my-project
  agent-loop "Implement a todo app with React" -n 100
`);
    process.exit(values.help ? 0 : 1);
  }

  return {
    projectSpec: positionals.join(" "),
    dir: resolve(values.dir as string),
    maxSessions: parseInt(values["max-sessions"] as string, 10),
  };
}

function readFeatureList(dir: string): FeatureList | null {
  const featureFile = resolve(dir, "feature_list.json");
  if (!existsSync(featureFile)) {
    return null;
  }
  try {
    const content = readFileSync(featureFile, "utf-8");
    return JSON.parse(content) as FeatureList;
  } catch {
    console.error("Failed to parse feature_list.json");
    return null;
  }
}

function getProgress(features: FeatureList): {
  passing: number;
  total: number;
} {
  const total = features.features.length;
  const passing = features.features.filter((f) => f.passes).length;
  return { passing, total };
}

async function runAgent(prompt: string, cwd: string): Promise<void> {
  console.log("\n--- Agent session starting ---\n");

  for await (const message of query({
    prompt,
    options: {
      cwd,
      permissionMode: "bypassPermissions",
      allowedTools: [
        "Read",
        "Write",
        "Edit",
        "Bash",
        "Glob",
        "Grep",
        "WebSearch",
        "WebFetch",
      ],
    },
  })) {
    // Handle different message types
    if (message.type === "assistant") {
      if ("content" in message && typeof message.content === "string") {
        process.stdout.write(message.content);
      }
    } else if (message.type === "result") {
      if (message.subtype === "error_during_execution") {
        console.error("\nAgent error:", message);
      }
    }
  }

  console.log("\n--- Agent session ended ---\n");
}

async function notify(message: string, title: string): Promise<void> {
  const script = `display notification "${message}" with title "${title}" sound name "Glass"`;
  await Bun.spawn(["osascript", "-e", script]).exited;
}

async function main(): Promise<void> {
  const options = parseCliArgs();

  // Validate directory exists
  if (!existsSync(options.dir)) {
    console.error(`Project directory does not exist: ${options.dir}`);
    process.exit(1);
  }

  console.log(`\x1b[36m=== Agent Loop Starting ===\x1b[0m`);
  console.log(`Directory: ${options.dir}`);
  console.log(`Max sessions: ${options.maxSessions}`);

  for (let session = 1; session <= options.maxSessions; session++) {
    console.log(
      `\n\x1b[36m=== Session ${session}/${options.maxSessions} ===\x1b[0m`
    );

    const featureList = readFeatureList(options.dir);

    if (featureList === null) {
      // First run - use initializer agent
      console.log("\x1b[33mInitializing project...\x1b[0m");
      await runAgent(getInitializerPrompt(options.projectSpec), options.dir);
    } else {
      // Subsequent runs - use coding agent
      console.log("\x1b[32mContinuing progress...\x1b[0m");
      await runAgent(getCoderPrompt(), options.dir);
    }

    // Check progress after session
    const updatedFeatures = readFeatureList(options.dir);
    if (updatedFeatures !== null) {
      const { passing, total } = getProgress(updatedFeatures);
      console.log(
        `\x1b[34mProgress: ${passing}/${total} features passing\x1b[0m`
      );

      if (passing === total) {
        console.log("\x1b[32mAll features complete!\x1b[0m");
        await notify("Agent loop complete", "All features passing");
        break;
      }
    }

    // Small delay between sessions
    await Bun.sleep(2000);
  }

  console.log("\x1b[36m=== Agent loop finished ===\x1b[0m");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
