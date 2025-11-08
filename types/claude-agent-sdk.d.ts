declare module '@anthropic-ai/claude-agent-sdk' {
        export class AbortError extends Error {}

        export interface AgentDefinition {
                description: string;
                prompt: string;
                tools?: string[];
                disallowedTools?: string[];
                model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
        }

        export interface Options {
                env?: Record<string, string | undefined>;
                includePartialMessages?: boolean;
                continue?: boolean;
                resume?: string | undefined;
                model?: string;
                systemPrompt?: unknown;
                abortController?: AbortController;
                agents?: Record<string, AgentDefinition>;
                [key: string]: unknown;
        }

        export type SDKMessage = any;

        export type Query = AsyncIterable<SDKMessage>;

        export function query(params: { prompt: string | AsyncIterable<SDKMessage>; options?: Options }): Query;
}
