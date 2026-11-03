# Launch copy (English)

> Before posting: `npm publish` so the `npm i -g quiz-dev` shown on the end card actually works, and upload
> `out/trailer.mp4` (YouTube for Hacker News; native upload for Reddit).

## Hacker News

**Title:** Show HN: Who Wants to Be a Dev? – a quiz about your own repo while your coding agent works

**URL:** https://github.com/leandrofus/who-wants-to-be-a-DEV

**First comment:**

I kept noticing that while a coding agent works I just stare at a spinner and then approve diffs I only half
understand. Over months that is how skills rust, and how "my" codebase stops being mine.

quiz-dev is a small Claude Code skill + hooks that turns the wait into a Who-Wants-to-Be-a-Millionaire style quiz
about the repo you are actually working in. It reads the topic you're touching (frontend / backend / database /
infra, or a feature like "customers"), generates self-contained multiple-choice questions from real snippets of
your code with a cheap model (Haiku, through your own `claude` login), keeps 10 ready per session, and pings you
(sound + toast + desktop notification) the moment the agent finishes.

The goals, in order: prevent skill rust, prove to yourself that you own the code, and be calm about what the agent
ships because you know what it wrote.

Things worth knowing up front:
- Snippets of your code (~50 lines, file list, recent commit subjects, your last prompts) go to the model through your
  own `claude` CLI/API key. Secret-looking files are skipped. Nothing else leaves the machine; the server binds to loopback.
- Each question is one small Haiku call (a fraction of a cent); it counts against your usage.
- The questions are LLM-written, so an occasional one will be ambiguous. I filter the obvious cases, not all of them.
- Developed and tested on Linux; macOS/Windows paths are written but untested.
- AGPL-3.0-or-later. The trailer is rendered from the real UI (the repo has the scripts under `trailer/`).

Feedback very welcome, especially on question quality.

## Reddit (r/ClaudeAI, r/SideProject)

**Title:** I built a "Who Wants to Be a Millionaire" quiz about your own repo to play while your coding agent works

**Body:**

While the agent is coding, I used to stare at a spinner and rubber-stamp diffs. Now that wait is a quiz about the
code I'm actually working on.

- Prevents skill rust: keeps the language and the codebase fresh in your head.
- Proves you own your code: you answer concrete questions about *your* repo.
- Peace of mind: you know what your agent wrote and why.

It picks the topic from what you're touching (or you choose: backend / frontend / a feature), pre-generates 10
questions per session with Haiku, and alerts you when the agent is done. Open source (AGPL), `npm i -g quiz-dev`.

Repo: https://github.com/leandrofus/who-wants-to-be-a-DEV
Heads-up: it sends small snippets of your code to the model via your own `claude` login, and it's only tested on Linux so far.
