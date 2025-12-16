/**
 * Initializer agent prompt - sets up the environment for long-running agent work.
 * Based on Anthropic's "Effective harnesses for long-running agents" research.
 *
 * The initializer agent:
 * 1. Sets up feature_list.json with comprehensive features from the spec
 * 2. Creates claude-progress.txt for progress tracking
 * 3. Creates init.nu for environment setup (nushell script)
 * 4. Makes an initial git commit
 */
export function getInitializerPrompt(projectSpec: string): string {
  return `You are setting up the environment for a long-running coding project. Your goal is to create the foundation that will enable incremental progress across many sessions.

## Project Specification
${projectSpec}

## Your Tasks

### 1. Create feature_list.json
Create a comprehensive feature_list.json file that breaks down the project specification into discrete, testable features. Each feature should be:
- Specific and verifiable
- End-to-end testable
- Independent where possible

Use this JSON schema:
\`\`\`json
{
  "features": [
    {
      "category": "functional|infrastructure|testing|documentation",
      "description": "Clear description of what this feature does",
      "steps": [
        "Step 1 to verify this feature works",
        "Step 2 to verify...",
        "..."
      ],
      "passes": false,
      "priority": 1
    }
  ]
}
\`\`\`

Include at least 20-30 features for a typical project. Prioritize them (1 = highest priority).

### 2. Create claude-progress.txt
Create a progress tracking file with this format:
\`\`\`
# Claude Progress Log

## Session 1 - [DATE]
### Initial Setup
- Created feature_list.json with N features
- Created init.nu
- Made initial commit

### Next Session Should:
- Start with the highest priority feature
- Run init.nu to set up the environment
\`\`\`

### 3. Create init.nu
Create a nushell initialization script that:
- Sets up any necessary environment (install dependencies, etc.)
- Starts any required services (dev server, database, etc.)
- Is idempotent (safe to run multiple times)

Use nushell syntax (not bash). Make it executable with appropriate comments.

### 4. Make Initial Git Commit
After creating these files:
1. Initialize git if not already initialized
2. Create a .gitignore if needed
3. Stage and commit with message: "chore: initialize long-running agent environment"

## Important Guidelines
- Be thorough in the feature list - missing features will be missing from the final product
- Features should be ordered by dependency (foundational features first)
- Each feature should be completable in a single session
- DO NOT start implementing features - just set up the environment

## Critical Constraints
- **DO NOT use WebSearch** - work only with the project spec and existing codebase
- **DO NOT spawn Task agents** - do all work directly yourself
- **DO NOT do research** - just create the environment files based on the spec
- **FOCUS** - your only job is to create feature_list.json, claude-progress.txt, init.nu, and commit

Start by briefly exploring the project directory structure, then create the files.`;
}
