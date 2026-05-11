import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createBrowserControl } from '../src/browser_control';
import { buildToolRegistry } from '../src/mcp/tool_registry';

async function main() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-tool-count-"));
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  process.env.BROWSER_CONTROL_HOME = tmpHome;
  
  try {
    const api = createBrowserControl({ dataHome: tmpHome });
    try {
      const tools = buildToolRegistry(api);
      console.log(`Total tools: ${tools.length}`);
    } finally {
      api.close();
    }
  } finally {
    process.env.BROWSER_CONTROL_HOME = previousHome;
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

main().catch(console.error);
