import { autoAnimate } from '../../core/auto-animation.js';
import { Button, Input, NumberField } from '../ui/index.js';
import { Play, Pause, Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';

import { sceneAt, sceneStart, totalDuration } from '../../core/timeline.js';
import { uid } from '../../data/defaults.js';

export default function Timeline({
  bp,
  setBp,
  time,
  setTime,
  playing,
  setPlaying,
  selected,
  campaign,
}) {
  const { scene, index } = sceneAt(bp, time),
    total = totalDuration(bp),
    track = scene.tracks[selected] || {};
  const editScene = (patch) =>
    setBp({ ...bp, scenes: bp.scenes.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  const editTrack = (patch) =>
    editScene({ tracks: { ...scene.tracks, [selected]: { ...track, ...patch } } });
  function duration(value) {
    const durationMs = Math.max(100, Math.min(15000, Math.round(value / 10) * 10));
    const tracks = Object.fromEntries(
      Object.entries(scene.tracks).map(([id, t]) => [
        id,
        {
          ...t,
          startMs: Math.min(t.startMs || 0, durationMs - 10),
          endMs: t.endMs ? Math.min(t.endMs, durationMs) : undefined,
          fadeInMs: 0,
          fadeOutMs: 0,
        },
      ]),
    );
    editScene({ durationMs, tracks, transitionMs: Math.min(scene.transitionMs, durationMs) });
    setTime(sceneStart(bp, index));
  }
  function add() {
    const next = { ...structuredClone(scene), id: uid(), name: `Part ${bp.scenes.length + 1}` };
    setBp({ ...bp, mode: 'animated', scenes: [...bp.scenes, next] });
    setTime(total);
  }
  function remove() {
    const scenes = bp.scenes.filter((_, i) => i !== index);
    setBp({ ...bp, scenes });
    setTime(0);
  }
  function move(delta) {
    const scenes = [...bp.scenes],
      next = index + delta;
    [scenes[index], scenes[next]] = [scenes[next], scenes[index]];
    const updated = { ...bp, scenes };
    setBp(updated);
    setTime(sceneStart(updated, next));
  }
  return (
    <section className="timeline">
      <div className="timeline-toolbar">
        <div className="row">
          <Button
            variant="plain"
            className="play-button"
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? 'Pause animation' : 'Play animation'}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </Button>
          <strong>Timeline</strong>
          <span className="muted">
            {(time / 1000).toFixed(2)} / {(total / 1000).toFixed(2)} s
          </span>
        </div>
        <div className="row">
          <Button
            variant="subtle"
            onClick={() => {
              setBp(autoAnimate(bp, campaign));
              setTime(0);
              setPlaying(false);
            }}
          >
            Auto parts
          </Button>
          <span className="micro">{bp.scenes.length} PARTS</span>
          <Button variant="subtle" disabled={bp.scenes.length >= 12} onClick={add}>
            <Plus size={14} /> Add part
          </Button>
        </div>
      </div>
      <div className="scene-strip">
        {bp.scenes.map((s, i) => (
          <Button
            variant="plain"
            key={s.id}
            style={{ flex: s.durationMs }}
            className={`scene-block ${index === i ? 'selected' : ''}`}
            onClick={() => {
              setPlaying(false);
              setTime(sceneStart(bp, i));
            }}
          >
            <span>
              0{i + 1} · {s.name}
            </span>
            <small>{(s.durationMs / 1000).toFixed(1)}s</small>
          </Button>
        ))}
      </div>
      <Input
        className="scrubber"
        aria-label="Timeline position"
        type="range"
        min="0"
        max={total - 1}
        value={time}
        onChange={(e) => {
          setPlaying(false);
          setTime(+e.target.value);
        }}
      />
      <div className="timeline-settings">
        <label className="field">
          <span>Part name</span>
          <Input value={scene.name} onChange={(e) => editScene({ name: e.target.value })} />
        </label>
        <NumberField
          label="Duration (ms)"
          value={scene.durationMs}
          min={100}
          max={15000}
          step={10}
          onChange={duration}
        />
        <NumberField
          label="Crossfade (ms)"
          value={scene.transitionMs}
          min={0}
          max={Math.min(2000, scene.durationMs)}
          step={10}
          onChange={(v) =>
            editScene({ transitionMs: Math.min(Math.max(0, v), scene.durationMs, 2000) })
          }
        />
        <div className="row">
          <Button
            variant="icon"
            disabled={index === 0}
            onClick={() => move(-1)}
            title="Move part earlier"
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="icon"
            disabled={index === bp.scenes.length - 1}
            onClick={() => move(1)}
            title="Move part later"
          >
            <ChevronRight size={16} />
          </Button>
          <Button
            variant="icon"
            disabled={bp.scenes.length === 1}
            onClick={remove}
            title="Remove part"
          >
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
      {selected && (
        <div className="track-settings">
          <label className="check">
            <Input
              type="checkbox"
              checked={track.visible !== false}
              onChange={(e) => editTrack({ visible: e.target.checked })}
            />{' '}
            {bp.layers.find((l) => l.id === selected)?.name} in this part
          </label>
          <NumberField
            label="In (ms)"
            value={track.startMs || 0}
            min={0}
            max={(track.endMs || scene.durationMs) - 10}
            step={10}
            onChange={(v) =>
              editTrack({
                startMs: Math.max(0, Math.min(v, (track.endMs || scene.durationMs) - 10)),
                fadeInMs: 0,
                fadeOutMs: 0,
              })
            }
          />
          <NumberField
            label="Out (ms)"
            value={track.endMs || scene.durationMs}
            min={(track.startMs || 0) + 10}
            max={scene.durationMs}
            step={10}
            onChange={(v) =>
              editTrack({
                endMs: Math.max((track.startMs || 0) + 10, Math.min(v, scene.durationMs)),
                fadeInMs: 0,
                fadeOutMs: 0,
              })
            }
          />
          <NumberField
            label="Fade in (ms)"
            value={track.fadeInMs || 0}
            min={0}
            step={10}
            onChange={(v) =>
              editTrack({
                fadeInMs: Math.max(
                  0,
                  Math.min(
                    v,
                    (track.endMs || scene.durationMs) -
                      (track.startMs || 0) -
                      (track.fadeOutMs || 0),
                  ),
                ),
              })
            }
          />
          <NumberField
            label="Fade out (ms)"
            value={track.fadeOutMs || 0}
            min={0}
            step={10}
            onChange={(v) =>
              editTrack({
                fadeOutMs: Math.max(
                  0,
                  Math.min(
                    v,
                    (track.endMs || scene.durationMs) -
                      (track.startMs || 0) -
                      (track.fadeInMs || 0),
                  ),
                ),
              })
            }
          />
        </div>
      )}
    </section>
  );
}
