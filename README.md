# MindWeaver for Obsidian

MindWeaver is an intelligent Obsidian plugin that uses GPT to automatically discover and weave meaningful connections across your knowledge base.

## Features

- **Intelligent Connection Discovery**: Uses GPT to analyze your notes and create meaningful connections
- **Customizable Settings**: Configure API key, special instructions, and relevance threshold
- **Easy to Use**: Invoke with slash command `/weave-connections` or customizable hotkey

## Installation

1. Download the latest release from the releases page
2. Extract the zip file in your Obsidian vault's `.obsidian/plugins/` directory
3. Enable the plugin in Obsidian's Community Plugins settings
4. Configure your OpenAI API key in the plugin settings

## Configuration

1. Open Settings > Community Plugins > MindWeaver
2. Enter your OpenAI API key
3. (Optional) Add special instructions for connection discovery
4. Adjust the relevance threshold as needed (0-1)

## Usage

1. Open any note in your vault
2. Use the slash command `/weave-connections` or the configured hotkey
3. MindWeaver will analyze your vault and automatically weave relevant connections

## Development

1. Clone this repository
2. Install dependencies with `npm install`
3. Build with `npm run build`
4. Copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugins directory

## License

MIT License
