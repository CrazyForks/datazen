/**
 * Invoke helpers for the real-time MONITOR feature.
 */
import { redisCommandInvoke } from "./redisInvoke";

export interface MonitorEvent {
  timestamp: number;
  db: number;
  clientAddr: string;
  clientName: string;
  command: string;
  args: string[];
}

export async function invokeMonitorStart(
  dbSessionId: string,
  bufferSize?: number
): Promise<string> {
  const result = await redisCommandInvoke("monitor_start", {
    dbSessionId,
    bufferSize: bufferSize ?? 1000,
  });
  return result.monitorId;
}

export async function invokeMonitorStop(
  dbSessionId: string,
  monitorId: string
): Promise<void> {
  await redisCommandInvoke("monitor_stop", { dbSessionId, monitorId });
}

export async function invokeMonitorGetBuffer(
  dbSessionId: string,
  monitorId: string
): Promise<MonitorEvent[]> {
  const result = await redisCommandInvoke("monitor_get_buffer", {
    dbSessionId,
    monitorId,
  });
  return result.events ?? [];
}
