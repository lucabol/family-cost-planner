# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Families comparing the monthly cost of living in Jávea/Xàbia, Savona, and Seattle for a household of two adults, one university student living at home, and one public-secondary-school student.

## Product Purpose

Turn cited cost-of-living evidence into an editable, locally private planning scenario. Success means a visitor can understand the evidence, adjust every adopted monthly amount, choose a contingency, and export a transparent monthly and annual budget.

## Positioning

The planner keeps source provenance, adopted defaults, and personal scenario values visibly separate instead of presenting a single opaque cost-of-living score.

## Operating Context

The public site is static and client-side. Checked-in JSON is refreshed by GitHub-hosted automation, while personal edits remain in the visitor's browser.

## Capabilities and Constraints

- The three supported cities, household composition, currencies, and budget items are fixed by the data contract.
- Every adopted default must have at least one citation.
- Source research must respect access controls and terms; automation must never bypass anti-bot protections.
- Missing or invalid refresh results must not replace the last-known-good checked-in data.
- University living-at-home allowances must not be counted again in household food, housing, or transport.

## Brand Commitments

Use the existing Clawpilot theme variables, typography, and light/dark behavior. The voice is direct, calm, and explicit about uncertainty.

## Evidence on Hand

The original self-contained prototype is the UX and content baseline. Its cited values are migrated to `data/costs.v1.json` with explicit provenance and normalization metadata.

## Product Principles

- Evidence before certainty.
- Adopt the highest comparable normalized upper bound; flag thin or outlying evidence without automatically reducing it.
- Personal inputs stay private and editable.
- Safe automation never degrades known-good data.
- Official sources outrank portals and crowd-sourced estimates.
- Planning assumptions are labeled rather than disguised as observations.

## Accessibility & Inclusion

The site must be responsive, keyboard accessible, screen-reader legible, and usable in light and dark color schemes.
