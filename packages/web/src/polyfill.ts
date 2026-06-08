// The parser uses gray-matter for frontmatter splitting, which reaches
// for Node's global Buffer. Browsers don't have it. Inject the userland
// `buffer` shim before any module that parses content evaluates — hence
// this is the first import in main.tsx.
import { Buffer } from "buffer";

const g = globalThis as unknown as { Buffer?: unknown };
if (!g.Buffer) g.Buffer = Buffer;
