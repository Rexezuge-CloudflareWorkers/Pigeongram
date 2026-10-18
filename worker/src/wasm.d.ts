/**
 * Wrangler compiles `*.wasm` imports into `WebAssembly.Module` instances (its
 * default `CompiledWasm` module rule). TypeScript needs to be told the shape.
 */
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
