# Snaghunt design system

Snaghunt walks through someone's app and hands back evidence: what it clicked, what
happened, what broke. The interface should feel like a precise inspection instrument
and the report it prints — exact, calm, legible at a glance — not like a generic
SaaS template.

## Principles

1. **Evidence first.** Data, screenshots and steps are the content. Chrome stays quiet.
2. **Color means something.** Neutral by default. The accent marks what you can act on
   or what is live; status colors appear only on status.
3. **Structure encodes information.** A border, rule or number is there because it
   separates, sequences or groups real things — never as decoration.
4. **Tables over card grids** for anything that is a list of records.
5. **One memorable moment per page.** On the landing page it is the inspection log;
   in the app it is the live browser view. Everything else is quiet.

## Tokens

| Name      | Hex       | Role                                                        |
| --------- | --------- | ----------------------------------------------------------- |
| Paper     | `#FFFFFF` | Page canvas, panels                                         |
| Well      | `#F4F5F6` | Sunken surfaces: sidebar, code and screenshot wells, hovers |
| Rule      | `#E2E4E8` | Borders and dividers                                        |
| Ink       | `#0A0A0B` | Text, primary buttons                                       |
| Graphite  | `#5E636B` | Secondary text                                              |
| Cobalt    | `#2445D6` | Links, focus, selection, the live state. Nothing else.      |

Status (only on status): pass `#127A3E`, fail `#C42B1C`, warning `#A85A00`,
skipped/neutral `#6B7079`. Each has a light tint for badge backgrounds.

## Type

- **IBM Plex Sans** for everything people read. Engineering heritage, distinct from
  the Inter default.
- **IBM Plex Mono** only for machine data: URLs, selectors, IDs, durations, code.
  Never for labels or decoration.
- Scale (px): 12 · 13 · 14 (body) · 16 · 20 · 28 · 44 (landing only, 56 on wide screens).
- Weights: 400 body, 500 labels and buttons, 600 headings. Display sizes use
  `-0.02em` letter spacing.
- Sentence case everywhere. No all-caps eyebrows, no accented word in a headline.

## Shape and depth

- Radius: 6px controls and badges, 8px panels, 10px dialogs. No pills except
  the live dot.
- Panels are separated by a 1px Rule border. No shadows on panels.
- One shadow, only for things that float over content: menus, dialogs, toasts.
- No gradients, glows, blur or glass anywhere.

## Layout

- App: sunken left sidebar (Well), content on Paper, max width 1200px.
- Page header: title and one line of context on the left, actions on the right.
  No hero banners inside the app.
- Spacing on a 4px grid; sections 32–48px apart; dense tables 40px rows.

## Motion

- Only in response to an action (open, expand, confirm) or to show live progress.
- No entrance animations on page load inside the app, no hover lift on cards.
  The landing page is the exception: a short opening (once per tab, skippable) and
  the hero setting itself up, then sections fading up as they scroll in (`motion.css`).
- Everything respects `prefers-reduced-motion`.

## Writing

- Plain, specific, user-side words. Buttons say what they do ("Start audit").
- No arrows on buttons. Errors say what happened and how to fix it.

## Never

Purple or violet accents, gradient text, gradient buttons, aurora backgrounds,
glassmorphism, glow shadows, identical icon-card grids, tracked all-caps
eyebrows, middle-dot meta strings as decoration, emoji as icons, arrows on buttons.

## Front pages: the night shift

The landing page and the sign-in and sign-up pages have their own surface, so the
product has a world before you are inside it. The app itself stays on the light
system above.

- **Story.** Snaghunt is a QA crew working through your site at night. The landing
  hero shows that literally: pages of a sample store floating in 3D, a work lamp
  moving from control to control, crosshairs and verdict tags lifting off the page.
  Then the "morning after" section switches to paper and hands you a case file:
  an annotated screenshot, an evidence slip and a stamp.
- **Surface.** Wrap the page in `.night`. Tokens: night `#060708`, raised `#0B0C0E`,
  line `#1A1C20`, faint `#2A2D33`, ink `#EDEEF0`, dim `#8A8F98`, lamp `#FFE9B8`,
  bug `#FF5A4A`, pass `#7BD88F`. The evidence section uses paper `#FAF9F6` with
  ink `#141414` and one red `#D92D20` for the mark.
- **Light.** The lamp is the only light source and the only glow. It sits on what is
  being inspected, never as background decoration.
- **Type.** Headlines use `.display`: Archivo at 125% width, 800, uppercase. Each
  section opens with a numbered `SectionIndex` (`0.01`, `0.02`…) in Plex Mono.
  Body copy stays IBM Plex Sans.
- **3D.** `InspectionScene` is CSS 3D (perspective, `translateZ` layers), not WebGL:
  text stays sharp, nothing extra to download. It fits its width with a
  ResizeObserver, tilts a few degrees toward a mouse pointer, and with reduced
  motion shows the finished state without animating.
- **Buttons.** Pill-shaped on the night surface only: ink fill for the main action,
  a faint outline for the second, lamp fill for the closing call to action.
