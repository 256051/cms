"use client";
import { useState } from "react";
import { ImagePlus } from "lucide-react";
import EditorDialog from "./EditorDialog";
import EditorAssetPicker from "./EditorAssetPicker";

export default function AssetSelector({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (id: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="asset-selector">
      <span className="asset-selector-label">{label}</span>
      <div className="row-actions">
        <button
          type="button"
          className="secondary"
          aria-label={label}
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <ImagePlus size={16} aria-hidden="true" />
          {value ? "更换图片" : "选择图片"}
        </button>
        {value && (
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={() => onChange("")}
          >
            移除图片
          </button>
        )}
      </div>
      {open && (
        <EditorDialog title={label} close={() => setOpen(false)}>
          <EditorAssetPicker
            kind="image"
            value={value}
            confirmLabel="使用所选图片"
            insert={(assets) => {
              if (!disabled) onChange(assets[0].id);
              setOpen(false);
            }}
          />
        </EditorDialog>
      )}
    </div>
  );
}
