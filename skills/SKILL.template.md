---
name: {{SKILL_NAME}}
description: >
  <one sentence: what this skill does and when the agent should use it — relevance
  is decided at runtime from this description>
version: 0.1.0
tags: [<domain>, <technology>, <task>]
---

# SKILL — {{SKILL_NAME}}

## Goal
<the role the agent assumes and the result it delivers when this skill is active>

## When to activate
<concrete triggers: the kinds of question/task that fire this skill>

## Sources of truth (priority order)
1. <preferred official doc/resource>
2. <…>
Never present speculation as fact (constitution D6).

## Procedure
1. <reproducible step>
2. <reproducible step>

## Expected output
<format, structure, level of detail — e.g., markdown with fixed sections>

## Anti-hallucination
- Never invent <parameters / syntax / endpoints / identifiers> of the domain.
- Under uncertainty: state it and escalate (constitution §4); never fill by assumption.

## Limits
<what this skill does NOT do; when to hand off to another skill or the human>
