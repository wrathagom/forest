// web/tests/helpers/contrast.ts
// The implementation moved to src/lib/contrast.ts so runtime code can use it.
// Re-exported here so existing theme tests keep their import path.
export { parseHex, luminance, contrast, mixHex } from "../../src/lib/contrast";
