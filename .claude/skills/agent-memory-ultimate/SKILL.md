---
name: agent-memory-ultimate
description: Advanced semantic memory and reasoning state management. Integrates MRL (Matryoshka Representation Learning) indexers and sequential thinking protocols for persistent knowledge.
---

# Agent Memory Ultimate

Enable persistent semantic storage and structured long-term reasoning for AI agents.

## Use this skill when

- Implementing long-term context across conversation sessions.
- Using MRL (Matryoshka Representation Learning) for efficient vector searches.
- Structuring reasoning via "Sequential Thinking" (scratchpads).
- Building Knowledge Items (KIs) from unstructured data.

## Logicware Components

### 1. Sequential Thinking

Store intermediate thoughts to maintain a clear "chain of command" and prevent logic drift.

- **Protocol**: Thought -> Observation -> Refinement -> Action.

### 2. MRL Indexer (`k3_mrl_indexer.py`)

- **Model**: `text-embedding-004`
- **Batching**: Process in chunks of 5-10 for rate-limit stability.
- **Search**: Rank snippets by cosine similarity and filter by confidence thresholds.

## Implementation Workflow

1. **Index**: Scan target directories and generate `.pkl` semantic indices.
2. **Retrieve**: Query index with user prompt to find relevant past contexts.
3. **Reason**: Apply Sequential Thinking to weave retrieved data into the current plan.
4. **Update**: Persist new findings back to the Knowledge Base.

## Metrics

- **Recall@K**: Measure how often the correct context is in the top K results.
- **Coherence**: Ensure reasoning steps follow logically from retrieved memory.
