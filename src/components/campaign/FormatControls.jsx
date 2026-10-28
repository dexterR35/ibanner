import { Search, X } from 'lucide-react';
import { Button, Input } from '../ui/index.js';

export function FormatSearch({ value, onChange }) {
  return (
    <label className="format-search">
      <Search size={14} />
      <Input
        aria-label="Find a format"
        placeholder="Find a size…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <Button variant="icon" aria-label="Clear format search" onClick={() => onChange('')}>
          <X size={12} />
        </Button>
      )}
    </label>
  );
}

export function FormatTabs({ value, onChange, count }) {
  return (
    <div className="segmented" role="group" aria-label="Filter formats">
      {[
        ['all', 'All formats'],
        ['static', 'Static'],
        ['animated', 'Animated'],
      ].map(([id, label]) => (
        <Button
          variant="plain"
          className={value === id ? 'active' : ''}
          key={id}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {label}
          {id === 'all' && <span>{count}</span>}
        </Button>
      ))}
    </div>
  );
}
