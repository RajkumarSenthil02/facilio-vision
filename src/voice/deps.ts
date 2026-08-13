/**
 * Voice dependency bundle (roadmap 8). Everything in src/voice takes a
 * VoiceDeps rather than importing the provider Proxy directly, so tests inject
 * fakes instead of monkey-patching a live seam.
 *
 * `defaultDeps` binds the real seam lazily — each call goes through the
 * provider/appStore Proxies, which resolve mock-vs-real per property access
 * (?mock=1). Capturing the methods at module load would pin the wrong one.
 */
import { provider } from '../api/provider';
import { appStore } from '../api/appStore';
import {
  draftWorkOrder,
  identifyAsset,
  voiceTurn,
  type IdentifyVerdict,
  type WoDraft,
} from '../api/agents';
import type {
  Asset,
  AssetSearch,
  WorkOrder,
  WorkOrderDraft,
  WorkOrderStatus,
  WorkOrderTask,
} from '../api/types';

export interface VoiceDeps {
  searchAssets(search?: AssetSearch): Promise<Asset[]>;
  listWorkOrdersForAssets(assetIds: number[]): Promise<WorkOrder[]>;
  listWorkOrderTasks(workOrderId: number): Promise<WorkOrderTask[]>;
  setTaskStatus(workOrderId: number, taskId: number, closed: boolean): Promise<void>;
  getStatuses(): Promise<WorkOrderStatus[]>;
  changeStatus(workOrderId: number, status: string): Promise<void>;
  createWorkOrder(draft: WorkOrderDraft): Promise<number>;
  uploadPhoto(blob: Blob, name: string): Promise<number>;
  draftWorkOrder(fileId: number, context: string): Promise<WoDraft>;
  identifyAsset(
    fileIds: number[],
    candidates: Array<{ id: number; name: string }>,
  ): Promise<IdentifyVerdict>;
  voiceTurn(input: string): Promise<string>;
  speak(text: string): void;
}

/**
 * Lifted from "/Users/rajkumars/Documents/Fun projects/asset-lens/src/ar/voiceAgent.ts"
 * — cancel() before speak() so a second command interrupts the first instead of
 * queueing behind it; rate 1.05 reads as brisk without sounding clipped.
 */
export function speak(text: string): void {
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch {
    // no speech synthesis (or jsdom) — the transcript still shows the answer
  }
}

export const defaultDeps: VoiceDeps = {
  searchAssets: (search) => provider.searchAssets(search),
  listWorkOrdersForAssets: (assetIds) => provider.listWorkOrdersForAssets(assetIds),
  listWorkOrderTasks: (workOrderId) => provider.listWorkOrderTasks(workOrderId),
  setTaskStatus: (workOrderId, taskId, closed) =>
    provider.setWorkOrderTaskStatus(workOrderId, taskId, closed),
  getStatuses: () => provider.getWorkOrderStatuses(),
  changeStatus: (workOrderId, status) => provider.changeWorkOrderStatus(workOrderId, status),
  createWorkOrder: (draft) => provider.createWorkOrder(draft),
  uploadPhoto: (blob, name) => appStore.uploadPhoto(blob, name),
  draftWorkOrder,
  identifyAsset,
  voiceTurn,
  speak,
};
