import type { OutlookConfig } from '../config.js';
import { acquireGraphToken, deviceCodeLogin } from '../auth/msal.js';
import { request, bearer } from '../http.js';
import { rangeContains } from '../range.js';
import type { Activity, DateRange, FetchContext, SourceResult } from '../types.js';

const SCOPES = ['User.Read', 'Calendars.Read', 'Mail.Read'];

export async function loginOutlook(cfg: OutlookConfig): Promise<void> {
  await deviceCodeLogin(cfg, SCOPES, 'Outlook');
}

interface GraphCalendarResponse {
  value: Array<{
    id: string;
    subject: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
    isCancelled: boolean;
    organizer?: { emailAddress: { name?: string; address?: string } };
    onlineMeetingUrl?: string;
    webLink?: string;
  }>;
}

interface GraphMailResponse {
  value: Array<{
    id: string;
    subject: string;
    sentDateTime: string;
    toRecipients: Array<{ emailAddress: { address: string; name?: string } }>;
    webLink?: string;
    bodyPreview?: string;
  }>;
}

export async function fetchOutlook(
  range: DateRange,
  cfg: OutlookConfig,
  ctx: FetchContext,
): Promise<SourceResult> {
  const token = await acquireGraphToken(cfg, SCOPES);
  const headers = { ...bearer(token), accept: 'application/json' };
  const activities: Activity[] = [];

  if (cfg.include_calendar) {
    try {
      const cal = await request<GraphCalendarResponse>(
        `https://graph.microsoft.com/v1.0/me/calendarView`,
        {
          headers,
          query: {
            startDateTime: range.since.toISOString(),
            endDateTime: range.until.toISOString(),
            $select: 'subject,start,end,isCancelled,organizer,webLink',
            $orderby: 'start/dateTime',
            $top: 100,
          },
        },
      );
      for (const ev of cal.value) {
        if (ev.isCancelled) continue;
        const startIso = new Date(`${ev.start.dateTime}Z`).toISOString();
        activities.push({
          source: 'outlook',
          type: 'meeting',
          timestamp: startIso,
          title: ev.subject || '(no subject)',
          url: ev.webLink,
          details: {
            start: ev.start.dateTime,
            end: ev.end.dateTime,
            organizer: ev.organizer?.emailAddress?.address,
          },
        });
      }
    } catch (err) {
      ctx.warn('outlook: calendar fetch failed', err);
    }
  }

  if (cfg.include_sent_mail) {
    try {
      const mail = await request<GraphMailResponse>(
        `https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages`,
        {
          headers,
          query: {
            $filter: `sentDateTime ge ${range.since.toISOString()} and sentDateTime le ${range.until.toISOString()}`,
            $select: 'subject,sentDateTime,toRecipients,webLink,bodyPreview',
            $orderby: 'sentDateTime',
            $top: 100,
          },
        },
      );
      for (const m of mail.value) {
        if (!rangeContains(range, m.sentDateTime)) continue;
        activities.push({
          source: 'outlook',
          type: 'mail-sent',
          timestamp: m.sentDateTime,
          title: m.subject || '(no subject)',
          url: m.webLink,
          details: {
            to: m.toRecipients.map((r) => r.emailAddress.address),
            preview: m.bodyPreview?.slice(0, 160),
          },
        });
      }
    } catch (err) {
      ctx.warn('outlook: sent-mail fetch failed', err);
    }
  }

  activities.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { source: 'outlook', activities };
}
