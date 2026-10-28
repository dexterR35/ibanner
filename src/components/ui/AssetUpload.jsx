import { useId } from 'react';
import { Upload } from 'lucide-react';
import { Input } from './Input.jsx';

export function AssetUpload({ label, assetName, accept, hint, onUpload, disabled }) {
  const hintId = useId();
  return (
    <div>
      <label className="asset-upload">
        <Upload size={14} />
        <span>
          {assetName ? 'Replace' : 'Upload'} {label}
        </span>
        <Input
          type="file"
          aria-label={label}
          aria-describedby={hintId}
          accept={accept}
          disabled={disabled}
          onChange={(event) => {
            onUpload(event.target.files[0]);
            event.target.value = '';
          }}
        />
      </label>
      <p className="asset-caption" id={hintId}>
        {assetName || hint}
      </p>
    </div>
  );
}
