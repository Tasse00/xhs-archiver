import type { ReadStore } from './read-store';
import type { Store } from './store';

export const ANNOTATION_FILE = 'annotation.txt';

function annotationPath(articlePath: string): string {
  return `${articlePath.replace(/\/+$/, '')}/${ANNOTATION_FILE}`;
}

function lf(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function normalizeArticleNote(text: string): string | null {
  const normalized = lf(text);
  if (normalized.trim() === '') return null;
  return `${normalized.replace(/\n+$/, '')}\n`;
}

export async function readArticleNote(store: ReadStore, articlePath: string): Promise<string> {
  const text = await store.readText(annotationPath(articlePath));
  if (text === null) return '';
  const normalized = lf(text);
  return normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
}

export async function writeArticleNote(
  store: Store,
  articlePath: string,
  text: string,
): Promise<void> {
  const normalized = normalizeArticleNote(text);
  const path = annotationPath(articlePath);
  if (normalized === null) {
    await store.removeFile(path);
    return;
  }
  await store.writeFile(path, normalized);
}
