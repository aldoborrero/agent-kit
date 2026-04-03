declare module "node:module" {
	export function createRequire(url: string): {
		resolve(id: string): string;
	};
}

declare module "node:path" {
	export function dirname(path: string): string;
	export function join(...parts: string[]): string;
}
