---
description: Full lifecycle - scout, plan, implement, review, apply feedback
---
Use the subagent tool with the chain parameter to execute this workflow:

1. First, use the "scout" agent to find all code relevant to: $@
2. Then, use the "planner" agent to create an implementation plan for "$@" using the context from the previous step (use {previous} placeholder)
3. Then, use the "worker" agent to implement the plan from the previous step (use {previous} placeholder)
4. Then, use the "reviewer" agent to review the implementation from the previous step (use {previous} placeholder)
5. Finally, use the "worker" agent to apply the feedback from the review (use {previous} placeholder)

Execute this as a chain, passing output between steps via {previous}.
