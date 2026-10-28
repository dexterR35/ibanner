import { useEffect, useRef, useState } from 'react';
import { Crosshair, Search } from 'lucide-react';
import { Button, Checkbox, TextField } from '../ui/index.js';
import { useWorkspace } from '../../hooks/useWorkspace.js';
import { useSubjectService } from '../../hooks/useSubjectService.js';

function SubjectPreview({ image, results, focus, onSelect }) {
  const canvas = useRef(),
    start = useRef();
  useEffect(() => {
    if (!image || !canvas.current) return;
    const scale = Math.min(1, 640 / image.width);
    canvas.current.width = Math.round(image.width * scale);
    canvas.current.height = Math.round(image.height * scale);
    canvas.current
      .getContext('2d')
      .drawImage(image, 0, 0, canvas.current.width, canvas.current.height);
  }, [image]);
  const point = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };
  return (
    <div
      className="subject-preview"
      aria-label="Subject preview"
      onPointerDown={(event) => {
        if (event.target.closest('button')) return;
        start.current = point(event);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onPointerUp={(event) => {
        if (!start.current) return;
        const a = start.current,
          b = point(event);
        start.current = null;
        let width = Math.abs(a.x - b.x),
          height = Math.abs(a.y - b.y),
          x = Math.min(a.x, b.x),
          y = Math.min(a.y, b.y);
        if (width < 0.02 || height < 0.02) {
          width = 0.12;
          height = 0.12;
          x = Math.max(0, Math.min(0.88, b.x - 0.06));
          y = Math.max(0, Math.min(0.88, b.y - 0.06));
        }
        onSelect({
          id: 'manual',
          source: 'manual',
          label: 'Manual focus',
          box: { x, y, width, height },
        });
      }}
    >
      <canvas ref={canvas} />
      {results.map((result, index) => (
        <Button
          key={result.id}
          variant="plain"
          className={`subject-box ${focus?.id === result.id ? 'selected' : ''}`}
          style={{
            left: `${result.box.x * 100}%`,
            top: `${result.box.y * 100}%`,
            width: `${result.box.width * 100}%`,
            height: `${result.box.height * 100}%`,
          }}
          aria-label={`Focus ${result.label} ${index + 1}`}
          aria-pressed={focus?.id === result.id}
          onClick={() => onSelect(result)}
        >
          <span>{index + 1}</span>
        </Button>
      ))}
      {focus?.source === 'manual' && (
        <div
          className="subject-box selected manual-focus"
          style={{
            left: `${focus.box.x * 100}%`,
            top: `${focus.box.y * 100}%`,
            width: `${focus.box.width * 100}%`,
            height: `${focus.box.height * 100}%`,
          }}
        />
      )}
    </div>
  );
}

export default function SubjectFocusPanel() {
  const { campaign, market, resources, subject, changeCampaign } = useWorkspace();
  const { connection, refresh } = useSubjectService();
  const [query, setQuery] = useState(campaign.subjectQuery || 'person');
  useEffect(() => setQuery(campaign.subjectQuery || 'person'), [market.id, campaign.subjectQuery]);
  const results =
    campaign.subjectSearch?.assetId === campaign.heroAssetId ? campaign.subjectSearch.results : [];
  const focus =
    campaign.subjectFocus?.assetId === campaign.heroAssetId ? campaign.subjectFocus : null;
  const statusMessage =
    subject.status?.message ??
    (focus ? `Focus: ${focus.label}.` : 'Search by name, or choose a focus below.');
  return (
    <section className="subject-panel" aria-label="Subject positioning">
      <div className="subject-heading">
        <Crosshair size={16} />
        <strong>Manual subject focus</strong>
        <span>Florence-2 · local service</span>
      </div>
      <details className="subject-service">
        <summary>
          {connection.checking
            ? 'Checking Florence-2…'
            : connection.ready
              ? 'Florence-2 available locally'
              : connection.offline
                ? 'Florence-2 offline'
                : 'Florence-2 needs setup'}
        </summary>
        <p>
          {connection.ready
            ? 'Subject detection uses local Florence-2. The first search loads the model.'
            : 'Set up local Florence-2 to detect subjects, or choose a focus manually on the image.'}
        </p>
        {connection.issues?.map((issue) => (
          <p key={issue.code}>{issue.message}</p>
        ))}
        {connection.note && <p>{connection.note}</p>}
        {connection.offline && <p>Start the local service to connect Florence-2.</p>}
        <Button variant="subtle" loading={connection.checking} onClick={refresh}>
          Check connection
        </Button>
      </details>
      <Checkbox
        label="Auto find subject on upload"
        checked={campaign.autoSubject !== false}
        onChange={(event) => changeCampaign({ autoSubject: event.target.checked })}
      />
      {!campaign.heroAssetId ? (
        <p>Upload an image to find a person, face, cards or another object.</p>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              subject.find(query);
            }}
          >
            <TextField
              label="Find in image"
              value={query}
              maxLength={160}
              placeholder="person, playing card, trophy…"
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button type="submit" className="full" loading={subject.status?.loading}>
              <Search size={14} /> Find subject
            </Button>
          </form>
          <div className="subject-presets">
            {[
              ['Person', 'person'],
              ['Cards', 'playing card'],
              ['Product', 'product'],
            ].map(([label, value]) => (
              <Button
                key={value}
                variant="subtle"
                onClick={() => {
                  setQuery(value);
                  subject.find(value);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          {statusMessage && (
            <p className={subject.status?.error ? 'field-error' : ''} role="status">
              {statusMessage}
            </p>
          )}
          {resources?.hero && (
            <SubjectPreview
              image={resources.hero}
              results={results}
              focus={focus}
              onSelect={subject.select}
            />
          )}
          {!!results.length && (
            <div className="subject-results">
              {results.map((result, index) => (
                <Button
                  variant="subtle"
                  key={result.id}
                  aria-pressed={focus?.id === result.id}
                  onClick={() => subject.select(result)}
                >
                  {index + 1} · {result.label}
                </Button>
              ))}
            </div>
          )}
          <p>
            Click a box, or drag an area for manual focus. Crops adapt per format; tight sizes may
            still need review.
          </p>
          {focus && (
            <Button variant="subtle" onClick={() => subject.select(null)}>
              Clear focus
            </Button>
          )}
          {campaign.autoArrange === false && (
            <p>Auto arrange is off. Use Arrange now after changing the manual focus.</p>
          )}
        </>
      )}
    </section>
  );
}
