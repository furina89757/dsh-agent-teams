/**
 * Pure team-status projections shared by the two status hosts.
 *
 * DOM-free by construction (no react, no CSS, no window) so the offline
 * verification script can import it directly. The presentational layer
 * (team-status-view.tsx) and the better-sidebar side card consume these
 * rules; the legacy floater consumes them too, so one rule set keeps both
 * hosts in sync.
 * @module dsh-agent-teams/client/team-status-select
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ActivityTeam } from './activity-monitor.ts'
import type { AgentTeamsCardData } from './agent-teams-card-definition.ts'

/** One historic conversation-card entry projected as a team row. */
export interface HistoricCardEntry {
  readonly data: AgentTeamsCardData
  readonly owner: string
}

/** Teams visible to one owning session, projected through the shared rules:
 * live snapshots and historic card summaries follow their captain session —
 * they are only shown while that session owns them. */
export interface VisibleTeamEntries {
  readonly visibleTeams: readonly ActivityTeam[]
  readonly visibleArchived: readonly ActivityTeam[]
  readonly visibleHistoric: readonly HistoricCardEntry[]
  readonly visibleCount: number
  /** Whether any visible team has a member working right now. */
  readonly busy: boolean
}

/** The teams visible to one owning session under the shared projection rules. */
export function selectVisibleTeamEntries(
  current: SessionId | undefined,
  teams: readonly ActivityTeam[],
  archivedTeams: readonly ActivityTeam[],
  historic: ReadonlyMap<string, HistoricCardEntry>,
): VisibleTeamEntries {
  if (current === undefined) {
    return { visibleTeams: [], visibleArchived: [], visibleHistoric: [], visibleCount: 0, busy: false }
  }
  const visibleTeams = teams.filter((team) => team.captainSessionId === current)
  const visibleHistoric = [...historic.values()].filter(({ data, owner }) =>
    owner === current && !teams.some((live) =>
      live.captainSessionId === current && live.teamId === data.teamId,
    ) && !archivedTeams.some((archived) =>
      archived.captainSessionId === current && archived.teamId === data.teamId,
    ),
  )
  const visibleArchived = archivedTeams.filter((team) =>
    team.captainSessionId === current && !teams.some((live) =>
      live.captainSessionId === current && live.teamId === team.teamId,
    ),
  )
  return {
    visibleTeams,
    visibleArchived,
    visibleHistoric,
    visibleCount: visibleTeams.length + visibleArchived.length + visibleHistoric.length,
    busy: visibleTeams.some((team) => team.members.some((member) => member.activity === 'working')),
  }
}
