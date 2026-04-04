# Skill Authoring Best Practices

> Learn how to write effective skills that agent runtimes can discover and use successfully.

This companion guide focuses on portable skill authoring principles rather than any single provider or runtime.

## Core ideas

- Keep skills concise and easy to scan.
- Put triggering language in the description so the agent knows when to load the skill.
- Avoid summarizing the full workflow in the description; keep implementation details in the body.
- Use supporting files only when they clearly improve discoverability or reduce noise in the main skill.
- Prefer deterministic scripts or validations for mechanical checks.
- Test skills against real or realistic tasks, then refine based on observed failures.

## Description guidance

A good description answers:
- when should this skill be used?
- what kind of task does it help with?
- what keywords would an agent likely search for?

Avoid descriptions that try to teach the whole procedure. They should route the agent to the skill, not replace it.

## Structure guidance

Recommended layout:

```text
skills/
  skill-name/
    SKILL.md
    reference.md
    examples.md
    scripts/
```

Use extra files for:
- heavy reference material
- reusable examples
- deterministic scripts and validators

Keep in `SKILL.md`:
- decision rules
- workflow steps
- compact examples
- links to supporting files

## Testing guidance

Test skills the same way you test code:
- establish baseline behavior without the skill
- add the skill
- verify the agent now behaves differently
- tighten wording where it still finds loopholes

Observe:
- whether the skill is selected when it should be
- whether the description is strong enough for discovery
- whether the workflow is followed correctly once loaded

## Portability guidance

Prefer runtime-neutral language where possible:
- say "agent" instead of naming a provider unless required
- describe filesystem locations generically unless the runtime requires a specific path
- avoid provider-specific assumptions about tools, networking, or model families unless the skill truly depends on them

## Practical checklist

- [ ] description clearly states when to use the skill
- [ ] description does not summarize the full workflow
- [ ] body contains concrete, testable steps
- [ ] examples are realistic and concise
- [ ] supporting files are used only when justified
- [ ] mechanical checks are automated where possible
- [ ] skill has been tested against representative tasks
