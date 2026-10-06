# Guestlist Apple informed design references

Guestlist adapts Apple product and interface principles into an original React web interface. The references were consulted on 5 October 2026. This is a design brief and traceability record; final visual and accessibility results belong in [the QA checklist](qa-checklist.md).

## Actual products and published examples

- [Apple Wallet product page](https://www.apple.com/wallet/): its live-event pass image was visually inspected. The event and date occupy the header, seating details have a clear label/value hierarchy, and supporting venue/event actions live below the pass. Rounded surfaces and small, clearly separated close/details controls reinforce the hierarchy
- [Wallet Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/wallet): reviewed through Apple's official documentation data and its indexed page. The pass front prioritises essential information; less frequent details move into a sheet. The guidance also distinguishes critical, primary, secondary, and supplemental fields
- [Sheets Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/sheets): Apple's macOS Notes example shows a focused, rounded sheet over its dimmed parent context. A scoped sheet should offer a clear exit and return to the underlying task

The published Wallet screenshot is a visual reference, not an asset to redistribute inside Guestlist. Its event image and Apple branding are not copied. Guestlist does not implement Apple Wallet, PassKit, Apple Pay, an Add to Apple Wallet export, native macOS controls, or Apple's device security model.

## Mapping to the original interface

| Apple reference or observed principle | Guestlist adaptation | Verification required |
| --- | --- | --- |
| Wallet event-pass header has quickly scannable event/date context | Put event name, date/time, admission status, and a real generated demo QR at the centre of the attendee experience; keep hashes and credentials secondary | Check the rendered phone pass, QR readability, and event/date hierarchy |
| Wallet HIG separates essential pass-front fields from supplemental information | Keep the pass front uncluttered; put credential text, commitment explanation, and less frequent operations in details/dialogs | Check that a first-time attendee can find the QR without opening technical details |
| Wallet supporting actions are visually distinct from the pass | Give pass presentation and organiser administration separate zones; avoid competing primary buttons | Inspect attendee and organiser screens at desktop and phone widths |
| macOS Notes sheet retains visible parent context | Use the web's native dialog semantics for brief issue/detail/revoke tasks, with a subdued backdrop and clear Cancel/Close | Verify focus containment, Escape, dismissal, return focus, and no accidental submission |
| Apple typography guidance uses size and weight to express hierarchy and recommends legible system styles | Use a system-font-first stack, clear title/body/metadata scale, and regular/medium/semibold weights; no bundled SF font files | Inspect final computed fonts and small text after the design pass; preserve browser zoom |
| Wallet's rounded pass and supporting tiles use a coherent surface language | Use a small set of radius, spacing, colour, border, and shadow tokens; reserve the pass treatment for the credential | Inspect consistency across cards, buttons, fields, dialogs, and status states |
| Apple accessibility guidance requires information beyond colour, keyboard access, and readable contrast | Pair status colour with text/icons; name icon buttons; show visible keyboard focus and keep errors understandable | Run keyboard, accessible-name, contrast, and zoom checks; do not infer compliance from appearance |
| Apple touch guidance prioritises comfortable controls and spacing | Adopt at least 44 by 44 CSS-pixel hit areas for touch actions as Guestlist's web criterion, with separation around destructive controls | Measure rendered hit areas on mobile, including close, row actions, navigation, and dialog buttons |
| Apple motion guidance favours purposeful, brief, optional feedback | Use restrained state transitions and respect prefers-reduced-motion; keep success/error information in text | Verify computed reduced-motion behaviour and repeated interactions |

This table describes the required coherent design, not a claim that every row has passed. The refined source uses system-first typography, rem-based text sizes, quiet neutral surfaces, restrained blue actions and explicit status text. Touch controls and reduced motion are implemented. Initial desktop rendering and the synthetic issue/pass/check-in flow have been observed in the private browser preview; the final QA record separates those results from remaining tests. Native Apple point sizes and web CSS pixels are different units; the web hit-area target above is a project choice, not a universal unit conversion.

## Supporting primary references

- [Typography](https://developer.apple.com/design/human-interface-guidelines/typography), read via [official documentation data](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/typography.json): hierarchy, legibility, and restrained typeface choices
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), read via [official documentation data](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json): text scaling, contrast, non-colour status cues, comfortable controls, keyboard access, and reduced motion
- [Motion](https://developer.apple.com/design/human-interface-guidelines/motion), read via [official documentation data](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/motion.json): purposeful, optional, brief feedback
- [UI design tips](https://developer.apple.com/design/tips/): fitting primary content without horizontal scrolling and comfortable touch targets

Do not equate an Apple-like visual treatment with Apple affiliation, native behaviour, security certification, or complete accessibility conformance. Those claims require their own implementation and evidence.
