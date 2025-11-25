/**
 * Represents insights from AI coding sessions that should be incorporated into the wiki.
 * Patterns where agents struggled, conventions they missed, etc.
 */
export interface Learning {
  id: string;
  /** Reference to the repo */
  repoId: string;
  /** Type of learning */
  type: LearningType;
  /** The insight itself */
  content: string;
  /** Source of this learning */
  source: LearningSource;
  /** How important is this learning */
  importance: 'low' | 'medium' | 'high';
  /** Has this been incorporated into the wiki */
  incorporated: boolean;
  /** Which wiki pages were updated with this learning */
  incorporatedInto: string[];
  /** When this learning was captured */
  createdAt: Date;
  /** When this learning was incorporated */
  incorporatedAt: Date | null;
}

export type LearningType =
  | 'convention'      // A coding convention the agent didn't know
  | 'pattern'         // A pattern the agent missed or misunderstood
  | 'mistake'         // An error the agent made that should be avoided
  | 'context'         // Missing context that would have helped
  | 'architecture';   // Architectural decision that wasn't documented

export interface LearningSource {
  /** Where this learning came from */
  type: 'user-feedback' | 'agent-reflection' | 'code-review' | 'manual';
  /** Session or run ID if applicable */
  sessionId?: string;
  /** User who provided feedback */
  userId?: string;
  /** Additional context */
  notes?: string;
}

export function createLearning(params: {
  id: string;
  repoId: string;
  type: LearningType;
  content: string;
  source: LearningSource;
  importance?: 'low' | 'medium' | 'high';
}): Learning {
  return {
    id: params.id,
    repoId: params.repoId,
    type: params.type,
    content: params.content,
    source: params.source,
    importance: params.importance ?? 'medium',
    incorporated: false,
    incorporatedInto: [],
    createdAt: new Date(),
    incorporatedAt: null,
  };
}
