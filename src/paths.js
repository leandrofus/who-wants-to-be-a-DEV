// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Leandro <leandrofusdev@gmail.com>
// Per-user directory for config.json, prefs.json and the pid file.
import os from 'node:os';
import path from 'node:path';

export function dataDir() {
  if (process.env.QUIZ_DEV_HOME) return process.env.QUIZ_DEV_HOME;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'quiz-dev');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'quiz-dev');
}
