/** Version-tolerant navigation into durable AgentTeams member transcripts. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'

/**
 * The Session the main panel currently shows, across Harness generations.
 *
 * Harness 0.1.5 exposed the selection as `sessions.list.current`. The
 * Session-Controller refactor in 0.1.6 removed that field: navigation now
 * belongs to the view owner, and the list reports which consumer retains each
 * row (`byId[*].retainedBy.mainView`) — the same rule ui-workspace itself uses
 * to mark the current row. Read the modern field first, then fall back to the
 * legacy one so one bundle serves both hosts.
 *
 * @param list - the `ctx.sessions.list` snapshot.
 * @returns the current Session id, or undefined when nothing is selected.
 */
export function currentSessionId(list: AgentTeamsSessionList): SessionId | undefined {
  if (list.current !== undefined) return list.current
  for (const row of Object.values(list.byId ?? {})) {
    const summary = row as { readonly id?: SessionId; readonly retainedBy?: Readonly<Record<string, number>> } | undefined
    if ((summary?.retainedBy?.mainView ?? 0) > 0) return summary?.id
  }
  return undefined
}

/** Structural slice of `ctx.sessions.list`'s snapshot the resolver reads. */
export interface AgentTeamsSessionList {
  /** Harness 0.1.5 selection field; absent from 0.1.6 onward. */
  readonly current?: SessionId | undefined
  /** Rows keyed by Session id; 0.1.6+ marks the shown row through retainedBy. */
  readonly byId?: Readonly<Record<string, unknown>> | undefined
}

/** Narrow sessions-service face used by the activity panel and team card. */
export interface AgentTeamsSessionNavigator {
  /**
   * Ordinary session navigation. Present through Harness 0.1.5; the
   * Session-Controller refactor in 0.1.6 moved navigation to the view owner
   * (`uiWorkspace.openSession`) and removed this method.
   */
  open?(id: SessionId): void
  /** rc.8 addressed subagent navigation; also removed in 0.1.6. */
  openSubagent?(address: SubagentAddress): void
  /** Refresh the exact parent's durable direct-child catalog. */
  refreshSubagents?(parentSessionId: SessionId): Promise<void>
  /** Reuse an address already retained by the client runtime when available. */
  subagentAddress?(id: SessionId): SubagentAddress | undefined
}

/**
 * View-owner navigation introduced by Harness 0.1.6. `openSession` accepts the
 * same SessionTarget vocabulary as the retired `sessions.open/openSubagent`
 * pair, and the workspace service already resolves the subagent address and
 * refreshes the parent catalog internally — so one call replaces the whole
 * 0.1.5 two-step flow.
 */
export interface AgentTeamsWorkspaceNavigator {
  openSession?(target: SessionId | SubagentAddress): void
}

/** Main-panel navigation added in Harness 0.1.5; older layouts omit these actions. */
export interface AgentTeamsLayoutNavigator {
  selectPanel?(panelId: null): void
  beginNavigation?(): AbortSignal
}

/**
 * Open one member's persisted transcript.
 *
 * Harness rc.8 intentionally removed cold subagents from the ordinary session
 * list, so a member transcript must be opened through its exact
 * parent/child/mode address. Two host generations own that navigation:
 *
 * - 0.1.6+ moved navigation to the view owner. `uiWorkspace.openSession`
 *   accepts the address directly, resolves it, and refreshes the parent
 *   catalog itself, so one call is the whole flow.
 * - 0.1.5 and earlier exposed it on the sessions service: refresh the parent's
 *   catalog, reuse the address the runtime already retained when it matches,
 *   then `openSubagent`. Runtimes without addressed navigation have only
 *   `open()`, which the last branch preserves.
 *
 * @returns which route was taken, for the caller's diagnostics.
 */
export async function openAgentTeamMember(
  sessions: AgentTeamsSessionNavigator,
  parentSessionId: SessionId,
  childSessionId: SessionId,
  layout?: AgentTeamsLayoutNavigator,
  workspace?: AgentTeamsWorkspaceNavigator,
): Promise<'subagent' | 'session' | 'cancelled'> {
  const navigation = layout?.beginNavigation?.()
  // 0.1.6+: the view owner owns navigation and resolves the address itself.
  if (workspace?.openSession !== undefined) {
    workspace.openSession({ parentSessionId, childSessionId, mode: 'continuable' })
    return 'subagent'
  }
  if (sessions.openSubagent === undefined || sessions.refreshSubagents === undefined) {
    sessions.open?.(childSessionId)
    layout?.selectPanel?.(null)
    return 'session'
  }

  await sessions.refreshSubagents(parentSessionId)
  if (navigation?.aborted) return 'cancelled'
  const retained = sessions.subagentAddress?.(childSessionId)
  sessions.openSubagent(retained?.parentSessionId === parentSessionId
    ? retained
    : { parentSessionId, childSessionId, mode: 'continuable' })
  layout?.selectPanel?.(null)
  return 'subagent'
}
