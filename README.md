# quiz-dev

A *Who Wants to Be a Millionaire*-style quiz about **your own repo**, to play while your coding agent
([Claude Code](https://claude.com/claude-code)) is working. Stay sharp on the language and the codebase instead of
staring at a spinner.

- 10-question ladder, 50:50 and pass lifelines, WebGL stage, suspense and sound effects (all synthesized, no assets).
- Questions are generated from the repo you are working in, restricted to your current topic
  (frontend / backend / database / infra, or a feature like `customers`), and always self-contained.
- Questions in your language (English, Spanish, Portuguese, French, German, Italian, Chinese, Japanese).
- A sound + toast + desktop notification when the agent finishes.

## Install

```sh
npm i -g quiz-dev
quiz-dev install      # installs the /quiz skill and the Claude Code hooks
```

Restart Claude Code (or `/reload-skills`), then type `/quiz`, or run `quiz-dev start` from any terminal.
`quiz-dev install --dry-run` shows what would change; `quiz-dev uninstall` removes everything.
(`npx` is not enough for `install`: the hooks call the `quiz-dev` command, so it must be on your PATH.)

## How it works

| Piece | What it does |
|---|---|
| `quiz-dev start` | Local server on `127.0.0.1:7777` + opens the game in your browser. |
| Hooks (`UserPromptSubmit`, `Stop`) | Tell the game when the agent starts/finishes and which repo/session/prompt it is on. They cost no tokens. |
| Question generator | Runs `claude -p --model haiku` with the prompt on stdin (uses your Claude Code login), or the API with `ANTHROPIC_API_KEY`, or a local Ollama model. Pre-generates 10 per session. |

## Privacy

To write questions, **snippets of your code** (about 50 lines of a file, the file list, recent commit subjects and the
uncommitted diff) and your last prompts are sent to the model through your own `claude` CLI / API key. Files named
like secrets (`.env`, `*.key`, `*.pem`, `secret`, `credential`, lockfiles) are skipped. Nothing else leaves your machine,
the server listens on loopback only, and the game page loads no third-party code.

## Cost

Each question is one small Haiku call (about 12k mostly-cached input tokens, ~500 output, a fraction of a cent).
A full queue is roughly 10–15 calls. They count against your Claude usage like any other request. Lower `prefetch` to reduce.

## Configuration

`quiz-dev config` prints the path of `config.json` (in your user config dir). Everything is optional:

```json
{
  "port": 7777,
  "repo": "",
  "questionLanguage": "en",
  "difficulty": "intermediate",
  "provider": "auto",
  "claudeCliModel": "haiku",
  "prefetch": 10
}
```

- `repo`: pin the game to one repo regardless of where the agent runs (empty = follow the agent).
- `provider`: `auto` (API key → `claude` CLI → Ollama), `claude-cli`, `anthropic`, or `ollama`.
- Topic choices are saved per repo in `prefs.json` next to the config.

## Controls

**PR review mode:** in the topics dialog (`T`) pick *PR review* instead of topics. Questions are then generated from the diff of your current branch against its base (the open GitHub PR if `gh` is available, otherwise `origin/main`/`master`; with no branch changes, the last commit). The point: prove you understand what you are about to ship.

`A–D` / `1–4` or click: answer · `Enter`: confirm · `F`: 50:50 · `P`: pass · `T`: choose topics.

## Platforms

Developed and tested on Linux. macOS and Windows code paths (browser opening, desktop notifications, process stop) are
included but untested. Requires Node 18+. Three.js (MIT) is bundled in `public/vendor`.

## License

Copyright (C) 2026 Leandro <leandrofusdev@gmail.com>

Licensed under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later); see `LICENSE`.
The bundled Three.js (`public/vendor`) is MIT-licensed, see `public/vendor/three.LICENSE`.
