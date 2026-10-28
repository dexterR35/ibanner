import { useMemo, useState } from 'react';
import { Check, Scissors, Undo2 } from 'lucide-react';
import { Button } from '../ui/index.js';
import { useWorkspace } from '../../hooks/useWorkspace.js';
import { resolveBanner } from '../../data/defaults.js';
import { copyFitIssues } from '../../core/copy-fit.js';
import { suggestShorterCopy } from '../../core/generation/planner.js';
import { canvasOf } from '../../core/render.js';

const ROLE_NAMES = { headline: 'Headline', subtitle: 'Offer', cta: 'Button' };

/**
 * Sizes whose copy cannot fit at its minimum size. Qwen3-VL suggests shorter versions; an
 * approved one is used for that size only (campaign.copyFits, shared with Create). The
 * campaign copy, other sizes and legal text stay unchanged.
 */
export default function StudioCopyFit() {
  const { project, entries, campaign, market, resources, busy, changeCampaign } = useWorkspace();
  const [state, setState] = useState({});
  const issues = useMemo(() => {
    if (!resources) return [];
    const context = canvasOf(1, 1).getContext('2d');
    return entries.flatMap((entry) =>
      copyFitIssues(resolveBanner(entry, project.banners[entry.id]), campaign, resources, context),
    );
  }, [entries, project.banners, campaign, resources]);
  const approved = Object.entries(campaign.copyFits || {}).flatMap(([size, fits]) =>
    Object.entries(fits).map(([role, text]) => ({ size, role, text })),
  );
  if (!issues.length && !approved.length) return null;
  const setFit = (size, role, text) => {
    const fits = { ...(campaign.copyFits?.[size] || {}) };
    if (text == null) delete fits[role];
    else fits[role] = text;
    const copyFits = { ...(campaign.copyFits || {}), [size]: fits };
    if (!Object.keys(fits).length) delete copyFits[size];
    changeCampaign({ copyFits });
  };
  async function ask({ size, role, text, capacity }) {
    const id = `${size}:${role}`;
    setState((s) => ({ ...s, [id]: { loading: true } }));
    try {
      const suggestions = await suggestShorterCopy({
        role,
        text,
        maxChars: Math.max(2, Math.min(text.length - 1, capacity || Math.floor(text.length * 0.7))),
        locale: market.locale,
      });
      setState((s) => ({ ...s, [id]: { suggestions } }));
    } catch (error) {
      setState((s) => ({ ...s, [id]: { error: error.message } }));
    }
  }
  return (
    <details className="brand-assets studio-copy-fit" open={issues.length > 0}>
      <summary>Copy fit{issues.length ? ` · ${issues.length} too long` : ''}</summary>
      {approved.map(({ size, role, text }) => (
        <div key={`ok-${size}-${role}`} className="copy-fit-row">
          <p>
            {size} · {ROLE_NAMES[role]}: <q>{text}</q>
          </p>
          <Button variant="subtle" disabled={!!busy} onClick={() => setFit(size, role, null)}>
            <Undo2 size={14} /> Use full copy
          </Button>
        </div>
      ))}
      {issues.map((issue) => {
        const id = `${issue.size}:${issue.role}`,
          current = state[id] || {};
        return (
          <div key={id} className="copy-fit-row">
            <p>
              {issue.size} · {ROLE_NAMES[issue.role]} needs to be shorter (about {issue.capacity} of{' '}
              {issue.text.length} characters fit).
            </p>
            {current.suggestions ? (
              current.suggestions.map((text) => (
                <Button
                  key={text}
                  variant="subtle"
                  disabled={!!busy}
                  onClick={() => setFit(issue.size, issue.role, text)}
                >
                  <Check size={14} /> {text}
                </Button>
              ))
            ) : (
              <Button
                variant="subtle"
                disabled={!!busy || current.loading}
                onClick={() => ask(issue)}
              >
                <Scissors size={14} />{' '}
                {current.loading ? 'Asking Qwen3-VL…' : 'Suggest shorter copy'}
              </Button>
            )}
            {current.error && <p className="copy-fit-error">{current.error}</p>}
          </div>
        );
      })}
    </details>
  );
}
