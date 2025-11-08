# Claude Aide Chat for Obsidian

Claude Aide Chat adds an aide bar to Obsidian that lets you collaborate with Claude directly inside your vault. The plugin is built on top of the [Claude Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview), giving Claude access to Claude Code's tooling pipeline so it can inspect files, run shell commands, and execute multi-step plans while you stay in control.

## Features

- 📎 **Pinned aide bar** – a dedicated sidebar view that keeps the conversation within reach while you browse notes.
- ⚡ **Claude Agent SDK integration** – stream responses from Claude Code with support for tool calls and usage summaries.
- 🔐 **Local API key storage** – your Anthropic API key is stored in the plugin's local data file only.
- 🧭 **Session controls** – quickly reset the session, cancel in-flight requests, and watch authentication status updates as Claude works.

## Getting started

1. Install the dependencies and build the plugin:
   ```bash
   npm install
   npm run build
   ```
2. Copy `main.js`, `manifest.json`, `styles.css`, and the `node_modules/@anthropic-ai/claude-agent-sdk` runtime assets into `<vault>/.obsidian/plugins/claude-aide-chat/`.
3. Enable **Claude Aide Chat** from *Settings → Community plugins* inside Obsidian.
4. Open the aide bar using the ribbon button or the `Open Claude aide chat` command.
5. Paste your Anthropic API key on the settings page and choose the default model you want Claude to use.

> **Note:** The Claude Agent SDK currently requires a desktop environment with Node.js tooling available. As such, this plugin is marked `isDesktopOnly`.

## Usage

- Type a prompt in the aide bar input and press **Send**. Claude will stream its response live.
- Use the **Stop** button to cancel the current request if you want to change course mid-stream.
- Press **New session** to reset the conversation and start a fresh Claude session.
- Usage statistics (tokens, cost, and duration) are shown beneath each assistant reply when available. You can disable these summaries from the settings tab.

## Configuration options

The plugin adds a settings tab with the following controls:

| Setting | Description |
| --- | --- |
| **Anthropic API key** | Required for authenticating with the Claude Agent SDK. Stored locally in your vault. |
| **Default Claude model** | Choose between Claude 3.5 Haiku, Sonnet, or Opus for new sessions. |
| **Custom instructions** | Optional text that is appended to the built-in Claude Code system prompt. |
| **Open chat on startup** | Automatically open the aide bar when Obsidian loads the plugin. |
| **Show usage summaries** | Toggle the per-response cost and token footer. |

## Development

- `npm run dev` – start esbuild in watch mode.
- `npm run build` – run TypeScript type-checking and create a production build.

The plugin bundles the Claude Agent SDK so the resulting `main.js` is sizable. Keep the generated files (`main.js`, `manifest.json`, `styles.css`) at the plugin root when distributing updates.
