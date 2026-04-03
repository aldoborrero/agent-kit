declare module "node:fs/promises" {
	export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
	export function readFile(path: string, encoding: string): Promise<string>;
	export function rename(oldPath: string, newPath: string): Promise<void>;
	export function writeFile(path: string, data: string, encoding: string | { flag?: string }): Promise<void>;
	export function unlink(path: string): Promise<void>;
}

declare module "node:path" {
	export function basename(path: string): string;
	export function dirname(path: string): string;
	export function join(...parts: string[]): string;
}

declare module "node:fs" {
	export interface FSWatcher {
		close(): void;
	}
	export function watch(
		filename: string,
		listener: (eventType: string, filename: string | null) => void,
	): FSWatcher;
}

declare const process: {
	cwd(): string;
	pid: number;
	kill(pid: number, signal?: number): void;
};
