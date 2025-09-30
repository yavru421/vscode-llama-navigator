// Ambient declaration for the external llama-api-typescript submodule
// This keeps the extension code simple without pulling types into this repo.
// Declare the public package name used by the upstream library.
// Consumers in this repo import the submodule using a relative path at runtime,
// but TypeScript module resolution for ambient declarations requires a non-relative name.
declare module 'llama-api-typescript' {
  export const LlamaAPIClient: any;
  export default LlamaAPIClient;
}

// Also allow common package name variants
declare module 'llama-api-client' {
  const anyExport: any;
  export = anyExport;
}

// Match relative dynamic imports like './llama-api-typescript/src/index.js'
declare module '*llama-api-typescript/src/index.js' {
  export const LlamaAPIClient: any;
  export default LlamaAPIClient;
}

// Global convenience types used in this extension
type Message = any;
declare const LlamaAPIClient: any;

// Fallback for any submodule import paths under the vendor folder
// (removed overly-broad wildcard module declaration)
