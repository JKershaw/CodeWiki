#!/usr/bin/env node

/**
 * CodeWiki CLI - Manual trigger for wiki generation.
 *
 * Usage:
 *   npx tsx src/cli.ts <command> [options]
 *
 * Commands:
 *   process <repo-path> [iterations]  - Process a local repository
 *   ask "<question>"                  - Quick query for current directory
 *   spec "<task>"                     - Generate implementation spec
 *   query <repo-path> "<question>"    - Ask about a codebase
 *   status <repo-id>                  - Show processing status
 *   list                              - List connected repositories
 */

import 'dotenv/config';
import {
  printHelp,
  processCommand,
  statusCommand,
  listCommand,
  queryCommand,
  askCommand,
  specCommand,
} from './cli/commands/index.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  switch (command) {
    case 'process':
      await processCommand(args.slice(1));
      break;
    case 'ask':
      await askCommand(args.slice(1));
      break;
    case 'spec':
      await specCommand(args.slice(1));
      break;
    case 'query':
      await queryCommand(args.slice(1));
      break;
    case 'status':
      await statusCommand(args.slice(1));
      break;
    case 'list':
      await listCommand();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
