---
name: ast-grep
description: Guide for writing ast-grep rules to perform structural code search and analysis. Use when users need to search codebases using Abstract Syntax Tree (AST) patterns, find specific code structures, or perform complex code queries that go beyond simple text search. This skill should be used when users ask to search for code patterns, find specific language constructs, or locate code with particular structural characteristics.
---

# ast-grep Code Search

Use the `ast_grep` tool for all ast-grep operations. It has three modes: `pattern`, `rule`, and `inspect`. The tool description contains the full syntax reference — this skill teaches the *workflow* for writing effective searches.

## Workflow

### 1. Understand the query

Before writing anything, clarify:
- What code pattern or structure is the target?
- Which programming language?
- Are there variations or edge cases to include/exclude?

### 2. Start with pattern mode

Always try the simplest approach first:

```
ast_grep({ mode: "pattern", pattern: "console.log($MSG)", lang: "javascript" })
```

If a single pattern matches what you need, stop here. Don't over-engineer.

### 3. Escalate to rule mode only when needed

Use rule mode when you need:
- **Relational logic**: "X inside Y" or "X containing Y" → `has`/`inside` with `stopBy: end`
- **Negation**: "X without Y" → `not` + `has`
- **Alternatives**: "X or Y" → `any`
- **Combinations**: "X and Y and Z" → `all`

```
ast_grep({
  mode: "rule",
  lang: "typescript",
  rule: "kind: function_declaration\nhas:\n  pattern: await $EXPR\n  stopBy: end"
})
```

### 4. Debug with inspect mode

When rules don't match, use inspect to understand the AST:

```
ast_grep({
  mode: "inspect",
  pattern: "async function foo() { await bar(); }",
  lang: "javascript",
  inspect_format: "ast"
})
```

This reveals the correct `kind` names. Common mistakes:
- Wrong `kind` value (e.g. `arrow_function` vs `function_declaration`)
- Missing `stopBy: end` on `has`/`inside` (search stops too early)
- Pattern too specific (use metavariables to generalize)

### 5. Iterate

The cycle is: **pattern → inspect → rule → inspect → refine**. Each step should make the rule more precise. Don't write a complex rule in one shot.

## Key Principles

- **`stopBy: end` is mandatory** on `has` and `inside` rules. Without it, the search stops at the first non-matching node instead of traversing the full subtree.
- **Prefer `pattern` over `kind`** when the code structure is unambiguous. `kind` + relational rules are for when patterns can't express the constraint.
- **Use `all` for ordered metavariable binding**. If rule B depends on a metavariable captured by rule A, put A before B in an `all` array.
- **Non-capturing wildcards (`$_VAR`)** avoid unnecessary binding. Use when you need to match "something" but don't care what.
- **`$$$` matches zero or more nodes**. Use in function args (`$$$ARGS`), statement blocks (`$$$BODY`), etc.
