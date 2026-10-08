# Mil: Design Brief (V1)

## 1. Feel

**"A calm kitchen ledger."** It should feel warm and trustworthy, quick to glance at, and Bangladeshi without being kitschy. It should feel like a well-kept khata that does the maths for you, not a fintech dashboard and not a generic SaaS template.

Three words: **warm · exact · effortless**.

## 2. Principles

1. **Answer first.** Every screen opens with the single number the user came for (my balance, tomorrow's headcount, the meal rate).
2. **One thumb.** Primary actions sit in the bottom half; bottom tab bar; tap targets ≥ 48 px.
3. **Show the maths.** Every number can be tapped to see how it was calculated. Trust comes from transparency.
4. **Neutral tone.** Dues text never blames anyone: "Fahim: ৳450 due" not "Fahim hasn't paid".
5. **Bangla first.** Design layouts with Bangla text first (it's longer and taller), then check English.

## 3. Visual system

| Token | Value | Use |
|---|---|---|
| Background | `#FBF7F0` (paper) · dark `#14130F` | App background |
| Surface | `#FFFFFF` · dark `#1E1C17` | Cards |
| Ink | `#1C1A16` · dark `#F2EEE6` | Text |
| Accent | **Turmeric** `#D9901A` | Primary buttons, active tab, meal toggles on |
| Positive | **Leaf** `#2F7D4F` | "You get back" |
| Negative | **Chili** `#C2412D` | "You owe" |
| Muted | `#8A8378` | Secondary text, locked states |

- Colour is **never the only signal**: owe/get always carries the words and a sign (−৳450 / +৳380). All text pairs meet WCAG AA contrast (check with a contrast tool before finalising).
- **Type:** *Hind Siliguri* (Bangla + Latin, made for screens) for UI; numbers use tabular figures so columns line up. Sizes: 32 balance hero / 20 titles / 16 body / 13 captions. Bangla line-height 1.6.
- **Shape:** 16 px card radius, 12 px button radius, soft single shadow (`0 1px 2px rgb(0 0 0 / .06)`), lots of whitespace.
- **Icons:** Lucide line icons, 1.5 stroke. A few hand-drawn spot illustrations (a hari cooking pot, a bazar bag) for empty states only.
- **Motion:** 150–200 ms ease-out. A number counting up when a balance changes; a toggle "pop". Respect `prefers-reduced-motion`.
- **Dark mode** from day one (follows the system setting).

## 4. Key screens

### Landing page (marketing website)
1. **Hero:** "Run your shared flat without the khata headache." / "মেসের হিসাব, এখন নিজে নিজেই।" Two buttons: **Create a flat** (turmeric) · **Join a flat** (outline). On the right (below on mobile): a phone mockup showing the balance card.
2. **Three-step strip:** Meals → Bazar → Settled, one illustration each.
3. **"What your cook sees"**: the headcount card at real size.
4. **Month-end proof:** a sample settlement text that looks like a Messenger bubble.
5. **For friends and strangers:** relaxed vs strict mode, side by side.
6. **Pricing:** one plan, first month free. **FAQ** (Do members need to install anything? Is our money held? No.)
7. Footer: Bangla/English switch.

### Member Home
```
┌──────────────────────────────┐
│ Mil · Green View Mess    ⚙  │
│                              │
│  October                     │
│  You get back                │
│  +৳380            (leaf)     │
│  Paid ৳3,500 · Cost ৳3,120 › │
├──────────────────────────────┤
│ Tomorrow · locks 10:00 pm    │
│ [ Breakfast ] [Lunch] [Dinner]│  ← big turmeric chips
│  + Guest        Away…        │
├──────────────────────────────┤
│ Meal rate ৳31.78 ›           │
│ Your bazar turn: Thu         │
└──────────────────────────────┘
 [Home] [Meals] [Money] [Flat]
```

### Cook headcount (cook link)
Huge numbers, nothing else. Readable from a metre away, works for a cook with limited reading.
```
  আগামীকাল · Tomorrow
  সকাল   7
  দুপুর   8
  রাত    9
```

### Manager panel
A "Today" card stack: Headcount text [Copy][Share] · 2 payments to confirm · 1 approval · Bazar duty: Rahim. Each card disappears once it's handled. **The aim is that the manager's day can be "nothing to do".**

### Close month
A step list with checkmarks: ✓ All payments confirmed · ✓ No pending approvals · ✓ Totals balance (৳0 difference) → Preview the settlement as a Messenger-style bubble → **Close October**.

## 5. Components (shadcn/ui based)

Balance card · Meal chip toggle (on/off/locked/late) · Amount input (৳, numeric keypad, Bangla numerals optional) · Ledger row (icon, who, note, amount, status pill) · Status pill (pending/late/confirmed) · Share-text card · Bottom tab bar · Step checklist · Empty state with illustration · Toast.

## 6. Accessibility and inclusion

- Body text ≥ 16 px; supports browser zoom up to 200%.
- Every control has a label in both languages; status is never shown by colour alone.
- Works on cheap Android phones (360 px wide, slow 4G).
- Bangla numerals (০১২৩) as an optional setting, with Latin digits as the default for money.

## 7. Deliverables before coding the UI

1. A design tokens file (`tailwind.config` theme + CSS variables, light and dark).
2. High-fidelity mockups of: Landing, Home, Meals, Money, Flat, Manager Today, Close month, Cook link (mobile 360 px, and desktop for the landing page).
3. A clickable prototype of the "normal day" flow and the "month close" flow, tested with 3 real flat members.
