import type { WebCitation } from '../llm/interfaces';
import type { ResearchResult, ResearchSource } from './agent-runner.interface';
import { normaliseSnippetUrl } from './research-snippets';

/**
 * Native research (`RESEARCH_MODE=native`): one research-model call that
 * searches the web itself, server-side. `findings` is the model's own
 * synthesis, as in `agent` mode, and `sources` are the pages it cited,
 * deduped like snippet sources. GENERATE reads it as research findings.
 */
export const buildNativeResearch = (
  text: string,
  citations: readonly WebCitation[],
): ResearchResult => {
  const seen = new Set<string>();
  const sources: ResearchSource[] = [];
  for (const citation of citations) {
    const url = citation.url.trim();
    if (url === '') continue;
    // Compared normalised, kept as returned: normalising can break a link.
    const key = normaliseSnippetUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ title: citation.title?.trim() || url, url });
  }
  return { findings: text.trim(), sources, mode: 'native' };
};
