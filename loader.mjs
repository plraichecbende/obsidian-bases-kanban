// ESM loader for handling TypeScript files and module resolution
// The package.json "imports" field handles most module resolution,
// but this loader is still needed for TypeScript file compilation

export async function resolve(specifier, context, nextResolve) {
	// The package.json "imports" field handles resolution of 'obsidian' and 'sortablejs'
	// Just pass through to let Node.js use the imports field
	return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
	// Handle TypeScript files - delegate to tsx or next loader
	// The imports field resolves to .ts files, which need compilation
	return nextLoad(url, context);
}


