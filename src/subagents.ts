import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

export interface SubagentLoadResult {
	agents: Record<string, AgentDefinition>;
	normalizedFolder?: string;
	errors: string[];
}

interface ParsedSubagent {
	id: string;
	definition: AgentDefinition;
}

const FRONT_MATTER_REGEX = /^---\s*[\r\n]+[\s\S]*?[\r\n]+---\s*/;
const MODEL_OPTIONS = new Set(['haiku', 'sonnet', 'opus', 'inherit']);

export async function loadSubagentsFromFolder(app: App, folderPath: string | undefined): Promise<SubagentLoadResult> {
	if (!folderPath || !folderPath.trim()) {
	        return { agents: {}, errors: [] };
	}

	const normalizedFolder = normalizePath(folderPath.trim());
	const target = app.vault.getAbstractFileByPath(normalizedFolder);

	if (!target) {
	        return {
	                agents: {},
	                normalizedFolder,
	                errors: [`Subagent folder not found: ${normalizedFolder}`],
	        };
	}

	if (!(target instanceof TFolder)) {
	        return {
	                agents: {},
	                normalizedFolder,
	                errors: [`Subagent path is not a folder: ${normalizedFolder}`],
	        };
	}

	const agents: Record<string, AgentDefinition> = {};
	const errors: string[] = [];

	for (const child of target.children) {
	        if (child instanceof TFile && child.extension.toLowerCase() === 'md') {
	                const result = await parseSubagentFile(app, child);
	                if (!result) {
	                        continue;
	                }
	                if (agents[result.id]) {
	                        errors.push(`Duplicate subagent id "${result.id}" in ${child.path}. Skipping.`);
	                        continue;
	                }
	                agents[result.id] = result.definition;
	        }
	}

	return { agents, normalizedFolder, errors };
}

function slugify(text: string): string {
	return text
	        .toLowerCase()
	        .replace(/[^a-z0-9]+/g, '-')
	        .replace(/^-+|-+$/g, '')
	        .replace(/-{2,}/g, '-');
}

async function parseSubagentFile(app: App, file: TFile): Promise<ParsedSubagent | undefined> {
	try {
	        const raw = await app.vault.read(file);
	        const cache = app.metadataCache.getCache(file.path);
	        const frontmatter = cache?.frontmatter ?? {};

	        const idSource = typeof frontmatter.id === 'string' && frontmatter.id.trim().length > 0
	                ? frontmatter.id.trim()
	                : file.basename;
	        const id = slugify(idSource);
	        if (!id) {
	                return undefined;
	        }

	        const prompt = stripFrontMatter(raw).trim();
	        if (!prompt) {
	                return undefined;
	        }

	        const description = typeof frontmatter.description === 'string' && frontmatter.description.trim().length > 0
	                ? frontmatter.description.trim()
	                : file.basename;

	        const modelValue = typeof frontmatter.model === 'string' ? frontmatter.model.trim().toLowerCase() : undefined;
	        const model = modelValue && MODEL_OPTIONS.has(modelValue)
	                ? (modelValue as AgentDefinition['model'])
	                : undefined;

	        const tools = normalizeStringArray(frontmatter.tools);
	        const disallowedTools = normalizeStringArray(frontmatter.disallowedTools);

	        return {
	                id,
	                definition: {
	                        prompt,
	                        description,
	                        ...(model ? { model } : {}),
	                        ...(tools ? { tools } : {}),
	                        ...(disallowedTools ? { disallowedTools } : {}),
	                },
	        };
	} catch (error) {
	        console.error('Failed to load Claude subagent', file.path, error);
	        return undefined;
	}
}

function normalizeStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
	        return undefined;
	}
	const cleaned = value
	        .map((item) => (typeof item === 'string' ? item.trim() : ''))
	        .filter((item) => item.length > 0);
	return cleaned.length > 0 ? cleaned : undefined;
}

function stripFrontMatter(text: string): string {
	if (text.startsWith('\uFEFF')) {
	        text = text.slice(1);
	}
	return text.replace(FRONT_MATTER_REGEX, '');
}

export function isPathWithinFolder(path: string, folder: string | undefined): boolean {
	if (!folder) {
	        return false;
	}
	const normalizedFolder = normalizePath(folder);
	const normalizedPath = normalizePath(path);
	if (normalizedFolder === normalizedPath) {
	        return true;
	}
	return normalizedPath.startsWith(`${normalizedFolder}/`);
}
