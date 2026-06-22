/**
 * クリックでインライン編集する小さなテキストフィールド。
 * ch ラベル / バンク名など、短い文字列の編集に使う共通部品。
 * - editable=false: 値を表示のみ（空なら空表示）
 * - editable=true : クリックで input に切り替え、Enter 確定 / Escape 取消
 */

import { useState } from 'react';

interface InlineTextProps {
  value: string;
  placeholder: string;
  editable: boolean;
  onCommit: (value: string) => void;
  className?: string;
  title?: string;
}

export function InlineText({ value, placeholder, editable, onCommit, className = '', title }: InlineTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    onCommit(draft.trim());
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        placeholder={placeholder}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className={`rounded bg-neutral-900 text-neutral-100 outline-none ring-1 ring-sky-500 ${className}`}
      />
    );
  }

  if (!editable) {
    return (
      <span className={className} title={title ?? value}>
        {value}
      </span>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
      className={`rounded hover:bg-neutral-700 ${className}`}
      title={title ?? 'クリックで編集'}
    >
      {value || <span className="text-neutral-600">{placeholder}</span>}
    </button>
  );
}
