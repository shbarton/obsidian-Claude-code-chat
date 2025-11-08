import { Notice, Plugin, TAbstractFile, TFile } from 'obsidian';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeAgentSession, type SessionCallbacks } from './claudeSession';
import { ClaudeChatView, VIEW_TYPE } from './chatView';
import { ClaudeAideSettingTab, DEFAULT_SETTINGS, type ClaudeAideSettings } from './settings';
import { isPathWithinFolder, loadSubagentsFromFolder } from './subagents';

export default class ClaudeAidePlugin extends Plugin {
        settings: ClaudeAideSettings;
        private session!: ClaudeAgentSession;
        private view: ClaudeChatView | undefined;
        private subagents: Record<string, AgentDefinition> = {};
        private subagentFolderNormalized: string | undefined;
        private subagentErrorMessage: string | undefined;
        private subagentReloadTimeout: number | undefined;

        private readonly handleVaultCreate = (file: TAbstractFile) => {
                if (file instanceof TFile && this.isSubagentPath(file.path)) {
                        this.queueSubagentReload();
                }
        };

        private readonly handleVaultModify = (file: TAbstractFile) => {
                if (file instanceof TFile && this.isSubagentPath(file.path)) {
                        this.queueSubagentReload();
                }
        };

        private readonly handleVaultDelete = (file: TAbstractFile) => {
                if (this.isSubagentPath(file.path)) {
                        this.queueSubagentReload();
                }
        };

        private readonly handleVaultRename = (file: TAbstractFile, oldPath: string) => {
                if (this.isSubagentPath(file.path) || this.isSubagentPath(oldPath)) {
                        this.queueSubagentReload();
                }
        };

        private readonly handleMetadataChanged = (file: TFile) => {
                if (this.isSubagentPath(file.path)) {
                        this.queueSubagentReload();
                }
        };

        async onload(): Promise<void> {
                await this.loadSettings();
                await this.refreshSubagents();
                this.session = new ClaudeAgentSession(() => ({
                        apiKey: this.settings.apiKey,
                        model: this.settings.defaultModel,
                        systemPrompt: this.settings.systemPrompt,
                        agents: this.subagents,
                }));

                this.registerView(VIEW_TYPE, (leaf) => {
                        const view = new ClaudeChatView(leaf, this);
                        this.view = view;
                        return view;
                });

                this.addRibbonIcon('bot', 'Open Claude aide chat', async () => {
                        await this.activateView();
                });

                this.addCommand({
                        id: 'claude-aide-open',
                        name: 'Open Claude aide chat',
                        callback: async () => {
                                await this.activateView();
                        },
                });

                this.addSettingTab(new ClaudeAideSettingTab(this.app, this));

                this.registerEvent(this.app.vault.on('create', this.handleVaultCreate));
                this.registerEvent(this.app.vault.on('modify', this.handleVaultModify));
                this.registerEvent(this.app.vault.on('delete', this.handleVaultDelete));
                this.registerEvent(this.app.vault.on('rename', this.handleVaultRename));
                this.registerEvent(this.app.metadataCache.on('changed', this.handleMetadataChanged));

                if (this.settings.autoOpenOnLoad) {
                        await this.activateView();
                }
        }

        async onunload(): Promise<void> {
                this.session?.abort();
                this.app.workspace.detachLeavesOfType(VIEW_TYPE);
                if (this.subagentReloadTimeout !== undefined) {
                        window.clearTimeout(this.subagentReloadTimeout);
                        this.subagentReloadTimeout = undefined;
                }
        }

        async sendMessage(prompt: string): Promise<void> {
                const view = await this.ensureView();

                if (this.session.hasActiveRequest) {
                        view.showNotice('Claude is still working on the last request.');
                        return;
                }

                view.addUserMessage(prompt);
                const assistantMessage = view.beginAssistantMessage();
                view.setBusy(true);
                view.setStatus('Contacting Claude...');

                const callbacks: SessionCallbacks = {
                        onSessionStarted: (sessionId) => view.setSessionId(sessionId),
                        onStatus: (status) => view.setStatus(status),
                        onDelta: (delta) => view.appendAssistantDelta(assistantMessage, delta),
                        onUsage: (usage) => view.setAssistantFooter(assistantMessage, usage),
                        onComplete: (text) => {
                                void view.finalizeAssistantMessage(assistantMessage, text);
                        },
                };

                try {
                        const finalText = await this.session.send(prompt, callbacks);
                        if (!finalText) {
                                await view.finalizeAssistantMessage(assistantMessage, assistantMessage.content);
                        }
                } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        const isCancelled = /cancel/i.test(message);
                        if (isCancelled) {
                                await view.finalizeAssistantMessage(assistantMessage, '_Request cancelled._');
                                view.setStatus('Request cancelled.');
                        } else {
                                await view.finalizeAssistantMessage(assistantMessage, `**Error:** ${message}`);
                                assistantMessage.element?.addClass('claude-aide-message-error');
                                new Notice(message);
                                view.setStatus(message);
                        }
                        assistantMessage.footerEl?.setText('');
                        assistantMessage.footerEl?.addClass('is-hidden');
                } finally {
                        view.setBusy(false);
                }
        }

        startNewConversation(): void {
                this.session.reset();
                const view = this.view;
                if (view) {
                        view.clearMessages();
                        view.setSessionId(undefined);
                        view.setStatus('Started a new session.');
                        view.focusInput();
                }
        }

        cancelActiveRequest(): void {
                if (this.session.hasActiveRequest) {
                        this.session.abort();
                        this.view?.setStatus('Cancelling request...');
                }
        }

        async activateView(): Promise<ClaudeChatView> {
                const workspace = this.app.workspace;
                let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
                if (!leaf) {
                        leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
                        if (!leaf) {
                                throw new Error('Unable to open Claude aide chat view.');
                        }
                        await leaf.setViewState({ type: VIEW_TYPE, active: true });
                }
                workspace.revealLeaf(leaf);
                const view = leaf.view as ClaudeChatView;
                this.view = view;
                view.focusInput();
                return view;
        }

        private async ensureView(): Promise<ClaudeChatView> {
                if (this.view && this.view.containerEl.isConnected) {
                        return this.view;
                }
                const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
                if (leaves.length > 0) {
                        const existing = leaves[0].view as ClaudeChatView;
                        this.view = existing;
                        return existing;
                }
                return this.activateView();
        }

        async loadSettings(): Promise<void> {
                this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        }

        async saveSettings(): Promise<void> {
                await this.saveData(this.settings);
                await this.refreshSubagents();
                this.session?.reset();
        }

        private async refreshSubagents(): Promise<void> {
                const result = await loadSubagentsFromFolder(this.app, this.settings.subagentFolder);
                this.subagents = result.agents;
                this.subagentFolderNormalized = result.normalizedFolder;

                if (result.errors.length > 0) {
                        const combined = result.errors.join('\n');
                        if (combined !== this.subagentErrorMessage) {
                                this.subagentErrorMessage = combined;
                                console.warn('[Claude aide] Subagent load issues:', combined);
                                new Notice(`Claude subagents: ${combined}`);
                        }
                } else if (this.subagentErrorMessage) {
                        this.subagentErrorMessage = undefined;
                }
        }

        private queueSubagentReload(): void {
                if (!this.settings.subagentFolder?.trim()) {
                        return;
                }
                if (this.subagentReloadTimeout !== undefined) {
                        window.clearTimeout(this.subagentReloadTimeout);
                }
                this.subagentReloadTimeout = window.setTimeout(() => {
                        this.subagentReloadTimeout = undefined;
                        void this.refreshSubagents();
                }, 500);
        }

        private isSubagentPath(path: string): boolean {
                if (!this.subagentFolderNormalized) {
                        return false;
                }
                return isPathWithinFolder(path, this.subagentFolderNormalized);
        }
}
