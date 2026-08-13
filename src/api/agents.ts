/**
 * Studio-agent seam. ALL model intelligence goes through the four app agents
 * (created via `facilio vibe agent`, definitions in /agents):
 *
 *   fv-identify   — vision confirm: snap + candidate refs → {assetId|none, confidence, reason}
 *   fv-wo-draft   — photo + context → {subject, description, priority}
 *   fv-nameplate  — photo → {manufacturer, model, serial — 'none' where unreadable}
 *   fv-voice      — free-form utterance → final answer or {tool, args} (client-side loop)
 *
 * Contract helpers encode four platform surprises (learned in asset-lens):
 *  - the reply is at res.response.content and it is a STRING;
 *  - models fence JSON in ``` blocks — strip before parsing;
 *  - schemas can't union-type, so agents return the string "none", never null;
 *  - agents fabricate ids — a verdict must name a SUPPLIED candidate or it is
 *    forced to no-match, and they never get server-side tools.
 */
import { vibe } from './vibe';
import { isMockMode } from './provider';

export const IDENTIFY_AGENT = 'fv-identify';
export const WO_DRAFT_AGENT = 'fv-wo-draft';
export const NAMEPLATE_AGENT = 'fv-nameplate';
export const VOICE_AGENT = 'fv-voice';

export function contentOf(res: unknown): string {
  const content = (res as { response?: { content?: unknown } })?.response?.content;
  if (typeof content !== 'string') throw new Error('agent reply had no text content');
  return content;
}

export function stripFences(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text.trim();
}

/** Agents are told to return the string 'none' rather than null. */
export function orNone(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return !text || text.toLowerCase() === 'none' || text.toLowerCase() === 'null'
    ? undefined
    : text;
}

export interface IdentifyVerdict {
  assetId: number | null;
  confidence: number;
  reason: string;
}

export interface WoDraft {
  subject: string;
  description: string;
  priority: 'High' | 'Medium' | 'Low';
}

export interface Nameplate {
  manufacturer?: string;
  model?: string;
  serial?: string;
}

// Mock replies keep every agent path developable offline (?mock=1).
const mock = {
  identify(candidateIds: number[]): IdentifyVerdict {
    return { assetId: candidateIds[0] ?? null, confidence: 0.82, reason: 'mock verdict' };
  },
  woDraft(): WoDraft {
    return {
      subject: 'Inspect equipment anomaly',
      description: 'Mock draft: visible wear on the housing; verify and schedule follow-up.',
      priority: 'Medium',
    };
  },
  nameplate(): Nameplate {
    return { manufacturer: 'Acme', model: 'AX-100', serial: 'SN-0042' };
  },
  voice(input: string): string {
    return `Mock reply to: ${input}`;
  },
};

/**
 * Vision confirm. fileIds[0] MUST be the live snap; the rest are candidate
 * reference photos in candidate order. Max 10 files per run (platform cap).
 */
export async function identifyAsset(
  fileIds: number[],
  candidates: Array<{ id: number; name: string }>,
): Promise<IdentifyVerdict> {
  if (isMockMode()) return mock.identify(candidates.map((c) => c.id));
  const prompt =
    `The first image is the live camera snap. The remaining images are reference photos of the candidates, in this order:\n` +
    candidates.map((c, i) => `${i + 1}. id=${c.id} name=${c.name}`).join('\n');
  const res = await vibe.executeAgent(IDENTIFY_AGENT, prompt, { fileIds: fileIds.slice(0, 10) });
  const parsed = JSON.parse(stripFences(contentOf(res))) as {
    assetId?: unknown;
    confidence?: unknown;
    reason?: unknown;
  };
  const idText = orNone(String(parsed.assetId ?? ''));
  let assetId = idText ? Number(idText) : null;
  // Fabrication guard: the verdict must name a supplied candidate.
  if (assetId !== null && !candidates.some((c) => c.id === assetId)) assetId = null;
  return {
    assetId,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
  };
}

export async function draftWorkOrder(fileId: number, context: string): Promise<WoDraft> {
  if (isMockMode()) return mock.woDraft();
  const res = await vibe.executeAgent(WO_DRAFT_AGENT, `CONTEXT: ${context}`, {
    fileIds: [fileId],
  });
  const parsed = JSON.parse(stripFences(contentOf(res))) as Partial<WoDraft>;
  if (!parsed.subject) throw new Error('draft agent returned no subject');
  return {
    subject: parsed.subject,
    description: parsed.description ?? '',
    priority: parsed.priority === 'High' || parsed.priority === 'Low' ? parsed.priority : 'Medium',
  };
}

export async function readNameplate(fileId: number): Promise<Nameplate> {
  if (isMockMode()) return mock.nameplate();
  const res = await vibe.executeAgent(NAMEPLATE_AGENT, 'Read the nameplate.', {
    fileIds: [fileId],
  });
  const parsed = JSON.parse(stripFences(contentOf(res))) as Record<string, unknown>;
  return {
    manufacturer: orNone(parsed.manufacturer),
    model: orNone(parsed.model),
    serial: orNone(parsed.serial),
  };
}

/** Raw voice turn — the client-side tool loop in src/voice interprets the reply. */
export async function voiceTurn(input: string): Promise<string> {
  if (isMockMode()) return mock.voice(input);
  const res = await vibe.executeAgent(VOICE_AGENT, input);
  return contentOf(res);
}
