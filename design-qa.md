# Design QA — Axtro Closer AI Human

## Scope and comparison target

- **Source visual truth:** `/Users/fernandosilva/.codex/generated_images/01a0114d-c840-7de1-939e-c4b4a4a51dd4/exec-64a17765-b1c5-42b9-ae5a-83878ebdfec1.png`
- **Rendered implementation:** `http://127.0.0.1:3100/`
- **Desktop implementation capture:** `/private/tmp/axtro-closer-landing-desktop-final.png`
- **Full-view comparison evidence:** `/private/tmp/axtro-closer-design-comparison-final.png`
- **Focused mobile captures:** `/private/tmp/axtro-closer-landing-mobile-final.png` and `/private/tmp/axtro-closer-landing-mobile-photo-final.png`

The user selected the visual direction of the supplied concept as a source of art direction, not as a request for a pixel-for-pixel clone. The reviewed implementation intentionally combines its dark/red command surface and split hero with the more editorial hierarchy requested from the second concept. The actual user-supplied Raissa photo replaces the concept mock image, as requested.

## Capture normalization

| Item | Source | Implementation |
| --- | --- | --- |
| Desktop pixels | 1536 × 1024 | 1536 × 1024 |
| CSS viewport | N/A (reference raster) | 1536 × 1024 |
| Device pixel ratio | N/A | 1 |
| State | Hero at page top, anonymous | Hero at page top, anonymous |
| Density normalization | Both rendered to 768 × 512 before side-by-side review | Same |

Mobile was also captured at 390 × 844 CSS px / DPR 1. The rendered document reported `scrollWidth: 390` and `clientWidth: 390`; there is no horizontal overflow.

## Findings

No actionable P0, P1, or P2 visual differences remain in the source-targeted landing hero.

- **Fonts and typography:** The implementation preserves the large editorial serif hierarchy, small spaced eyebrow, and restrained sans-serif controls. The H1 holds a deliberate three-line desktop composition and a readable four-line mobile composition without clipping.
- **Spacing and layout rhythm:** The hero retains the left-copy/right-video balance, generous black space, thin divider and CTA hierarchy from the reference. The mobile design reflows copy, actions, proof line, then video frame without overlap.
- **Colors and visual tokens:** The review confirmed charcoal surfaces, warm red CTA/disclosure accents, low-elevation borders and high readable foreground contrast. No decorative gradients or synthetic dashboard illustration were introduced for the selected direction.
- **Image quality and asset fidelity:** The source-oriented red studio treatment is preserved while using the local, user-supplied Raissa asset at `/assets/digital-human/raissa-closer-hero.png`; its crop remains sharp and natural on desktop and mobile. The synthetic system image remains lower in the page, where it is not presented as a person.
- **Copy and affordances:** The hero’s `Assistir à demonstração` control remains a semantic button backed by the isolated synthetic demo flow; public E2E reaches it by keyboard. The page visibly discloses IA identity and synthetic demo data instead of making unsupported conversion claims.
- **Accessibility and resilience:** Mobile has no overflow; the landing has a descriptive photo alt, visible focus treatment, and progressive reveal behavior that leaves essential content visible without `IntersectionObserver`.

## Intentional, product-grounded differences

- The source shows a decorative preview of a fictional priority queue below the hero. The implementation does not reproduce fictional leads or revenue priorities: the authenticated command center shows only account-scoped metrics, readiness and persisted conversations.
- The source labels the visual as a generic AI preview. The implementation makes the disclosure and account/configuration condition explicit, matching product behavior and consent requirements.

## Authenticated dashboard note

The dashboard redesign is verified through type checking, linting and its data/keyboard test contracts. A browser screenshot was not taken from the authenticated E2E tenant because that would require entering private test credentials and mutating a protected customer-like session. The supplied visual source is an anonymous landing hero rather than an authenticated dashboard state, so this does not block the source-targeted comparison above.

## Comparison history

1. **Final desktop comparison — passed.** Source and implementation were normalized into `/private/tmp/axtro-closer-design-comparison-final.png`. The review found no P0/P1/P2 mismatch in the hero’s hierarchy, frame geometry, photo treatment, CTA visibility or divider rhythm.
2. **Responsive validation — passed.** At 390 × 844, controls remain visible, the CTA stack is usable, proof copy wraps without collision, and the Raissa frame remains correctly cropped. Evidence: the two mobile captures above.

## Validation evidence

- Browser console errors/warnings on the landing: none.
- `node --test tests/ui/portal-seo-surface.test.mjs` — 6 passing.
- `pnpm --filter @axtro/portal typecheck` — passing.
- `pnpm lint` — passing.
- `pnpm --filter @axtro/portal e2e:public` — 3 passing in a production build.

## Implementation checklist

- [x] Apply the selected hybrid visual direction to the landing.
- [x] Use the authorized local Raissa photo in the hero.
- [x] Keep the original system visual in a lower system section.
- [x] Carry the visual language to the data-backed dashboard without fabricating operational data.
- [x] Validate desktop/mobile visual states and public discovery behavior.

final result: passed
