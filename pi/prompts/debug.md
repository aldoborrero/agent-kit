---
description: Systematic debugging - investigate bugs and test failures with root cause analysis
---
Use the subagent tool with the chain parameter to execute this workflow:

1. First, use the "scout" agent to find all code relevant to: $@
2. Then, use the "debugger" agent to systematically debug the issue using the context from the previous step (use {previous} placeholder)

Execute this as a chain, passing output between steps via {previous}.
