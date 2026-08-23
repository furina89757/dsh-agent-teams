/**
 * Better-sidebar bridge for the AgentTeams status side card.
 *
 * Pure decision rules (tab id, badge state, auto-open guard) plus one
 * DOM-free wiring entry (`startSidebarMonitor`) that keeps the current
 * session's team poll alive and opens the side card when a team first
 * appears — mirroring the legacy floater's auto-expand semantics. The
 * better-sidebar client registration itself lives in index.tsx; this module
 * stays free of react, cordis, and window so the offline verification can
 * import it under Node.
 * @module dsh-agent-teams/client/sidebar-monitor
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ActivitySnapshots, ActivityMonitorTarget, ActivityTeam } from './activity-monitor.ts'

/** The better-sidebar tab id of the AgentTeams status side card. */
export const AGENT_TEAMS_TAB_ID = 'agent-teams:activity'

/** Stable lock-free team key owned by one session. */
function teamAttentionKey(sessionId: string, teamId: string): string {
  return sessionId + ':' + teamId
}

/** The attention keys of the live teams owned by one session. */
export function selectAttentionKeys(
  sessionId: string,
  teams: readonly ActivityTeam[],
): ReadonlySet<string> {
  return new Set(
    teams.filter((team) => team.captainSessionId === sessionId)
      .map((team) => teamAttentionKey(sessionId, team.teamId)),
  )
}

/** One auto-open decision: the newly-seen team key to surface (or null). */
export interface SidebarAutoOpenDecision {
  /** The first newly-seen team key, or null when nothing new appeared. */
  readonly open: string | null
  /** The next known-key set the caller must remember. */
  readonly known: ReadonlySet<string>
}

/**
 * Decide whether the status side card should be opened.
 *
 * Mirrors the floater's auto-expand rule: a team first seen for the session
 * opens the card once; a session with no live teams re-arms the guard, so a
 * later team burst can surface the card again after the user dismissed it.
 */
export function decideSidebarAutoOpen(
  knownKeys: ReadonlySet<string>,
  sessionId: string,
  teams: readonly ActivityTeam[],
): SidebarAutoOpenDecision {
  const keys = selectAttentionKeys(sessionId, teams)
  if (keys.size === 0) return { open: null, known: new Set() }
  let open: string | null = null
  const known = new Set(knownKeys)
  for (const key of keys) {
    if (known.has(key)) continue
    known.add(key)
    if (open === null) open = key
  }
  return { open, known }
}

/** The tab-badge state of one session: live team count + busy flag. */
export interface SessionTeamBadgeState {
  readonly count: number
  readonly busy: boolean
}

/** Live teams and busy members of ONE session (the tab badge source). */
export function sessionTeamBadgeState(
  teams: readonly ActivityTeam[],
  sessionId: string,
): SessionTeamBadgeState {
  const owned = teams.filter((team) => team.captainSessionId === sessionId)
  return {
    count: owned.length,
    busy: owned.some((team) => team.members.some((member) => member.activity === 'working')),
  }
}

/** The session/feed seams the side-card monitor needs (injected at call time). */
export interface SidebarMonitorServices {
  readonly subscribeSnapshots: (listener: () => void) => () => void
  readonly getSnapshots: () => ActivitySnapshots
  readonly subscribeTargets: (listener: () => void) => () => void
  readonly getTargets: () => readonly ActivityMonitorTarget[]
  readonly subscribeSessions: (listener: () => void) => () => void
  readonly getCurrentSession: () => SessionId | undefined
  /** Start one current-session polling loop (single-flight). */
  readonly startPolling: (targets: readonly ActivityMonitorTarget[], discoverySessionId?: string) => { stop(): void }
  /** Open (or focus) the AgentTeams status side card. */
  readonly openTab: () => void
}

/**
 * Keep the current session's team snapshots fresh and auto-open the side
 * card on first-team appearance. Mirrors the legacy floater's polling
 * ownership: one loop per current session restarting when the session or its
 * monitor targets change; returns the disposer.
 */
export function startSidebarMonitor(services: SidebarMonitorServices): () => void {
  let controller: { stop(): void } | null = null
  let currentSession: string | undefined = services.getCurrentSession()
  let knownKeys = new Set<string>()
  let restartKey = ''
  const restart = (): void => {
    const sessionId = services.getCurrentSession()
    const targets = sessionId === undefined || sessionId === ''
      ? []
      : services.getTargets().filter((target) => target.sessionId === sessionId)
    const key = (sessionId ?? '') + '|' + targets.map((target) => target.key).join(',')
    if (key === restartKey) return
    restartKey = key
    if (sessionId !== currentSession) {
      currentSession = sessionId
      knownKeys = new Set()
    }
    controller?.stop()
    controller = null
    if (sessionId === undefined || sessionId === '') return
    controller = services.startPolling(targets, sessionId)
  }
  const onSnapshots = (): void => {
    const sessionId = services.getCurrentSession()
    if (sessionId === undefined || sessionId === '') return
    const decision = decideSidebarAutoOpen(knownKeys, sessionId, services.getSnapshots().teams)
    knownKeys = new Set(decision.known)
    if (decision.open !== null) services.openTab()
  }
  const offSnapshots = services.subscribeSnapshots(onSnapshots)
  const offTargets = services.subscribeTargets(restart)
  const offSessions = services.subscribeSessions(restart)
  restart()
  return () => {
    offSnapshots()
    offTargets()
    offSessions()
    controller?.stop()
    controller = null
  }
}
