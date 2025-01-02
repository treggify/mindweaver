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
2. Enable the plugin by clicking the toggle switch
3. Click the gear icon next to MindWeaver to open settings
4. Enter your OpenAI API key
5. (Optional) Add special instructions for connection discovery
6. Adjust the relevance threshold as needed (0-1)

## Usage

1. Open any note in your vault
2. You can invoke MindWeaver in two ways:
   - Type `/` and choose "MindWeaver: Weave Connections"
   - Open command palette (Cmd/Ctrl + P) and search for "Weave Connections"
3. MindWeaver will analyze your vault and automatically weave relevant connections

## Development

1. Clone this repository
2. Install dependencies with `npm install`
3. Build with `npm run build`
4. Copy the contents of the `build` directory to your vault's plugins directory:
   ```bash
   cp build/* <vault>/.obsidian/plugins/mindweaver/
   ```

The build directory will contain all necessary files:
- `main.js`: The compiled plugin code
- `manifest.json`: Plugin manifest
- `styles.css`: Plugin styles

## License

MIT License
