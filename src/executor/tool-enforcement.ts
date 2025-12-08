/**
 * Tool Enforcement - Ensures agents use verification tools effectively.
 *
 * This module addresses the gap where agents have access to codebase tools
 * but aren't required to use them. Without enforcement, LLMs can generate
 * plausible but unverified content.
 *
 * See: docs/issues/01-tool-usage-not-enforced.md
 */

import type { AgentType } from '../agents/registry.js';
import type { ToolMetrics } from '../agents/base-agent.js';

/**
 * Configuration for tool usage requirements per agent type.
 */
export interface ToolEnforcementConfig {
  /** Minimum number of tool calls required */
  minToolCalls?: number;
  /** Specific tools that must be used at least once */
  requiredTools?: string[];
  /** If true, log warning instead of throwing error */
  warnOnly?: boolean;
}

/**
 * Result of tool usage validation.
 */
export interface ToolValidationResult {
  valid: boolean;
  message: string;
  toolCallCount: number;
  toolsUsed: string[];
  missingTools: string[];
}

/**
 * Default tool requirements per agent type.
 *
 * Analysis agents that cite specific code require tool verification.
 * Synthesis agents work on existing wiki content, lower requirements.
 * Meta agents work on wiki structure, no tool requirements.
 */
export const DEFAULT_TOOL_REQUIREMENTS: Partial<Record<AgentType, ToolEnforcementConfig>> = {
  // Analysis agents - HIGH enforcement (they cite specific code)
  'code-change': { minToolCalls: 1, requiredTools: ['read_file'] },
  'pattern': { minToolCalls: 1, requiredTools: ['read_file'] },
  'security': { minToolCalls: 1, requiredTools: ['read_file'] },
  'technical-debt': { minToolCalls: 1, requiredTools: ['read_file'] },
  'codebase-explorer': { minToolCalls: 2, requiredTools: ['list_directory', 'read_file'] },
  'narrative': { minToolCalls: 1, warnOnly: true },
  'dependency': { minToolCalls: 1, warnOnly: true },

  // Synthesis agents - MEDIUM enforcement (they transform existing content)
  // These agents primarily work with wiki content but may verify against code
  'writer': { minToolCalls: 0, warnOnly: true },
  'overview': { minToolCalls: 0, warnOnly: true },
  'bootstrap': { minToolCalls: 1, warnOnly: true },
  'project-overview': { minToolCalls: 1, warnOnly: true },
  'getting-started': { minToolCalls: 1, warnOnly: true },
  'testing-guide': { minToolCalls: 1, warnOnly: true },
  'extension-guide': { minToolCalls: 1, warnOnly: true },

  // Meta agents - NO enforcement (they work on wiki content, not code)
  'quality': { minToolCalls: 0 },
  'link': { minToolCalls: 0 },
  'wiki-editor': { minToolCalls: 0 },
  'structure': { minToolCalls: 0 },
  'consistency': { minToolCalls: 0 },
};

/**
 * Validate that an agent's tool usage meets requirements.
 *
 * @param agentType - The type of agent that ran
 * @param metrics - Tool usage metrics from the agent run
 * @param configOverride - Optional config to override defaults
 * @returns Validation result with details
 */
export function validateToolUsage(
  agentType: AgentType,
  metrics: ToolMetrics,
  configOverride?: ToolEnforcementConfig
): ToolValidationResult {
  const config = configOverride ?? DEFAULT_TOOL_REQUIREMENTS[agentType] ?? {};
  const callCount = metrics.toolCallCount;
  const toolsUsed = Object.keys(metrics.toolsUsed);

  // Check minimum calls
  if (config.minToolCalls !== undefined && callCount < config.minToolCalls) {
    return {
      valid: false,
      message: `Agent '${agentType}' made ${callCount} tool call(s), but ${config.minToolCalls} required`,
      toolCallCount: callCount,
      toolsUsed,
      missingTools: [],
    };
  }

  // Check required tools
  const missingTools: string[] = [];
  if (config.requiredTools) {
    for (const tool of config.requiredTools) {
      if (!(tool in metrics.toolsUsed)) {
        missingTools.push(tool);
      }
    }

    if (missingTools.length > 0) {
      return {
        valid: false,
        message: `Agent '${agentType}' did not use required tool(s): ${missingTools.join(', ')}`,
        toolCallCount: callCount,
        toolsUsed,
        missingTools,
      };
    }
  }

  return {
    valid: true,
    message: 'OK',
    toolCallCount: callCount,
    toolsUsed,
    missingTools: [],
  };
}

/**
 * Check if an agent type should only warn (not fail) on tool usage violations.
 */
export function isWarnOnly(agentType: AgentType): boolean {
  const config = DEFAULT_TOOL_REQUIREMENTS[agentType];
  return config?.warnOnly === true;
}

/**
 * Check if an agent type has any tool requirements.
 */
export function hasToolRequirements(agentType: AgentType): boolean {
  const config = DEFAULT_TOOL_REQUIREMENTS[agentType];
  if (!config) return false;
  return (config.minToolCalls ?? 0) > 0 || (config.requiredTools?.length ?? 0) > 0;
}

/**
 * Format tool metrics for logging.
 */
export function formatToolMetricsForLog(agentType: AgentType, metrics: ToolMetrics): string {
  const toolsList = Object.entries(metrics.toolsUsed)
    .map(([name, count]) => `${name}(${count})`)
    .join(', ');

  const validation = validateToolUsage(agentType, metrics);
  const status = validation.valid ? '✓' : '⚠';
  const toolsInfo = metrics.toolCallCount > 0 ? toolsList : 'none';

  return `${status} ${agentType}: ${metrics.toolCallCount} tool call(s) [${toolsInfo}]`;
}

/**
 * Error thrown when tool usage requirements are not met.
 */
export class ToolEnforcementError extends Error {
  constructor(
    public readonly agentType: AgentType,
    public readonly validation: ToolValidationResult
  ) {
    super(validation.message);
    this.name = 'ToolEnforcementError';
  }
}
