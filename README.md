# MindWeaver

MindWeaver is an Obsidian plugin that uses AI to automatically discover and create meaningful backlinks between your notes, and intelligently suggest relevant tags. It analyzes your notes' content and suggests connections that you might have missed, helping you build a more interconnected knowledge base.

## Features

- **AI-Powered Connection Discovery**: Automatically finds meaningful relationships between your notes using advanced language models
- **Multiple Model Options**: Choose from various AI models to balance cost, speed, and accuracy:
  - OpenAI: GPT-4 (Most accurate) or GPT-3.5 (Balanced)
  - Anthropic: Claude 3.5 (Latest & most capable) or Claude 3 (Balanced performance)
  - Together.ai: Llama 2 70B (Low cost)
  - Self-hosted: Llama (Local) or Ollama (Local, easy setup)
- **Intelligent Tag Weaving**: Automatically suggests and adds relevant tags from your existing tag collection
- **Flexible Formatting**: Display backlinks in your preferred format:
  - Comma list
  - Bulleted list
  - Numbered list
  - One per line
- **Custom Instructions**: Add special instructions to guide how connections are discovered
- **Folder Exclusion**: Exclude specific folders from backlink discovery
- **Connection Strength Control**: Adjust how strict or relaxed the connection criteria should be

## Setup

1. Install the plugin from Obsidian's Community Plugins
2. Choose your preferred AI model in settings:
   - For OpenAI models: Enter your [OpenAI API key](https://platform.openai.com/)
   - For Claude models: Enter your [Anthropic API key](https://console.anthropic.com/account/keys)
   - For Llama 2 70B: Enter your [Together.ai API key](https://www.together.ai/)
   - For local Llama: Set up [llama.cpp](https://github.com/ggerganov/llama.cpp) and enter your endpoint
   - For Ollama: Install [Ollama](https://ollama.com/) and enter your endpoint (default: http://localhost:11434)

## Usage

1. Open any note in your vault
2. Click the MindWeaver icon in the ribbon or use the command palette
3. MindWeaver will analyze your note and discover meaningful connections
4. Review the suggested backlinks and click to navigate to connected notes

### Tag Weaving
1. Open any note
2. Use the command palette and search for "Weave tags"
3. MindWeaver will analyze your note and add relevant tags from your vault
4. Tags are automatically added to the end of your note

## Configuration

### Model Selection
Choose your preferred model based on your needs:
- GPT-4: Best accuracy but highest cost
- GPT-3.5: Good balance of accuracy and cost
- Claude 3.5: Latest Anthropic model with high capability
- Claude 3: Balanced performance from Anthropic
- Llama 2 70B: Low-cost option via Together.ai
- Local options (slower but free):
  - Llama: Self-hosted using llama.cpp
  - Ollama: Easier setup with pre-built models

### Tag Settings
- **Custom Tags**: Add tags that may not be in your vault yet
- **Use Only Custom Tags**: Toggle between using all vault tags or only your custom tags

### Connection Strength
- Strict: Only very clear and direct connections
- Balanced: Moderate threshold for connections
- Relaxed: More connections, including indirect ones

### Special Instructions
Add custom instructions to guide how connections are discovered. For example:
- "Only connect notes about similar technologies"
- "Focus on methodological similarities"
- "Connect notes with opposing viewpoints"

## Support

- Report issues on [GitHub](https://github.com/yourusername/mindweaver/issues)

## License

[MIT License](LICENSE)
