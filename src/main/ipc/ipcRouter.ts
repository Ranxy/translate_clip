import { ipcMain, type IpcMainInvokeEvent } from 'electron'

import type { Logger } from '../services/logStore'

export type IpcHandler = (...args: never[]) => unknown

export interface IpcRouterOptions {
  /**
   * Every call is checked against the set of windows we actually created. A
   * renderer that is not one of ours (or a frame we did not expect) is rejected
   * before the handler runs — defence in depth on top of contextIsolation.
   */
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
  log: Logger
}

export function registerIpcRouter(handlers: Record<string, IpcHandler>, options: IpcRouterOptions): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!options.isTrustedSender(event)) {
        options.log.warn(`rejected IPC call on "${channel}" from an untrusted sender`)
        throw new Error(`Rejected IPC call on "${channel}"`)
      }

      try {
        return await (handler as (...innerArgs: unknown[]) => unknown)(...args)
      } catch (error) {
        // Surfacing a clean message keeps the renderer's error handling simple
        // while the full stack still lands in the log file.
        options.log.error(`IPC handler "${channel}" failed`, error)
        throw new Error(error instanceof Error ? error.message : String(error))
      }
    })
  }
}

export function unregisterIpcRouter(channels: string[]): void {
  for (const channel of channels) {
    ipcMain.removeHandler(channel)
  }
}
