# User Patterns — Javier's Preferences

> **CRITICAL**: These preferences are NON-NEGOTIABLE for all agents.
> Violating these will result in rejected work.

---

## Quality Standards

- **NO generic output**. Every result must be "brutal" — excellence is the minimum bar
- **Animations with purpose**, not decorative. Every motion must communicate something
- **Zero tolerance for**: production errors, blank screens, `console.log`/`print` in prod, hardcoded secrets, `any`/`dynamic` without justification

## Hard Rejections (Do NOT Do These)

| Pattern | Why |
|---------|-----|
| AI-loop language ("equipo de expertos", "soluciones integrales") | Generic, meaningless |
| Blue→purple→pink gradients | Overused, unprofessional |
| Glow shadows | Distracting |
| Decorative glassmorphism | No purpose |
| Emojis in production UI | Unprofessional |
| Infinite loading loops | User-hostile |
| `any`/`dynamic` without documented justification | Type safety violation |

## Preferred Aesthetic

### GMP App Movilidad
- Material 3 with centralized colors in `app_colors.dart` (40+ colors)
- Clean, professional, data-dense
- Skeleton loading states for async data
- Smooth transitions with purpose

### Granja Mari Pepa
- Editorial Mediterranean: cream/paprika/olive/sky palette
- Fraunces + Inter font pairing
- CSS transitions + IntersectionObserver (NO GSAP on homepage)
- Zero horizontal overflow

## Workflow Preferences

- **Single point of contact**: Wants to use ONLY the orchestrator
- **Does NOT want to repeat context**: AI should remember patterns from previous work
- **Main frustration**: "I have to explain too many things to the AI"
- **Expectation**: With a basic prompt, the result should be exceptional
- **No tolerance for sub-agent failures**: Verification mandatory before reporting completion
- **No emojis in files** unless explicitly requested

## Interaction Pattern

| User says | What they mean |
|-----------|----------------|
| "mejorar X" | Full redesign/optimization, not a tweak |
| "arreglar X" | Root cause fix with test, not a band-aid |
| "hazlo" | Do it, don't ask for permission |
| "vago" | Intentional ambiguity — figure it out |
| "que un senior haria" | Best practice, production-grade, no shortcuts |
