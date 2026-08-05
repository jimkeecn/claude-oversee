---
description: Toggle Claude Oversee web review for this project (on | off | status)
---

Run the Claude Oversee CLI with the user's argument and show its output to the user verbatim. If no argument was provided, use `status`.

```
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.cjs" $ARGUMENTS
```

Do not add commentary beyond the command output. If the output mentions pending review URLs, present them as clickable links.
