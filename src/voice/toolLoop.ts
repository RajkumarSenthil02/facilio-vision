/**
 * Client-side agent tool loop.
 * Lifted from "/Users/rajkumars/Documents/Fun projects/asset-lens/src/ar/voiceAgent.ts"
 * and kept protocol-identical — only the tool set and the id-validation are new.
 *
 * The protocol, exactly:
 *  - the agent replies EITHER a tool call `{"tool":"…","args":{…}}` (optionally
 *    fenced) OR a sentence for the user. parseTool() returning null IS the
 *    "final answer" signal — there is no separate done marker;
 *  - tools run in the CLIENT, against the provider seam. The agent has no
 *    server-side tools and no org credentials of its own;
 *  - tool failures come back as `Error: …` STRINGS inside the transcript rather
 *    than exceptions, so the model reads what went wrong and self-corrects on
 *    the next hop (an unknown status is answered with the valid list);
 *  - a CONTEXT: line carries siteId / assetInView / workOrderInView so the user
 *    can say "this one"; ids in args win, context is the fallback;
 *  - MAX_HOPS caps the loop — still calling tools after that is a stuck model,
 *    answered with a plain apology rather than another round trip.
 *
 * Fabrication guard (new here, same spirit as agents.ts): create_work_order is
 * refused if it names an assetId the app never showed it. Models invent ids;
 * writes must not carry an invented one.
 */
import type { VoiceDeps } from './deps';

export const MAX_HOPS = 3;

export interface VoiceCtx {
  siteId?: number;
  assetInView?: number;
  workOrderInView?: number;
}

export interface ToolLogEntry {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

export interface ToolLoopResult {
  answer: string;
  tools: ToolLogEntry[];
}

interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

/** Strict: fenced-or-plain `{...}` with a string `.tool`. Anything else → null. */
export function parseTool(reply: string): ToolCall | null {
  let text = reply.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(text) as { tool?: unknown; args?: unknown };
    if (typeof parsed.tool !== 'string') return null;
    const args =
      parsed.args && typeof parsed.args === 'object'
        ? (parsed.args as Record<string, unknown>)
        : {};
    return { tool: parsed.tool, args };
  } catch {
    return null;
  }
}

/** Models emit ids as both numbers and numeric strings. */
export function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function contextLine(ctx: VoiceCtx): string {
  return (
    `CONTEXT: siteId=${ctx.siteId ?? 'unknown'}` +
    (ctx.assetInView ? ` assetInView=${ctx.assetInView}` : '') +
    (ctx.workOrderInView ? ` workOrderInView=#${ctx.workOrderInView}` : '')
  );
}

async function runTool(
  call: ToolCall,
  ctx: VoiceCtx,
  deps: VoiceDeps,
  /** Asset ids this loop has actually surfaced — the write whitelist. */
  seenAssetIds: Set<number>,
): Promise<string> {
  try {
    switch (call.tool) {
      case 'find_asset': {
        const name = String(call.args.name ?? '').trim();
        if (!name) return 'Error: find_asset needs a name.';
        const rows = (await deps.searchAssets({ text: name })).slice(0, 3);
        rows.forEach((a) => seenAssetIds.add(a.id));
        if (rows.length === 0) return `No assets match "${name}".`;
        return rows
          .map((a) => `id=${a.id} "${a.name}"${a.spaceName ? ` in ${a.spaceName}` : ''}`)
          .join('\n');
      }

      case 'list_work_orders': {
        const assetId = num(call.args.assetId) ?? ctx.assetInView;
        if (!assetId) return 'Error: no asset in view — call find_asset first.';
        const rows = (await deps.listWorkOrdersForAssets([assetId])).slice(0, 6);
        if (rows.length === 0) return `No work orders on asset ${assetId}.`;
        return rows.map((w) => `#${w.id} "${w.subject}" · ${w.status ?? '—'}`).join('\n');
      }

      case 'find_work_order': {
        const text = String(call.args.text ?? '').trim().toLowerCase();
        const rows = await deps.listOpenWorkOrders();
        const hits = (text
          ? rows.filter(
              (w) =>
                w.subject.toLowerCase().includes(text) ||
                (w.resourceName ?? '').toLowerCase().includes(text),
            )
          : rows
        ).slice(0, 6);
        if (hits.length === 0) return 'No open work orders match that.';
        // Ids surfaced here become navigable — same whitelist the create guard uses.
        for (const w of hits) if (w.resourceId) seenAssetIds.add(w.resourceId);
        return hits
          .map(
            (w) =>
              `#${w.id} "${w.subject}" · asset ${w.resourceId ?? '—'} ${w.resourceName ?? ''}`.trim(),
          )
          .join('\n');
      }

      case 'navigate_to': {
        const asked = num(call.args.assetId);
        if (asked === undefined) return 'Error: navigate_to needs an assetId.';
        if (asked !== ctx.assetInView && !seenAssetIds.has(asked)) {
          return `Error: asset ${asked} was never shown to you — call find_asset or find_work_order first and use an id from its result.`;
        }
        const route = await deps.routeToAsset(asked);
        if (!route) {
          return `Asset ${asked} is not pinned in any survey, so there is no route to it yet.`;
        }
        if (route.steps.length === 0) {
          return `${route.destination} is the destination, but no mapped path leads there yet — connect it in the Wayfinder graph.`;
        }
        return `Route to ${route.destination}: ${route.steps.join(' then ')}`;
      }

      case 'create_work_order': {
        const subject = String(call.args.subject ?? '').trim();
        if (!subject) return 'Error: create_work_order needs a subject.';
        const asked = num(call.args.assetId);
        if (asked !== undefined && asked !== ctx.assetInView && !seenAssetIds.has(asked)) {
          return `Error: asset ${asked} was never shown to you — call find_asset and use an id from its result, or omit assetId to use the asset in view.`;
        }
        const resourceId = asked ?? ctx.assetInView;
        const id = await deps.createWorkOrder({
          subject,
          description: call.args.description ? String(call.args.description) : undefined,
          resourceId,
          siteId: ctx.siteId,
        });
        return `Created work order #${id}.`;
      }

      case 'complete_task':
      case 'reopen_task': {
        const workOrderId = num(call.args.workOrderId) ?? ctx.workOrderInView;
        if (!workOrderId) return 'Error: no work order in view.';
        const tasks = await deps.listWorkOrderTasks(workOrderId);
        const taskId = num(call.args.taskId);
        const hit =
          tasks.find((t) => t.id === taskId) ?? (tasks.length === 1 ? tasks[0] : undefined);
        if (!hit) {
          return `Error: no task ${call.args.taskId ?? ''} on #${workOrderId}. Tasks: ${
            tasks.map((t) => `${t.id} "${t.subject}"`).join('; ') || 'none'
          }`;
        }
        const closed = call.tool === 'complete_task';
        await deps.setTaskStatus(workOrderId, hit.id, closed);
        return `Task "${hit.subject}" ${closed ? 'completed' : 'reopened'}.`;
      }

      case 'change_status': {
        const workOrderId = num(call.args.workOrderId) ?? ctx.workOrderInView;
        if (!workOrderId) return 'Error: no work order in view.';
        const wanted = String(call.args.status ?? '').trim().toLowerCase();
        const statuses = await deps.getStatuses();
        const hit = statuses.find(
          (s) => s.value.toLowerCase() === wanted || s.label.toLowerCase() === wanted,
        );
        if (!hit) {
          return `Error: unknown status "${call.args.status ?? ''}". Available: ${statuses
            .map((s) => s.label)
            .join(', ')}`;
        }
        await deps.changeStatus(workOrderId, hit.value);
        return `#${workOrderId} is now ${hit.label}.`;
      }

      default:
        return `Error: unknown tool ${call.tool}. Available: find_asset, find_work_order, navigate_to, list_work_orders, create_work_order, complete_task, reopen_task, change_status.`;
    }
  } catch (err) {
    // Failures re-enter the transcript as text; the model gets to try again.
    return `Error: ${err instanceof Error ? err.message : 'tool failed'}`;
  }
}

export async function runToolLoop(
  text: string,
  ctx: VoiceCtx,
  deps: VoiceDeps,
  onTool?: (entry: ToolLogEntry) => void,
): Promise<ToolLoopResult> {
  const line = contextLine(ctx);
  const tools: ToolLogEntry[] = [];
  const seenAssetIds = new Set<number>();
  if (ctx.assetInView) seenAssetIds.add(ctx.assetInView);

  try {
    let reply = await deps.voiceTurn(`${line}\nCOMMAND: ${text}`);
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const call = parseTool(reply);
      if (!call) break;
      const result = await runTool(call, ctx, deps, seenAssetIds);
      const entry: ToolLogEntry = { tool: call.tool, args: call.args, result };
      tools.push(entry);
      onTool?.(entry);
      reply = await deps.voiceTurn(
        `${line}\nCOMMAND: ${text}\nTOOL RESULT (${call.tool}):\n${result}\nAnswer or call another tool.`,
      );
    }
    const answer = parseTool(reply) ? 'I could not finish that — try rephrasing.' : reply.trim();
    deps.speak(answer);
    return { answer, tools };
  } catch (err) {
    // The agent seam itself failed (no content, network, bad JSON upstream).
    // Voice must never throw into the UI — it answers, badly, and moves on.
    const answer = `Sorry — the assistant is unavailable (${
      err instanceof Error ? err.message : 'unknown error'
    }).`;
    return { answer, tools };
  }
}
