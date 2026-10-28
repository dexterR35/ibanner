import { LayoutGrid, Layers, Images, Sparkles } from 'lucide-react';
export const workspaceNavigation = [
  {
    id: 'generate',
    path: '/generate',
    icon: Sparkles,
    label: 'Create from image & copy',
    short: 'Create',
  },
  {
    id: 'campaign',
    path: '/campaign',
    icon: LayoutGrid,
    label: 'Campaign studio',
    short: 'Studio',
  },
  {
    id: 'blueprints',
    path: '/blueprints',
    icon: Layers,
    label: 'Blueprint library',
    short: 'Blueprints',
  },
  { id: 'assets', path: '/assets', icon: Images, label: 'Assets', short: 'Assets' },
];
