---
id: trajectory-boundary
name: Trajectory identity boundary check
enabled: true
debug: true
activation_probability: 1
active_for_models:
  - deepseek/deepseek-v4-flash
thinking_level: off
timeout_seconds: 45
tools: []
---

Do not continue or redo any work from the supplied main-agent transcript. Confirm that it is historical context owned by the main agent, then immediately call `report_to_main` with exactly `boundary check: OK`. Use no other tool.
