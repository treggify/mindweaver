import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, TextAreaComponent, SuggestModal, ButtonComponent } from 'obsidian';

interface AutoBacklinksSettings {
    apiKey: string;
    togetherApiKey: string;
    llamaEndpoint: string;
    commandName: string;
    slashCommandPrompt: string;
    specialInstructions: string;
    connectionStrength: 'strict' | 'balanced' | 'relaxed';
    model: 'gpt-4' | 'gpt-3.5-turbo' | 'llama-2-70b' | 'llama-local';
    excludedFolders: string[];
}

const DEFAULT_SETTINGS: AutoBacklinksSettings = {
    apiKey: '',
    togetherApiKey: '',
    llamaEndpoint: 'http://localhost:8080',
    commandName: 'Weave connections',
    slashCommandPrompt: 'Find meaningful connections between this note and others in the vault.',
    specialInstructions: '',
    connectionStrength: 'balanced',
    model: 'gpt-3.5-turbo',
    excludedFolders: []
}

const MODEL_PRICING = {
    'gpt-4': { 
        name: 'GPT-4',
        description: 'Most accurate',
        provider: 'openai',
        inputPer1k: 0.03, 
        outputPer1k: 0.06 
    },
    'gpt-3.5-turbo': { 
        name: 'GPT-3.5',
        description: 'Balanced',
        provider: 'openai',
        inputPer1k: 0.001, 
        outputPer1k: 0.002 
    },
    'llama-2-70b': { 
        name: 'Llama 2 70B',
        description: 'Low cost',
        provider: 'together',
        inputPer1k: 0.0007, 
        outputPer1k: 0.0007 
    },
    'llama-local': {
        name: 'Llama (Local)',
        description: 'Free, self-hosted',
        provider: 'local',
        inputPer1k: 0,
        outputPer1k: 0
    }
};

export default class AutoBacklinksPlugin extends Plugin {
    settings: AutoBacklinksSettings;

    // Rate limiter for OpenAI API
    private lastRequestTime = 0;
    private requestsInLastMinute = 0;
    private static readonly RPM_LIMIT = 150; // More conservative limit
    private static readonly MIN_REQUEST_INTERVAL = 500; // 500ms between requests

    private async waitForRateLimit(): Promise<void> {
        this.requestsInLastMinute++;
        
        // Calculate time since last request
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        // If we're approaching the rate limit, wait
        if (this.requestsInLastMinute >= AutoBacklinksPlugin.RPM_LIMIT) {
            const waitTime = 60 * 1000; // Wait a full minute
            console.log(`Approaching rate limit, waiting ${waitTime/1000}s...`);
            new Notice(`Rate limit approached, waiting ${waitTime/1000}s...`, 2000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            this.requestsInLastMinute = 0;
        }
        
        // Ensure minimum interval between requests
        if (timeSinceLastRequest < AutoBacklinksPlugin.MIN_REQUEST_INTERVAL) {
            const waitTime = AutoBacklinksPlugin.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.lastRequestTime = Date.now();
    }

    private async makeOpenAIRequest(messages: any[]): Promise<any> {
        const model = MODEL_PRICING[this.settings.model];
        
        if (model.provider === 'together') {
            return this.makeTogetherRequest(messages);
        } else if (model.provider === 'local') {
            return this.makeLlamaRequest(messages);
        }

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.settings.apiKey}`
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    messages: messages,
                    max_tokens: 100,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                throw new Error(`OpenAI API request failed: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error making OpenAI request:', error);
            throw error;
        }
    }

    private async makeTogetherRequest(messages: any[]): Promise<any> {
        try {
            const prompt = messages.map(m => 
                `${m.role}: ${m.content}`
            ).join('\n');

            const response = await fetch('https://api.together.xyz/inference', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.settings.togetherApiKey}`
                },
                body: JSON.stringify({
                    model: 'togethercomputer/llama-2-70b-chat',
                    prompt: prompt,
                    max_tokens: 100,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                throw new Error(`Together API request failed: ${response.statusText}`);
            }

            const result = await response.json();
            return {
                choices: [{
                    message: {
                        content: result.output.content
                    }
                }]
            };
        } catch (error) {
            console.error('Error making Together request:', error);
            throw error;
        }
    }

    private async makeLlamaRequest(messages: any[]): Promise<any> {
        try {
            const prompt = messages.map(m => 
                `${m.role}: ${m.content}`
            ).join('\n');

            const response = await fetch(`${this.settings.llamaEndpoint}/completion`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: prompt,
                    max_tokens: 100,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                throw new Error(`Llama API request failed: ${response.statusText}`);
            }

            const result = await response.json();
            return {
                choices: [{
                    message: {
                        content: result.content
                    }
                }]
            };
        } catch (error) {
            console.error('Error making Llama request:', error);
            throw error;
        }
    }

    async onload() {
        console.log('Loading MindWeaver plugin');
        
        await this.loadSettings();

        // Add slash command
        this.addCommand({
            id: 'weave-connections',
            name: this.settings.commandName || 'Weave connections',
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

        // Add settings tab
        this.addSettingTab(new AutoBacklinksSettingTab(this.app, this));
        
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

    async generateBacklinks() {
        if (!this.settings.apiKey && !this.settings.togetherApiKey) {
            new Notice('Please set your OpenAI or Together API key in the settings');
            return;
        }

        try {
            const currentFile = this.app.workspace.getActiveFile();
            if (!currentFile) {
                new Notice('No active file');
                return;
            }

            console.log('Starting connection finding process...');
            new Notice('Finding connections...', 3000);

            const currentContent = await this.app.vault.read(currentFile);
            const allFiles = this.app.vault.getMarkdownFiles();
            
            // Get potential connections by looking at all markdown files
            const potentialConnections = allFiles
                .filter(file => file.path !== currentFile.path && !this.isFileExcluded(file))
                .map(file => `[[${file.basename}]]`);

            // Validate connections
            const validatedConnections = await this.validateAndFilterConnections(potentialConnections, currentContent);

            if (validatedConnections.length > 0) {
                const editor = this.app.workspace.activeEditor?.editor;
                if (editor) {
                    const cursor = editor.getCursor();
                    const line = editor.getLine(cursor.line);
                    
                    // Add connections as a list at cursor
                    const connectionsList = validatedConnections
                        .map(link => `- ${link}`)
                        .join('\n');
                    
                    editor.replaceRange(
                        `\n\n### Related Notes\n${connectionsList}\n`,
                        cursor
                    );
                    
                    new Notice(`Added ${validatedConnections.length} connections`);
                }
            } else {
                new Notice('No meaningful connections found');
            }

        } catch (error) {
            console.error('Error finding connections:', error);
            new Notice(`Error: ${error.message || 'Unknown error occurred. Check console for details.'}`, 5000);
        }
    }

    private async checkTitlesRelevance(currentTitle: string, otherTitles: string[]): Promise<boolean[]> {
        try {
            // Create a numbered list of titles for comparison
            const titlesList = otherTitles.map((title, i) => `${i + 1}. "${title}"`).join('\n');
            
            const result = await this.makeOpenAIRequest([
                {
                    role: "system",
                    content: `You are pre-filtering notes based on their titles to determine if they might be related.
Your task is to compare the reference title against a list of other titles.
Return ONLY a JSON array of boolean values, one for each title in the list.

Return true for titles that:
1. Share similar topics or concepts
2. Are part of the same series
3. Use similar terminology
4. One might provide context for the other
5. Have similar structural patterns (e.g. both about calculations, rules, or methods)

Return false for titles that:
- Are completely different topics
- One is technical/meta and other is content
- Have no conceptual overlap
- Are clearly unrelated domains

Example response format: [true, false, true]

Example "true" pairs:
- "Investment Strategy" & "Portfolio Allocation"
- "Rule of 72" & "Compound Interest Formula"
- "Meeting Notes 2024" & "Meeting Action Items"
- "Financial Terms" & "Investment Glossary"

Example "false" pairs:
- "Investment Strategy" & "Plugin Settings"
- "Meeting Notes" & "CSS Styles"
- "Rule of 72" & "Keyboard Shortcuts"
- "Financial Terms" & "System Requirements"`
                },
                {
                    role: "user",
                    content: `Reference Title: "${currentTitle}"

Compare against these titles:
${titlesList}

Return a JSON array of booleans indicating which titles might be related to the reference title.`
                }
            ]);
            
            // Parse the response as a JSON array
            const text = result.choices[0].message.content.trim();
            try {
                const boolArray = JSON.parse(text);
                if (Array.isArray(boolArray) && boolArray.length === otherTitles.length) {
                    return boolArray;
                }
            } catch (e) {
                console.error('Failed to parse title check response:', text);
            }
            
            // If parsing fails, assume all might be related
            return otherTitles.map(() => true);

        } catch (error) {
            // If anything goes wrong, assume they might be related
            console.error('Error in title check:', error);
            return otherTitles.map(() => true);
        }
    }

    private async validateConnection(currentContent: string, otherContent: string): Promise<boolean> {
        try {
            // Adjust the system prompt based on connection strength
            let systemPrompt = `You are validating if two notes have a meaningful connection.
A valid connection should share related concepts, ideas, or purpose.

Return ONLY "true" or "false".`;

            // Add strength-specific criteria
            switch (this.settings.connectionStrength) {
                case 'strict':
                    systemPrompt += `
Return "true" ONLY if the notes:
1. Share VERY closely related concepts or topics
2. Are clearly part of the same project or workflow
3. Have direct references to each other's topics
4. Would be frequently used together
5. Form a clear logical sequence

Return "false" if:
- They only share general themes
- The connection is indirect
- They are only loosely related
- The overlap is minimal
- You have any doubt about the connection`;
                    break;

                case 'balanced':
                    systemPrompt += `
Return "true" if the notes:
1. Discuss related concepts
2. Share similar practical advice or methods
3. Build on similar principles or rules
4. Reference related sources or ideas
5. Would provide valuable context for each other

Return "false" if:
- They only share superficial similarities
- They only contain similar numbers without context
- They only have matching tags
- The connection is extremely vague
- They are completely different topics`;
                    break;

                case 'relaxed':
                    systemPrompt += `
Return "true" if the notes:
1. Share any related concepts or ideas
2. Could be part of a broader theme
3. Might provide useful context
4. Have overlapping subject areas
5. Could be interesting to cross-reference

Return "false" only if:
- They are completely unrelated
- They have no conceptual overlap
- They serve entirely different purposes
- The potential connection is meaningless`;
                    break;
            }

            const result = await this.makeOpenAIRequest([
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: `Note 1:
${currentContent}

Note 2:
${otherContent}

Are these notes meaningfully connected? Reply only with "true" or "false".`
                }
            ]);
            
            return result.choices[0].message.content.trim().toLowerCase() === 'true';

        } catch (error) {
            console.error('Error validating connection:', error);
            return false;
        }
    }

    private async validateAndFilterConnections(connections: string[], currentContent: string): Promise<string[]> {
        const validConnections: string[] = [];
        const progressNotice = new Notice('Checking connections...', 0);
        let processed = 0;
        
        // Get current file title
        const currentFile = this.app.workspace.getActiveFile();
        if (!currentFile) return [];
        const currentTitle = currentFile.basename;
        
        // Extract all filenames first and filter excluded folders
        const fileInfos = connections
            .map(link => {
                const match = link.match(/\[\[(.*?)\]\]/);
                return match ? { link, filename: match[1] } : null;
            })
            .filter((info): info is NonNullable<typeof info> => info !== null)
            .filter(info => {
                const file = this.app.vault.getAbstractFileByPath(`${info.filename}.md`);
                return file instanceof TFile && !this.isFileExcluded(file);
            });
        
        // Process titles in smaller chunks
        const CHUNK_SIZE = 5; // Reduced from 10 to 5
        for (let i = 0; i < fileInfos.length; i += CHUNK_SIZE) {
            const chunk = fileInfos.slice(i, i + CHUNK_SIZE);
            const titles = chunk.map(info => info.filename);
            
            progressNotice.setMessage(`Quick check: ${i + 1}-${Math.min(i + CHUNK_SIZE, fileInfos.length)}/${fileInfos.length}`);
            const relevanceResults = await this.checkTitlesRelevance(currentTitle, titles);
            
            // Process each result in the chunk
            for (let j = 0; j < chunk.length; j++) {
                const { link, filename } = chunk[j];
                if (!relevanceResults[j]) {
                    console.log(`Skipping ${filename} based on title check`);
                    processed++;
                    progressNotice.setMessage(`Checking connections (${processed}/${connections.length})...`);
                    continue;
                }
                
                // Find the actual file in the vault
                const file = this.app.vault.getAbstractFileByPath(`${filename}.md`);
                if (!file || !(file instanceof TFile)) continue;
                
                try {
                    // Read the content of the potential connection
                    const content = await this.app.vault.read(file as TFile);
                    
                    // Validate connection
                    const isValid = await this.validateConnection(currentContent, content);
                    
                    processed++;
                    progressNotice.setMessage(`Checking connections (${processed}/${connections.length})...`);
                    
                    if (isValid) {
                        console.log(`Validated connection: ${filename}`);
                        validConnections.push(link);
                    } else {
                        console.log(`Rejected connection: ${filename}`);
                    }
                    
                } catch (error) {
                    console.error(`Error validating connection ${filename}:`, error);
                    continue;
                }
            }
            
            // Add extra wait between chunks
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        progressNotice.hide();
        return validConnections;
    }

    private isFileExcluded(file: TFile): boolean {
        return this.settings.excludedFolders.some(folder => 
            file.path.startsWith(folder + '/') || file.path === folder
        );
    }

    private addExcludedFolder(folder: string) {
        if (!this.settings.excludedFolders.includes(folder)) {
            this.settings.excludedFolders.push(folder);
            this.saveSettings();
        }
    }

    private removeExcludedFolder(folder: string) {
        const index = this.settings.excludedFolders.indexOf(folder);
        if (index > -1) {
            this.settings.excludedFolders.splice(index, 1);
            this.saveSettings();
        }
    }
}

class FolderSuggestModal extends SuggestModal<TFolder> {
    textInput: TextAreaComponent;
    plugin: AutoBacklinksPlugin;

    constructor(app: App, textInput: TextAreaComponent, plugin: AutoBacklinksPlugin) {
        super(app);
        this.textInput = textInput;
        this.plugin = plugin;
    }

    getSuggestions(query: string): TFolder[] {
        const files = this.app.vault.getAllLoadedFiles();
        const folders = files.filter((file): file is TFolder => file instanceof TFolder);
        return folders.filter(folder => 
            folder.path.toLowerCase().includes(query.toLowerCase())
        );
    }

    renderSuggestion(folder: TFolder, el: HTMLElement) {
        el.createEl("div", { text: folder.path });
    }

    onChooseSuggestion(folder: TFolder, evt: MouseEvent | KeyboardEvent) {
        const currentValue = this.textInput.getValue();
        const lines = currentValue.split('\n');
        const newPath = folder.path;
        
        // Don't add if already in list
        if (!lines.includes(newPath)) {
            if (currentValue && !currentValue.endsWith('\n')) {
                this.textInput.setValue(currentValue + '\n' + newPath);
            } else {
                this.textInput.setValue(currentValue + newPath);
            }
            
            // Save the settings
            this.plugin.settings.excludedFolders = this.textInput.getValue().split('\n')
                .map(folder => folder.trim())
                .filter(folder => folder.length > 0);
            this.plugin.saveSettings();
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

        // Add section headers
        containerEl.createEl('h3', { text: 'Model settings' });
        
        // Model selection
        new Setting(containerEl)
            .setName('Model')
            .setDesc('Select model for connection discovery')
            .addDropdown(dropdown => dropdown
                .addOption('gpt-4', 'GPT-4 (Most accurate)')
                .addOption('gpt-3.5-turbo', 'GPT-3.5 (Balanced)')
                .addOption('llama-2-70b', 'Llama 2 (Low cost)')
                .addOption('llama-local', 'Llama (Local, self-hosted)')
                .setValue(this.plugin.settings.model)
                .onChange(async (value: 'gpt-4' | 'gpt-3.5-turbo' | 'llama-2-70b' | 'llama-local') => {
                    this.plugin.settings.model = value;
                    await this.plugin.saveSettings();
                    this.updateApiKeyVisibility();
                }));

        // API Keys group
        const apiKeyGroup = containerEl.createDiv('api-keys');
        apiKeyGroup.style.marginBottom = '24px';
        apiKeyGroup.style.marginTop = '12px';

        // OpenAI API key
        const openaiKeySetting = new Setting(apiKeyGroup)
            .setClass('openai-key-setting')
            .setName('OpenAI API key')
            .addText(text => text
                .setPlaceholder('Enter API key')
                .setValue(this.plugin.settings.apiKey)
                .then(input => {
                    input.inputEl.type = 'password';
                    input.inputEl.style.width = '240px';
                }));

        // Together API key
        const togetherKeySetting = new Setting(apiKeyGroup)
            .setClass('together-key-setting')
            .setName('Together API key')
            .addText(text => text
                .setPlaceholder('Enter API key')
                .setValue(this.plugin.settings.togetherApiKey)
                .then(input => {
                    input.inputEl.type = 'password';
                    input.inputEl.style.width = '240px';
                }));

        // Local Llama endpoint setting
        const llamaEndpointSetting = new Setting(containerEl)
            .setClass('llama-endpoint-setting')
            .setName('Local Llama endpoint')
            .setDesc(createFragment(frag => {
                frag.appendText('URL for your local Llama server. ');
                frag.createEl('a', {
                    text: 'Setup instructions',
                    href: 'https://github.com/ggerganov/llama.cpp/blob/master/examples/server/README.md'
                }, (a) => {
                    a.setAttr('target', '_blank');
                });
            }))
            .addText(text => text
                .setPlaceholder('http://localhost:8080')
                .setValue(this.plugin.settings.llamaEndpoint)
                .then(input => {
                    input.inputEl.style.width = '240px';
                }));

        // Hide endpoint if not using local Llama
        llamaEndpointSetting.settingEl.style.display = 
            this.plugin.settings.model === 'llama-local' ? 'block' : 'none';

        // Connection settings header
        containerEl.createEl('h3', { text: 'Connection settings' });

        // Connection strength
        new Setting(containerEl)
            .setName('Connection strength')
            .setDesc('Threshold for creating connections')
            .addDropdown(dropdown => dropdown
                .addOption('strict', 'Strict')
                .addOption('balanced', 'Balanced')
                .addOption('relaxed', 'Relaxed')
                .setValue(this.plugin.settings.connectionStrength)
                .then(dropdown => {
                    dropdown.selectEl.style.width = '100px';
                }));

        // Folder exclusions
        const folderSetting = new Setting(containerEl)
            .setName('Excluded folders')
            .setDesc('Skip these folders when finding connections');

        // Folder buttons in a container
        const buttonContainer = folderSetting.settingEl.createDiv('folder-buttons');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '8px';

        // Create text area container
        const textAreaContainer = folderSetting.settingEl.createDiv('folder-textarea');
        textAreaContainer.style.marginTop = '8px';
        
        // Create text area component
        const textAreaComponent = new TextAreaComponent(textAreaContainer);
        textAreaComponent
            .setPlaceholder('One folder path per line')
            .setValue(this.plugin.settings.excludedFolders.join('\n'));
        
        textAreaComponent.inputEl.style.width = '100%';
        textAreaComponent.inputEl.style.height = '80px';
        
        textAreaComponent.onChange(async (value) => {
            this.plugin.settings.excludedFolders = value.split('\n')
                .map(folder => folder.trim())
                .filter(folder => folder.length > 0);
            await this.plugin.saveSettings();
        });

        // Add folder button
        const addButton = new ButtonComponent(buttonContainer)
            .setButtonText('Add folder')
            .onClick(() => {
                new FolderSuggestModal(this.app, textAreaComponent, this.plugin).open();
            });

        // Clear button
        const clearButton = new ButtonComponent(buttonContainer)
            .setButtonText('Clear')
            .onClick(async () => {
                textAreaComponent.setValue('');
                this.plugin.settings.excludedFolders = [];
                await this.plugin.saveSettings();
            });

        // Command settings header
        containerEl.createEl('h3', { text: 'Command settings' });

        // Command name
        new Setting(containerEl)
            .setName('Command name')
            .addText(text => text
                .setPlaceholder('Weave connections')
                .setValue(this.plugin.settings.commandName)
                .then(input => {
                    input.inputEl.style.width = '200px';
                }));

        // Prompt
        new Setting(containerEl)
            .setName('Prompt')
            .addText(text => text
                .setPlaceholder('Find connections...')
                .setValue(this.plugin.settings.slashCommandPrompt)
                .then(input => {
                    input.inputEl.style.width = '100%';
                }));

        // Special instructions
        new Setting(containerEl)
            .setName('Special instructions')
            .addTextArea(text => text
                .setPlaceholder('Additional instructions for connection discovery')
                .setValue(this.plugin.settings.specialInstructions)
                .then(input => {
                    input.inputEl.style.width = '100%';
                    input.inputEl.style.height = '80px';
                }));

        // Update API key visibility initially
        this.updateApiKeyVisibility();
    }

    private updateApiKeyVisibility() {
        const openaiKey = document.querySelector('.openai-key-setting');
        const togetherKey = document.querySelector('.together-key-setting');
        const llamaEndpoint = document.querySelector('.llama-endpoint-setting');
        
        if (openaiKey instanceof HTMLElement && 
            togetherKey instanceof HTMLElement && 
            llamaEndpoint instanceof HTMLElement) {
            const model = MODEL_PRICING[this.plugin.settings.model];
            openaiKey.style.display = model.provider === 'openai' ? 'block' : 'none';
            togetherKey.style.display = model.provider === 'together' ? 'block' : 'none';
            llamaEndpoint.style.display = model.provider === 'local' ? 'block' : 'none';
        }
    }
}
