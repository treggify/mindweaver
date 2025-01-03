import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, TextAreaComponent, SuggestModal, ButtonComponent } from 'obsidian';

interface AutoBacklinksSettings {
    apiKey: string;
    togetherApiKey: string;
    anthropicKey: string;
    llamaEndpoint: string;
    ollamaEndpoint: string;
    model: 'gpt-4' | 'gpt-3.5-turbo' | 'claude-3.5' | 'claude-3' | 'llama-2-70b' | 'llama-local' | 'ollama';
    connectionStrength: 'strict' | 'balanced' | 'relaxed';
    excludedFolders: string[];
    specialInstructions: string;
    format: 'comma' | 'bullet' | 'number' | 'line';
    showHeader: boolean;
    headerLevel: 1 | 2 | 3 | 4 | 5 | 6;
    customTags: string[];
    useOnlyCustomTags: boolean;
}

const DEFAULT_SETTINGS: AutoBacklinksSettings = {
    apiKey: '',
    togetherApiKey: '',
    anthropicKey: '',
    llamaEndpoint: 'http://localhost:8080',
    ollamaEndpoint: 'http://localhost:11434',
    model: 'gpt-4',
    connectionStrength: 'balanced',
    excludedFolders: [],
    specialInstructions: '',
    format: 'comma',
    showHeader: true,
    headerLevel: 3,
    customTags: [],
    useOnlyCustomTags: false
}

const MODEL_PRICING: Record<string, {
    name: string;
    description: string;
    provider: 'openai' | 'anthropic' | 'together' | 'local';
    inputPer1k: number;
    outputPer1k: number;
}> = {
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
    'claude-3.5': {
        name: 'Claude 3.5',
        description: 'Latest & most capable',
        provider: 'anthropic',
        inputPer1k: 0.015,
        outputPer1k: 0.075
    },
    'claude-3': {
        name: 'Claude 3',
        description: 'Balanced performance',
        provider: 'anthropic',
        inputPer1k: 0.008,
        outputPer1k: 0.024
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
        description: 'Free, self-hosted, slow',
        provider: 'local',
        inputPer1k: 0,
        outputPer1k: 0
    },
    'ollama': {
        name: 'Ollama (Local)',
        description: 'Free, self-hosted, easy setup, slow',
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

    private async makeClaudeRequest(messages: any[]): Promise<any> {
        try {
            const prompt = messages.map(m => 
                `${m.role}: ${m.content}`
            ).join('\n');

            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.settings.anthropicKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: this.settings.model === 'claude-3.5' ? 'claude-3.5-20240229' : 'claude-3-20240229',
                    max_tokens: 1024,
                    messages: [{
                        role: 'user',
                        content: prompt
                    }]
                })
            });

            if (!response.ok) {
                throw new Error(`Claude API request failed: ${response.statusText}`);
            }

            const result = await response.json();
            return {
                choices: [{
                    message: {
                        content: result.content[0].text
                    }
                }]
            };
        } catch (error) {
            console.error('Error making Claude request:', error);
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

            if (this.settings.model === 'ollama') {
                // Ollama API endpoint
                const response = await fetch(`${this.settings.ollamaEndpoint}/api/generate`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'llama2',
                        prompt: prompt + "\nRespond with ONLY 'true' or 'false', nothing else.",
                        stream: false
                    })
                });

                if (!response.ok) {
                    throw new Error(`Ollama API request failed: ${response.statusText}`);
                }

                const result = await response.json();
                const responseText = result.response.toLowerCase().trim();
                
                // Extract true/false from the response
                if (responseText.includes('true')) {
                    return {
                        choices: [{
                            message: {
                                content: 'true'
                            }
                        }]
                    };
                } else if (responseText.includes('false')) {
                    return {
                        choices: [{
                            message: {
                                content: 'false'
                            }
                        }]
                    };
                } else {
                    throw new Error('Failed to get clear true/false response from Ollama');
                }
            } else {
                // Original Llama endpoint
                const response = await fetch(`${this.settings.llamaEndpoint}/completion`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        prompt: prompt + "\nRespond with ONLY 'true' or 'false', nothing else.",
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
            }
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
            name: 'Weave connections',
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

        // Add weavetag command
        this.addCommand({
            id: 'weavetag',
            name: 'Weave tags into current note',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.weaveTagsIntoNote(editor, view);
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
        if (!this.settings.apiKey && !this.settings.togetherApiKey && !this.settings.anthropicKey) {
            new Notice('Please set your OpenAI, Together, or Anthropic API key in the settings');
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
                    const connectionsList = await this.formatConnections(validatedConnections);

                    editor.replaceRange(
                        connectionsList,
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

    private async formatConnections(links: string[]): Promise<string> {
        if (links.length === 0) return '';

        const formatters = {
            bullet: (link: string) => `- ${link}`,
            number: (link: string, i: number) => `${i + 1}. ${link}`,
            line: (link: string) => link,
            comma: (link: string) => link
        };

        const header = this.settings.showHeader 
            ? `${'#'.repeat(this.settings.headerLevel)} Related notes\n`
            : '';
            
        const formatter = formatters[this.settings.format];
        const formattedLinks = this.settings.format === 'comma'
            ? links.join(', ')
            : links.map((link, i) => formatter(link, i)).join('\n');

        return `${header}${formattedLinks}\n`;
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
- The potential connection is meaningless

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

${this.settings.specialInstructions ? this.settings.specialInstructions + "\n\n" : ""}Return ONLY "true" or "false".`;

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

            let result;
            switch (MODEL_PRICING[this.settings.model].provider) {
                case 'openai':
                    result = await this.makeOpenAIRequest([
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
                    break;
                case 'anthropic':
                    result = await this.makeClaudeRequest([
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
                    break;
                case 'together':
                    result = await this.makeTogetherRequest([
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
                    break;
                case 'local':
                    result = await this.makeLlamaRequest([
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
                    break;
            }
            
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

    private async weaveTagsIntoNote(editor: Editor, view: MarkdownView) {
        const currentContent = editor.getValue();
        
        // Get available tags
        let availableTags: string[] = [];
        if (!this.settings.useOnlyCustomTags) {
            // Get all files in vault
            const files = this.app.vault.getMarkdownFiles();
            const tagSet = new Set<string>();
            
            // Collect all unique tags
            for (const file of files) {
                const cache = this.app.metadataCache.getFileCache(file);
                if (cache?.tags) {
                    cache.tags.forEach(tagObj => {
                        tagSet.add(tagObj.tag);
                    });
                }
            }
            
            availableTags = Array.from(tagSet);
        }
        
        // Add custom tags if any
        if (this.settings.customTags.length > 0) {
            const formattedCustomTags = this.settings.customTags.map((tag: string) => 
                tag.startsWith('#') ? tag : `#${tag}`
            );
            availableTags = [...new Set([...availableTags, ...formattedCustomTags])];
        }

        if (availableTags.length === 0) {
            new Notice('No tags available. Please add some tags to your vault or custom tags list.');
            return;
        }

        // Prepare the prompt for the AI
        const messages = [
            {
                role: 'system',
                content: `You are a tag suggestion system. Your task is to analyze the given note content and suggest relevant tags from the provided list. Only suggest tags from the provided list, do not create new ones. Return the tags as a comma-separated list.`
            },
            {
                role: 'user',
                content: `Here is the note content:\n\n${currentContent}\n\nAvailable tags:\n${availableTags.join(', ')}\n\nPlease suggest relevant tags from this list only.`
            }
        ];

        try {
            let response;
            switch (this.settings.model) {
                case 'gpt-4':
                case 'gpt-3.5-turbo':
                    response = await this.makeOpenAIRequest(messages);
                    break;
                case 'claude-3.5':
                case 'claude-3':
                    response = await this.makeClaudeRequest(messages);
                    break;
                case 'llama-2-70b':
                    response = await this.makeTogetherRequest(messages);
                    break;
                case 'llama-local':
                    response = await this.makeLlamaRequest(messages);
                    break;
                default:
                    throw new Error('Unsupported model');
            }

            // Extract tags from the response
            const suggestedTags = response.choices[0].message.content
                .split(',')
                .map((tag: string) => tag.trim())
                .filter((tag: string) => availableTags.includes(tag));

            if (suggestedTags.length === 0) {
                new Notice('No relevant tags found for this note.');
                return;
            }

            // Insert tags at the end of the note
            if (!view.file) {
                new Notice('No active file.');
                return;
            }

            const cache = this.app.metadataCache.getFileCache(view.file);
            const existingTags = new Set(
                cache?.tags?.map((t: { tag: string }) => t.tag) || []
            );
            
            const newTags = suggestedTags.filter((tag: string) => !existingTags.has(tag));
            
            if (newTags.length === 0) {
                new Notice('All relevant tags are already present in the note.');
                return;
            }

            // Add new tags at the end of the note
            const tagString = '\n' + newTags.join(' ');
            editor.replaceRange(tagString, { line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length });
            
            new Notice(`Added ${newTags.length} new tags to the note.`);

        } catch (error) {
            console.error('Error in weaveTagsIntoNote:', error);
            new Notice('Error suggesting tags. Please check the console for details.');
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
        const modelHeader = containerEl.createEl('h3', { text: 'Model settings' });
        modelHeader.style.marginBottom = '24px';
        
        // Model selection
        const modelSetting = new Setting(containerEl)
            .setName('Model')
            .setDesc('Select model for connection discovery')
            .addDropdown(dropdown => dropdown
                .addOption('gpt-4', 'GPT-4 (Most accurate)')
                .addOption('gpt-3.5-turbo', 'GPT-3.5 (Balanced)')
                .addOption('claude-3.5', 'Claude 3.5 (Latest & most capable)')
                .addOption('claude-3', 'Claude 3 (Balanced performance)')
                .addOption('llama-2-70b', 'Llama 2 (Low cost)')
                .addOption('llama-local', 'Llama (Local, self-hosted)')
                .addOption('ollama', 'Ollama (Local, easy setup)')
                .setValue(this.plugin.settings.model)
                .then(dropdown => {
                    dropdown.selectEl.style.width = '240px';
                })
                .onChange(async (value: 'gpt-4' | 'gpt-3.5-turbo' | 'claude-3.5' | 'claude-3' | 'llama-2-70b' | 'llama-local' | 'ollama') => {
                    this.plugin.settings.model = value;
                    await this.plugin.saveSettings();
                    this.updateApiKeyVisibility();
                }));

        // API Keys group
        const apiKeyGroup = containerEl.createDiv('api-keys');
        apiKeyGroup.style.marginBottom = '24px';

        // OpenAI API key
        const openaiKeySetting = new Setting(apiKeyGroup)
            .setClass('openai-key-setting')
            .setName('OpenAI API key');
        openaiKeySetting.settingEl.style.alignItems = 'center';
        openaiKeySetting.addText(text => text
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
            .setDesc(createFragment(frag => {
                frag.appendText('Required for Llama 2 70B. ');
                frag.createEl('a', {
                    text: 'Get API key',
                    href: 'https://www.together.ai/'
                }, (a) => {
                    a.setAttr('target', '_blank');
                });
            }));
        togetherKeySetting.settingEl.style.alignItems = 'center';
        togetherKeySetting.addText(text => text
            .setPlaceholder('Enter API key')
            .setValue(this.plugin.settings.togetherApiKey)
            .then(input => {
                input.inputEl.type = 'password';
                input.inputEl.style.width = '240px';
            })
            .onChange(async (value) => {
                this.plugin.settings.togetherApiKey = value;
                await this.plugin.saveSettings();
            }));

        // Anthropic API key
        const anthropicKeySetting = new Setting(apiKeyGroup)
            .setClass('anthropic-key-setting')
            .setName('Anthropic API key')
            .setDesc(createFragment(frag => {
                frag.appendText('Required for Claude models. ');
                frag.createEl('a', {
                    text: 'Get API key',
                    href: 'https://console.anthropic.com/account/keys'
                }, (a) => {
                    a.setAttr('target', '_blank');
                });
            }));
        anthropicKeySetting.settingEl.style.alignItems = 'center';
        anthropicKeySetting.addText(text => text
            .setPlaceholder('Enter API key')
            .setValue(this.plugin.settings.anthropicKey)
            .then(input => {
                input.inputEl.type = 'password';
                input.inputEl.style.width = '240px';
            })
            .onChange(async (value) => {
                this.plugin.settings.anthropicKey = value;
                await this.plugin.saveSettings();
            }));

        // Local Llama endpoint setting
        const llamaEndpointSetting = new Setting(apiKeyGroup)
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
            }));
        llamaEndpointSetting.settingEl.style.alignItems = 'center';
        llamaEndpointSetting.addText(text => text
            .setPlaceholder('http://localhost:8080')
            .setValue(this.plugin.settings.llamaEndpoint)
            .then(input => {
                input.inputEl.style.width = '240px';
            }));

        // Ollama endpoint setting
        const ollamaEndpointSetting = new Setting(apiKeyGroup)
            .setClass('ollama-endpoint-setting')
            .setName('Ollama endpoint')
            .setDesc(createFragment(frag => {
                frag.appendText('URL for your Ollama server. ');
                frag.createEl('a', {
                    text: 'Install Ollama',
                    href: 'https://ollama.com/'
                }, (a) => {
                    a.setAttr('target', '_blank');
                });
            }));
        ollamaEndpointSetting.settingEl.style.alignItems = 'center';
        ollamaEndpointSetting.addText(text => text
            .setPlaceholder('http://localhost:11434')
            .setValue(this.plugin.settings.ollamaEndpoint)
            .then(input => {
                input.inputEl.style.width = '240px';
            }));

        // Hide endpoint if not using local Llama or Ollama
        llamaEndpointSetting.settingEl.style.display = 
            this.plugin.settings.model === 'llama-local' ? 'block' : 'none';
        ollamaEndpointSetting.settingEl.style.display = 
            this.plugin.settings.model === 'ollama' ? 'block' : 'none';

        // Connection settings header
        const connectionHeader = containerEl.createEl('h3', { text: 'Connection settings' });
        connectionHeader.style.marginBottom = '24px';

        // Connection strength
        const strengthSetting = new Setting(containerEl)
            .setName('Connection strength')
            .setDesc('How closely related notes need to be')
            .addDropdown(dropdown => dropdown
                .addOption('strict', 'Strict')
                .addOption('balanced', 'Balanced')
                .addOption('relaxed', 'Relaxed')
                .setValue(this.plugin.settings.connectionStrength)
                .then(dropdown => {
                    dropdown.selectEl.style.width = '240px';
                })
                .onChange(async (value: 'strict' | 'balanced' | 'relaxed') => {
                    this.plugin.settings.connectionStrength = value;
                    await this.plugin.saveSettings();
                }));

        // Backlink settings header
        const commandHeader = containerEl.createEl('h3', { text: 'Backlink settings' });
        commandHeader.style.marginBottom = '24px';
        commandHeader.style.marginTop = '48px';

        // Show header
        const showHeaderSetting = new Setting(containerEl)
            .setName('Show section header')
            .setDesc('Add "Related notes" header above backlinks')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showHeader)
                .onChange(async (value) => {
                    this.plugin.settings.showHeader = value;
                    await this.plugin.saveSettings();
                }));

        // Header level
        const headerLevelSetting = new Setting(containerEl)
            .setName('Header level')
            .setDesc('Level of the header (1-6)')
            .addDropdown(dropdown => dropdown
                .addOption('1', 'H1')
                .addOption('2', 'H2')
                .addOption('3', 'H3')
                .addOption('4', 'H4')
                .addOption('5', 'H5')
                .addOption('6', 'H6')
                .setValue(this.plugin.settings.headerLevel.toString())
                .then(dropdown => {
                    dropdown.selectEl.style.width = '240px';
                })
                .onChange(async (value) => {
                    const level = parseInt(value) as 1 | 2 | 3 | 4 | 5 | 6;
                    this.plugin.settings.headerLevel = level;
                    await this.plugin.saveSettings();
                }));

        // Format selection
        const formatSetting = new Setting(containerEl)
            .setName('Backlink format')
            .setDesc('Choose how to display backlinks in your notes')
            .addDropdown(dropdown => dropdown
                .addOption('comma', 'Comma list')
                .addOption('bullet', 'Bulleted list')
                .addOption('number', 'Numbered list')
                .addOption('line', 'One per line')
                .setValue(this.plugin.settings.format)
                .then(dropdown => {
                    dropdown.selectEl.style.width = '240px';
                })
                .onChange(async (value: 'comma' | 'bullet' | 'number' | 'line') => {
                    this.plugin.settings.format = value;
                    await this.plugin.saveSettings();
                }));

        // Special instructions
        const specialInstructionsSetting = new Setting(containerEl)
            .setName('Special instructions')
            .setDesc('Additional criteria for finding or formatting related notes')
            .addTextArea(text => text
                .setPlaceholder('Enter special instructions')
                .setValue(this.plugin.settings.specialInstructions)
                .then(input => {
                    input.inputEl.style.width = '240px';
                    input.inputEl.style.height = '96px';
                })
                .onChange(async (value) => {
                    this.plugin.settings.specialInstructions = value;
                    await this.plugin.saveSettings();
                }));

        // Folder exclusions
        const folderSetting = new Setting(containerEl)
            .setName('Excluded folders')
            .setDesc('Skip these folders when finding connections');

        const folderContainer = folderSetting.settingEl.createDiv('folder-container');
        folderContainer.style.display = 'flex';
        folderContainer.style.flexDirection = 'column';
        folderContainer.style.gap = '12px';

        // Create text area component
        const textAreaComponent = new TextAreaComponent(folderContainer);
        textAreaComponent
            .setPlaceholder('One folder path per line')
            .setValue(this.plugin.settings.excludedFolders.join('\n'));
        
        textAreaComponent.inputEl.style.width = '240px';
        textAreaComponent.inputEl.style.height = '96px';
        
        textAreaComponent.onChange(async (value) => {
            this.plugin.settings.excludedFolders = value.split('\n')
                .map(folder => folder.trim())
                .filter(folder => folder.length > 0);
            await this.plugin.saveSettings();
        });

        // Button row below textarea
        const buttonRow = folderContainer.createDiv('button-row');
        buttonRow.style.display = 'flex';
        buttonRow.style.gap = '8px';

        // Add folder button
        const addButton = new ButtonComponent(buttonRow)
            .setButtonText('Add folder')
            .onClick(() => {
                new FolderSuggestModal(this.app, textAreaComponent, this.plugin).open();
            });

        // Clear button
        const clearButton = new ButtonComponent(buttonRow)
            .setButtonText('Clear')
            .onClick(async () => {
                textAreaComponent.setValue('');
                this.plugin.settings.excludedFolders = [];
                await this.plugin.saveSettings();
            });

        // Tag settings
        const tagWeavingHeader = containerEl.createEl('h3', { text: 'Tag settings' });
        tagWeavingHeader.style.marginBottom = '24px';
        tagWeavingHeader.style.marginTop = '48px';

        // Custom tags
        const customTagsSetting = new Setting(containerEl)
            .setName('Custom tags')
            .setDesc('Tags that may not be in your vault yet.');

        const customTagsContainer = customTagsSetting.settingEl.createDiv('custom-tags-container');
        customTagsContainer.style.display = 'flex';
        customTagsContainer.style.flexDirection = 'column';
        customTagsContainer.style.gap = '12px';

        // Create text area component
        const customTagsTextAreaComponent = new TextAreaComponent(customTagsContainer);
        customTagsTextAreaComponent
            .setPlaceholder('One tag per line')
            .setValue(this.plugin.settings.customTags.join('\n'));
        
        customTagsTextAreaComponent.inputEl.style.width = '240px';
        customTagsTextAreaComponent.inputEl.style.height = '96px';
        
        customTagsTextAreaComponent.onChange(async (value) => {
            this.plugin.settings.customTags = value.split('\n')
                .map(tag => tag.trim())
                .filter(tag => tag.length > 0);
            await this.plugin.saveSettings();
        });

        // Button row below textarea
        const customTagsButtonRow = customTagsContainer.createDiv('button-row');
        customTagsButtonRow.style.display = 'flex';
        customTagsButtonRow.style.gap = '8px';

        // Clear button
        const customTagsClearButton = new ButtonComponent(customTagsButtonRow)
            .setButtonText('Clear')
            .onClick(async () => {
                customTagsTextAreaComponent.setValue('');
                this.plugin.settings.customTags = [];
                await this.plugin.saveSettings();
            });

        // Use only custom tags
        const useOnlyCustomTagsSetting = new Setting(containerEl)
            .setName('Use only custom tags')
            .setDesc('Only consider connections with custom tags')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useOnlyCustomTags)
                .onChange(async (value) => {
                    this.plugin.settings.useOnlyCustomTags = value;
                    await this.plugin.saveSettings();
                }));

        // Update API key visibility initially
        this.updateApiKeyVisibility();
    }

    private updateApiKeyVisibility() {
        const openaiKeyEl = document.querySelector('.openai-key-setting') as HTMLElement;
        const anthropicKeyEl = document.querySelector('.anthropic-key-setting') as HTMLElement;
        const togetherKeyEl = document.querySelector('.together-key-setting') as HTMLElement;
        const llamaEndpointEl = document.querySelector('.llama-endpoint-setting') as HTMLElement;
        const ollamaEndpointEl = document.querySelector('.ollama-endpoint-setting') as HTMLElement;

        if (openaiKeyEl) {
            openaiKeyEl.style.display = 
                ['gpt-4', 'gpt-3.5-turbo'].includes(this.plugin.settings.model) ? 'block' : 'none';
        }
        if (anthropicKeyEl) {
            anthropicKeyEl.style.display = 
                ['claude-3.5', 'claude-3'].includes(this.plugin.settings.model) ? 'block' : 'none';
        }
        if (togetherKeyEl) {
            togetherKeyEl.style.display = 
                this.plugin.settings.model === 'llama-2-70b' ? 'block' : 'none';
        }
        if (llamaEndpointEl) {
            llamaEndpointEl.style.display = 
                this.plugin.settings.model === 'llama-local' ? 'block' : 'none';
        }
        if (ollamaEndpointEl) {
            ollamaEndpointEl.style.display = 
                this.plugin.settings.model === 'ollama' ? 'block' : 'none';
        }
    }
}
