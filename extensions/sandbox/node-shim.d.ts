declare module "node:child_process" {
	export function spawn(command: string, args?: string[], options?: { stdio?: string[] | string; env?: Record<string, string | undefined>; cwd?: string; detached?: boolean }): {
		pid: number;
		stdout?: { on(event: string, cb: (chunk: Buffer | string) => void): void };
		stderr?: { on(event: string, cb: (chunk: Buffer | string) => void): void };
		on(event: string, cb: (...args: any[]) => void): void;
		kill(signal?: string): void;
	};
}

declare module "node:fs" {
	export function existsSync(path: string): boolean;
	export function readFileSync(path: string, encoding: string): string;
}

declare module "node:path" {
	export function join(...parts: string[]): string;
}

declare namespace NodeJS {
	type Timeout = ReturnType<typeof setTimeout>;
}

declare interface Buffer {
	toString(encoding?: string): string;
}

declare const process: {
	platform: string;
	env: Record<string, string | undefined>;
	cwd(): string;
	kill(pid: number, signal?: string | number): void;
};
