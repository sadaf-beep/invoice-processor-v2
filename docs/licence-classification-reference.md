# Licence, Software Licence, and SLA — Classification Reference

Reference examples for distinguishing **Licence**, **Software Licence**, **SLA**, **Hardware**,
and adjacent categories (Bulk/Materials, Labor, Service, Travel) when processing vendor
quotes/POs into the Beam licence import format. Drawn from real processing sessions (Riedel PO),
synthetic test data (Nexus test PO), and known vendor patterns referenced in the licence-
processing skill (Ross Video, Grass Valley/GVCare).

This file is the source of truth for the classification guidance baked into the extraction
prompts in `lib/extractInvoice.ts` (both the asset invoice's PREPAID classification and the
licence extraction's Type field). If this reference changes, update those prompts to match.

---

## 1. Licence (general definition)

A licence is a **right to use** something — software, a feature, or occasionally a bundled
capability — granted for a period (or perpetually), in exchange for payment. The commercial
substance is "you may use X," not "here is a physical thing." Type = `License`.

### Extended positive examples

| Item | Vendor pattern | Why it's a licence |
|---|---|---|
| MediaHub Pro Suite License — 50 Concurrent User Seats, Annual Subscription | Generic SaaS | Seat-based usage right, term-limited |
| Stream Analytics Add-on License, Annual Renewal | Generic SaaS | Add-on module usage right, recurring |
| Closed Caption Compliance Module License, Perpetual | Generic SaaS | Indefinite usage right, no term end |
| VAE-16 Plus Virtual Artist Expansion Plus License, 16 Ports | Riedel | Feature/capacity expansion on existing hardware, hardware-linked |
| GVG-STRATUS-ENTERPRISE License, 4-Channel Bundle | Grass Valley pattern | Channel-count-based usage right |
| Ross Xpression Graphics Engine License — Node-Locked | Ross Video pattern | Tied to a specific machine/node rather than a user count |
| PCR Automation Suite License, Site License (Unlimited Seats) | Ross Video pattern | Site-wide rather than per-seat, still a usage right |
| GVCare Software Update Entitlement — Firmware Access Rights | Grass Valley | Right to receive/install firmware updates, distinct from the SLA response-time promise |
| Codec Pack License — H.265 Encode/Decode Enablement | Generic hardware vendor | Unlocks a capability on hardware already owned |
| Redundancy/Failover License — Dual-Frame Sync Enablement | Broadcast infra vendor | Enables a mode of operation, not a physical part |

### Extended negative examples (NOT licences)

| Item | Why it's excluded | Correct Type |
|---|---|---|
| PTZ Camera, Model X200 4K | Physical equipment, no bundled usage right | Hardware |
| Rack-Mount Video Switcher VS-64 | Physical equipment | Hardware |
| Cat6 Shielded Cable, 100ft Spool | Bulk material, no usage right | Materials |
| XLR Connector Pack (10-pack) | Bulk accessory | Materials |
| On-Site Installation Labor — 16 hrs @ $125/hr | A service performed once | Labor |
| Engineer Travel & Per Diem — 3-Day Site Visit | Reimbursed travel cost | Travel |
| US Tariff Surcharge | One-time pass-through government fee | Materials |
| Freight & Logistics Fee | One-time shipping cost | Materials |
| Rack Unit Installation Kit (screws, rails, cable ties) | Physical consumable, no usage right | Materials |
| Spare Power Supply Unit, Hot-Swap | Replacement hardware part | Hardware |

---

## 2. Software Licence (a subtype of Licence)

Specifically grants rights to use a **software** product, module, or feature — as opposed to a
right to use physical hardware (rare) or a support/coverage promise (see SLA below).

**Tells:**
- Description usually contains "License," "Subscription," "Seats," "Module," "Add-on," "Entitlement"
- Priced per seat / user / port / channel / instance, or as a flat annual/perpetual fee
- Often references hardware it runs on via **Asset Relationships** (a serial number) — without
  itself being hardware.

### Extended positive examples by licensing model

| Licensing model | Example | Notes |
|---|---|---|
| Per-seat / per-user | MediaHub Pro Suite License, 50 Seats | Price scales with seat count |
| Per-port / per-channel | VAE-16 Plus Expansion, 16 Ports | Price scales with port/channel count |
| Node-locked | Ross Xpression Graphics Engine License — Node-Locked | Tied to one machine, not a user count |
| Site license | PCR Automation Suite, Site License (Unlimited Seats) | Flat fee regardless of seat count |
| Subscription (term-based) | Stream Analytics Add-on License, Annual Renewal | Recurs annually, lapses if not renewed |
| Perpetual | Closed Caption Compliance Module License, Perpetual | One-time fee, indefinite right |
| Feature unlock on owned hardware | Codec Pack License — H.265 Enablement | No new hardware ships, only unlocks capability |
| Capacity/tier upgrade | Storage Tier Upgrade License — 10TB to 50TB | Unlocks higher usage ceiling on existing platform |
| Bundle | GVG-STRATUS-ENTERPRISE License, 4-Channel Bundle | Multiple channels/features sold as one licence record |

### Hardware-linked software licence example (worked)
> **VAE-16 Plus Virtual Artist Expansion Plus License, 16 Ports** (Riedel PO)
> Type = `License`. Asset Relationships = `SN1460023250100` (the Encore Frame's serial number).
> The frame itself is a separate Hardware record; the licence record only *references* it.
> Never merge a hardware serial and a software licence into a single Hardware-typed row.

---

## 3. SLA (Service Level Agreement)

A **support/maintenance coverage** commitment — response times, repair, replacement, or update
entitlement over a period. Not a right to use software; a right to receive support. Type = `SLA`.

### Extended positive examples

| Item | Vendor pattern | Notes |
|---|---|---|
| Riedel Care Enhanced — Service Level Agreement, One Year | Riedel | Named "SLA" explicitly |
| Nexus Care Enhanced — Service Level Agreement, One Year | Generic | Named "SLA" explicitly |
| GVCare Support Agreement — Gold Tier, 24/7 Response | Grass Valley | Tiered SLA, response-time commitment |
| Ross Video Care Plan — Next Business Day Replacement | Ross Video | Named "Care Plan," functions as an SLA |
| Advance Replacement Program — 4-Hour Hardware Swap | Generic hardware vendor | Not literally "SLA," but is one functionally |
| Software Maintenance & Update Agreement, Annual | Generic SaaS | Support/patch commitment, distinct from usage-right licence |
| TAC (Technical Assistance Center) Support Contract, Silver | Networking vendor pattern | Support-tier naming, still an SLA |

### Boundary case: Extended Warranty
"Extended Warranty, Prepaid — 3 Year Term" behaves like an SLA (ongoing coverage over a defined
term) but isn't literally labeled "SLA," and the Type field has no dedicated "Prepaid" option.

**Handling rule:** map to `SLA` as the closest coverage-type fit, and add a Review Note flagging
the mapping so it can be corrected later if a "Prepaid" Type is ever added.

### Other near-miss boundary cases
| Item | Classify as | Why it's a near-miss |
|---|---|---|
| Extended Warranty, Prepaid — 3 Year Term | SLA (flagged) | Coverage-like, not literally named SLA |
| Advance Replacement Program, 4-Hour Swap | SLA | Sounds like a shipping/logistics service but is a coverage tier |
| Firmware Update Subscription, Annual | Could be License or SLA — flag | If it's "right to receive updates," lean SLA; if it's "right to run a new firmware feature set," lean License. Ask if unclear. |
| Priority Support Add-on (ticket queue jump) | SLA | Support-tier upsell, not a usage right |

---

## 4. Hardware — and the "can hardware be a licence?" edge case

Standalone hardware is never a licence, regardless of whether a licence elsewhere references its
serial number. Type = `Hardware`. Per the skill's duplicate-sheet rule, standalone hardware found
**only in an internal budget doc** (separate from the authoritative vendor quote) should be
excluded from the licence sheet entirely and flagged to CS/Implementation for a possible asset
import instead. Hardware appearing as a native line item on the **vendor's own quote/PO** may
still be included, typed `Hardware`, but should be flagged for confirmation on whether it belongs
on an asset sheet instead.

### Extended true-hardware examples (not a licence)
- PTZ Camera, Model X200 4K
- Rack-Mount Video Switcher VS-64
- Wireless Intercom Beltpack IC-500
- SFP CPU Module (Riedel PO)
- Encore Frame (chassis itself, as opposed to licences that run on it)
- Rack-mount UPS / Power Distribution Unit
- Fiber patch panel
- Replacement fan tray / hot-swap PSU

### The genuine grey zone: hardware key / dongle-style licences
If a physical token's **entire purpose** is unlocking a software entitlement — no dongle, no
access, and the item has no independent function — the commercial substance is a licence.
Type = `License` even though something physical ships.

| Example | Classify as | Reasoning |
|---|---|---|
| Codec Activation Dongle — required to unlock 4K encode license, no function without paired subscription | License | Dongle has zero independent utility; it *is* the licence mechanism |
| USB Security Key for DAW Software Authorization | License | Same pattern — token only gates software access |
| Encore Frame, SN1460023250100 (chassis) | Hardware | Fully functional on its own; licences merely reference its serial |
| Replacement SFP Module (no licence tie) | Hardware | Independently functional part |

Contrast with functional hardware that merely *hosts* a licence (e.g., an Encore Frame whose
serial a separate licence record points to via Asset Relationships): that stays `Hardware`, and
the licence stays a separate `License` row linked by serial number — never merged into one row.

---

## 5. Quick decision checklist

1. Does the price grant a right to use software/a feature? → **License**
2. Is it a promise of ongoing support, repair, or response time? → **SLA**
3. Is it a warranty/coverage that doesn't literally say "SLA"? → **SLA** (flag as Prepaid-mapped)
4. Is it a standalone physical item with no bundled usage right? → **Hardware** (flag for
   possible asset-sheet exclusion)
5. Is the physical item's sole function to unlock a licence with no independent use? →
   **License** (rare — flag for confirmation)
6. Is it a one-time fee, bulk material, or labor charge? → **Materials** / **Labor** / **Travel**
7. Does it sit ambiguously between "receiving updates" (SLA) and "running new features"
   (License)? → Flag explicitly rather than guessing; the distinction depends on what the vendor
   is actually promising, which isn't always obvious from the line item name alone.
