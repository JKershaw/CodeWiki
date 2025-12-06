# Questions for the Self-Analysis Agent

## Purpose

These questions are designed to be asked of the self-analysis agent running in production after 100+ wiki generation iterations. They aim to gather empirical data about the issues identified in this analysis and help prioritize fixes based on real-world impact.

---

## Category 1: Accuracy and Correctness

### Q1: Low-Accuracy Pages
> "Which wiki pages have the lowest accuracy scores after 100+ iterations? List the bottom 10 and identify what common characteristics they share (topic, source agent, creation age, etc.)."

**Why this matters:** Identifies systematic failure patterns.

### Q2: Agent Accuracy Correlation
> "Looking at the provenance data, which agents contribute to pages that later receive low benchmark grades? Is there a correlation between specific agent types and inaccuracy?"

**Why this matters:** Helps target which agents need improvement.

### Q3: Code Example Accuracy
> "For pages that contain code examples or snippets, what percentage are verified to exist in the actual source code? Can you identify examples that appear fabricated?"

**Why this matters:** Tests the hallucination hypothesis for Writer and Pattern agents.

### Q4: Stuck Questions
> "Which benchmark questions have been 'stuck' (not improving) across 10+ iterations? What wiki content relates to these topics, and what's blocking improvement?"

**Why this matters:** Identifies structural barriers the system cannot overcome.

---

## Category 2: Quality Dimensions

### Q5: Consistent Weaknesses
> "Are there quality dimensions that consistently score below 50 across all pages or iterations? Which dimensions, and what patterns explain the low scores?"

**Why this matters:** Identifies systemic quality gaps.

### Q6: Quality vs Agent Type
> "Is there a correlation between which agent created a page and its quality scores? For example, do pages created by the Writer Agent score lower on 'Contextual Richness' than pages from CodeChangeAgent?"

**Why this matters:** Tests agent-specific quality issues.

### Q7: Content Degradation
> "Looking at page edit history, are there cases where content was correct (high accuracy) but then degraded after a rewrite or consolidation? What caused the regression?"

**Why this matters:** Identifies if agents are making things worse.

---

## Category 3: Orchestrator Effectiveness

### Q8: Missed Opportunities
> "Has the orchestrator been consistently missing certain types of work? Are there patterns in what it fails to prioritize compared to what the benchmarks show needs attention?"

**Why this matters:** Tests the orchestrator disconnect hypothesis.

### Q9: Work Efficiency
> "What's the ratio of work items completed to benchmark improvement? Are some work types very efficient (small effort, big improvement) while others are wasteful?"

**Why this matters:** Helps optimize orchestrator strategy.

### Q10: Coverage vs Quality Trade-off
> "Is there a trade-off between coverage (% commits processed) and quality? Did quality metrics improve as coverage increased, or did they plateau or decline?"

**Why this matters:** Tests if more processing equals better wiki.

---

## Category 4: Consolidation Effectiveness

### Q11: Finding Resolution Success
> "What percentage of findings raised by meta agents (Quality, Consistency, Structure, Link) were successfully resolved by the Consolidation Agent? Break down by finding type."

**Why this matters:** Tests if the self-healing pipeline works.

### Q12: Unresolved Contradictions
> "Are there contradictions or inconsistencies that the Consistency Agent found but remain unresolved after 100+ iterations? What are they?"

**Why this matters:** Identifies consolidation gaps.

### Q13: Duplicate Detection
> "How many duplicate or near-duplicate pages exist in the wiki currently? Were any detected but not merged? Why?"

**Why this matters:** Tests duplicate handling.

---

## Category 5: Content Verification

### Q14: Line Number Accuracy
> "For pages about code patterns or architecture that reference specific line numbers, how often do those references point to the correct code? Sample 20 references and verify."

**Why this matters:** Directly tests Pattern Agent hallucination.

### Q15: Claim Verification
> "Select 10 specific factual claims from the wiki (e.g., 'The system uses JWT tokens', 'All API endpoints are rate-limited'). Verify each against the source code. What's the accuracy rate?"

**Why this matters:** Tests overall wiki truthfulness.

### Q16: Link Validity
> "What percentage of internal wiki links point to valid pages? How many broken links exist currently?"

**Why this matters:** Tests Link Agent and consolidation effectiveness.

---

## Category 6: Agent Interactions

### Q17: Agent Conflicts
> "Are there cases where two agents produced contradictory content for the same topic? Which agent pairs conflict most often?"

**Why this matters:** Identifies coordination issues.

### Q18: Synthesis Agent Input Quality
> "When synthesis agents (Writer, Overview, Getting Started) produce low-quality output, is it because their wiki input was already flawed? Trace the provenance of 5 low-quality synthesis pages."

**Why this matters:** Tests if errors compound through the pipeline.

### Q19: Bootstrap Impact
> "How much does the quality of initial Bootstrap Agent pages affect final wiki quality? Do pages that were bootstrapped poorly remain problematic?"

**Why this matters:** Tests foundation hypothesis.

---

## Category 7: System-Level Insights

### Q20: Improvement Trajectory
> "Plot the accuracy and quality scores over the 100+ iterations. Is there a clear improvement trajectory? Where did it plateau? Were there any regressions?"

**Why this matters:** Overall system health check.

### Q21: Most Impactful Changes
> "Looking at iterations where quality scores improved significantly, what work was done in those iterations? What types of agents ran? What topics were addressed?"

**Why this matters:** Identifies what actually works.

### Q22: Diminishing Returns
> "At what point did additional iterations stop improving quality? Is there a natural limit the current system reaches?"

**Why this matters:** Helps understand system ceiling.

### Q23: Resource Efficiency
> "Which agents consume the most tokens/cost while producing the least quality improvement? Are there efficiency opportunities?"

**Why this matters:** Optimization opportunity.

---

## How to Use These Questions

### Running the Self-Analysis

1. Ensure at least 100 iterations have completed
2. Run benchmarks after completion
3. Access the self-improvement API:
   ```
   POST /api/repos/:id/self-improvements
   ```
4. Use the chat interface to ask questions:
   ```
   POST /api/repos/:id/self-improvements/:runId/chat/:sessionId/messages
   ```

### Interpreting Results

| Finding | Implies | Action |
|---------|---------|--------|
| Agent X consistently low accuracy | Agent X needs tool access or prompt changes | Prioritize agent improvement |
| Quality dimension Y always low | Systemic gap in that dimension | Add dedicated agent or improve prompts |
| Findings not resolved | Consolidation broken | Test and fix consolidation pipeline |
| No improvement after iteration N | System ceiling reached | Need architectural changes |
| Code examples often fabricated | Hallucination hypothesis confirmed | Add verification step |

### Prioritizing Fixes

After gathering answers:

1. **Group by impact:** Which issues affect the most pages?
2. **Group by cause:** Which issues share root causes?
3. **Estimate effort:** Quick fixes vs architectural changes
4. **Order by ROI:** Impact / Effort ratio

---

## Follow-Up Analysis

After implementing initial fixes, re-run analysis with these focus questions:

1. "Did fixing [X] improve benchmark scores for affected pages?"
2. "Are there new patterns of failure after the fix?"
3. "Did the improvement trajectory resume?"
4. "What's the new system ceiling?"
