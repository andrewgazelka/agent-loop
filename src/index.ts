#!/usr/bin/env bun
/**
 * Long-running agent loop implementation using Claude Agent SDK.
 *
 * Based on Anthropic's "Effective harnesses for long-running agents" research:
 * https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
 *
 * Three-phase approach:
 * 1. Initializer agent: Sets up feature_list.json, progress tracking, and init.sh
 * 2. Planner agent: Creates implementation plan (plan.md) for the next feature
 * 3. Coder agent: Implements the plan and marks features as passing
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "util";
import pc from "picocolors";
import { getInitializerPrompt } from "./prompts/initializer.ts";
import { getPlannerPrompt } from "./prompts/planner.ts";
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

type AgentPhase = "initializer" | "planner" | "coder";

interface Options {
  projectSpec: string;
  dir: string;
  maxSessions: number;
  verbose: boolean;
  model: string;
}

function parseCliArgs(): Options {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      dir: { type: "string", short: "d", default: "." },
      "max-sessions": { type: "string", short: "n", default: "50" },
      model: { type: "string", short: "m", default: "claude-opus-4-5-20251101" },
      verbose: { type: "boolean", short: "v", default: false },
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
  -m, --model <model>        Model to use (default: "claude-opus-4-5-20251101")
  -n, --max-sessions <num>   Maximum number of sessions to run (default: 50)
  -v, --verbose              Enable verbose logging (show all SDK events)
  -h, --help                 Show this help message

Three-Phase Approach:
  1. Initializer - Creates feature_list.json, init.sh, claude-progress.txt
  2. Planner     - Explores codebase and creates plan.md for next feature
  3. Coder       - Implements the plan and marks feature as passing

Examples:
  agent-loop "Build a REST API with user authentication"
  agent-loop "Create a CLI tool for parsing CSV files" -d ./my-project
  agent-loop "Implement a todo app with React" -n 100
  agent-loop "Fix bugs" -m claude-sonnet-4-5-20250929  # use Sonnet
`);
    process.exit(values.help ? 0 : 1);
  }

  return {
    projectSpec: positionals.join(" "),
    dir: resolve(values.dir as string),
    maxSessions: parseInt(values["max-sessions"] as string, 10),
    verbose: values.verbose as boolean,
    model: values.model as string,
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

function planExists(dir: string): boolean {
  return existsSync(resolve(dir, "plan.md"));
}

function getProgress(features: FeatureList): {
  passing: number;
  total: number;
} {
  const total = features.features.length;
  const passing = features.features.filter((f) => f.passes).length;
  return { passing, total };
}

/**
 * Determine which agent phase to run based on project state.
 *
 * State machine:
 * - No feature_list.json → Initializer
 * - Has feature_list.json but no plan.md → Planner
 * - Has feature_list.json and plan.md → Coder
 */
function determinePhase(dir: string): AgentPhase {
  const featureList = readFeatureList(dir);

  if (featureList === null) {
    return "initializer";
  }

  if (planExists(dir)) {
    return "coder";
  }

  return "planner";
}

function getPromptForPhase(phase: AgentPhase, projectSpec: string): string {
  switch (phase) {
    case "initializer":
      return getInitializerPrompt(projectSpec);
    case "planner":
      return getPlannerPrompt();
    case "coder":
      return getCoderPrompt();
  }
}

function formatPhase(phase: AgentPhase): string {
  switch (phase) {
    case "initializer":
      return pc.yellow(`[${phase}] Initializing project...`);
    case "planner":
      return pc.magenta(`[${phase}] Planning next feature...`);
    case "coder":
      return pc.green(`[${phase}] Implementing plan...`);
  }
}

async function runAgent(prompt: string, cwd: string, model: string, verbose: boolean): Promise<boolean> {
  console.log("\n--- Agent session starting ---\n");

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd,
        model,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        persistSession: false, // Don't persist/resume sessions - each run is fresh
        sandbox: { enabled: false }, // Disable sandboxing - run in actual cwd
        settingSources: [], // Don't load any settings files - full SDK isolation
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: `
IMPORTANT: Your working directory is ${cwd}.
All file paths should be relative to ${cwd} or absolute paths starting with ${cwd}.
When you run 'pwd', it should show ${cwd}.
Do NOT use paths like /home/user/repos/ - those are incorrect.`,
        },
        tools: { type: "preset", preset: "claude_code" },
        disallowedTools: ["Bash"], // Force nushell MCP instead of Bash
        mcpServers: {
          nu: {
            type: "stdio",
            command: "nu",
            args: ["--mcp"],
          },
        },
        stderr: verbose ? (data) => console.error(pc.dim(`[stderr] ${data}`)) : undefined,
      },
    })) {
      // In verbose mode, log all message types
      if (verbose) {
        console.log(pc.dim(`[message] type=${message.type}${"subtype" in message ? ` subtype=${message.subtype}` : ""}`));
      }

      // Handle different message types based on SDK types
      switch (message.type) {
        case "system":
          if (message.subtype === "init") {
            console.log(pc.dim(`[system] Session ${message.session_id} initialized`));
            console.log(pc.dim(`[system] Model: ${message.model}, Tools: ${message.tools.length}`));
          } else if (verbose) {
            console.log(pc.dim(`[system] ${message.subtype}`));
          }
          break;

        case "assistant":
          if (message.message?.content) {
            for (const block of message.message.content) {
              if (block.type === "text") {
                process.stdout.write(block.text);
              } else if (block.type === "tool_use") {
                const inputStr = JSON.stringify(block.input);
                const truncated = inputStr.length > 200 ? inputStr.slice(0, 200) + "..." : inputStr;
                console.log(`\n${pc.yellow(`[tool] ${block.name}`)} ${pc.dim(truncated)}`);
              }
            }
          }
          break;

        case "user":
          // Tool results come back as user messages with content array
          if (message.message?.content) {
            for (const block of message.message.content) {
              if (block.type === "tool_result") {
                const content = block.content;
                let resultStr = typeof content === "string"
                  ? content
                  : JSON.stringify(content);

                // Try to extract just the output from nushell MCP responses
                // Format: {cwd:...,history_index:...,output:"..."}
                try {
                  if (resultStr.includes('"output"') || resultStr.includes('output:')) {
                    const parsed = JSON.parse(resultStr);
                    if (Array.isArray(parsed) && parsed[0]?.text) {
                      // Handle [{type:"text", text:"..."}] format
                      const inner = JSON.parse(parsed[0].text);
                      if (inner.output !== undefined) {
                        resultStr = inner.output || "(empty)";
                      }
                    } else if (parsed.output !== undefined) {
                      resultStr = parsed.output || "(empty)";
                    }
                  }
                } catch {
                  // Keep original if parsing fails
                }

                const maxLen = verbose ? 2000 : 500;
                const truncated = resultStr.length > maxLen ? resultStr.slice(0, maxLen) + "..." : resultStr;
                console.log(pc.dim(truncated));
              }
            }
          }
          break;

        case "result":
          if (message.subtype === "success") {
            console.log(`\n${pc.green(`[result] Success - ${message.num_turns} turns, $${message.total_cost_usd.toFixed(4)}`)}`);
          } else {
            console.error(`\n${pc.red(`[result] Error: ${message.subtype}`)}`);
            if ("errors" in message) {
              for (const err of message.errors) {
                console.error(`  ${err}`);
              }
            }
          }
          break;

        case "tool_progress":
          if (verbose) {
            console.log(pc.dim(`[progress] ${message.tool_name} (${message.elapsed_time_seconds.toFixed(1)}s)`));
          }
          break;

        case "stream_event":
          if (verbose) {
            console.log(pc.dim(`[stream] ${message.event.type}`));
          }
          break;
      }
    }
    console.log("\n--- Agent session ended ---\n");
    return true;
  } catch (error) {
    console.error("\n--- Agent session failed ---");
    console.error("Error:", error instanceof Error ? error.message : error);
    if (verbose && error instanceof Error && error.stack) {
      console.error("Stack:", error.stack);
    }
    return false;
  }
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

  console.log(pc.cyan("=== Agent Loop Starting ==="));
  console.log(`Directory: ${options.dir}`);
  console.log(`Model: ${options.model}`);
  console.log(`Max sessions: ${options.maxSessions}`);
  if (options.verbose) {
    console.log("Verbose mode: enabled");
  }

  for (let session = 1; session <= options.maxSessions; session++) {
    console.log(`\n${pc.cyan(`=== Session ${session}/${options.maxSessions} ===`)}`);

    // Determine which phase to run
    const phase = determinePhase(options.dir);
    const prompt = getPromptForPhase(phase, options.projectSpec);

    console.log(formatPhase(phase));

    const success = await runAgent(prompt, options.dir, options.model, options.verbose);

    if (!success) {
      console.log(pc.yellow("Session failed, retrying after delay..."));
      await Bun.sleep(5000);
      continue;
    }

    // Check progress after session
    const featureList = readFeatureList(options.dir);
    if (featureList !== null) {
      const { passing, total } = getProgress(featureList);
      console.log(pc.blue(`Progress: ${passing}/${total} features passing`));

      if (passing === total) {
        console.log(pc.green("All features complete!"));
        await notify("Agent loop complete", "All features passing");
        break;
      }
    }

    // Small delay between sessions
    await Bun.sleep(2000);
  }

  console.log(pc.cyan("=== Agent loop finished ==="));
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
