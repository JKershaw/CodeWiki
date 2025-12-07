/**
 * Agent Registry - Central registry for all agents.
 *
 * This module provides a simple way to access agents and their prompts
 * for introspection purposes (e.g., self-improvement analysis).
 */

import type { Agent } from './base-agent.js';
import type { AgentType } from '../domain/agent-run.js';

// Analysis agents
import { CodeChangeAgent } from './analysis/code-change-agent.js';
import { NarrativeAgent } from './analysis/narrative-agent.js';
import { SecurityAgent } from './analysis/security-agent.js';
import { TechnicalDebtAgent } from './analysis/technical-debt-agent.js';
import { PatternAgent } from './analysis/pattern-agent.js';
import { DependencyAgent } from './analysis/dependency-agent.js';
import { CodebaseExplorerAgent } from './analysis/codebase-explorer-agent.js';

// Meta agents
import { LinkAgent } from './meta/link-agent.js';
import { StructureAgent } from './meta/structure-agent.js';
import { QualityAgent } from './meta/quality-agent.js';
import { ConsistencyAgent } from './meta/consistency-agent.js';
import { WikiEditorAgent } from './meta/wiki-editor-agent.js';
import { SourceVerificationAgent } from './meta/source-verification-agent.js';

// Consolidation agent
import { ConsolidationAgent } from './consolidation/consolidation-agent.js';

// Synthesis agents
import { OverviewAgent } from './synthesis/overview-agent.js';
import { WriterAgent } from './synthesis/writer-agent.js';
import { ProjectOverviewAgent } from './synthesis/project-overview-agent.js';
import { GettingStartedAgent } from './synthesis/getting-started-agent.js';
import { TestingGuideAgent } from './synthesis/testing-guide-agent.js';
import { ExtensionGuideAgent } from './synthesis/extension-guide-agent.js';
import { BootstrapAgent } from './synthesis/bootstrap-agent.js';
import { WikiIndexAgent } from './synthesis/wiki-index-agent.js';
import { TableOfContentsAgent } from './synthesis/toc-agent.js';

// Orchestrator prompt (not a full Agent, but has a prompt)
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestrator/prompts.js';

/**
 * Registry of all agent instances.
 * Agents are instantiated once and reused.
 */
const agentRegistry: Map<string, Agent> = new Map();

// Register all agents
function initializeRegistry(): void {
  if (agentRegistry.size > 0) return; // Already initialized

  // Analysis agents
  agentRegistry.set('code-change', new CodeChangeAgent());
  agentRegistry.set('narrative', new NarrativeAgent());
  agentRegistry.set('security', new SecurityAgent());
  agentRegistry.set('technical-debt', new TechnicalDebtAgent());
  agentRegistry.set('pattern', new PatternAgent());
  agentRegistry.set('dependency', new DependencyAgent());
  agentRegistry.set('codebase-explorer', new CodebaseExplorerAgent());

  // Meta agents
  agentRegistry.set('link', new LinkAgent());
  agentRegistry.set('structure', new StructureAgent());
  agentRegistry.set('quality', new QualityAgent());
  agentRegistry.set('consistency', new ConsistencyAgent());
  agentRegistry.set('wiki-editor', new WikiEditorAgent());
  agentRegistry.set('source-verification', new SourceVerificationAgent());

  // Consolidation agent
  agentRegistry.set('consolidation', new ConsolidationAgent());

  // Synthesis agents
  agentRegistry.set('overview', new OverviewAgent());
  agentRegistry.set('writer', new WriterAgent());
  agentRegistry.set('project-overview', new ProjectOverviewAgent());
  agentRegistry.set('getting-started', new GettingStartedAgent());
  agentRegistry.set('testing-guide', new TestingGuideAgent());
  agentRegistry.set('extension-guide', new ExtensionGuideAgent());
  agentRegistry.set('bootstrap', new BootstrapAgent());
  agentRegistry.set('wiki-index', new WikiIndexAgent());
  agentRegistry.set('toc', new TableOfContentsAgent());
}

// Initialize on module load
initializeRegistry();

/**
 * Get an agent by type.
 * @returns The agent instance, or null if not found
 */
export function getAgent(type: string): Agent | null {
  return agentRegistry.get(type) ?? null;
}

/**
 * Get all registered agents.
 */
export function getAllAgents(): Agent[] {
  return Array.from(agentRegistry.values());
}

/**
 * Get the system prompt for an agent.
 * Returns null if the agent doesn't exist or doesn't use an LLM.
 *
 * Special case: 'orchestrator' returns the orchestrator prompt even though
 * it's not a full Agent implementation.
 */
export function getAgentPrompt(type: string): string | null {
  // Special case: orchestrator prompt
  if (type === 'orchestrator') {
    return ORCHESTRATOR_SYSTEM_PROMPT;
  }

  const agent = agentRegistry.get(type);
  if (!agent) {
    return null;
  }

  return agent.getSystemPrompt();
}

/**
 * Get all available agent types (including orchestrator).
 */
export function getAvailableAgentTypes(): string[] {
  const types = Array.from(agentRegistry.keys());
  types.push('orchestrator'); // Include orchestrator as a special case
  return types.sort();
}

/**
 * Analysis agents that process commits.
 * Order matters - code-change runs first to establish base wiki content,
 * then specialized agents add their perspectives.
 */
export const ANALYSIS_AGENTS: AgentType[] = [
  'code-change',      // General code analysis - runs first
  'narrative',        // Detects ADRs, planning docs, READMEs
  'security',         // Security audit
  'technical-debt',   // Technical debt indicators, TODOs, code smells
  'pattern',          // Design patterns and conventions
  'dependency',       // Dependency changes
];

/**
 * Meta agents that process the wiki (not commits).
 * These run after analysis agents have created content.
 */
export const META_AGENTS: AgentType[] = [
  'wiki-editor',          // Process edit requests (runs first to apply pending edits)
  'link',                 // Cross-reference management
  'structure',            // Wiki organization analysis
  'quality',              // Content quality review
  'consistency',          // Cross-page consistency check
  'source-verification',  // Verify wiki content matches source code
];

// Re-export AgentType from domain for convenience
export type { AgentType } from '../domain/agent-run.js';
