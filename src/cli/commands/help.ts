/**
 * CLI help command - displays usage information.
 */

export function printHelp(): void {
  console.log(`
CodeWiki CLI - Generate living wikis from Git repositories

Usage:
  npx tsx src/cli.ts <command> [options]

Commands:
  process <repo-path> [iterations]  Process a local Git repository
                                    Default: 10 iterations
                                    Uses LLM-powered intelligent orchestration

  ask "<question>"                  Quick query for the current directory
                                    Uses the most recent wiki for this repo
                                    Returns just the answer text

  spec "<task>"                     Generate a spec for a coding agent task
                                    Uses the wiki to build context for implementation
                                    Returns structured specification

  query <repo-path> "<question>"    Ask a question about the codebase
                                    Searches wiki and synthesizes an answer

  status <repo-id>                  Show processing status for a repository

  list                              List all connected repositories

Examples:
  npm run ask "what is the architecture?"               # Quick ask (current repo)
  npm run ask "how does authentication work?"           # Quick ask
  npm run spec "add user authentication"                # Generate spec for task
  npm run spec "implement rate limiting for API"        # Generate implementation spec
  npx tsx src/cli.ts process . 5                        # Process current repo
  npx tsx src/cli.ts process . 20                       # More iterations
  npx tsx src/cli.ts query . "what is the architecture?"  # Ask about architecture
  npx tsx src/cli.ts query . "why use CQRS?"            # Ask about decisions
  npx tsx src/cli.ts status abc123                      # Show status
  npx tsx src/cli.ts list                               # List repos
`);
}
