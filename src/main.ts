import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

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

    async onload() {
        console.log('Loading MindWeaver plugin');
        
        await this.loadSettings();

        // Add slash command
        this.addCommand({
            id: 'weave-connections',
            name: 'Weave Connections',
            callback: () => {
                try {
                    this.generateBacklinks();
                } catch (error) {
                    console.error('Error in weave-connections command:', error);
                    new Notice('Error executing command. Check console for details.');
                }
            }
        });

        // Add settings tab
        this.addSettingTab(new AutoBacklinksSettingTab(this.app, this));
        
        console.log('MindWeaver plugin loaded');
    }

    onunload() {
        console.log('Unloading MindWeaver plugin');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
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

            new Notice('Starting to weave connections...');
            const currentContent = await this.app.vault.read(currentFile);
            
            // For now, just show a success message
            new Notice('Successfully analyzed current note. Feature implementation in progress.');
            
        } catch (error) {
            console.error('Error generating backlinks:', error);
            new Notice('Error generating backlinks. Check console for details.');
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
