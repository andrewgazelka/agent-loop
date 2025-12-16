# agent-loop

Long-running agent harness for complex coding tasks using the Claude Agent SDK.

```bash
bun run ~/Projects/agent-loop/src/index.ts "Build a REST API with user authentication"
```

## How It Works

Based on Anthropic's research on [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

Two-phase approach:

1. **Initializer agent** - Sets up `feature_list.json` with comprehensive features, `claude-progress.txt` for tracking, and `init.sh` for environment setup
2. **Coding agent** - Makes incremental progress on one feature per session, leaving the codebase in a clean state

## Features

- **Incremental progress** - Works on exactly one feature per session, preventing scope creep
- **Session bridging** - Progress files let each new context window pick up where the last left off
- **Clean state guarantee** - Every session ends with committed, working code
- **Automatic verification** - Features only marked complete after full end-to-end testing

## Usage

```bash
# Initialize and run in current directory
agent-loop "Build a todo app with React"

# Specify project directory
agent-loop "Create a CLI tool" -d ./my-project

# Limit number of sessions
agent-loop "Implement auth system" -n 100
```

## Status

Early prototype. Implements the core patterns from Anthropic's research.
