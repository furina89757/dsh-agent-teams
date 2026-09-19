/** Browser plugin: the AgentTeams status side card (DSH-better-sidebar
 * extension tab), the legacy floater fallback for profiles without
 * better-sidebar, and the in-conversation conversation card. */

import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the official browser locale service into ClientContext.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: registers the card into the conversation chat-node slot map.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session identity merge (sessionId standard props).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Conversation folding is target-neutral; keyed Chat rendering is owned by
// ui-chat, whose declaration is loaded above.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// The frame-level overlay is declared by ui-layout. This import is type-only;
// ctx.slots.inject below owns the runtime wait for the declaration.
import type { UsePanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
// Official model catalog/directory service. The staged roster reads its
// provider/model/effort metadata without mutating the captain's own selection.
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
// Type-only: better-sidebar's cordis augmentation declares ctx.betterSidebar
// and the consumer types below; erased at build time (no runtime coupling).
import type { TabComponentProps, TabDescriptor } from 'dsh-better-sidebar/client/service'
import type {} from 'dsh-better-sidebar/client/service'
import { ActivityPanel } from './ActivityPanel.tsx'
import { AgentTeamsCard, type AgentTeamsCardInjected } from './AgentTeamsCard.tsx'
import { agentTeamsCardDefinition } from './agent-teams-card-definition.ts'
import { OPEN_PANEL_EVENT } from './AgentTeamsCard.tsx'
import { TeamStatusTab } from './TeamStatusTab.tsx'
import {
  AGENT_TEAMS_TAB_ID,
  sessionTeamBadgeState,
  startSidebarMonitor,
} from './sidebar-monitor.ts'
import {
  getActivityMonitorTargetsSnapshot,
  getActivitySnapshotsSnapshot,
  startActivityPolling,
  subscribeActivityMonitorTargets,
  subscribeActivitySnapshots,
} from './activity-monitor.ts'
import {
  AGENT_TEAMS_LOCALE_NAMESPACE, en, zh, type AgentTeamsLocaleKey,
} from './locales.ts'
import {
  currentSessionId,
  openAgentTeamMember,
  type AgentTeamsLayoutNavigator,
  type AgentTeamsWorkspaceNavigator,
} from './session-navigation.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** AgentTeams conversation card and activity monitor copy. */
    agentTeams: AgentTeamsLocaleKey
  }
}

/** Required services: conversation nodes, slots, sessions navigation, and locale. */
export const inject = ['uiConversation', 'slots', 'sessions', 'locale', 'modelDirectories', 'layout']

/** The host supplies this hook for the lifetime of a 0.1.5 root slot. */
interface PanelNavigationProps {
  usePanelInfo?: UsePanelInfo
}
const useLegacyPanelInfo: UsePanelInfo = select => select({ activePanelId: null })

/** The replayed user message is the canonical transcript entry. */
function HiddenAgentTeamsCommand(): null {
  return null
}

/**
 * Register three surfaces:
 *
 * 1. the DSH-better-sidebar extension side card (`agent-teams:activity`)
 *    — the migrated status display, registered through the optional
 *    betterSidebar service (soft dependency, so profiles without
 *    better-sidebar keep the legacy floater);
 * 2. the legacy shell-overlay floater as a FALLBACK, retired the moment
 *    the betterSidebar service arrives (its disposer also cancels a
 *    pending shell.overlay wait);
 * 3. the in-conversation team card, unchanged, whose activity button now
 *    opens the side card (better-sidebar present) or the floater (fallback).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(AGENT_TEAMS_LOCALE_NAMESPACE, { zh, en }),
    'agent-teams: dictionaries',
  )
  // The typed translate function read at call time: stable per namespace.
  const tabT = ctx.locale.bind(AGENT_TEAMS_LOCALE_NAMESPACE) as (
    key: AgentTeamsLocaleKey,
    params?: Record<string, unknown>,
  ) => string
  const openMember = (parentId: SessionId, childId: SessionId): void => {
    // 0.1.6 moved navigation to the view owner; `uiWorkspace` is absent on
    // older hosts, where the sessions-service route below still applies.
    const workspace = ctx.get('uiWorkspace') as AgentTeamsWorkspaceNavigator | undefined
    void openAgentTeamMember(
      ctx.sessions,
      parentId,
      childId,
      ctx.layout as AgentTeamsLayoutNavigator,
      workspace,
    ).catch((error: unknown) => {
      console.warn(`agent-teams: failed to open member transcript ${childId}: ${String(error)}`)
    })
  }
  const Panel = ({ t, usePanelInfo }: PropsLocale<'agentTeams'> & PanelNavigationProps) => {
    // A host's standard hook set is fixed for this mounted plugin instance.
    const usePanel = usePanelInfo ?? useLegacyPanelInfo
    const conversationVisible = usePanel(panel => panel.activePanelId === null)
    return (
    <ActivityPanel
      conversationVisible={conversationVisible}
      sessionsList={ctx.sessions.list}
      modelDirectories={ctx.modelDirectories}
      openMember={openMember}
      t={t}
    />
    )
  }

  // ── Legacy floater (fallback only) ─────────────────────────────────────
  // Better-sidebar owns the status display when the service is present;
  // without it the floater keeps today's behavior exactly.
  const cancelFloater = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'agent-teams-activity',
    order: 80,
    label: 'AgentTeams activity',
    locale: AGENT_TEAMS_LOCALE_NAMESPACE,
  }, Panel))

  // The host command is only the slash-menu/admission surface. Its input is
  // replayed as the visible user message, so the generic result row would be
  // a duplicate placed before that message by command lifecycle ordering.
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'agent-teams',
  }, HiddenAgentTeamsCommand))

  ctx.uiConversation.events.register(agentTeamsCardDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'agent-teams',
    locale: AGENT_TEAMS_LOCALE_NAMESPACE,
    inject: (): AgentTeamsCardInjected => ({
      openMember,
    }),
  }, AgentTeamsCard))

  // ── DSH-better-sidebar extension side card (the migrated status display) ──
  ctx.inject(['betterSidebar'], (bsCtx) => {
    // The side card has taken over: retire the floater (regardless of
    // whether its shell.overlay slot has been declared yet).
    cancelFloater()
    const openStatusCard = (): void => {
      bsCtx.betterSidebar.openTab({ type: AGENT_TEAMS_TAB_ID })
    }
    // The in-chat card's activity button now opens the side card. The
    // historic card summary still rides the window event detail; the tab's
    // useTeamHistoric hook picks it up exactly like the floater did.
    const onOpenPanel = (): void => { openStatusCard() }
    window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel)
    bsCtx.effect(() => () => {
      window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel)
    }, 'agent-teams: status-card open listener')

    bsCtx.effect(() => {
      const descriptor: TabDescriptor = {
        id: AGENT_TEAMS_TAB_ID,
        title: () => tabT('sidebar.tabTitle'),
        icon: (size: number) => <IconBranchOutline16 size={size} />,
        order: 80,
        single: true,
        component: (props: TabComponentProps) => (
          <TeamStatusTab
            sessionId={props.scope.sessionId as SessionId}
            openMember={openMember}
            t={tabT}
          />
        ),
      }
      if (bsCtx.betterSidebar.features.includes('badge')) {
        descriptor.badge = (tctx, scope) => {
          const badge = sessionTeamBadgeState(getActivitySnapshotsSnapshot().teams, scope.sessionId)
          return badge.count > 0 ? badge.count : null
        }
      }
      const offTab = bsCtx.betterSidebar.registerTab(descriptor)
      return () => { offTab() }
    }, 'agent-teams: register better-sidebar status card')

    // One current-session poll loop keeps the badge and the auto-open guard
    // fresh; use the tab's own visible-gated data flow when it is open.
    bsCtx.effect(() => startSidebarMonitor({
      subscribeSnapshots: subscribeActivitySnapshots,
      getSnapshots: () => getActivitySnapshotsSnapshot(),
      subscribeTargets: subscribeActivityMonitorTargets,
      getTargets: () => getActivityMonitorTargetsSnapshot(),
      subscribeSessions: (listener) => ctx.sessions.list.subscribe(listener),
      // Version-tolerant: 0.1.6 moved the selection out of the list snapshot
      // into per-row consumer counts (see currentSessionId).
      getCurrentSession: () => currentSessionId(ctx.sessions.list.getSnapshot()),
      startPolling: (targets, discoverySessionId) => startActivityPolling(targets, { discoverySessionId }),
      openTab: () => openStatusCard(),
    }), 'agent-teams: better-sidebar session monitor')
  })
}
