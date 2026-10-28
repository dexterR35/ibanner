import { Button, Card } from '../ui/index.js';
import { Layers, ArrowUpRight } from 'lucide-react';

export default function CampaignSummary({ campaign, market, count, onReferences }) {
  return (
    <Card as="div" className="campaign-meta">
      <span className="campaign-icon">
        <Layers size={19} />
      </span>
      <div>
        <strong>{campaign.name}</strong>
        <small>
          {count} formats <span>·</span> {market.name} <span>·</span>Campaign set
        </small>
      </div>
      <span className="draft-badge">Draft</span>
      <Button variant="subtle" onClick={onReferences}>
        View references <ArrowUpRight size={14} />
      </Button>
    </Card>
  );
}
