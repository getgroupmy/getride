# graphify
- **graphify** (`.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.
# ui-ux-pro-max
- **ui-ux-pro-max** (`.claude/skills/ui-ux-pro-max/SKILL.md`) - UI/UX design intelligence: searchable rule database (accessibility, touch targets, layout, typography, colour, motion) with a React Native stack profile. Use it when designing, building, or reviewing app UI.
Query it with `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <ux|web|style|color|typography> [--stack react-native]`.
For this repo the useful domains are `web` (React Native app-interface rules), `ux`, and `--stack react-native`; the `--design-system` generator is tuned for marketing landing pages and its pattern/style/typography output does not fit an existing branded mobile app. See `docs/ui-ux-audit.md`.
