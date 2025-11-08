import { App, PluginSettingTab, Setting } from 'obsidian';
import type ClaudeAidePlugin from './main';

export type ClaudeModel = 'haiku' | 'sonnet' | 'opus';

export interface ClaudeAideSettings {
	apiKey: string;
	defaultModel: ClaudeModel;
	systemPrompt: string;
	subagentFolder: string;
	autoOpenOnLoad: boolean;
	showUsageSummaries: boolean;
}

export const DEFAULT_SETTINGS: ClaudeAideSettings = {
	apiKey: '',
	defaultModel: 'sonnet',
	systemPrompt: '',
	subagentFolder: '',
	autoOpenOnLoad: true,
	showUsageSummaries: true,
};

export class ClaudeAideSettingTab extends PluginSettingTab {
        private plugin: ClaudeAidePlugin;

        constructor(app: App, plugin: ClaudeAidePlugin) {
                super(app, plugin);
                this.plugin = plugin;
        }

        display(): void {
                const { containerEl } = this;
                containerEl.empty();

                containerEl.createEl('h2', { text: 'Claude Aide Chat' });

                new Setting(containerEl)
                        .setName('Anthropic API key')
                        .setDesc('Used to authenticate requests sent through the Claude Agent SDK. Stored locally in your vault.')
                        .addText(text => {
                                text.inputEl.type = 'password';
                                text.setPlaceholder('sk-ant-...');
                                text.setValue(this.plugin.settings.apiKey);
                                text.onChange(async (value) => {
                                        this.plugin.settings.apiKey = value.trim();
                                        await this.plugin.saveSettings();
                                });
                        });

                new Setting(containerEl)
                        .setName('Default Claude model')
                        .setDesc('Select which Claude model the agent should use when generating responses.')
                        .addDropdown(dropdown => {
                                dropdown.addOption('haiku', 'Claude 3.5 Haiku');
                                dropdown.addOption('sonnet', 'Claude 3.5 Sonnet');
                                dropdown.addOption('opus', 'Claude 3.5 Opus');
                                dropdown.setValue(this.plugin.settings.defaultModel);
                                dropdown.onChange(async (value: ClaudeModel) => {
                                        this.plugin.settings.defaultModel = value;
                                        await this.plugin.saveSettings();
                                });
                        });

                new Setting(containerEl)
                        .setName('Custom instructions')
                        .setDesc('Optional text appended to the built-in Claude Code preset instructions for every conversation.')
                        .addTextArea(text => {
                                text.setPlaceholder('Keep responses short, summarize code, ...');
                                text.setValue(this.plugin.settings.systemPrompt);
                                text.onChange(async (value) => {
                                        this.plugin.settings.systemPrompt = value.trim();
                                        await this.plugin.saveSettings();
                                });
                                text.inputEl.rows = 4;
                        });

                new Setting(containerEl)
                        .setName('Subagent folder')
                        .setDesc('Path relative to your vault containing Markdown files. Each file becomes a Claude subagent; optionally add YAML front matter with id, description, model, tools, or disallowedTools.')
                        .addText((text) => {
                                text.setPlaceholder('Claude/Subagents');
                                text.setValue(this.plugin.settings.subagentFolder);
                                text.onChange(async (value) => {
                                        this.plugin.settings.subagentFolder = value.trim();
                                        await this.plugin.saveSettings();
                                });
                        });

                new Setting(containerEl)
                        .setName('Open chat on startup')
                        .setDesc('Automatically open the Claude aide bar when the plugin loads.')
                        .addToggle(toggle => {
                                toggle.setValue(this.plugin.settings.autoOpenOnLoad);
                                toggle.onChange(async (value) => {
                                        this.plugin.settings.autoOpenOnLoad = value;
                                        await this.plugin.saveSettings();
                                });
                        });

                new Setting(containerEl)
                        .setName('Show usage summaries')
                        .setDesc('Display the token and cost summary beneath each assistant response when available.')
                        .addToggle(toggle => {
                                toggle.setValue(this.plugin.settings.showUsageSummaries);
                                toggle.onChange(async (value) => {
                                        this.plugin.settings.showUsageSummaries = value;
                                        await this.plugin.saveSettings();
                                });
                        });
        }
}
