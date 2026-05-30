# Roadmap / Backlog

Deliberately-deferred ideas, with enough context to pick them up later.

## Reference-image `role` field (unify character / style / mixed)

**Status:** deferred — style transfer is intentionally kept prompt-based for now (Option C).

### Problem

Today, character consistency has a structured-mode shortcut (`subjectDescription`
→ shared `buildCharacterConsistencyPrompt` in `BaseTTIProvider`), but **style
transfer has no equivalent** — it is always prompt-driven. Reference images are
generic and the *prompt* assigns the role (subject vs. style). This works
(verified live with FLUX.2: robot + cat + a style ref in one request → both
characters preserved and redrawn in the reference's art style), but offers no
middleware-level convenience for style.

### Proposed feature (Option B)

Add an optional `role` per reference image:

```typescript
referenceImages: [
  { base64: robot, role: 'subject' },
  { base64: cat,   role: 'subject' },
  { base64: pixel, role: 'style' },   // role?: 'subject' | 'style' (default: 'subject')
]
```

The middleware would build the prompt from the roles (subject-consistency +
style-transfer templates), covering character, style, **and** mixed cases in one
unified API across providers.

### Why it's a clean fit

Vertex Imagen already exposes native `REFERENCE_TYPE_SUBJECT` /
`REFERENCE_TYPE_STYLE`. A `role` field could map onto those for Imagen, while
Gemini and FLUX keep using prompt assembly.

### Cost / scope

- New optional field on `TTIRequest` → **minor** version (e.g. 1.15.0).
- Prompt-builder changes in `BaseTTIProvider` (add a style template alongside
  the existing character template).
- Per-provider wiring (Google Cloud, BFL).
- Tests for character / style / mixed.
- **Backwards compatible** (default `role: 'subject'` reproduces today's behavior).
