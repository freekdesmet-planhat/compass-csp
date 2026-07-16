# Changelog

This file is the source of truth for the in-app **What's new** panel.
`npm run changelog:sync` upserts these entries into the `changelog_entries` table
on deploy. Format: `## <version> — <YYYY-MM-DD>`, then `### new|improved|fixed`
sections with `- <title>: <body>` lines.

## 1.1.0 — 2026-07-16

### new
- Ask Compass: Chat with an agent about your book — renewals, usage, activity, all scoped to what you can see.
- Dashboards: Build, arrange and share widget dashboards from a safe dataset layer.
- CSV import: Import companies, contacts and usage metrics with mapping, validation and dedupe modes.
- Library: A shelf for QBR decks, one-pagers, templates and links.
- Whitespace map: Products × accounts heatmap to spot cross-sell plays; create expansion deals in a click.
- Contact 360: Every contact name links to a full record with activity, emails, meetings, NPS and tasks.
- Latest news: AI web-search news card on the 360, auto-refreshed weekly for enterprise accounts.
- Usage tab: Utilisation, per-metric charts and adoption grid driven by usage_metrics.
- @mentions & notifications: Mention teammates in notes; in-app bell + optional Slack DM.
- Log interaction: Capture in-person meetings and unrecorded calls with a sentiment slider that feeds health.

### improved
- Everything is clickable: Portfolio KPI cards, report charts and dashboard widgets drill through to filtered views.
- Editable everywhere: MEDDIC toggles, contact fields, success-plan statuses and deal qualification are all hand-editable.
- Collapsible sidebar: No more truncation; collapse toggle + "[" shortcut, persisted per user.
- Full-size demo books: 150 scaled / 70 mid-touch accounts so pagination and performance are honestly exercised.

### fixed
- 360 quick actions wired: Log note / Task / Email / Meeting now open the right composer or modal; graceful disconnected-Gmail state.
- NPS page populated: Root-caused the empty NPS page, added manual "Log NPS response" and a proper empty state.
- Tasks complete on the 360 Tasks tab with optimistic UI and a Completed group.
- Email rows show From / To / Cc as chips linking to Contact 360.

## 1.0.0 — 2026-07-14

### new
- Compass V1 launch: Portfolio review, 360s, health engine, renewals, playbooks, digests, ⌘K, integrations (Gmail/Calendar/Fathom/Aircall/HubSpot/Outreach), Planhat migration.
