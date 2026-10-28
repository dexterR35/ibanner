import { useState } from 'react';
import { Check, Scissors, Undo2 } from 'lucide-react';

const ROLE_NAMES = { headline: 'Headline', subtitle: 'Subtitle', cta: 'CTA' };

/**
 * Copy that is too long for one size. The draft is still produced (text shrinks and wraps);
 * here the user can ask Qwen for shorter versions and approve one for this size only. The
 * campaign's full copy and the legal line are never changed.
 */
export default function CopyFitPanel({ item, campaign, size, disabled, suggest, approve, clear }) {
  const [state, setState] = useState({});
  const approved = campaign?.copyFits?.[size] || {};
  const issues = Object.fromEntries(
    (item?.state === 'succeeded' ? item.copyIssues || [] : []).map((issue) => [issue.role, issue]),
  );
  const roles = Object.keys(ROLE_NAMES).filter(
    (role) => approved[role] != null || issues[role] != null,
  );
  if (!roles.length) return null;
  const stop = (event) => event.stopPropagation();
  async function ask(role) {
    const capacity = issues[role]?.capacity || 0;
    const maxChars = Math.max(2, capacity);
    setState((s) => ({ ...s, [role]: { loading: true } }));
    try {
      const suggestions = await suggest(role, maxChars);
      setState((s) => ({ ...s, [role]: { suggestions } }));
    } catch (error) {
      setState((s) => ({ ...s, [role]: { error: error.message } }));
    }
  }
  return (
    <div
      className="create-copy-fit nodrag nowheel"
      onPointerDown={stop}
      aria-label={`Copy fit for ${size}`}
    >
      {roles.map((role) => {
        const current = state[role] || {};
        if (approved[role] != null)
          return (
            <div key={role} className="create-copy-fit-role">
              <p>
                {ROLE_NAMES[role]} for this size: <q>{approved[role]}</q>
              </p>
              <button
                type="button"
                className="create-node-action"
                disabled={disabled}
                onClick={(event) => {
                  stop(event);
                  clear(role);
                }}
              >
                <Undo2 size={13} />
                <span>Use full {ROLE_NAMES[role].toLowerCase()}</span>
              </button>
            </div>
          );
        const fits = issues[role].capacity;
        return (
          <div key={role} className="create-copy-fit-role">
            <p>
              {ROLE_NAMES[role]} is long for this size: it was made smaller to fit. About {fits} of{' '}
              {issues[role].text.length} characters fit at its normal size.
            </p>
            {fits >= 4 && (
              <button
                type="button"
                className="create-node-action"
                disabled={disabled || current.loading}
                onClick={(event) => {
                  stop(event);
                  ask(role);
                }}
              >
                <Scissors size={13} />
                <span>
                  {current.loading
                    ? 'Asking Qwen…'
                    : `Suggest shorter ${ROLE_NAMES[role].toLowerCase()}`}
                </span>
              </button>
            )}
            {current.error && <p role="alert">{current.error}</p>}
            {current.suggestions?.map((text) => (
              <button
                key={text}
                type="button"
                className="create-node-action create-copy-fit-option"
                disabled={disabled}
                aria-label={`Use "${text}" for ${size}`}
                onClick={(event) => {
                  stop(event);
                  approve(role, text);
                }}
              >
                <Check size={13} />
                <span>{text}</span>
              </button>
            ))}
            {current.suggestions && (
              <small>Approving changes only this size. Generate it again afterwards.</small>
            )}
          </div>
        );
      })}
    </div>
  );
}
