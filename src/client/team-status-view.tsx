/**
 * Shared presentational AgentTeams team status.
 *
 * One team-status face is rendered by two hosts: the legacy shell-overlay
 * floater (ActivityPanel, kept only when DSH-better-sidebar is absent) and
 * the DSH-better-sidebar extension side card (the `agent-teams:activity`
 * tab). Everything between the team header rows and the task DAG is shared
 * here — each host supplies its own chrome (geometry and gestures for the
 * floater, the tab shell for the side card).
 *
 * Historic conversation-card summaries are projected through the same
 * historicCardTeam shape so both hosts render legacy teams identically.
 * @module dsh-agent-teams/client/team-status
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  compactDagLayout,
  COMPACT_DAG_NODE_HEIGHT,
  COMPACT_DAG_NODE_WIDTH,
  dependencyFocusTaskId,
  relatedTaskIds,
  usesParallelTaskGrid,
} from './activity-model.ts'
import type {
  ActivityMember,
  ActivityTask,
  ActivityTeam,
} from './activity-monitor.ts'
import { ACTION_ART, LEAD_ART, memberArtUrl } from './artwork.ts'
import { OPEN_PANEL_EVENT } from './AgentTeamsCard.tsx'
import type { AgentTeamsCardData } from './agent-teams-card-definition.ts'
import type { AgentTeamsLocaleKey, AgentTeamsTranslate } from './locales.ts'
import type { HistoricCardEntry } from './team-status-select.ts'
import { selectVisibleTeamEntries } from './team-status-select.ts'
import css from './ActivityPanel.module.css'

/** Initial-letter fallback for unmatched roles. */
function memberInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

function stableHash(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

const ACCENTS = [
  'var(--dsw-alias-state-business-primary)',
  'var(--dsw-alias-state-success)',
  'var(--dsw-alias-state-danger)',
  'var(--dsw-alias-state-warning)',
  'var(--dsw-alias-label-tertiary)',
] as const

function accentOf(id: string): string {
  return ACCENTS[stableHash(id) % ACCENTS.length] ?? ACCENTS[0]
}

/** Badge text follows the raw task status (finer than the 4 visual states):
 * claimed/pending/failed/cancelled keep their own labels and colors. */
const TASK_STATUS_LABEL: Record<string, AgentTeamsLocaleKey> = {
  pending: 'task.status.pending',
  claimed: 'task.status.claimed',
  in_progress: 'task.status.inProgress',
  completed: 'task.status.completed',
  failed: 'task.status.failed',
  cancelled: 'task.status.cancelled',
}

function taskStatusLabel(status: string, t: AgentTeamsTranslate): string {
  const key = TASK_STATUS_LABEL[status]
  return key === undefined ? status : t(key)
}

function formatTaskIds(ids: readonly string[], t: AgentTeamsTranslate): string {
  return ids.join(t('format.listSeparator'))
}

/** Badge/bar coloring key: visual state, widened for terminal statuses. */
function taskTone(state: ActivityTask['state'], status: string): string {
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return state
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg className={css.chevron} data-open={open} width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M3.5 2l3 3-3 3" />
    </svg>
  )
}

function WorkGlyph({ active }: { readonly active: boolean }) {
  return (
    <svg className={css.workGlyph} data-active={active} width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden>
      {[[0, 0], [4.2, 0], [8.4, 0], [0, 4.2], [4.2, 4.2], [8.4, 4.2]].map(([x, y], index) => (
        <rect key={`${x}:${y}`} x={x} y={y} width="2.6" height="2.6" rx=".6" style={{ animationDelay: `${index * 0.15}s` }} />
      ))}
    </svg>
  )
}

/** Collapsed badge: an always-visible corner pill while any team exists. */
export function CollapsedBadge({ count, busy, onClick, t }: {
  readonly count: number
  readonly busy: boolean
  readonly onClick: () => void
  readonly t: AgentTeamsTranslate
}) {
  return (
    <button type="button" className={css.badge} data-agent-teams-collapsed data-busy={busy} onClick={onClick} aria-label={t('activity.badgeAria', { count })}>
      <span className={css.badgeDot} data-busy={busy} aria-hidden />
      <span className={css.badgeCount}>{count}</span>
    </button>
  )
}

function memberStateLabel(
  member: ActivityMember,
  tasks: readonly ActivityTask[],
  historic: boolean,
  t: AgentTeamsTranslate,
): string {
  const owned = tasks.filter((task) => task.assignee === member.name)
  if (member.activity === 'working') return t('member.state.working')
  if (owned.some((task) => task.status === 'failed')) return t('member.state.failed')
  if (owned.some((task) => task.state === 'blocked')) return t('member.state.waiting')
  if (owned.length > 0 && owned.every((task) => task.status === 'completed')) return t('member.state.delivered')
  if (member.status === 'removed') return t(historic ? 'member.state.left' : 'member.state.removed')
  if (owned.length > 0) return t('member.state.pending')
  return t('member.state.unassigned')
}

function memberStatusText(
  member: ActivityMember,
  tasks: readonly ActivityTask[],
  t: AgentTeamsTranslate,
): string {
  const owned = tasks.filter((task) => task.assignee === member.name)
  const current = owned.find((task) => task.id === member.currentTask)
  const blocked = owned.find((task) => task.state === 'blocked')
  if (member.activity === 'working' && current !== undefined) return t('member.status.executing', { taskId: current.id })
  if (member.activity === 'working') return t('member.status.working')
  if (blocked !== undefined) {
    const dependency = tasks.find((task) => blocked.dependencies.includes(task.id) && task.state !== 'completed')
    if (dependency !== undefined) {
      return t('member.status.waitingOn', {
        taskId: dependency.id,
        assignee: dependency.assignee || t('task.assignee.unclaimed'),
      })
    }
    return t('member.status.waitingPrerequisite')
  }
  if (member.total === 0) return t('member.status.waitingAssignment')
  if (member.done === member.total) return t('member.status.delivered')
  return t(member.activity === 'idle' ? 'member.status.idle' : 'member.status.unknown')
}

function compactTaskLabel(subject: string): string {
  const withoutVerb = subject.replace(/^开发\s*/u, '').replace(/^\d+[-_.、\s]*/u, '')
  const head = withoutVerb.split(/[（(·：:]/u)[0]?.trim() ?? withoutVerb
  return head.length > 18 ? `${head.slice(0, 17)}…` : head
}

function taskSummary(team: ActivityTeam, t: AgentTeamsTranslate): string {
  const completed = team.tasks.filter((task) => task.status === 'completed')
  const running = team.tasks.filter((task) => task.state === 'running')
  const blocked = team.tasks.filter((task) => task.state === 'blocked')
  const ready = team.tasks.filter((task) => task.state === 'open' && task.status !== 'completed')
  if (team.tasks.length === 0) return t('task.summary.waitingBreakdown')
  if (completed.length === team.tasks.length) return t('task.summary.allDelivered', { count: completed.length })
  if (blocked.length > 0 && running.length > 0) {
    return t('task.summary.blockedAndRunning', {
      tasks: formatTaskIds(blocked.slice(0, 3).map((task) => task.id), t),
      more: blocked.length > 3 ? t('task.summary.more', { count: blocked.length - 3 }) : '',
    })
  }
  if (running.length > 0) return t('task.summary.running', { tasks: formatTaskIds(running.map((task) => task.id), t) })
  if (ready.length > 0) return t('task.summary.ready', { tasks: formatTaskIds(ready.map((task) => task.id), t) })
  if (blocked.length > 0) return t('task.summary.blocked', { tasks: formatTaskIds(blocked.map((task) => task.id), t) })
  return t('task.summary.waitingSchedule')
}

function ProgressOverview({ team, t }: { readonly team: ActivityTeam; readonly t: AgentTeamsTranslate }) {
  const running = team.tasks.filter((task) => task.state === 'running').length
  const blocked = team.tasks.filter((task) => task.state === 'blocked').length
  const completed = team.tasks.filter((task) => task.status === 'completed').length
  const summaryTone = blocked > 0 ? 'warning' : completed === team.tasks.length && team.tasks.length > 0 ? 'completed' : 'running'
  return (
    <section className={css.progressOverview} aria-label={t('progress.aria')} data-progress-summary>
      <span className={css.progressTitle}>{t('progress.title')}</span>
      {team.tasks.length > 0 ? (
        <span className={css.progressSegments} aria-hidden>
          {team.tasks.map((task) => <span key={task.id} data-state={taskTone(task.state, task.status)} />)}
        </span>
      ) : <span className={css.progressEmpty} />}
      <span className={css.progressLegend}>
        <span data-state="running">{t('progress.running', { count: running })}</span>
        <span data-state="blocked">{t('progress.blocked', { count: blocked })}</span>
        <span data-state="completed">{t('progress.delivered', { count: completed })}</span>
      </span>
      <span className={css.progressSummary} data-state={summaryTone}>
        <span className={css.progressSummaryDot} />
        <span>{taskSummary(team, t)}</span>
      </span>
    </section>
  )
}

function DependencyMap({ tasks, t }: {
  readonly tasks: readonly ActivityTask[]
  readonly t: AgentTeamsTranslate
}) {
  const [open, setOpen] = useState(true)
  const [hoverTaskId, setHoverTaskId] = useState<string | null>(null)
  const [keyboardTaskId, setKeyboardTaskId] = useState<string | null>(null)
  const [pinnedTaskId, setPinnedTaskId] = useState<string | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusedTaskId = dependencyFocusTaskId(pinnedTaskId, keyboardTaskId, hoverTaskId)
  const layout = useMemo(() => compactDagLayout(tasks), [tasks])
  const parallel = useMemo(() => usesParallelTaskGrid(tasks), [tasks])
  const related = useMemo(
    () => focusedTaskId === null ? null : relatedTaskIds(focusedTaskId, tasks),
    [focusedTaskId, tasks],
  )
  const scheduleHover = (id: string | null): void => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    if (id === null) {
      setHoverTaskId(null)
      return
    }
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null
      setHoverTaskId(id)
    }, 180)
  }
  useEffect(() => () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current)
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPinnedTaskId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [])
  if (tasks.length === 0) return null
  const fallbackTask = tasks.find((task) => task.state === 'blocked')
    ?? tasks.find((task) => task.state === 'running')
    ?? tasks[0]!
  const detailTask = tasks.find((task) => task.id === focusedTaskId) ?? fallbackTask
  const waitingOn = detailTask.dependencies.filter((dependency) => (
    tasks.find((task) => task.id === dependency)?.status !== 'completed'
  ))
  const dependents = tasks.filter((task) => task.dependencies.includes(detailTask.id))
  return (
    <section className={css.dependencySection} aria-label={t('dependency.aria')} data-dependency-map>
      <header className={css.sectionHead}>
        <button type="button" className={css.sectionToggleTitle} onClick={() => { setOpen((current) => !current) }} aria-expanded={open}>
          <Chevron open={open} /><IconBranchOutline16 /> {t(parallel ? 'dependency.parallel' : 'dependency.title')}
        </button>
        <span className={css.sectionHint}>{pinnedTaskId === null
          ? t(parallel ? 'dependency.hint.parallel' : 'dependency.hint.chain')
          : t('dependency.hint.pinned', { taskId: pinnedTaskId })}</span>
      </header>
      {open && (
        <>
          <div className={css.dagViewport}>
            <div
              className={css.dagCanvas}
              data-layout={parallel ? 'parallel' : 'dependency'}
              style={parallel ? undefined : { width: layout.width, height: layout.height }}
            >
              {!parallel && <svg className={css.dagEdges} width={layout.width} height={layout.height} aria-hidden>
                {layout.edges.map((edge) => {
                  const active = related !== null && related.has(edge.from) && related.has(edge.to)
                  return <path key={`${edge.from}:${edge.to}`} d={edge.path} data-active={active} data-dimmed={related !== null && !active} />
                })}
              </svg>}
              {layout.nodes.map(({ task, x, y }) => (
                <button
                  key={task.id}
                  type="button"
                  className={css.dagNode}
                  style={parallel
                    ? { height: COMPACT_DAG_NODE_HEIGHT }
                    : { left: x, top: y, width: COMPACT_DAG_NODE_WIDTH, height: COMPACT_DAG_NODE_HEIGHT }}
                  data-task-id={task.id}
                  data-state={taskTone(task.state, task.status)}
                  data-focused={related?.has(task.id) ?? false}
                  data-dimmed={related !== null && !related.has(task.id)}
                  aria-pressed={pinnedTaskId === task.id}
                  title={`${task.id} · ${task.subject}`}
                  onClick={() => { setPinnedTaskId((current) => current === task.id ? null : task.id) }}
                  onMouseEnter={() => { scheduleHover(task.id) }}
                  onMouseLeave={() => { scheduleHover(null) }}
                  onFocus={() => { setKeyboardTaskId(task.id) }}
                  onBlur={() => { setKeyboardTaskId(null) }}
                >
                  <span className={css.dagNodeHead}><span className={css.dagNodeDot} />{task.id}</span>
                  <span className={css.dagNodeLabel}>{compactTaskLabel(task.subject)}</span>
                  {task.state === 'running' && (
                    <span className={css.dagRunningState} aria-label={t('task.runningAria')}>
                      <WorkGlyph active />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <section className={css.taskDetail} data-task-detail={detailTask.id}>
            <span className={css.taskDetailHead}>
              <span className={css.taskDetailId}>{detailTask.id}</span>
              <span className={css.taskDetailSubject} title={detailTask.subject}>{detailTask.subject.replace(/^开发\s*/u, '')}</span>
              <span className={css.taskDetailBadge} data-state={taskTone(detailTask.state, detailTask.status)}>{taskStatusLabel(detailTask.status, t)}</span>
            </span>
            <span className={css.taskDetailLine}>
              {detailTask.assignee || t('task.assignee.unclaimed')} · {detailTask.status === 'completed'
                ? t('task.detail.completed')
                : detailTask.dependencies.length === 0
                ? t('task.detail.noPrerequisite')
                : waitingOn.length === 0
                  ? t('task.detail.ready')
                  : t('task.detail.waitingOn', { tasks: formatTaskIds(waitingOn, t) })}
            </span>
            <span className={css.taskDetailMeta}>{dependents.length === 0
              ? t('task.detail.noDownstream')
              : t('task.detail.unlocks', { tasks: formatTaskIds(dependents.map((task) => task.id), t) })}</span>
          </section>
        </>
      )}
    </section>
  )
}

function TeamSection({ team, onNavigate, t, historic = false }: {
  readonly team: ActivityTeam
  /** Navigate to a member transcript (floater hides immediately). */
  readonly onNavigate: (parentId: SessionId, childId: SessionId) => void
  readonly t: AgentTeamsTranslate
  readonly historic?: boolean
}) {
  const [membersOpen, setMembersOpen] = useState(true)
  const busyCount = team.members.filter((member) => member.activity === 'working').length
  const assignedCount = team.tasks.filter((task) => task.assignee !== '').length
  const completedCount = team.tasks.filter((task) => task.status === 'completed').length
  const allCompleted = team.tasks.length > 0 && completedCount === team.tasks.length
  return (
    <section className={css.team} data-team-id={team.teamId}>
      <header className={css.teamHead}>
        <span className={css.teamName} title={team.name}>{team.name}</span>
        {historic && <span className={css.historicPill}>{t('team.ended')}</span>}
        <span className={css.teamStats}>
          <span data-stat="members">{t('team.stats.members', { count: team.members.length })}</span>
          <span data-stat="tasks">{t('team.stats.completed', { completed: completedCount, total: team.tasks.length })}</span>
          <span data-stat="messages">{t('team.stats.messages', { count: team.messageCount })}</span>
        </span>
      </header>

      <section className={css.delegationSection} aria-label={t('delegation.aria')} data-delegation-map>
        <div className={css.captainNode}>
          <span className={css.captainAvatar}>
            <img className={css.leadAvatar} src={LEAD_ART} alt="" aria-hidden />
          </span>
          <span className={css.captainInfo}>
            <span className={css.captainLine}>
              <span className={css.captainName}>{t('captain.name')}</span>
              <span className={css.captainRole}>{t('captain.role')}</span>
            </span>
            <span className={css.captainSummary}>{t('captain.summary', {
              tasks: assignedCount,
              members: team.members.length,
            })}</span>
          </span>
          <span className={css.captainState} data-busy={busyCount > 0}>
            <WorkGlyph active={busyCount > 0} />
            {busyCount > 0
              ? t('captain.state.working', { count: busyCount })
              : t(allCompleted ? 'captain.state.collected' : 'captain.state.waiting')}
          </span>
        </div>

        <ProgressOverview team={team} t={t} />

        <button type="button" className={css.membersToggle} onClick={() => { setMembersOpen((current) => !current) }} aria-expanded={membersOpen} data-members-toggle>
          <span><Chevron open={membersOpen} />{t('members.toggle', { count: team.members.length })}</span>
          <span>{t(membersOpen ? 'members.collapse' : 'members.expand')}</span>
        </button>

        {membersOpen && <div className={css.delegationTree}>
          {team.members.length === 0 && <span className={css.emptyHint}>{t('members.empty')}</span>}
          {team.members.map((member) => {
            const owned = team.tasks.filter((task) => task.assignee === member.name)
            return (
              <div key={member.id} className={css.memberBlock} data-activity={member.activity}>
                <span className={css.memberBranch} aria-hidden><span /></span>
                <button
                  type="button"
                  className={css.memberRow}
                  data-activity={member.activity}
                  onClick={() => {
                    if (member.id !== '') {
                      onNavigate(team.captainSessionId as SessionId, member.id as SessionId)
                    }
                  }}
                >
                  <span className={css.memberAvatar} data-unread={member.unread > 0}>
                    {memberArtUrl(member.name, member.role) !== null ? (
                      <img className={css.memberArt} src={memberArtUrl(member.name, member.role) ?? ''} alt="" aria-hidden />
                    ) : (
                      <span className={css.memberInitial} style={{ background: accentOf(member.id) }}>{memberInitial(member.name)}</span>
                    )}
                    <img className={css.stateArt} data-activity={member.activity} src={ACTION_ART[member.activity]} alt="" aria-hidden />
                  </span>
                  <span className={css.memberInfo}>
                    <span className={css.memberLine}>
                      <span className={css.memberName}>{member.name}</span>
                      {member.role !== '' && <span className={css.memberRole}>{member.role}</span>}
                      <span className={css.memberState} data-activity={member.activity}>
                        <WorkGlyph active={member.activity === 'working'} />
                        {memberStateLabel(member, team.tasks, historic, t)}
                      </span>
                    </span>
                    <span className={css.memberStatusLine}>{memberStatusText(member, team.tasks, t)}</span>
                  </span>
                  <span className={css.memberCount}>{member.done}/{member.total}</span>
                </button>
                <div className={css.assignmentLine}>
                  <span className={css.assignmentLabel}>{t('assignment.label')}</span>
                  <span className={css.assignmentTasks}>
                    {owned.length === 0
                      ? <span className={css.taskEmpty}>{t('assignment.empty')}</span>
                      : owned.map((task) => (
                        <span key={task.id} className={css.assignmentChip} data-state={taskTone(task.state, task.status)} title={task.subject}>
                          {task.id}
                        </span>
                      ))}
                  </span>
                </div>
              </div>
            )
          })}
        </div>}
      </section>

      <DependencyMap tasks={team.tasks} t={t} />
    </section>
  )
}

/** Legacy conversation cards may outlive their host archive. Project their
 * durable roster through the same rebuilt panel instead of a second UI. */
function historicCardTeam(data: AgentTeamsCardData, owner: string): ActivityTeam {
  return {
    workspace: '',
    teamId: data.teamId,
    name: data.teamName,
    captainSessionId: data.captainSessionId || owner,
    members: data.members.map((member) => ({
      ...member,
      status: 'removed',
      activity: 'idle',
      progress: 0,
      done: 0,
      total: 0,
      currentTask: '',
      unread: 0,
    })),
    tasks: [],
    messageCount: 0,
    captainInbox: [],
  }
}

/** Historic card summaries raised by the conversation card's open button
 * (the floater's recovery path for a session whose host archive is gone). */
export function useTeamHistoric(): ReadonlyMap<string, HistoricCardEntry> {
  const [historic, setHistoric] = useState<ReadonlyMap<string, HistoricCardEntry>>(new Map())
  useEffect(() => {
    const onOpenPanel = (event: Event): void => {
      const detail = (event as CustomEvent<AgentTeamsCardData>).detail
      if (detail?.teamId === undefined) return
      const owner = detail.captainSessionId !== '' ? detail.captainSessionId : ''
      const teamKey = owner + ':' + detail.teamId
      setHistoric((previous) => {
        const next = new Map(previous)
        next.set(teamKey, { data: detail, owner })
        return next
      })
    }
    window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel)
    return () => { window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel) }
  }, [])
  return historic
}

/** The teams list body both hosts render inside their own scroll container. */
export interface TeamStatusViewProps {
  readonly current: SessionId | undefined
  readonly teams: readonly ActivityTeam[]
  readonly archivedTeams: readonly ActivityTeam[]
  readonly historic: ReadonlyMap<string, HistoricCardEntry>
  readonly openMember: (parentId: SessionId, childId: SessionId) => void
  readonly t: AgentTeamsTranslate
  /** Overrides the shared scroll container class (host-scoped CSS module). */
  readonly containerClass?: string
}

export function TeamStatusView({ current, teams, archivedTeams, historic, openMember, t, containerClass }: TeamStatusViewProps) {
  const entries = selectVisibleTeamEntries(current, teams, archivedTeams, historic)
  return (
    <div className={containerClass ?? css.teams}>
      {entries.visibleCount === 0
        ? <span className={css.emptyHint}>{t('activity.empty')}</span>
        : (
          <>
            {entries.visibleTeams.map((team) => (
              <TeamSection key={team.teamId} team={team} onNavigate={openMember} t={t} />
            ))}
            {entries.visibleArchived.map((team) => (
              <div key={team.captainSessionId + ':' + team.teamId} data-team-id={team.teamId} data-historic className={css.archivedWrap}>
                <span className={css.archiveLabel}>{t('archive.label')}</span>
                <TeamSection team={team} onNavigate={openMember} t={t} historic />
              </div>
            ))}
            {entries.visibleHistoric.map(({ data: team, owner }) => (
              <TeamSection key={owner + ':' + team.teamId} team={historicCardTeam(team, owner)} onNavigate={openMember} t={t} historic />
            ))}
          </>
        )}
    </div>
  )
}