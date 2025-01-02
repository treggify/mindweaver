import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { Configuration, OpenAIApi } from 'openai';

interface AutoBacklinksSettings {
    apiKey: string;
    specialInstructions: string;
    excludeFolders: string[];
    relevanceThreshold: number;
}

const DEFAULT_SETTINGS: AutoBacklinksSettings = {
    apiKey: '',
    specialInstructions: '',
    excludeFolders: [],
    relevanceThreshold: 0.7
}

export default class AutoBacklinksPlugin extends Plugin {
    settings: AutoBacklinksSettings;
    openai: OpenAIApi;

    async onload() {
        await this.loadSettings();

        // Initialize OpenAI if API key is present
        if (this.settings.apiKey) {
            const configuration = new Configuration({
                apiKey: this.settings.apiKey
            });
            this.openai = new OpenAIApi(configuration);
        }

        // Add slash command
        this.addCommand({
            id: 'weave-connections',
            name: 'Weave Connections',
            callback: () => this.generateBacklinks()
        });

        // Add settings tab
        this.addSettingTab(new AutoBacklinksSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // Reinitialize OpenAI client if API key changes
        if (this.settings.apiKey) {
            const configuration = new Configuration({
                apiKey: this.settings.apiKey
            });
            this.openai = new OpenAIApi(configuration);
        }
    }

    async generateBacklinks() {
        if (!this.settings.apiKey) {
            new Notice('Please set your OpenAI API key in the settings');
            return;
        }

        try {
            const files = this.app.vault.getMarkdownFiles();
            const currentFile = this.app.workspace.getActiveFile();
            
            if (!currentFile) {
                new Notice('No active file');
                return;
            }

            const currentContent = await this.app.vault.read(currentFile);
            
            // Get potential related notes
            const relatedNotes = await this.findRelatedNotes(currentContent, files);
            
            if (relatedNotes.length > 0) {
                await this.addBacklinks(currentFile, relatedNotes);
                new Notice(`Added backlinks to ${relatedNotes.length} related notes`);
            } else {
                new Notice('No relevant backlinks found');
            }
        } catch (error) {
            console.error('Error generating backlinks:', error);
            new Notice('Error generating backlinks. Check console for details.');
        }
    }

    async findRelatedNotes(currentContent: string, files: any[]) {
        const relatedNotes = [];
        
        for (const file of files) {
            if (file.path === this.app.workspace.getActiveFile()?.path) continue;
            
            const content = await this.app.vault.read(file);
            const relevance = await this.checkRelevance(currentContent, content);
            
            if (relevance >= this.settings.relevanceThreshold) {
                relatedNotes.push({
                    file,
                    relevance
                });
            }
        }
        
        return relatedNotes;
    }

    async checkRelevance(content1: string, content2: string): Promise<number> {
        try {
            const response = await this.openai.createChatCompletion({
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert at analyzing semantic relationships between texts. Your task is to determine how relevant two pieces of text are to each other on a scale of 0 to 1."
                    },
                    {
                        role: "user",
                        content: `Text 1: ${content1.substring(0, 1000)}...\nText 2: ${content2.substring(0, 1000)}...\n\nRate the relevance between these texts from 0 to 1, where 1 means highly related and 0 means unrelated. Return only the number.`
                    }
                ]
            });

            const relevance = parseFloat(response.data.choices[0].message?.content || "0");
            return isNaN(relevance) ? 0 : relevance;
        } catch (error) {
            console.error('Error checking relevance:', error);
            return 0;
        }
    }

    async addBacklinks(currentFile: any, relatedNotes: any[]) {
        for (const { file } of relatedNotes) {
            const content = await this.app.vault.read(file);
            const backlink = `[[${currentFile.basename}]]`;
            
            if (!content.includes(backlink)) {
                const newContent = `${content}\n\nRelated: ${backlink}`;
                await this.app.vault.modify(file, newContent);
            }
        }
    }
}

class AutoBacklinksSettingTab extends PluginSettingTab {
    plugin: AutoBacklinksPlugin;

    constructor(app: App, plugin: AutoBacklinksPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('OpenAI API Key')
            .setDesc('Enter your OpenAI API key')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Special Instructions')
            .setDesc('Additional instructions for how the AI should handle backlink generation')
            .addTextArea(text => text
                .setPlaceholder('Enter special instructions')
                .setValue(this.plugin.settings.specialInstructions)
                .onChange(async (value) => {
                    this.plugin.settings.specialInstructions = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Relevance Threshold')
            .setDesc('Minimum relevance score (0-1) required to create a backlink')
            .addSlider(slider => slider
                .setLimits(0, 1, 0.1)
                .setValue(this.plugin.settings.relevanceThreshold)
                .onChange(async (value) => {
                    this.plugin.settings.relevanceThreshold = value;
                    await this.plugin.saveSettings();
                }));
    }
}
