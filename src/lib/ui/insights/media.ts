import type { MediaView } from '$lib/ui/types';
import type { MediaStatistics } from '$lib/media/statistics';
import type { ProfilePeriod } from '$lib/profile/period';
import { activityChart } from '../charts/activity';
import type { InsightPanel } from './types';
export function mediaOverviewPanels(item:MediaView,members:MediaView[]=[],seasons:MediaView[]=[]):InsightPanel[] {
  const group = (['show', 'season', 'collection'].includes(item.kind));
  const total = (members.length || item.totalEpisodes || 0);
  const completed = (
    Math.min(
      total,
      members.length ? members.filter((m) => m.watched).length : item.completedEpisodes || 0
    )
  );
  const partial = (members.filter((m) => !m.watched && m.progress > 0).length);
  const available = (members.filter((m) => m.available).length);
  const minutes = (members.reduce((n, m) => n + (m.runtimeMinutes ?? 0), 0));
  const duration = (item.duration || (item.runtimeMinutes ?? 0) * 60);
  const position = (
    item.progress > 0 ? Math.min(duration, item.progress) : item.watched ? duration : 0
  );
  const percent = (
    duration ? Math.round((position / duration) * 100) : item.watched ? 100 : 0
  );
  const unit = (item.kind === 'collection' ? 'titles' : 'episodes');
  const progressItems = (
    group
      ? [
          { label: 'Watched', value: completed },
          ...(members.length ? [{ label: 'In progress', value: partial }] : []),
          {
            label: members.length ? 'Not started' : 'Unwatched',
            tone: 'var(--line)',
            value: Math.max(0, total - completed - partial),
          },
        ]
      : [
          { label: 'Played', value: position / 60 },
          {
            label: 'Remaining',
            tone: 'var(--line)',
            value: Math.max(0, (duration - position) / 60),
          },
        ]
  );
  const seasonItems = (
    seasons.map((s) => ({
      label: s.title,
      value: s.completedEpisodes ?? 0,
      total: s.totalEpisodes || undefined,
      href: `/media/${s.id}`,
    }))
  );
  const runtime = (value: number) =>
    value < 60 ? `${value}m` : `${Math.floor(value / 60)}h${value % 60 ? ` ${value % 60}m` : ''}`;
  const metrics = ([
    ...(group
      ? [
          {
            label: `${unit[0].toUpperCase() + unit.slice(1)} watched`,
            value: `${completed} / ${total}`,
          },
        ]
      : [{ label: 'Play count', value: item.playCount }]),
    ...(members.length ? [{ label: 'In your library', value: `${available} / ${total}` }] : []),
    ...(minutes || item.runtimeMinutes
      ? [
          {
            label: group ? 'Total runtime' : 'Runtime',
            value: runtime(minutes || item.runtimeMinutes!),
          },
        ]
      : []),
    {
      label: 'Your rating',
      value: item.rating ? `${item.rating} / 5` : '—',
      detail: item.rating ? undefined : 'Not rated',
    },
  ]);
  return [
    {title:group?'Completion':'Playback progress',description:group?`Across ${total} ${unit}`:
      item.progress>0 && position<duration?'Your saved resume point':item.watched?'Marked as watched':'Not started',
      content:(group && total) || duration ? {kind:'breakdown',props:{label:group?'Viewing completion':'Playback progress',items:progressItems,
        centre:`${group?Math.round((completed/Math.max(1,total))*100):percent}%`,unit:group?'watched':'played'}}
      : {kind:'text',muted:true,text:group?'No episodes or titles have been added yet.':'Progress will appear when a playback duration is available.'},
      footerText:group?'Completion reflects your current watched state. Rewatches stay in your history.':'Playback is measured in minutes. Recorded plays and viewing history are kept separately.'},
    {title:'At a glance',content:{kind:'metrics',props:{items:metrics}}},
    ...(seasonItems.length?[{title:'Season progress',description:'Episodes watched in each season',content:{kind:'progress' as const,props:{label:'Season progress',items:seasonItems}}}]:[]),
  ];
}
export function mediaActivityPanels(result:MediaStatistics,period:ProfilePeriod):InsightPanel[] {
  const date=(value:string|null)=>value?new Date(value).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'—';
  return [
    {title:'Watching activity',content:{kind:'bar',props:activityChart(result.days,result.today,period)},
      footerText:`Completed watches, including rewatches. Dates use UTC.${result.undated?` ${result.undated} undated watches are included in totals, but not plotted.`:''}`},
    {title:'Your history',content:{kind:'metrics',props:{items:[
      {label:'Recorded watches',value:result.watches},{label:'Unique titles',value:result.unique},
      {label:'First watch',value:date(result.first),text:true},{label:'Last watch',value:date(result.last),text:true},
    ]}}},
  ];
}
