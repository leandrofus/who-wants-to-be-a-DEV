---
name: quiz
description: Start (or stop) the "Who Wants to Be a Dev?" quiz game to play while the agent works. Only when the user types /quiz.
disable-model-invocation: true
argument-hint: "[stop]"
---

Argument received: `$ARGUMENTS`

- If the argument is `stop`: run `quiz-dev stop` and confirm in one line.
- Otherwise run `quiz-dev start` (it starts the server if needed and opens the browser).

If the command is not found, tell the user to run `npm i -g quiz-dev`. Reply in one or two lines: the URL, and that questions come from the current repo/topic. Do not read project files.
