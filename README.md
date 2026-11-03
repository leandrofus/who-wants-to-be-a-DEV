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
| Question generator | Requests one batch of up to 10 questions from the selected provider: Claude Code, Antigravity (`agy`), Codex CLI, Anthropic API, or Ollama. |

## Privacy

To write questions, **snippets of your code** (about 50 lines of a file, the file list, recent commit subjects and the
uncommitted diff) and your last prompts are sent to the selected provider using its CLI login, API key, or local
Ollama instance. Files named
like secrets (`.env`, `*.key`, `*.pem`, `secret`, `credential`, lockfiles) are skipped. Nothing else leaves your machine,
the server listens on loopback only, and the game page loads no third-party code.

## Cost

Questions are generated in batches of 10 with one provider call; the batch is queued and served one question at a time.
The output is larger than a single-question response, but avoids starting a separate CLI session for every question.
Lower `prefetch` in `config.json` (1–10) to request a smaller batch.

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

- `repo`: pin the game to one repo regardless of where the agent runs (empty = follow the agent; `quiz-dev start` initially uses the current folder/repo).
- `provider`: the default question generator: `auto` (API key → Claude Code → Ollama), `claude-cli`, `antigravity`, `codex`, `anthropic`, or `ollama`. You can override it from the Topics dialog; that choice is saved in `prefs.json`.
- `prefetch`: questions per generated batch (1–10; defaults to 10).
- The Topics dialog's **Question provider** setting supports Claude Code (`claude`), Antigravity (`agy`), Codex CLI (`codex`), and Ollama. `Automatic` preserves the configured fallback order; **Anthropic API** requires `ANTHROPIC_API_KEY`.
- Topic choices are saved per repo in `prefs.json` next to the config.

The Topics dialog lets you browse to and pin any folder, switch to a recent folder, or return to automatic repo selection.

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
