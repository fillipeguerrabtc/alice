import { readFileSync } from 'node:fs';
import path from 'node:path';

function getChatSourceFiles(): string[] {
  const chatSrcDir = path.join(process.cwd(), 'apps', 'chat-service', 'src');
  return [
    path.join(chatSrcDir, 'index.ts'),
    path.join(chatSrcDir, 'chat-operational-routes.ts'),
    path.join(chatSrcDir, 'chat-agent-websocket.ts'),
    path.join(chatSrcDir, 'chat-websocket-runtime.ts'),
    path.join(chatSrcDir, 'ws-agent-auth-governance.ts'),
  ];
}

export function loadChatSource(): string {
  return getChatSourceFiles()
    .map((filePath) => readFileSync(filePath, 'utf-8'))
    .join('\n');
}
