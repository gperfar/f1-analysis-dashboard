/**
 * Optional AI-written recap of a session, generated with Claude during the
 * data build (only when ANTHROPIC_API_KEY is set). The prompt only contains
 * facts computed from the session data, and the model is told to use nothing
 * else, so the recap can't invent results.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SessionStory } from '../src/lib/story';
import { formatTime } from '../src/lib/narrative';

const client = new Anthropic();

const SYSTEM = `You write short recaps of Formula 1 sessions for a data dashboard.
Use only the facts you are given: never add results, causes, quotes or context
that aren't in them. Write one paragraph of 70-110 words in plain, lively
British-English sports prose. No headings, lists, emoji or markdown. Mention
the winner (or fastest driver), how the session unfolded, and what stands out
in the numbers. Use drivers' full names the first time, surnames after.`;

function facts(story: SessionStory): string {
  const byNumber = new Map(story.drivers.map((d) => [d.number, d]));
  const name = (n: number) => `${byNumber.get(n)?.name ?? n} (${byNumber.get(n)?.team ?? '?'})`;
  const lines: string[] = [
    `Event: ${story.meta.event} ${story.meta.year}, round ${story.meta.round}, ${story.meta.name}, at ${story.meta.location}.`,
  ];
  if (story.meta.weather) lines.push(`Weather: air ${story.meta.weather.air}°C, track ${story.meta.weather.track}°C${story.meta.weather.rain ? ', rain at some point' : ', dry'}.`);
  lines.push('Classification (top 10):');
  for (const r of story.classification.slice(0, 10)) {
    const extra =
      story.meta.kind === 'race'
        ? `grid ${r.grid ?? '?'}, ${typeof r.gap === 'number' && r.gap > 0 ? `+${r.gap}s` : r.gap ?? ''} ${r.status !== 'Finished' ? r.status : ''}`
        : r.qTimes
          ? `Q times ${r.qTimes.map((t) => formatTime(t)).join(' / ')}`
          : '';
    lines.push(`  P${r.position}: ${name(r.driver)} ${extra}`.trimEnd());
  }
  const out = story.classification.filter((r) => r.status === 'DNF' || r.status === 'DNS' || r.status === 'DSQ');
  if (out.length) lines.push(`Did not finish / start / disqualified: ${out.map((r) => `${name(r.driver)} ${r.status}`).join('; ')}.`);
  if (story.periods.length) lines.push(`Interruptions: ${story.periods.map((p) => `${p.type} laps ${Math.ceil(p.start) || 1}-${Math.ceil(p.end)}`).join(', ')}.`);
  const compounds = [...new Set(story.stints.map((s) => s.compound))];
  if (compounds.length) lines.push(`Tyre compounds used: ${compounds.join(', ').toLowerCase()}.`);
  lines.push('Computed highlights:');
  story.headlines.forEach((h) => lines.push(`  ${h.label}: ${h.value} (${h.detail})`));
  lines.push(`Template summary: ${story.summary.join(' ')}`);
  return lines.join('\n');
}

export async function aiSummary(story: SessionStory): Promise<string | null> {
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    output_config: { effort: 'medium' },
    // If a safety classifier declines, retry on a fallback model chosen by the API.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: `Write the recap from these facts:\n\n${facts(story)}` }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return text || null;
}
