import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

interface AutoBacklinksSettings {
    apiKey: string;
    specialInstructions: string;
    excludeFolders: string[];
    relevanceThreshold: number;
    slashCommandPrompt: string;
    commandName: string;
    vaultIndex: { [key: string]: string }; // path -> concepts mapping
    lastIndexed: number;
}

const DEFAULT_SETTINGS: AutoBacklinksSettings = {
    apiKey: '',
    specialInstructions: '',
    excludeFolders: [],
    relevanceThreshold: 0.7,
    slashCommandPrompt: 'Find connections in my notes by analyzing the current note and suggesting relevant links.',
    commandName: 'Weave Connections',
    vaultIndex: {},
    lastIndexed: 0
}

export default class AutoBacklinksPlugin extends Plugin {
    settings: AutoBacklinksSettings;

    async onload() {
        console.log('Loading MindWeaver plugin');
        
        await this.loadSettings();

        // Add slash command
        this.addCommand({
            id: 'weave-connections',
            name: this.settings.commandName || 'Weave Connections',
            callback: () => {
                console.log('Executing weave-connections command');
                try {
                    this.generateBacklinks();
                } catch (error) {
                    console.error('Error in weave-connections command:', error);
                    new Notice('Error executing command. Check console for details.');
                }
            }
        });

        // Add command to reindex vault
        this.addCommand({
            id: 'reindex-vault',
            name: 'Reindex Vault',
            callback: () => {
                console.log('Executing reindex-vault command');
                try {
                    this.indexVault();
                } catch (error) {
                    console.error('Error in reindex-vault command:', error);
                    new Notice('Error reindexing vault. Check console for details.');
                }
            }
        });

        // Add settings tab
        this.addSettingTab(new AutoBacklinksSettingTab(this.app, this));
        
        // Check if we need to reindex (older than 24 hours)
        const ONE_DAY = 24 * 60 * 60 * 1000;
        if (!this.settings.lastIndexed || Date.now() - this.settings.lastIndexed > ONE_DAY) {
            console.log('Initial indexing needed');
            this.indexVault();
        }
        
        console.log('MindWeaver plugin loaded successfully');
    }

    onunload() {
        console.log('Unloading MindWeaver plugin');
    }

    async loadSettings() {
        console.log('Loading settings');
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        console.log('Settings loaded:', this.settings);
    }

    async saveSettings() {
        console.log('Saving settings');
        await this.saveData(this.settings);
        console.log('Settings saved');
    }

    private cleanupLinks(links: string[]): string[] {
        return links
            .map(link => {
                // Extract just the filename from the path
                const match = link.match(/\[\[(.*?)(\.md)?(\|.*?)?\]\]/);
                if (!match) return null;
                
                let filename = match[1];
                // Remove any path components
                filename = filename.split('/').pop() || filename;
                // Remove .md extension if present
                filename = filename.replace(/\.md$/, '');
                return `[[${filename}]]`;
            })
            .filter((link): link is string => link !== null);
    }

    async indexVault() {
        if (!this.settings.apiKey) {
            new Notice('Please set your OpenAI API key in the settings');
            return;
        }

        try {
            new Notice('Starting to index vault...');

            const allFiles = this.app.vault.getMarkdownFiles();
            const MAX_CHUNK_SIZE = 5;
            const chunks = [];

            for (let i = 0; i < allFiles.length; i += MAX_CHUNK_SIZE) {
                chunks.push(allFiles.slice(i, i + MAX_CHUNK_SIZE));
            }

            for (const chunk of chunks) {
                const fileContents = await Promise.all(
                    chunk.map(async (file) => ({
                        path: file.path,
                        content: await this.app.vault.read(file)
                    }))
                );

                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.settings.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: "gpt-3.5-turbo",
                        messages: [
                            {
                                role: "system",
                                content: `You are an expert at extracting key information from text. For each document, extract:
1. Main topics (e.g., places, people, events, concepts)
2. Categories (e.g., travel, philosophy, technology)
3. Geographic locations mentioned
4. Time periods or dates
5. Related themes (e.g., adventure, learning, growth)

Format each document's concepts as a structured list.`
                            },
                            {
                                role: "user",
                                content: `Analyze these documents and extract key concepts for each:\n\n${
                                    fileContents.map(file => `File: ${file.path}\n${file.content}\n---`).join('\n')
                                }`
                            }
                        ]
                    })
                });

                if (!response.ok) {
                    throw new Error(`OpenAI API error (${response.status}): ${response.statusText}`);
                }

                const result = await response.json();
                const concepts = result.choices[0].message.content;

                chunk.forEach((file, i) => {
                    this.settings.vaultIndex[file.path] = concepts.split('---')[i] || '';
                });

                await new Promise(resolve => setTimeout(resolve, 200));
            }

            this.settings.lastIndexed = Date.now();
            await this.saveSettings();
            new Notice('Vault indexing complete!');

        } catch (error) {
            console.error('Error indexing vault:', error);
            new Notice(`Error: ${error.message || 'Unknown error occurred. Check console for details.'}`);
        }
    }

    private async validateAndFilterConnections(connections: string[], currentContent: string): Promise<string[]> {
        const validConnections: string[] = [];
        
        for (const link of connections) {
            // Extract filename from the link format [[filename]]
            const match = link.match(/\[\[(.*?)\]\]/);
            if (!match) continue;
            
            const filename = match[1];
            
            // Find the actual file in the vault
            const file = this.app.vault.getAbstractFileByPath(`${filename}.md`);
            if (!file || !(file instanceof TFile)) continue;
            
            try {
                // Read the content of the potential connection
                const content = await this.app.vault.read(file as TFile);
                
                // Use GPT to verify if this is actually a meaningful connection
                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.settings.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: "gpt-3.5-turbo",
                        messages: [
                            {
                                role: "system",
                                content: `You are validating if two notes have a meaningful connection.
A valid connection should share related concepts, ideas, or purpose.

Return ONLY "true" or "false".
Return "true" if the notes:
1. Discuss related financial concepts or strategies
2. Share similar practical advice or methods
3. Build on similar principles or rules
4. Reference related sources or ideas
5. Would provide valuable context for each other

Return "false" if:
- They only share superficial similarities
- They only contain similar numbers without context
- They only have matching tags
- The connection is extremely vague
- They are completely different topics
- One is purely technical/structural and the other is content

For example, return "true" for:
- Two notes about investment strategies
- Two notes about financial calculations
- A rule and its practical application
- Related financial concepts

Return "false" for:
- A financial note and a technical specification
- A money rule and a design principle
- Two notes that just happen to use percentages
- Two notes that just share similar formatting`
                            },
                            {
                                role: "user",
                                content: `Note 1:
${currentContent}

Note 2:
${content}

Are these notes meaningfully connected? Reply only with "true" or "false".`
                            }
                        ]
                    })
                });

                if (!response.ok) continue;

                const result = await response.json();
                const isValid = result.choices[0].message.content.trim().toLowerCase() === 'true';
                
                if (isValid) {
                    console.log(`Validated connection: ${filename}`);
                    validConnections.push(link);
                } else {
                    console.log(`Rejected connection: ${filename}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } catch (error) {
                console.error(`Error validating connection ${filename}:`, error);
                continue;
            }
        }
        
        return validConnections;
    }

    async generateBacklinks() {
        if (!this.settings.apiKey) {
            new Notice('Please set your OpenAI API key in the settings');
            return;
        }

        try {
            const currentFile = this.app.workspace.getActiveFile();
            if (!currentFile) {
                new Notice('No active file');
                return;
            }

            console.log('Starting connection finding process...');
            new Notice('Finding connections...');

            const currentContent = await this.app.vault.read(currentFile);
            console.log('Current note content length:', currentContent.length);
            
            const ONE_DAY = 24 * 60 * 60 * 1000;
            if (Date.now() - this.settings.lastIndexed > ONE_DAY) {
                console.log('Index is stale, reindexing...');
                await this.indexVault();
            }

            console.log('Analyzing current note...');
            const analysisResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.settings.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: "gpt-3.5-turbo",
                    messages: [
                        {
                            role: "system",
                            content: `You are analyzing a note to extract its key elements for finding connections.
Focus on the specific meaning and context, not just keywords or numbers.

Extract:
1. Specific concepts or rules being discussed
2. Specific calculations or methods explained
3. Specific sources or references cited
4. Specific series or sequence information
5. Key facts with their exact context`
                        },
                        {
                            role: "user",
                            content: `Analyze this note and extract its key elements:

${currentContent}

Provide the analysis in this format:
1. Main concepts/rules:
2. Calculations/methods:
3. Sources/references:
4. Series/sequence info:
5. Key facts with context:`
                        }
                    ]
                })
            });

            if (!analysisResponse.ok) {
                throw new Error(`OpenAI API error (${analysisResponse.status}): ${analysisResponse.statusText}`);
            }

            const analysisResult = await analysisResponse.json();
            const noteAnalysis = analysisResult.choices[0].message.content;
            console.log('Note analysis:', noteAnalysis);

            const indexedNotes = Object.entries(this.settings.vaultIndex)
                .filter(([path]) => path !== currentFile.path);
            
            console.log('Number of indexed notes to process:', indexedNotes.length);

            const CHUNK_SIZE = 10;
            let allConnections: string[] = [];

            for (let i = 0; i < indexedNotes.length; i += CHUNK_SIZE) {
                const chunk = indexedNotes.slice(i, i + CHUNK_SIZE);
                console.log(`Processing chunk ${i/CHUNK_SIZE + 1}/${Math.ceil(indexedNotes.length/CHUNK_SIZE)}`);
                
                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.settings.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: "gpt-3.5-turbo",
                        messages: [
                            {
                                role: "system",
                                content: `You are finding STRONG, DIRECT connections between notes. A connection must be based on shared meaning and context, not superficial similarities.

VALID connection examples:
- Both notes explain the exact same financial calculation
- Both notes reference and discuss the same specific investment strategy
- One note directly cites or references the other
- Both notes are explicitly part of the same series or concept
- Both notes analyze the same specific data or study

DO NOT make connections based on:
- Presence of numbers without matching context
- Similar formatting or structure
- Matching tags or categories
- Both having percentages or calculations
- Both mentioning time periods
- Both containing measurements
- Both having version numbers or IDs
- Both using similar units (dollars, years, etc.)

NUMBERS ALONE ARE NOT ENOUGH - the context and meaning must be identical.

For example:
"Save $100/month" should NOT connect to "Version 1.0.0" just because both contain numbers.
"8% interest rate" should NOT connect to "80% test coverage" just because both use percentages.
"$500 investment" should NOT connect to "$500 phone bill" even though the amount matches.

Rate each potential connection from 0-100% based on shared meaning and context.
Only include connections rated 95% or higher - be EXTREMELY selective.

IMPORTANT: Return ONLY a comma-separated list of relevant note links in double brackets, with no additional text or explanations. Example:
[[note1]], [[note2]], [[note3]]

If no connections meet the 95% threshold, return an empty string.`
                            },
                            {
                                role: "user",
                                content: `Find STRONG, DIRECT connections between the analyzed note and these vault notes.
Only return connections that are extremely specific and meet the 95% threshold.

Current note analysis:
${noteAnalysis}

Vault notes to check (only include those with >95% relevance):
${chunk.map(([path, concepts]) => `File: ${path}\nConcepts: ${concepts}\n---`).join('\n')}`
                            }
                        ]
                    })
                });

                if (!response.ok) {
                    const errorBody = await response.text();
                    console.error('OpenAI API Error:', {
                        status: response.status,
                        statusText: response.statusText,
                        body: errorBody
                    });

                    if (response.status === 429) {
                        throw new Error('Rate limit exceeded. Please wait a moment before trying again.');
                    } else if (response.status === 401) {
                        throw new Error('Invalid API key. Please check your settings.');
                    } else {
                        throw new Error(`OpenAI API error (${response.status}): ${response.statusText}`);
                    }
                }

                const result = await response.json();
                const connections = result.choices[0].message.content.trim();
                console.log('Raw connections found in chunk:', connections);
                
                if (connections && connections.includes('[[')) {
                    const links = connections.split(',').map((s: string) => s.trim());
                    const cleanedLinks = this.cleanupLinks(links);
                    allConnections.push(...cleanedLinks);
                }

                await new Promise(resolve => setTimeout(resolve, 200));
            }

            console.log('Initial connections found:', allConnections);
            
            // Validate and filter connections
            const validatedConnections = await this.validateAndFilterConnections(allConnections, currentContent);
            console.log('Validated connections:', validatedConnections);

            // Remove duplicates and sort
            const uniqueConnections = [...new Set(validatedConnections)].sort().join(', ');
            const finalOutput = uniqueConnections ? `#### Related Notes\n${uniqueConnections}` : '';

            console.log('Final output:', finalOutput);

            if (!finalOutput) {
                console.log('No valid connections found');
                new Notice('No relevant connections found');
                return;
            }

            const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
            if (!editor) {
                throw new Error('No active editor found');
            }

            const currentPosition = editor.getCursor();
            const endPosition = { line: editor.lineCount(), ch: 0 };
            
            const lastLine = editor.getLine(editor.lineCount() - 1);
            const separator = lastLine && lastLine.trim() ? '\n\n' : '';
            
            editor.replaceRange(
                `${separator}${finalOutput}`,
                endPosition
            );

            editor.setCursor(currentPosition);

            new Notice('Successfully added connections!');
            
        } catch (error) {
            console.error('Error generating backlinks:', error);
            new Notice(`Error: ${error.message || 'Unknown error occurred. Check console for details.'}`);
        }
    }
}

class AutoBacklinksSettingTab extends PluginSettingTab {
    plugin: AutoBacklinksPlugin;
    showApiKey: boolean = false;

    constructor(app: App, plugin: AutoBacklinksPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Add reset button at the top
        new Setting(containerEl)
            .setName('Reset Settings')
            .setDesc('Reset all settings to their default values (preserves API key)')
            .addButton(button => button
                .setButtonText('Reset to Defaults')
                .onClick(async () => {
                    const currentApiKey = this.plugin.settings.apiKey;
                    this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, {
                        apiKey: currentApiKey // Preserve API key
                    });
                    await this.plugin.saveSettings();
                    this.display(); // Refresh the display
                    new Notice('Settings reset to defaults (API key preserved)');
                }));

        const apiKeySetting = new Setting(containerEl)
            .setName('OpenAI API Key')
            .setDesc('Enter your OpenAI API key')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.apiKey)
                .inputEl.type = this.showApiKey ? 'text' : 'password');

        // Add show/hide toggle button
        apiKeySetting.addButton(button => {
            button
                .setIcon(this.showApiKey ? 'eye-off' : 'eye')
                .setTooltip(this.showApiKey ? 'Hide API Key' : 'Show API Key')
                .onClick(() => {
                    this.showApiKey = !this.showApiKey;
                    const input = apiKeySetting.controlEl.getElementsByTagName('input')[0];
                    input.type = this.showApiKey ? 'text' : 'password';
                    button.setIcon(this.showApiKey ? 'eye-off' : 'eye');
                    button.setTooltip(this.showApiKey ? 'Hide API Key' : 'Show API Key');
                });
        });

        // Add the input change handler
        const input = apiKeySetting.controlEl.getElementsByTagName('input')[0];
        input.addEventListener('change', async (e: Event) => {
            const target = e.target as HTMLInputElement;
            this.plugin.settings.apiKey = target.value;
            await this.plugin.saveSettings();
        });

        new Setting(containerEl)
            .setName('Command Name')
            .setDesc('Customize the name of the command that appears in the command palette')
            .addText(text => text
                .setPlaceholder('Weave Connections')
                .setValue(this.plugin.settings.commandName)
                .onChange(async (value) => {
                    this.plugin.settings.commandName = value;
                    await this.plugin.saveSettings();
                    // Reload the command with new name
                    this.plugin.addCommand({
                        id: 'weave-connections',
                        name: value,
                        callback: () => this.plugin.generateBacklinks()
                    });
                }));

        new Setting(containerEl)
            .setName('GPT Prompt')
            .setDesc('Customize the prompt that will be sent to GPT when analyzing notes')
            .addTextArea(text => text
                .setPlaceholder('Enter prompt for GPT')
                .setValue(this.plugin.settings.slashCommandPrompt)
                .onChange(async (value) => {
                    this.plugin.settings.slashCommandPrompt = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Special Instructions')
            .setDesc('Additional instructions for how the AI should handle connection discovery')
            .addTextArea(text => text
                .setPlaceholder('Enter special instructions')
                .setValue(this.plugin.settings.specialInstructions)
                .onChange(async (value) => {
                    this.plugin.settings.specialInstructions = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Relevance Threshold')
            .setDesc('Minimum relevance score (0-1) required to create a connection')
            .addSlider(slider => slider
                .setLimits(0, 1, 0.1)
                .setValue(this.plugin.settings.relevanceThreshold)
                .onChange(async (value) => {
                    this.plugin.settings.relevanceThreshold = value;
                    await this.plugin.saveSettings();
                }));
    }
}
