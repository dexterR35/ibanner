import { SelectField } from '../ui/index.js';

export default function BannerTypography({ campaign, onChange, disabled }) {
  return (
    <SelectField
      label="Banner typography"
      value={campaign.typography || 'original'}
      disabled={disabled}
      onChange={(event) => onChange({ typography: event.target.value })}
    >
      <option value="outfit">Outfit · brand weights</option>
      <option value="original">
        {campaign.fontAssetId ? 'Uploaded font · original weights' : 'Arial · original weights'}
      </option>
    </SelectField>
  );
}
