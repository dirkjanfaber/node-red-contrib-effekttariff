# CLAUDE.md — Project Instructions for Claude Code

## Before tagging a release

Always run through this checklist before bumping the version and pushing a tag:

1. **Run the full test suite** — `npm test` must pass with no failures.
2. **Update `ROADMAP.md`** — add the new version to the "Released" section with a summary of changes. Move any items from "Planned" that were completed.
3. **Review tariff research docs** — scan `docs/tariffs/*.md` for any items that may have changed:
   - Netherlands (`docs/tariffs/netherlands.md`): check for ACM updates. The proposal is expected to be finalised **end of 2026**. Once confirmed, create the Netherlands preset.
   - Flanders (`docs/tariffs/flanders.md`): check for Fluvius rule changes.
   - Sweden (`docs/tariffs/sweden.md`): check for new provider configurations from community feedback.
4. **Update open GitHub issues** — close any issues resolved by the release; check if any blockers have been lifted.
5. **Regenerate simulation reports** — run `node scripts/generate-index.js` if scenarios changed, and commit updated `docs/simulations/`.

## Code conventions

- Internal identifiers (e.g. `region: 'belgium'`, `belgiumMode`) must stay stable for backward compatibility. Only user-facing text should be updated.
- All core logic (peak tracking, limit calculation) must have unit tests.
- Never work directly on `main` for new features — use a feature branch.
- No AI attribution in commit messages.

## Project structure

- `lib/peak-tracker.js` — core peak tracking and limit calculation logic
- `lib/scenarios.js` — simulation scenario definitions
- `lib/simulation.js` — simulation runner
- `src/nodes/effekttariff.js` — Node-RED node runtime
- `src/nodes/effekttariff.html` — Node-RED editor UI and help text
- `docs/tariffs/` — per-country tariff research notes
- `ROADMAP.md` — release history and planned work
- `test/` — Jest unit and integration tests

## Sweden-specific

Default preset matches the most common Swedish provider rules (3 peaks, weekdays, 07–21, Nov–Mar). Provider variations (Jönköping Energi: 2 peaks, Bixia: night discount) are documented in `docs/tariffs/sweden.md`.

## Flanders-specific

The Belgian capaciteitstarief applies only to Flanders. Wallonia uses different rules and is not currently supported. Internal code identifiers (`region: 'belgium'`, `belgiumMode`, etc.) are kept as-is for backward compatibility.

## Netherlands (future)

Research is in `docs/tariffs/netherlands.md`. Implementation is blocked until ACM finalises time block hours (expected end 2026). Tracked in GitHub issue #11.
