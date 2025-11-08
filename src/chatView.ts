import { ItemView, MarkdownRenderer, Notice, WorkspaceLeaf } from 'obsidian';
import type ClaudeAidePlugin from './main';
import type { UsageSummary } from './claudeSession';

export const VIEW_TYPE = 'claude-aide-chat-view';

interface ChatMessage {
        id: string;
        role: 'user' | 'assistant' | 'system' | 'error';
        content: string;
        streaming: boolean;
        footer?: string;
        element?: HTMLElement;
        contentEl?: HTMLElement;
        footerEl?: HTMLElement;
}

export class ClaudeChatView extends ItemView {
        private plugin: ClaudeAidePlugin;
        private headerEl!: HTMLElement;
        private statusEl!: HTMLElement;
        private sessionBadgeEl!: HTMLElement;
        private resetButton!: HTMLButtonElement;
        private stopButton!: HTMLButtonElement;
        private messageContainer!: HTMLElement;
        private formEl!: HTMLFormElement;
        private inputEl!: HTMLTextAreaElement;
        private sendButton!: HTMLButtonElement;
        private busy = false;
        private messageOrder = 0;
        private messages: ChatMessage[] = [];

        constructor(leaf: WorkspaceLeaf, plugin: ClaudeAidePlugin) {
                super(leaf);
                this.plugin = plugin;
        }

        getViewType(): string {
                return VIEW_TYPE;
        }

        getDisplayText(): string {
                return 'Claude aide chat';
        }

        async onOpen(): Promise<void> {
                this.containerEl.empty();
                this.containerEl.addClass('claude-aide-view');

                this.headerEl = this.containerEl.createDiv({ cls: 'claude-aide-header' });
                const titleEl = this.headerEl.createEl('h2', { text: 'Claude aide chat' });
                titleEl.addClass('claude-aide-title');

                this.statusEl = this.headerEl.createDiv({ cls: 'claude-aide-status', text: 'Enter a prompt to start chatting.' });
                this.sessionBadgeEl = this.headerEl.createDiv({ cls: 'claude-aide-session-id' });

                const headerButtons = this.headerEl.createDiv({ cls: 'claude-aide-header-buttons' });
                this.stopButton = headerButtons.createEl('button', { text: 'Stop' });
                this.stopButton.addClass('mod-cta');
                this.stopButton.disabled = true;
                this.stopButton.addEventListener('click', () => {
                        this.plugin.cancelActiveRequest();
                });

                this.resetButton = headerButtons.createEl('button', { text: 'New session' });
                this.resetButton.addEventListener('click', () => {
                        this.plugin.startNewConversation();
                });

                this.messageContainer = this.containerEl.createDiv({ cls: 'claude-aide-messages' });

                this.formEl = this.containerEl.createEl('form', { cls: 'claude-aide-input' });
                this.inputEl = this.formEl.createEl('textarea');
                this.inputEl.placeholder = 'Ask Claude about your vault or code...';
                this.inputEl.rows = 3;

                const controls = this.formEl.createDiv({ cls: 'claude-aide-input-controls' });
                this.sendButton = controls.createEl('button', { text: 'Send', type: 'submit' });
                this.sendButton.addClass('mod-cta');

                this.formEl.addEventListener('submit', async (event) => {
                        event.preventDefault();
                        const value = this.inputEl.value.trim();
                        if (!value) {
                                return;
                        }
                        await this.plugin.sendMessage(value);
                });

                this.renderEmptyState();
        }

        async onClose(): Promise<void> {
                this.messages = [];
        }

        focusInput(): void {
                this.inputEl.focus();
        }

        showNotice(message: string): void {
                new Notice(message);
        }

        setBusy(isBusy: boolean): void {
                this.busy = isBusy;
                this.inputEl.toggleAttribute('disabled', isBusy);
                this.sendButton.toggleAttribute('disabled', isBusy);
                this.stopButton.disabled = !isBusy;
                if (!isBusy) {
                        this.inputEl.value = '';
                        this.inputEl.focus();
                }
        }

        setStatus(text: string): void {
                if (text) {
                        this.statusEl.setText(text);
                } else {
                        this.statusEl.setText('');
                }
        }

        setSessionId(sessionId: string | undefined): void {
                if (sessionId) {
                        this.sessionBadgeEl.setText(`Session ${sessionId.slice(0, 8)}`);
                } else {
                        this.sessionBadgeEl.setText('');
                }
        }

        clearMessages(): void {
                this.messages = [];
                this.messageContainer.empty();
                this.renderEmptyState();
        }

        addUserMessage(content: string): void {
                const message = this.createMessage('user', content, false);
                this.messages.push(message);
                message.contentEl?.setText(content);
                this.scrollToBottom();
        }

        beginAssistantMessage(): ChatMessage {
                const message = this.createMessage('assistant', '', true);
                this.messages.push(message);
                message.contentEl?.setText('');
                this.scrollToBottom();
                return message;
        }

        appendAssistantDelta(message: ChatMessage, delta: string): void {
                message.content += delta;
                if (message.streaming && message.contentEl) {
                        message.contentEl.setText(message.content);
                }
                this.scrollToBottom();
        }

        async finalizeAssistantMessage(message: ChatMessage, content: string): Promise<void> {
                message.streaming = false;
                message.content = content;
                message.element?.removeClass('is-streaming');
                if (!message.contentEl) {
                        return;
                }
                if (!content.trim()) {
                        message.contentEl.setText('');
                        this.scrollToBottom();
                        return;
                }
                message.contentEl.empty();
                await MarkdownRenderer.render(this.app, content, message.contentEl, '/', this);
                this.scrollToBottom();
        }

        setAssistantFooter(message: ChatMessage, usage?: UsageSummary): void {
                if (!this.plugin.settings.showUsageSummaries) {
                        return;
                }
                if (!message.footerEl || !usage) {
                        return;
                }
                const summary = usage.text || this.buildUsageSummary(usage);
                message.footerEl.setText(summary);
                message.footerEl.toggleClass('is-hidden', summary.length === 0);
        }

        private buildUsageSummary(usage: UsageSummary): string {
                const parts: string[] = [];
                if (usage.inputTokens !== undefined) {
                        parts.push(`Input ${usage.inputTokens} tok`);
                }
                if (usage.outputTokens !== undefined) {
                        parts.push(`Output ${usage.outputTokens} tok`);
                }
                if (usage.costUSD !== undefined) {
                        parts.push(`Cost $${usage.costUSD.toFixed(4)}`);
                }
                if (usage.durationMs !== undefined) {
                        parts.push(`Time ${(usage.durationMs / 1000).toFixed(1)}s`);
                }
                return parts.join(' • ');
        }

        showError(error: string): void {
                const message = this.createMessage('error', error, false);
                this.messages.push(message);
                message.contentEl?.setText(error);
                this.scrollToBottom();
        }

        private renderEmptyState(): void {
                const empty = this.messageContainer.createDiv({ cls: 'claude-aide-empty' });
                empty.createEl('p', { text: 'Start a conversation with Claude to get code-aware assistance in your vault.' });
                empty.createEl('p', { text: 'Claude uses the Agent SDK, so the aide bar can read files, run tools, and stay in context.' });
        }

        private createMessage(role: ChatMessage['role'], content: string, streaming: boolean): ChatMessage {
                const id = `${Date.now()}-${this.messageOrder++}`;
                const emptyState = this.messageContainer.querySelector('.claude-aide-empty');
                emptyState?.detach();
                const wrapper = this.messageContainer.createDiv({ cls: `claude-aide-message claude-aide-message-${role}` });
                if (streaming) {
                        wrapper.addClass('is-streaming');
                }
                const bubble = wrapper.createDiv({ cls: 'claude-aide-bubble' });
                const contentEl = bubble.createDiv({ cls: 'claude-aide-bubble-content' });
                const footerEl = wrapper.createDiv({ cls: 'claude-aide-message-footer is-hidden' });

                const message: ChatMessage = {
                        id,
                        role,
                        content,
                        streaming,
                        element: wrapper,
                        contentEl,
                        footerEl,
                };
                return message;
        }

        private scrollToBottom(): void {
                this.messageContainer.scrollTo({ top: this.messageContainer.scrollHeight, behavior: 'smooth' });
        }
}
