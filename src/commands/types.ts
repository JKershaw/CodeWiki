/**
 * CQRS Command types.
 *
 * Commands are things that change state. All state changes in the system
 * go through commands, providing a clean boundary between the core logic
 * and external interfaces (HTTP, MCP, CLI, etc.).
 */

/**
 * Base interface for all commands.
 */
export interface Command {
  readonly type: string;
}

/**
 * Result of executing a command.
 */
export interface CommandResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Command handler function type.
 */
export type CommandHandler<C extends Command, R = void> = (command: C) => Promise<CommandResult<R>>;

/**
 * Helper to create a successful command result.
 */
export function success<T>(data?: T): CommandResult<T> {
  return { success: true, data };
}

/**
 * Helper to create a failed command result.
 */
export function failure(error: string): CommandResult<never> {
  return { success: false, error };
}
