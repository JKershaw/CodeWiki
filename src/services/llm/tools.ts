/**
 * Tool definitions for agentic LLM interactions.
 *
 * Tools allow agents to explore the codebase by reading files,
 * searching for content, and understanding project structure.
 */

/**
 * Context provided to tools when they execute.
 */
export interface ToolContext {
  /** Root path of the repository */
  repoPath: string;
  /** Maximum file size to read (bytes) */
  maxFileSize?: number;
}

/**
 * Definition of a tool that an agent can use.
 */
export interface ToolDefinition {
  /** Unique name for the tool */
  name: string;
  /** Description of what the tool does (shown to LLM) */
  description: string;
  /** JSON Schema for the input parameters */
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  /** Execute the tool with given input */
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

/**
 * Result of a tool execution during an agentic loop.
 */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: string;
}
