# PaperLoop Enablement: Plugins, Skills, And Execution Notes

Last updated: 2026-05-26

## Summary

No custom Codex skill is required for the current documentation pack. The work is product planning and repository setup, so normal file editing, Browser research, and git tools are enough.

Future custom skills may be useful once PaperLoop moves from planning into repeatable workflows such as OCR ingestion research, publisher onboarding, or product requirement generation.

## Recommended Plugins

| Plugin | Required now | Use |
| --- | --- | --- |
| Browser | Yes | Inspect reference e-paper products, verify responsive web prototypes, test local app flows, capture screenshots during frontend QA. |
| Documents | Optional | Export the planning pack into `.docx` or polished proposal documents for stakeholders. |
| Spreadsheets | Optional | Build revenue models, KPI dashboards, campaign tracking templates, pricing tables, and publisher onboarding trackers. |
| Presentations | Optional | Create pitch decks for publishers, investors, or internal planning reviews. |

## Suggested Future Skills

Create these only if the workflow becomes repetitive:

| Skill | Trigger | Purpose |
| --- | --- | --- |
| `epaper-competitive-research` | Repeated competitor analysis | Standardize e-paper feature audits, screenshots, and gap maps. |
| `paperloop-prd-writer` | Repeated PRD updates | Keep product docs consistent across modules and releases. |
| `hindi-epaper-ocr-review` | OCR pipeline planning | Document OCR quality checks, manual correction workflow, and Hindi layout constraints. |
| `publisher-onboarding-pack` | Publisher sales/support docs | Generate checklists, onboarding docs, pilot questionnaires, and training material. |

## Implementation Plugins For Later App Build

When development begins, use:

- Browser plugin for local frontend verification across desktop and mobile viewports.
- Spreadsheets plugin if pricing, revenue model, or analytics exports need workbook artifacts.
- Documents plugin if stakeholder-ready PRDs, proposals, or contracts need formal formatting.
- Presentations plugin if the team needs a pitch deck or publisher demo deck.

## Current Decision

Do not create a custom skill yet. The immediate deliverable is a committed planning repository, and introducing a skill before repeatable workflows exist would add maintenance without improving the current output.
