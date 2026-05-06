import type { TeamsConfig } from '../config.js';
import { acquireGraphToken, deviceCodeLogin } from '../auth/msal.js';
import { request } from '../http.js';
import { rangeContains } from '../range.js';
import type { Activity, AgendaItem, DateRange, FetchContext, SourceResult } from '../types.js';

const SCOPES = ['User.Read', 'Chat.Read', 'OnlineMeetings.Read'];

export async function loginTeams(cfg: TeamsConfig): Promise<void> {
  await deviceCodeLogin(cfg, SCOPES, 'Teams');
}

interface GraphMe {
  id: string;
  displayName: string;
  userPrincipalName: string;
}

interface GraphChatList {
  value: Array<{
    id: string;
    topic: string | null;
    chatType: 'oneOnOne' | 'group' | 'meeting' | string;
    lastUpdatedDateTime: string;
    members?: Array<{ displayName?: string; email?: string }>;
  }>;
  '@odata.nextLink'?: string;
}

interface GraphMessageList {
  value: Array<{
    id: string;
    createdDateTime: string;
    from?: { user?: { id: string; displayName?: string } } | null;
    body?: { content?: string; contentType?: string };
  }>;
  '@odata.nextLink'?: string;
}

interface GraphOnlineMeetingList {
  value: Array<{
    id: string;
    subject?: string;
    startDateTime: string;
    endDateTime: string;
    joinWebUrl?: string;
  }>;
}

export async function fetchTeams(
  range: DateRange,
  cfg: TeamsConfig,
  ctx: FetchContext,
): Promise<SourceResult> {
  const token = await acquireGraphToken(cfg, SCOPES);
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const activities: Activity[] = [];

  const me = await request<GraphMe>('https://graph.microsoft.com/v1.0/me', { headers });

  if (cfg.include_chats) {
    try {
      const chats = await request<GraphChatList>('https://graph.microsoft.com/v1.0/me/chats', {
        headers,
        query: { $orderby: 'lastUpdatedDateTime desc', $top: cfg.max_chats, $expand: 'members' },
      });

      const relevant = chats.value.filter((c) => {
        const t = new Date(c.lastUpdatedDateTime).getTime();
        return t >= range.since.getTime() && t <= range.until.getTime() + 24 * 3600 * 1000;
      });
      ctx.log(`teams: scanning ${relevant.length}/${chats.value.length} chats with activity in window`);

      for (const chat of relevant) {
        try {
          const msgs = await request<GraphMessageList>(
            `https://graph.microsoft.com/v1.0/me/chats/${chat.id}/messages`,
            { headers, query: { $top: 50 } },
          );
          const mineInRange = msgs.value.filter(
            (m) => m.from?.user?.id === me.id && rangeContains(range, m.createdDateTime),
          );
          if (mineInRange.length === 0) continue;

          const counterparts = chat.members
            ?.map((m) => m.displayName)
            .filter((n): n is string => Boolean(n) && n !== me.displayName)
            .slice(0, 3) ?? [];
          const label =
            chat.chatType === 'oneOnOne' && counterparts.length
              ? `Chat mit ${counterparts[0]}`
              : chat.topic ?? `Gruppen-Chat (${counterparts.join(', ') || 'unknown'})`;

          activities.push({
            source: 'teams',
            type: 'chat-activity',
            timestamp: mineInRange[0]!.createdDateTime,
            title: `${label} — ${mineInRange.length} eigene Nachricht(en)`,
            details: {
              chatType: chat.chatType,
              participants: counterparts,
              messageCount: mineInRange.length,
            },
          });
        } catch (err) {
          ctx.warn(`teams: messages fetch failed for chat ${chat.id}`, err);
        }
      }
    } catch (err) {
      ctx.warn('teams: chat list failed', err);
    }
  }

  if (cfg.include_online_meetings) {
    try {
      const meetings = await request<GraphOnlineMeetingList>(
        'https://graph.microsoft.com/v1.0/me/onlineMeetings',
        {
          headers,
          query: {
            $filter: `startDateTime ge ${range.since.toISOString()} and startDateTime le ${range.until.toISOString()}`,
          },
        },
      );
      for (const m of meetings.value) {
        activities.push({
          source: 'teams',
          type: 'meeting',
          timestamp: m.startDateTime,
          title: m.subject || '(Online Meeting)',
          url: m.joinWebUrl,
          details: { start: m.startDateTime, end: m.endDateTime },
        });
      }
    } catch (err) {
      ctx.warn('teams: online meetings fetch failed', err);
    }
  }

  activities.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const agenda = cfg.include_online_meetings ? await fetchTeamsAgenda(headers, ctx) : [];
  return { source: 'teams', activities, agenda };
}

async function fetchTeamsAgenda(
  headers: Record<string, string>,
  ctx: FetchContext,
): Promise<AgendaItem[]> {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const meetings = await request<GraphOnlineMeetingList>(
      'https://graph.microsoft.com/v1.0/me/onlineMeetings',
      {
        headers,
        query: {
          $filter: `startDateTime ge ${startOfToday.toISOString()} and startDateTime le ${endOfToday.toISOString()}`,
        },
      },
    );
    const out: AgendaItem[] = [];
    for (const m of meetings.value) {
      if (new Date(m.endDateTime).getTime() < now.getTime()) continue;
      out.push({
        source: 'teams',
        type: 'online-meeting',
        start: m.startDateTime,
        end: m.endDateTime,
        title: m.subject || '(Online Meeting)',
        url: m.joinWebUrl,
      });
    }
    return out;
  } catch (err) {
    ctx.warn('teams: today-agenda fetch failed', err);
    return [];
  }
}
