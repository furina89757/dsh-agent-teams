/**
 * AgentTeams status side card: the DSH-better-sidebar extension tab
 * (`agent-teams:activity`).
 *
 * Hosts the shared team-status face (TeamStatusView) inside better-sidebar's
 * tab shell — no own panel chrome, geometry, or drag/resize gestures; the
 * sidebar owns the pane, scrolling, persistence, and the settings enable
 * switch. Snapshots come from the shared activity monitor (the
 * better-sidebar branch's session monitor keeps them fresh; the legacy
 * floater owns that duty only in the fallback mode).
 *
 * Teams follow the tab's session (scope.sessionId): live snapshots and
 * historic card summaries are shown only while the captain session is the
 * one the tab belongs to.
 * @module dsh-agent-teams/client/sidebar-tab
 */

import { useMemo, useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  getActivitySnapshotsSnapshot,
  subscribeActivitySnapshots,
} from './activity-monitor.ts'
import type { AgentTeamsTranslate } from './locales.ts'
import { selectVisibleTeamEntries } from './team-status-select.ts'
import { TeamStatusView, useTeamHistoric } from './team-status-view.tsx'
import css from './TeamStatusTab.module.css'

/** Props the better-sidebar tab component receives (subset of the host tile). */
export interface TeamStatusTabProps {
  /** The session this tab belongs to (better-sidebar scope). */
  readonly sessionId: SessionId
  /** Open one member transcript from its captain/member session pair. */
  readonly openMember: (parentId: SessionId, childId: SessionId) => void
  readonly t: AgentTeamsTranslate
}

export function TeamStatusTab({ sessionId, openMember, t }: TeamStatusTabProps) {
  const { teams, archivedTeams } = useSyncExternalStore(
    subscribeActivitySnapshots,
    getActivitySnapshotsSnapshot,
  )
  const historic = useTeamHistoric()
  const summary = useMemo(
    () => selectVisibleTeamEntries(sessionId, teams, archivedTeams, historic),
    [sessionId, teams, archivedTeams, historic],
  )
  return (
    <div className={css.root} data-agent-teams-status-card data-team-count={summary.visibleCount} data-busy={summary.busy || undefined}>
      <header className={css.head}>
        <span className={css.title}>{t('activity.title')}</span>
        <span className={css.count}>{summary.visibleCount}</span>
      </header>
      <TeamStatusView
        current={sessionId}
        teams={teams}
        archivedTeams={archivedTeams}
        historic={historic}
        openMember={openMember}
        t={t}
        containerClass={css.body}
      />
    </div>
  )
}
