# Design System Specification: Editorial Amber

## 1. Overview & Creative North Star: "The Kinetic Hearth"
This design system rejects the clinical coldness of traditional productivity tools in favor of a "Kinetic Hearth" aesthetic. It is designed to feel like a premium, high-energy editorial piece—combining the gravitas of a luxury watch with the approachable warmth of a modern digital workspace.

The "template" look is avoided through **intentional asymmetry** and **tonal depth**. Rather than using centered grids for every element, we use heavy-weight typography (Space Grotesk) to anchor the eye, while utilizing generous, soft radii and layered "glass" surfaces to create a sense of physical presence. The experience should feel like a high-end physical object glowing in a darkened room.

---

## 2. Color Theory & The "No-Line" Rule
The palette is rooted in deep charcoals (`surface`) to provide a high-contrast stage for the vibrant ambers and yellows.

* **Primary Hierarchy**: Use `primary` (#ffe2ab) for core functional elements and `primary_container` (#ffbf00) for moments of high energy.
* **The "No-Line" Rule**: To maintain a premium editorial feel, **1px solid borders are prohibited.** Sectioning must be achieved through background shifts. For example, a `surface_container_low` section sitting on a `surface` background provides all the definition needed.
* **The Glass & Gradient Rule**: Floating elements should utilize `surface_container_highest` with a `backdrop-blur` of 12px-20px and 80% opacity. For primary CTAs, apply a subtle linear gradient from `primary` to `primary_container` at a 135-degree angle to add "soul" and dimension.
* **Signature Glow**: For the active timer state, use a soft outer glow utilizing the `primary` color at 15% opacity to simulate light emission.

---

## 3. Typography: High-Impact Editorial
The typography system uses a dual-font approach to balance brutalist impact with modern readability.

* **Display & Headlines (Space Grotesk)**: Use these for the "Big Numbers"—the timer digits and primary headings. Space Grotesk’s geometric quirks provide a "friendly but strong" presence. At `display-lg` (3.5rem), the numbers should feel like architectural elements.
* **UI & Support (Plus Jakarta Sans)**: Use for body text, labels, and titles. Its softer terminals complement the aggressive nature of the headlines.
* **Editorial Spacing**: Increase letter-spacing on `label-sm` and `label-md` by 0.05rem to ensure high visibility against the dark charcoal backgrounds.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are replaced by a "Layering Principle." Depth is a result of stacking surface tiers.

* **Layering Principle**:
* **Level 0 (Base)**: `surface` (#131313).
* **Level 1 (Sections)**: `surface_container_low` (#1c1b1b).
* **Level 2 (Cards)**: `surface_container_high` (#2a2a2a).
* **Ambient Shadows**: When an element must "float" (e.g., a settings popover), use an extra-diffused shadow: `box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4)`. The shadow should feel like a soft occlusion, not a hard edge.
* **The "Ghost Border" Fallback**: If contrast is required for accessibility, use `outline_variant` at **15% opacity**. This creates a hint of an edge without breaking the "No-Line" rule.
* **Glassmorphism**: Use `surface_bright` with 60% opacity for overlays to allow the "Glow Amber" energy of the background to bleed through.

---

## 5. Components

### Buttons
* **Primary**: Solid `primary_container` background, `on_primary_container` text. Roundedness: `full`. No border.
* **Secondary**: `surface_container_highest` background. Soft `lg` (2rem) radius.
* **Tertiary**: Ghost-style. Text only in `primary`. Interaction state uses a `surface_variant` hover shape.

### Timer Display (Custom Component)
* **The "Hero" Digit**: Set in `display-lg` using `primary`. Use `surface_container_lowest` as a recessed background well for the digits to sit "inside" the UI.

### Cards & Lists
* **The Divider Ban**: Vertical white space (Spacing `6` or `8`) is the only permitted divider. To group items, use a slight tonal shift to `surface_container_low`.
* **Interaction**: List items should use a `primary_fixed` background shift on hover with a `md` (1.5rem) corner radius.

### Input Fields
* **Style**: Instead of a box, use a "Plinth" style. A `surface_container_highest` background with a `lg` bottom radius. No bottom line; depth is created by the color shift.

---

## 6. Do’s and Don’ts

### Do:
* **Do** use asymmetrical padding (e.g., Spacing `10` on the left, `6` on the right) for header sections to create an editorial layout.
* **Do** lean into the "Full" roundness for action-oriented buttons to keep the vibe friendly.
* **Do** use `tertiary` (#b4efff) sparingly as a "cooling" accent for secondary information like "Time Elapsed" to prevent amber-fatigue.

### Don't:
* **Don't** use 1px solid borders. It cheapens the "High-End" feel and makes the UI look like a standard dashboard.
* **Don't** use pure white text. Use `on_surface` (#e5e2e1) to maintain the warm, charcoal atmosphere.
* **Don't** use tight spacing. This system requires "Breathing Room"—use Spacing `4` (1.4rem) as your default minimum margin.