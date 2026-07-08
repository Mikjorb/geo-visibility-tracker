---
name: Feature request
about: Suggest an idea for the tracker
labels: enhancement
---

**Problem**
What problem would this feature solve? What are you trying to measure or do?

**Proposed solution**
A clear description of what you want to happen.

**Alternatives considered**
Any alternative solutions or workarounds you've considered.

**Note on architecture**
This project deliberately avoids automatic Anthropic API calls from server code (see
CONTRIBUTING.md). Features requiring LLM analysis should work through a Claude Code session or a
rule-based approach.
