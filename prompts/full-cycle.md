---
description: Full lifecycle - explore, plan, build, review, fix
---
Use the subagent tool with the chain parameter to execute this workflow:

1. First, use the "explore" agent to find all code relevant to: $@
2. Then, use the "plan" agent to create an implementation plan for "$@" using the context from the previous step (use {previous} placeholder)
3. Then, use the "build" agent to implement the plan from the previous step (use {previous} placeholder)
4. Then, use the "review" agent to review the implementation from the previous step (use {previous} placeholder)
5. Finally, use the "build" agent to apply the feedback from the review (use {previous} placeholder)

Execute this as a chain, passing output between steps via {previous}.
