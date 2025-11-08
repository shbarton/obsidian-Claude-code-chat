import { AbortError, query, type AgentDefinition, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export interface AgentConfig {
        apiKey: string;
        model: string;
        systemPrompt: string;
        agents?: Record<string, AgentDefinition>;
}

export interface UsageSummary {
        text: string;
        inputTokens?: number;
        outputTokens?: number;
        costUSD?: number;
        durationMs?: number;
}

export interface SessionCallbacks {
        onSessionStarted?: (sessionId: string) => void;
        onStatus?: (status: string) => void;
        onDelta?: (delta: string) => void;
        onComplete?: (finalText: string) => void;
        onUsage?: (usage: UsageSummary) => void;
}

export class ClaudeAgentSession {
        private readonly configProvider: () => AgentConfig;
        private sessionId: string | undefined;
        private active = false;
        private abortController: AbortController | undefined;

        constructor(configProvider: () => AgentConfig) {
                this.configProvider = configProvider;
        }

        get hasActiveRequest(): boolean {
                return this.active;
        }

        get currentSessionId(): string | undefined {
                return this.sessionId;
        }

        reset(): void {
                this.abort();
                this.sessionId = undefined;
        }

        abort(): void {
                if (this.abortController) {
                        this.abortController.abort();
                        this.abortController = undefined;
                }
        }

        async send(prompt: string, callbacks: SessionCallbacks): Promise<string> {
                if (this.active) {
                        throw new Error('Claude is already processing a message.');
                }

                const config = this.configProvider();
                if (!config.apiKey) {
                        throw new Error('Add an Anthropic API key in the plugin settings to chat with Claude.');
                }

                const env = { ...process.env, ANTHROPIC_API_KEY: config.apiKey };

                const options: Options = {
                        env,
                        includePartialMessages: true,
                        continue: Boolean(this.sessionId),
                        resume: this.sessionId,
                        model: config.model || undefined,
                        ...(config.agents ? { agents: config.agents } : {}),
                };

                if (config.systemPrompt) {
                        options.systemPrompt = {
                                type: 'preset',
                                preset: 'claude_code',
                                append: config.systemPrompt,
                        };
                }

                const abortController = new AbortController();
                options.abortController = abortController;
                this.abortController = abortController;

                this.active = true;
                let finalText = '';
                let completed = false;
                let accumulated = '';

                const callbacksWithAggregation: SessionCallbacks = {
                        ...callbacks,
                        onDelta: (delta: string) => {
                                if (delta.length > 0) {
                                        accumulated += delta;
                                        callbacks.onDelta?.(delta);
                                }
                        },
                };

                const markComplete = (value?: string) => {
                        const resolved = value && value.length > 0 ? value : accumulated;
                        if (!completed && resolved && resolved.length > 0) {
                                completed = true;
                                finalText = resolved;
                                callbacks.onComplete?.(resolved);
                        }
                };

                try {
                        const stream = query({ prompt, options });
                        for await (const message of stream) {
                                this.handleMessage(message, callbacksWithAggregation, markComplete);
                        }
                        if (!completed) {
                                markComplete();
                        }
                        return finalText;
                } catch (error) {
                        if (error instanceof AbortError || (error instanceof Error && error.name === 'AbortError')) {
                                throw new Error('The current request was cancelled.');
                        }
                        throw error;
                } finally {
                        this.active = false;
                        this.abortController = undefined;
                }
        }

        private handleMessage(message: SDKMessage, callbacks: SessionCallbacks, markComplete: (text?: string) => void): void {
                switch (message.type) {
                case 'system':
                        if (message.subtype === 'init') {
                                this.sessionId = message.session_id;
                                callbacks.onSessionStarted?.(message.session_id);
                                callbacks.onStatus?.('Connected to Claude');
                        } else if (message.subtype === 'hook_response') {
                                callbacks.onStatus?.(message.stdout?.trim() || 'Hook response received');
                        }
                        break;
                case 'auth_status':
                        if (message.error) {
                                callbacks.onStatus?.(`Authentication error: ${message.error}`);
                        } else if (message.isAuthenticating) {
                                callbacks.onStatus?.('Authenticating with Anthropic...');
                        } else {
                                callbacks.onStatus?.('Authentication complete');
                        }
                        break;
                case 'tool_progress':
                        callbacks.onStatus?.(`Running tool: ${message.tool_name}`);
                        break;
                case 'stream_event':
                        this.handleStreamEvent(message.event, callbacks, markComplete);
                        break;
                case 'assistant':
                        this.renderAssistantMessage(message.message.content, callbacks, markComplete);
                        break;
                case 'result':
                        this.handleResultMessage(message, callbacks, markComplete);
                        break;
                default:
                        break;
                }
        }

        private handleStreamEvent(event: unknown, callbacks: SessionCallbacks, markComplete: (text?: string) => void): void {
                const streamEvent = event as {
                        type?: string;
                        delta?: { type?: string; text?: string };
                        content_block?: { type?: string };
                        message?: { stop_reason?: string };
                        error?: { message?: string };
                };

                if (!streamEvent || typeof streamEvent !== 'object') {
                        return;
                }

                if (streamEvent.type === 'content_block_delta' && streamEvent.delta?.type === 'text_delta') {
                        const delta = streamEvent.delta.text ?? '';
                        if (delta) {
                                callbacks.onDelta?.(delta);
                        }
                } else if (streamEvent.type === 'message_stop') {
                        callbacks.onStatus?.('Response complete');
                        markComplete();
                } else if (streamEvent.type === 'message_delta' && streamEvent.message?.stop_reason) {
                        callbacks.onStatus?.(`Stopped: ${streamEvent.message.stop_reason}`);
                } else if (streamEvent.type === 'message_error' && streamEvent.error?.message) {
                        callbacks.onStatus?.(`Error: ${streamEvent.error.message}`);
                }
        }

        private renderAssistantMessage(content: unknown, callbacks: SessionCallbacks, markComplete: (text?: string) => void): void {
                if (!Array.isArray(content)) {
                        return;
                }
                const textParts: string[] = [];
                for (const block of content as Array<{ type?: string; text?: string; name?: string; input?: unknown }>) {
                        if (block.type === 'text' && block.text) {
                                textParts.push(block.text);
                        } else if (block.type === 'tool_use' && block.name) {
                                textParts.push(`\n[Used tool: ${block.name}]`);
                        }
                }
                if (textParts.length > 0) {
                        const combined = textParts.join('\n\n');
                        markComplete(combined);
                }
        }

        private handleResultMessage(message: Extract<SDKMessage, { type: 'result' }>, callbacks: SessionCallbacks, markComplete: (text?: string) => void): void {
                if (message.subtype !== 'success') {
                        const reason = Array.isArray((message as { errors?: string[] }).errors) && (message as { errors?: string[] }).errors?.length
                                ? (message as { errors?: string[] }).errors!.join('\n')
                                : 'Claude was unable to finish the request.';
                        throw new Error(reason);
                }

                const resultText = (message.result ?? '').toString();
                markComplete(resultText);

                const usage = message.usage as Record<string, unknown> | undefined;
                const summary: UsageSummary = {
                        text: '',
                        durationMs: message.duration_ms,
                        costUSD: message.total_cost_usd,
                };

                const inputTokens = this.extractNumericField(usage, ['inputTokens', 'input_tokens']);
                const outputTokens = this.extractNumericField(usage, ['outputTokens', 'output_tokens']);
                const cacheRead = this.extractNumericField(usage, ['cacheReadInputTokens', 'cache_read_input_tokens']);
                const cacheCreate = this.extractNumericField(usage, ['cacheCreationInputTokens', 'cache_creation_input_tokens']);

                summary.inputTokens = inputTokens;
                summary.outputTokens = outputTokens;

                const pieces: string[] = [];
                if (inputTokens !== undefined && outputTokens !== undefined) {
                        pieces.push(`Input ${inputTokens} tok • Output ${outputTokens} tok`);
                } else if (inputTokens !== undefined) {
                        pieces.push(`Input ${inputTokens} tok`);
                } else if (outputTokens !== undefined) {
                        pieces.push(`Output ${outputTokens} tok`);
                }

                if (cacheRead !== undefined || cacheCreate !== undefined) {
                        const parts: string[] = [];
                        if (cacheRead !== undefined) {
                                parts.push(`cache read ${cacheRead}`);
                        }
                        if (cacheCreate !== undefined) {
                                parts.push(`cache write ${cacheCreate}`);
                        }
                        pieces.push(parts.join(', '));
                }

                if (message.total_cost_usd !== undefined) {
                        pieces.push(`Cost $${message.total_cost_usd.toFixed(4)}`);
                }

                if (message.duration_ms !== undefined) {
                        pieces.push(`Time ${(message.duration_ms / 1000).toFixed(1)}s`);
                }

                summary.text = pieces.join(' • ');
                callbacks.onUsage?.(summary);
        }

        private extractNumericField(source: Record<string, unknown> | undefined, keys: string[]): number | undefined {
                if (!source) {
                        return undefined;
                }
                for (const key of keys) {
                        const value = source[key];
                        if (typeof value === 'number') {
                                return value;
                        }
                }
                return undefined;
        }
}
