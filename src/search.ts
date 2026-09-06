import path from "node:path";
import {
	DEFAULT_MAX_BYTES,
	formatSize,
	truncateHead,
	truncateLine,
	type FindToolDetails,
	type FindToolInput,
	type GrepToolDetails,
	type GrepToolInput,
} from "@earendil-works/pi-coding-agent";

/** Sends one remote-search.py request; rejects transport/remote errors and returns value. */
export type RemoteSearchCall = (request: Record<string, unknown>) => Promise<any>;

type SearchResult<D> = {
	content: { type: "text"; text: string }[];
	details: D | undefined;
};

function result<D>(text: string, details?: D): SearchResult<D> {
	return { content: [{ type: "text", text }], details };
}

function invalidResponse(): never {
	throw new Error("Invalid remote search response");
}

/** The parent resolves paths on the selected machine before calling these adapters. */
function requireAbsolute(searchPath: string): void {
	if (!path.posix.isAbsolute(searchPath) || searchPath.includes("\0")) {
		throw new Error("Remote search requires an absolute POSIX path without NUL bytes");
	}
}

/** Mirrors pi 0.85.1's default fd backend, rather than its custom-glob variant. */
export async function remoteFind(
	input: FindToolInput,
	searchPath: string,
	call: RemoteSearchCall,
): Promise<SearchResult<FindToolDetails>> {
	requireAbsolute(searchPath);
	const effectiveLimit = input.limit ?? 1000;
	const value = await call({
		op: "find", path: searchPath, pattern: input.pattern, limit: String(effectiveLimit),
	});
	if (!value || !Array.isArray(value.paths) || !value.paths.every((p: unknown) => typeof p === "string")) {
		invalidResponse();
	}
	const paths: string[] = value.paths;
	if (paths.length === 0) return result("No files found matching pattern");

	// NUL framing preserves names containing whitespace/newlines, unlike native fd's
	// line splitting and trim(). Ordinary paths and directory suffixes are identical.
	const relative = paths.map((p) => {
		const relativePath = path.posix.isAbsolute(p) ? path.posix.relative(searchPath, p) : p;
		return p.endsWith("/") && !relativePath.endsWith("/") ? `${relativePath}/` : relativePath;
	});
	const truncation = truncateHead(relative.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
	let output = truncation.content;
	const details: FindToolDetails = {};
	const notices: string[] = [];
	if (relative.length >= effectiveLimit) {
		notices.push(`${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`);
		details.resultLimitReached = effectiveLimit;
	}
	if (truncation.truncated) {
		notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
		details.truncation = truncation;
	}
	if (notices.length) output += `\n\n[${notices.join(". ")}]`;
	return result(output, Object.keys(details).length ? details : undefined);
}

type Match = { filePath: string; lineNumber: number; lineText?: string };
type GrepResponse = {
	isDirectory: boolean;
	matchCount: number;
	matchLimitReached: boolean;
	matches: Match[];
	/** Raw file bytes, read on the remote machine, or null only for an OS read error. */
	files: { filePath: string; content: string | null }[];
};

function grepResponse(value: any): GrepResponse {
	if (!value || typeof value.isDirectory !== "boolean" ||
		typeof value.matchCount !== "number" || !Number.isInteger(value.matchCount) || value.matchCount < 0 ||
		typeof value.matchLimitReached !== "boolean" || !Array.isArray(value.matches) || !Array.isArray(value.files)) {
		invalidResponse();
	}
	for (const match of value.matches) {
		if (!match || typeof match.filePath !== "string" || typeof match.lineNumber !== "number" ||
			!Number.isFinite(match.lineNumber) || (match.lineText !== undefined && typeof match.lineText !== "string")) {
			invalidResponse();
		}
	}
	for (const file of value.files) {
		if (!file || typeof file.filePath !== "string" || (file.content !== null && typeof file.content !== "string")) {
			invalidResponse();
		}
		if (typeof file.content === "string" &&
			Buffer.from(file.content, "base64").toString("base64") !== file.content) invalidResponse();
	}
	if (value.matches.length > value.matchCount) invalidResponse();
	return value;
}

/**
 * Mirrors pi 0.85.1's rg JSON match collection and formatting. Context is deliberately
 * read in the same remote request: a dropped SSH connection must reject the whole
 * operation, not become the native '(unable to read file)' OS-error fallback.
 */
export async function remoteGrep(
	input: GrepToolInput,
	searchPath: string,
	call: RemoteSearchCall,
): Promise<SearchResult<GrepToolDetails>> {
	requireAbsolute(searchPath);
	const contextValue = input.context && input.context > 0 ? input.context : 0;
	const effectiveLimit = Math.max(1, input.limit ?? 100);
	const value = grepResponse(await call({
		op: "grep", path: searchPath, pattern: input.pattern, glob: input.glob,
		ignoreCase: input.ignoreCase, literal: input.literal, context: contextValue, limit: effectiveLimit,
	}));
	if (value.matchCount === 0) return result("No matches found");

	const formatPath = (filePath: string): string => {
		if (value.isDirectory) {
			const relative = path.posix.relative(searchPath, filePath);
			if (relative && !relative.startsWith("..")) return relative.replace(/\\/g, "/");
		}
		return path.posix.basename(filePath);
	};
	const fileCache = new Map(value.files.map(({ filePath, content }) => [filePath,
		content === null ? [] : Buffer.from(content, "base64").toString("utf8")
			.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n"),
	]));
	let linesTruncated = false;
	const compactLine = (text: string): string => {
		const truncated = truncateLine(text);
		if (truncated.wasTruncated) linesTruncated = true;
		return truncated.text;
	};
	const outputLines: string[] = [];
	for (const match of value.matches) {
		const relativePath = formatPath(match.filePath);
		if (contextValue === 0 && match.lineText !== undefined) {
			const sanitized = match.lineText.replace(/\r\n/g, "\n").replace(/\r/g, "").replace(/\n$/, "");
			outputLines.push(`${relativePath}:${match.lineNumber}: ${compactLine(sanitized)}`);
			continue;
		}
		const lines = fileCache.get(match.filePath);
		if (!lines) invalidResponse(); // Missing context is a protocol error, never a file-read error.
		if (!lines.length) {
			outputLines.push(`${relativePath}:${match.lineNumber}: (unable to read file)`);
			continue;
		}
		const start = contextValue > 0 ? Math.max(1, match.lineNumber - contextValue) : match.lineNumber;
		const end = contextValue > 0 ? Math.min(lines.length, match.lineNumber + contextValue) : match.lineNumber;
		// Do not round context: the native schema accepts numbers, including fractions.
		for (let current = start; current <= end; current++) {
			const text = compactLine((lines[current - 1] ?? "").replace(/\r/g, ""));
			outputLines.push(current === match.lineNumber
				? `${relativePath}:${current}: ${text}` : `${relativePath}-${current}- ${text}`);
		}
	}
	// Search tools have a 50 KiB byte limit, not the read tool's 2000-line cap.
	const truncation = truncateHead(outputLines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
	let output = truncation.content;
	const details: GrepToolDetails = {};
	const notices: string[] = [];
	if (value.matchLimitReached) {
		notices.push(`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`);
		details.matchLimitReached = effectiveLimit;
	}
	if (truncation.truncated) {
		notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
		details.truncation = truncation;
	}
	if (linesTruncated) {
		// truncateLine's public default is 500 UTF-16 code units in pi 0.85.1.
		notices.push("Some lines truncated to 500 chars. Use read tool to see full lines");
		details.linesTruncated = true;
	}
	if (notices.length) output += `\n\n[${notices.join(". ")}]`;
	return result(output, Object.keys(details).length ? details : undefined);
}
